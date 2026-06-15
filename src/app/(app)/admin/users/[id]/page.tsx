import Link from "next/link";
import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { AdminLocalDateTime } from "@/components/admin/admin-local-time";
import { ApproveWithGrantForm } from "@/components/admin/approve-with-grant-form";
import { ConfirmSubmitForm } from "@/components/admin/confirm-submit-form";
import { DetailDateRow, DetailFieldRow, DetailPager, DetailRow, DetailSection } from "@/components/admin/detail";
import { ExpandableImage } from "@/components/admin/expandable-image";
import { HackatimeTrustStatus } from "@/components/admin/hackatime-trust-status";
import { PosterPlacementMap } from "@/components/admin/poster-placement-map";
import { SlackAvatar, SlackProfile } from "@/components/admin/slack-profile";
import { StatusBadge } from "@/components/admin/status-badge";
import { SuperuserPasswordForm } from "@/components/admin/superuser-password-form";
import { Timestamp } from "@/components/timestamp";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { pillVariants } from "@/components/ui/pill";
import { Textarea } from "@/components/ui/textarea";
import { getTranslatedPageMetadata } from "@/i18n/metadata";
import { fetchHackClubAddresses } from "@/lib/auth";
import {
  APPLICATION_STATUS_ACCEPTED,
  APPLICATION_STATUS_REJECTED,
  APPLICATION_STATUS_REJECTED_PERMANENT,
  canChangeApplicationReviewStatus,
  isRejectedPermanentlyApplicationStatus,
} from "@/lib/applications/status";
import sql from "@/lib/database/client";
import { ensureSchema } from "@/lib/database/ensure-schema";
import { formatDate, formatDateTime, formatTimeInTimeZone, joinNonEmpty } from "@/lib/format";
import {
  getOfficeGrantDashboardMessage,
  refreshOfficeGrantBalanceForUser,
} from "@/lib/hcb/grants";
import { getCachedHackatimeTrustLevel } from "@/lib/hackatime";
import { formatPosterLabel } from "@/lib/posters/format";
import { loadPosterPlacementsForUser } from "@/lib/posters/map-points";
import { getPosterProofUrl } from "@/lib/posters/storage";
import { readHcaAccessToken } from "@/lib/hca-access-token";
import { ensureUserAddressSchema } from "@/lib/database/user-address-schema";
import {
  getOverrideFlagsForUser,
  SAFEGUARD_KEYS,
  type SafeguardKey,
} from "@/lib/safeguards";
import {
  getUserManualDashboardStateLabel,
  isUserManualDashboardState,
} from "@/lib/user-dashboard-state";
import { getActorSession } from "@/lib/session";

const USER_FLAG_CONTROLS: { key: SafeguardKey; labelKey: string }[] = [
  { key: SAFEGUARD_KEYS.onboardingEnabled, labelKey: "admin.user-detail.flags.onboarding-enabled" },
  { key: SAFEGUARD_KEYS.shirtOrderingEnabled, labelKey: "admin.user-detail.flags.shirt-ordering-enabled" },
  { key: SAFEGUARD_KEYS.postersEnabled, labelKey: "admin.user-detail.flags.posters-enabled" },
  { key: SAFEGUARD_KEYS.referralsEnabled, labelKey: "admin.user-detail.flags.referrals-enabled" },
];
import { normalizeHackClubAddresses } from "@/lib/settings";
import { isSuperuserConfigured } from "@/lib/superuser";

type AdminUserRow = {
  id: string;
  hca_id: string | null;
  email: string | null;
  hca_first_name: string | null;
  hca_last_name: string | null;
  verification_status: string | null;
  is_admin: boolean | null;
  last_ip: string | null;
  latitude: number | null;
  longitude: number | null;
  city: string | null;
  region: string | null;
  country_code: string | null;
  country_name: string | null;
  postal_code: string | null;
  timezone: string | null;
  org: string | null;
  hca_addresses: unknown;
  hca_access_token: string | null;
  permanently_rejected_at: string | null;
  permanent_rejection_note: string | null;
  created_at: string;
  updated_at: string;
  manual_dashboard_state: string | null;
  slack_id: string | null;
  slack_name: string | null;
  display_name: string;
};

type ApplicationListRow = {
  id: string;
  status: string;
  name: string;
  date_of_birth?: string | null;
  decision_note?: string | null;
  created_at: string;
  updated_at?: string;
};

type CountRow = { count: number };
type LatestNoteEventRow = { note: string | null };
type PosterListRow = {
  id: string;
  name: string | null;
  group_name: string | null;
  referral_code: string;
  poster_type: string;
  verification_status: string;
  rejection_reason: string | null;
  proof_path: string | null;
  proof_content_type: string | null;
  created_at: string;
};
type PosterCountsRow = {
  total_count: number;
  pending_count: number;
  in_review_count: number;
  success_count: number;
  rejected_count: number;
  digital_count: number;
};
type ReferralListRow = {
  id: string;
  name: string;
  email: string;
  hours_logged: string | number;
  hours_approved: string | number;
  verification_status: string;
  referred_at: string;
};
type ReferralCountsRow = {
  total_count: number;
  unverified_count: number;
  pending_count: number;
  verified_count: number;
  rejected_count: number;
};
type VisitRow = {
  id: string;
  ip: string;
  visit_type: string;
  city: string | null;
  region: string | null;
  country_code: string | null;
  org: string | null;
  timezone: string | null;
  created_at: string;
};

const HCB_GRANT_STATUS_KEYS = new Set([
  "linked",
  "queued",
  "already_linked",
  "already_pending",
  "not_onboarded",
  "provision_failed",
  "unlinked",
  "invalid",
  "not_found",
  "link_failed",
  "unlink_failed",
]);

export async function generateMetadata(): Promise<Metadata> {
  return getTranslatedPageMetadata("admin.user-detail.metadata.title");
}

export default async function AdminUserDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    visitsPage?: string;
    notesPage?: string;
    postersPage?: string;
    referralsPage?: string;
    hcbGrant?: string;
    superuser?: string;
  }>;
}) {
  const [{ id }, query, t, locale, actorSession] = await Promise.all([
    params,
    searchParams,
    getTranslations(),
    getLocale(),
    getActorSession(),
  ]);
  const requestedVisitsPage = Number(query.visitsPage ?? "1");
  const visitsPage = Number.isFinite(requestedVisitsPage) && requestedVisitsPage > 0
    ? Math.floor(requestedVisitsPage)
    : 1;
  const requestedNotesPage = Number(query.notesPage ?? "1");
  const notesPage = Number.isFinite(requestedNotesPage) && requestedNotesPage > 0
    ? Math.floor(requestedNotesPage)
    : 1;
  const requestedPostersPage = Number(query.postersPage ?? "1");
  const postersPage = Number.isFinite(requestedPostersPage) && requestedPostersPage > 0
    ? Math.floor(requestedPostersPage)
    : 1;
  const requestedReferralsPage = Number(query.referralsPage ?? "1");
  const referralsPage = Number.isFinite(requestedReferralsPage) && requestedReferralsPage > 0
    ? Math.floor(requestedReferralsPage)
    : 1;
  const POSTERS_PER_PAGE = 10;
  const REFERRALS_PER_PAGE = 10;

  await ensureSchema();
  await ensureUserAddressSchema();

  const user = (await sql<AdminUserRow[]>`
    SELECT id, hca_id, email, display_name, hca_first_name, hca_last_name, slack_id, slack_name,
           slack_avatar_url, verification_status, is_admin, last_ip, latitude, longitude, city,
           region, country_code, country_name, postal_code, timezone, org, hca_addresses,
           hca_access_token,
           manual_dashboard_state,
           permanently_rejected_at, permanent_rejection_note, created_at, updated_at
    FROM users
    WHERE id = ${id}
    LIMIT 1
  `).at(0);

  if (!user) notFound();

  const userOverrideKeys = await getOverrideFlagsForUser(user.id);

  const storedAddresses = Array.isArray(user.hca_addresses)
    ? user.hca_addresses.filter(
        (address): address is Record<string, unknown> =>
          address !== null && typeof address === "object",
      )
    : [];
  const hcaAccessToken = readHcaAccessToken(user.hca_access_token);
  const liveAddresses = hcaAccessToken !== null
    ? await fetchHackClubAddresses(hcaAccessToken).catch((error) => {
        console.error("Failed to load live Hack Club Auth addresses", {
          userId: user.id,
          error,
        });
        return [];
      })
    : [];
  const addresses = normalizeHackClubAddresses(
    liveAddresses.length > 0 ? liveAddresses : storedAddresses,
  );
  const hackatimeTrust = await getCachedHackatimeTrustLevel(user.slack_id);

  const [
    latestApplication,
    applications,
    visitCountResult,
    visits,
    orders,
    latestNoteEvent,
    noteCountResult,
    noteHistory,
    posterCounts,
    posterList,
    referralCounts,
    referralList,
    posterPlacements,
  ] = await Promise.all([
    sql<ApplicationListRow[]>`
      SELECT id, status, name, date_of_birth, decision_note, created_at, updated_at
      FROM applications
      WHERE user_id = ${user.id}
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `.then((rows) => rows.at(0) ?? null),
    sql<ApplicationListRow[]>`
      SELECT id, status, name, decision_note, created_at
      FROM applications
      WHERE user_id = ${user.id}
      ORDER BY created_at DESC, id DESC
    `,
    sql<CountRow[]>`
      SELECT COUNT(*)::int AS count
      FROM ip_visits
      WHERE user_id = ${user.id}
    `.then((rows) => rows.at(0)?.count ?? 0),
    sql<VisitRow[]>`
      SELECT id, ip, visit_type, city, region, country_code, org, timezone, created_at
      FROM ip_visits
      WHERE user_id = ${user.id}
      ORDER BY created_at DESC
      LIMIT 3
      OFFSET ${(visitsPage - 1) * 3}
    `,
    sql`
      SELECT id, status, created_at
      FROM orders
      WHERE user_id = ${user.id}
      ORDER BY created_at DESC
      LIMIT 10
    `,
    sql<LatestNoteEventRow[]>`
      SELECT note
      FROM user_note_events
      WHERE user_id = ${user.id}
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `.then((rows) => rows.at(0) ?? null),
    sql<CountRow[]>`
      SELECT COUNT(*)::int AS count
      FROM user_note_events
      WHERE user_id = ${user.id}
    `.then((rows) => rows.at(0)?.count ?? 0),
    sql`
      SELECT une.id, une.note, une.created_at, une.created_by,
             actor.display_name AS actor_display_name, actor.email AS actor_email
      FROM user_note_events une
      LEFT JOIN users actor ON actor.id = une.created_by
      WHERE une.user_id = ${user.id}
      ORDER BY une.created_at DESC, une.id DESC
      LIMIT 3
      OFFSET ${(notesPage - 1) * 3}
    `,
    sql<PosterCountsRow[]>`
      SELECT
        COUNT(*)::int AS total_count,
        COUNT(*) FILTER (WHERE verification_status = 'pending')::int AS pending_count,
        COUNT(*) FILTER (WHERE verification_status = 'in_review')::int AS in_review_count,
        COUNT(*) FILTER (WHERE verification_status = 'success')::int AS success_count,
        COUNT(*) FILTER (WHERE verification_status = 'rejected')::int AS rejected_count,
        COUNT(*) FILTER (WHERE verification_status = 'digital')::int AS digital_count
      FROM posters
      WHERE user_id = ${user.id} AND deleted_at IS NULL
    `.then((rows) => rows.at(0) ?? {
      total_count: 0,
      pending_count: 0,
      in_review_count: 0,
      success_count: 0,
      rejected_count: 0,
      digital_count: 0,
    }),
    sql<PosterListRow[]>`
      SELECT p.id, p.name, g.name AS group_name, p.referral_code, p.poster_type,
             p.verification_status, p.rejection_reason, p.proof_path, p.proof_content_type,
             p.created_at
      FROM posters p
      LEFT JOIN poster_groups g ON g.id = p.poster_group_id
      WHERE p.user_id = ${user.id} AND p.deleted_at IS NULL
      ORDER BY p.created_at DESC, p.id DESC
      LIMIT ${POSTERS_PER_PAGE}
      OFFSET ${(postersPage - 1) * POSTERS_PER_PAGE}
    `,
    sql<ReferralCountsRow[]>`
      SELECT
        COUNT(*)::int AS total_count,
        COUNT(*) FILTER (WHERE verification_status = 'unverified')::int AS unverified_count,
        COUNT(*) FILTER (WHERE verification_status = 'pending')::int AS pending_count,
        COUNT(*) FILTER (WHERE verification_status = 'verified')::int AS verified_count,
        COUNT(*) FILTER (WHERE verification_status = 'rejected')::int AS rejected_count
      FROM stardance_referrals
      WHERE user_id = ${user.id}
    `.then((rows) => rows.at(0) ?? {
      total_count: 0,
      unverified_count: 0,
      pending_count: 0,
      verified_count: 0,
      rejected_count: 0,
    }),
    sql<ReferralListRow[]>`
      SELECT id, name, email, hours_logged, hours_approved, verification_status, referred_at
      FROM stardance_referrals
      WHERE user_id = ${user.id}
      ORDER BY referred_at DESC, id DESC
      LIMIT ${REFERRALS_PER_PAGE}
      OFFSET ${(referralsPage - 1) * REFERRALS_PER_PAGE}
    `,
    loadPosterPlacementsForUser(user.id),
  ]);
  const currentUserNote =
    typeof latestNoteEvent?.note === "string" && latestNoteEvent.note.trim().length > 0
      ? latestNoteEvent.note
      : null;
  const officeGrant = await refreshOfficeGrantBalanceForUser(user.id);
  const usdFormatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
  });
  const officeGrantDashboardMessage = getOfficeGrantDashboardMessage({ grant: officeGrant });
  const officeGrantUrl = officeGrantDashboardMessage.href;
  const hasLinkedOfficeGrant =
    officeGrant?.provisioningState === "linked" &&
    officeGrant?.grantId !== null;
  const officeGrantBalance =
    officeGrant?.balanceCents !== null &&
    officeGrant?.balanceCents !== undefined &&
    Number.isFinite(officeGrant.balanceCents)
      ? usdFormatter.format(officeGrant.balanceCents / 100)
      : null;
  const hcbGrantStatus = query.hcbGrant?.trim() ?? "";
  const hcbGrantFlashMessage =
    hcbGrantStatus !== "" && HCB_GRANT_STATUS_KEYS.has(hcbGrantStatus)
      ? t(`office-grant.admin-status.${hcbGrantStatus}`)
      : null;
  const superuserStatus = query.superuser?.trim() ?? "";
  const superuserFlashMessage = superuserStatus === ""
    ? null
    : superuserStatus === "missing"
      ? t("admin.user-detail.superuser.missing")
      : superuserStatus === "invalid"
        ? t("admin.user-detail.superuser.invalid")
        : null;
  const superuserConfigured = isSuperuserConfigured();

  const totalVisitPages = Math.max(1, Math.ceil(visitCountResult / 3));
  const currentVisitPage = Math.min(visitsPage, totalVisitPages);
  const totalNotePages = Math.max(1, Math.ceil(noteCountResult / 3));
  const currentNotePage = Math.min(notesPage, totalNotePages);
  const totalPosterPages = Math.max(1, Math.ceil(posterCounts.total_count / POSTERS_PER_PAGE));
  const currentPosterPage = Math.min(postersPage, totalPosterPages);
  const posterProofUrls = new Map(
    await Promise.all(
      posterList.map(async (poster) => {
        const isImage =
          poster.proof_path !== null &&
          poster.proof_path !== "" &&
          (poster.proof_content_type === null || poster.proof_content_type.startsWith("image/"));
        const url = isImage
          ? await getPosterProofUrl(poster.proof_path, poster.proof_content_type)
          : null;
        return [poster.id, url] as const;
      }),
    ),
  );
  const totalReferralPages = Math.max(1, Math.ceil(referralCounts.total_count / REFERRALS_PER_PAGE));
  const currentReferralPage = Math.min(referralsPage, totalReferralPages);
  const numberFormatter = new Intl.NumberFormat(locale);
  const hoursFormatter = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 2,
  });
  const shouldShowPermanentRejectionLabel =
    Boolean(user.permanently_rejected_at) &&
    !isRejectedPermanentlyApplicationStatus(latestApplication?.status);
  const canAccept = latestApplication
    ? canChangeApplicationReviewStatus(latestApplication.status, APPLICATION_STATUS_ACCEPTED)
    : false;
  const canReject = latestApplication
    ? canChangeApplicationReviewStatus(latestApplication.status, APPLICATION_STATUS_REJECTED)
    : false;
  const canRejectPermanently = latestApplication
    ? canChangeApplicationReviewStatus(
        latestApplication.status,
        APPLICATION_STATUS_REJECTED_PERMANENT,
      )
    : false;
  const manualDashboardState = isUserManualDashboardState(
    user.manual_dashboard_state,
  )
    ? user.manual_dashboard_state
    : null;
  const manualDashboardStateLabel = manualDashboardState
    ? getUserManualDashboardStateLabel(t, manualDashboardState)
    : t("admin.user-detail.dashboard-state.no-manual-state");
  const headerStatus = manualDashboardState
    ? manualDashboardState
    : shouldShowPermanentRejectionLabel
      ? "rejected_permanently"
      : latestApplication?.status ?? null;
  const shouldShowHeaderLatestApplicationLabel =
    !manualDashboardState &&
    latestApplication !== null &&
    !shouldShowPermanentRejectionLabel;
  const canImpersonateUser = Boolean(actorSession && actorSession.sub !== user.id);
  const canRemoveAdmin = user.is_admin === true && actorSession?.sub !== user.id;

  return (
    <div className="space-y-12">
      <header className="space-y-4">
        <div className="flex flex-wrap items-center gap-3 text-sm text-secondary">
          <Link href="/admin/users" className="hover:text-foreground">
            {t("admin.user-detail.breadcrumb")}
          </Link>
          <span>/</span>
          <span className="font-body text-foreground">{user.id}</span>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-4">
              <SlackAvatar
                slackId={user.slack_id}
                fallbackName={user.slack_name ?? user.display_name}
                sizeClassName="h-16 w-16"
                textClassName="text-lg"
              />
              <h1 className="text-4xl leading-[3rem] text-foreground">{user.display_name}</h1>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {headerStatus !== null ? (
                <>
                  <StatusBadge status={headerStatus} />
                  {manualDashboardState ? (
                    <span className={pillVariants({ tone: "black" })}>
                      {t("admin.user-detail.sections.dashboard-state.title")}
                    </span>
                  ) : null}
                  {shouldShowHeaderLatestApplicationLabel ? (
                    <span className={pillVariants({ tone: "green" })}>
                      {t("admin.user-detail.latest-application")}
                    </span>
                  ) : null}
                </>
              ) : (
                <span className="text-sm text-foreground">{t("admin.user-detail.no-application")}</span>
              )}
              {shouldShowPermanentRejectionLabel && (
                <span className={pillVariants({ tone: "red" })}>
                  {t("admin.user-detail.user-permanently-rejected")}
                </span>
              )}
            </div>
          </div>
          {latestApplication ? (
            <Link
              href={`/admin/applications/${latestApplication.id}`}
              aria-label={t("admin.user-detail.open-latest-application")}
              className="ui-open-link inline-flex font-body text-lg leading-none"
            >
              <span aria-hidden="true">↗</span>
            </Link>
          ) : null}
        </div>
      </header>

      <DetailSection
        title={t("admin.user-detail.sections.user-actions.title")}
        description={t("admin.user-detail.sections.user-actions.description")}
      >
        <div className="space-y-8">
          {superuserFlashMessage !== null ? (
            <p className="max-w-xl font-body text-base text-foreground">
              {superuserFlashMessage}
            </p>
          ) : !superuserConfigured ? (
            <p className="max-w-xl font-body text-base text-foreground">
              {t("admin.user-detail.superuser.missing")}
            </p>
          ) : null}

          {canImpersonateUser ? (
            <form action={`/api/admin/users/${user.id}/impersonate`} method="POST">
              <input type="hidden" name="redirectTo" value="/dashboard" />
              <button className={buttonVariants({ size: "app" })}>
                {t("admin.user-detail.actions.impersonate")}
              </button>
            </form>
          ) : null}

          {user.is_admin !== true ? (
            <SuperuserPasswordForm
              action={`/api/admin/users/${user.id}/make-admin`}
              buttonLabel={t("admin.user-detail.actions.make-admin")}
              confirmationMessage={t("admin.user-detail.actions.make-admin-confirmation")}
              disabled={!superuserConfigured}
              passwordPrompt={t("admin.user-detail.superuser.password-label")}
              redirectTo={`/admin/users/${user.id}`}
              variant="success"
            />
          ) : null}

          {canRemoveAdmin ? (
            <SuperuserPasswordForm
              action={`/api/admin/users/${user.id}/remove-admin`}
              buttonLabel={t("admin.user-detail.actions.remove-admin")}
              confirmationMessage={t("admin.user-detail.actions.remove-admin-confirmation")}
              disabled={!superuserConfigured}
              passwordPrompt={t("admin.user-detail.superuser.password-label")}
              redirectTo={`/admin/users/${user.id}`}
            />
          ) : null}

          {latestApplication ? (
            <div className="space-y-8">
              <div className="pb-2">
                <div className="text-sm text-secondary">{t("admin.user-detail.actions.current-review-target")}</div>
                <div className="mt-1 flex flex-wrap items-center gap-3">
                  <span className="font-body text-sm text-foreground">{latestApplication.id}</span>
                  <StatusBadge status={latestApplication.status} />
                  {shouldShowHeaderLatestApplicationLabel ? (
                    <span className={pillVariants({ tone: "green" })}>
                      {t("admin.user-detail.latest-application")}
                    </span>
                  ) : null}
                </div>
              </div>

              {canAccept ? (
                <ApproveWithGrantForm
                  action={`/api/admin/users/${user.id}/approve`}
                  method="POST"
                  className="max-w-xl space-y-3"
                >
                  <input type="hidden" name="redirectTo" value={`/admin/users/${user.id}`} />
                  <button className={buttonVariants({ variant: "success", size: "app" })}>
                    {t("admin.user-detail.actions.bypass-approval")}
                  </button>
                </ApproveWithGrantForm>
              ) : null}

              {canReject ? (
                <ConfirmSubmitForm
                  action={`/api/admin/users/${user.id}/reject`}
                  method="POST"
                  className="max-w-xl space-y-3"
                  confirmationMessage={t("common.confirm-destructive")}
                >
                  <input type="hidden" name="redirectTo" value={`/admin/users/${user.id}`} />
                  <label className="block text-sm text-secondary">
                    {t("admin.user-detail.actions.reject-note-label")}
                    <Textarea
                      name="note"
                      required
                      rows={5}
                      className="ui-input-surface mt-2 min-h-24 resize-none border-foreground bg-transparent px-5 py-4 font-body text-base font-normal placeholder:font-normal hover:bg-transparent md:text-base"
                      placeholder={t("admin.user-detail.actions.reject-note-placeholder")}
                    />
                  </label>
                  <button className={buttonVariants({ size: "app" })}>
                    {t("admin.user-detail.actions.reject")}
                  </button>
                </ConfirmSubmitForm>
              ) : null}

              {canRejectPermanently ? (
                <ConfirmSubmitForm
                  action={`/api/admin/users/${user.id}/reject-permanently`}
                  method="POST"
                  className="max-w-xl space-y-3"
                  confirmationMessage={t("common.confirm-destructive")}
                >
                  <input type="hidden" name="redirectTo" value={`/admin/users/${user.id}`} />
                  <label className="block text-sm text-secondary">
                    {t("admin.user-detail.actions.permanent-rejection-note-label")}
                    <Textarea
                      name="note"
                      rows={4}
                      className="ui-input-surface mt-2 min-h-20 resize-none border-foreground bg-transparent px-5 py-4 font-body text-base font-normal placeholder:font-normal hover:bg-transparent md:text-base"
                      placeholder={t("admin.user-detail.actions.permanent-rejection-note-placeholder")}
                    />
                  </label>
                  <button className={buttonVariants({ size: "app" })}>
                    {t("admin.user-detail.actions.reject-permanently")}
                  </button>
                </ConfirmSubmitForm>
              ) : null}
            </div>
          ) : (
            <p className="font-body text-base text-foreground">
              {t("admin.user-detail.actions.no-review-target")}
            </p>
          )}

          <div className="space-y-4 pt-8">
            <div className="space-y-2">
              <h3 className="text-2xl leading-8 text-foreground">
                {t("admin.user-detail.sections.dashboard-state.title")}
              </h3>
              <p className="max-w-3xl font-body text-base text-foreground">
                {t("admin.user-detail.sections.dashboard-state.description")}
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <form action={`/api/admin/users/${user.id}/state`} method="POST">
                <input type="hidden" name="redirectTo" value={`/admin/users/${user.id}`} />
                <input type="hidden" name="state" value="approved" />
                <button className={buttonVariants({ variant: "success", size: "app-sm" })}>
                  {t("admin.user-detail.dashboard-state.set-approved")}
                </button>
              </form>
              <form action={`/api/admin/users/${user.id}/state`} method="POST">
                <input type="hidden" name="redirectTo" value={`/admin/users/${user.id}`} />
                <input type="hidden" name="state" value="rejected" />
                <button className={buttonVariants({ size: "app-sm" })}>
                  {t("admin.user-detail.dashboard-state.set-rejected")}
                </button>
              </form>
              <form action={`/api/admin/users/${user.id}/state`} method="POST">
                <input type="hidden" name="redirectTo" value={`/admin/users/${user.id}`} />
                <input type="hidden" name="state" value="banned" />
                <button className={buttonVariants({ size: "app-sm" })}>
                  {t("admin.user-detail.dashboard-state.set-banned")}
                </button>
              </form>
              <form action={`/api/admin/users/${user.id}/state`} method="POST">
                <input type="hidden" name="redirectTo" value={`/admin/users/${user.id}`} />
                <input type="hidden" name="state" value="" />
                <button className={buttonVariants({ size: "app-sm" })}>
                  {t("admin.user-detail.dashboard-state.clear-state")}
                </button>
              </form>
            </div>
          </div>
        </div>
      </DetailSection>

      <DetailSection
        title={t("admin.user-detail.sections.flags.title")}
        description={t("admin.user-detail.sections.flags.description")}
      >
        <div className="max-w-xl space-y-3">
          {USER_FLAG_CONTROLS.map((control) => {
            const enabled = userOverrideKeys.has(control.key);
            return (
              <form
                key={control.key}
                action={`/api/admin/users/${user.id}/flags`}
                method="POST"
                className="flex flex-wrap items-center justify-between gap-3 border-b border-foreground/10 pb-4 last:border-b-0"
              >
                <input type="hidden" name="redirectTo" value={`/admin/users/${user.id}`} />
                <input type="hidden" name="flagKey" value={control.key} />
                <input type="hidden" name="action" value={enabled ? "disable" : "enable"} />
                <div className="flex flex-col">
                  <span className="font-body text-sm text-foreground">{t(control.labelKey)}</span>
                  <span className="text-xs text-secondary">
                    {enabled
                      ? t("admin.user-detail.flags.override-active")
                      : t("admin.user-detail.flags.override-inactive")}
                  </span>
                </div>
                <button
                  className={buttonVariants({
                    size: "app-sm",
                    variant: enabled ? "default" : "success",
                  })}
                >
                  {enabled
                    ? t("admin.user-detail.flags.remove-override")
                    : t("admin.user-detail.flags.grant-override")}
                </button>
              </form>
            );
          })}
        </div>
      </DetailSection>

      <div id="office-grant">
        <DetailSection
          title="Office Grant"
          description="Manage the linked HCB office-expenses grant for this ambassador."
        >
          {hcbGrantFlashMessage !== null ? (
            <p className="font-body text-base text-foreground">{hcbGrantFlashMessage}</p>
          ) : null}
          <DetailFieldRow
            label="Provisioning state"
            value={officeGrant?.provisioningState ?? "none"}
          />
          <DetailFieldRow
            label="Provisioning source"
            value={officeGrant?.provisioningSource}
          />
          <DetailFieldRow
            label="Grant ID"
            value={officeGrant?.grantId}
            mono
          />
          <DetailFieldRow
            label="Purpose"
            value={officeGrant?.purpose ?? "Office grant!"}
          />
          <DetailFieldRow
            label="Amount"
            value={usdFormatter.format((officeGrant?.amountCents ?? 2_000) / 100)}
          />
          <div className="grid gap-2 sm:grid-cols-[14rem_minmax(0,1fr)] sm:gap-5">
            <div className="text-sm text-secondary">Current balance</div>
            <div className="font-body text-base text-acceptance break-words [overflow-wrap:anywhere]">
              {officeGrantBalance ?? "-"}
            </div>
          </div>
          <DetailRow label="Grant link">
            {officeGrantUrl !== null ? (
              <a
                href={officeGrantUrl}
                target="_blank"
                rel="noreferrer"
                className="font-body text-sm text-foreground underline transition-opacity hover:opacity-80"
              >
                {officeGrantUrl}
              </a>
            ) : (
              <div className="font-body text-sm text-foreground">-</div>
            )}
          </DetailRow>
          <DetailFieldRow
            label="Last error"
            value={officeGrant?.lastError}
          />
          <DetailDateRow
            label="Next retry"
            value={officeGrant?.nextRetryAt}
            locale={locale}
          />
          <DetailDateRow
            label="Balance synced"
            value={officeGrant?.balanceSyncedAt}
            locale={locale}
          />
          <DetailDateRow
            label="Linked at"
            value={officeGrant?.linkedAt}
            locale={locale}
          />

          <div className="flex flex-wrap items-end gap-4">
            {!hasLinkedOfficeGrant ? (
              <ConfirmSubmitForm
                action={`/api/admin/users/${user.id}/hcb-grant/provision`}
                method="POST"
                confirmationMessage="Are you sure?"
              >
                <input type="hidden" name="redirectTo" value={`/admin/users/${user.id}#office-grant`} />
                <button className={buttonVariants({ variant: "success", size: "app" })}>
                  Provision grant
                </button>
              </ConfirmSubmitForm>
            ) : null}

            <ConfirmSubmitForm
              action={`/api/admin/users/${user.id}/hcb-grant/unlink`}
              method="POST"
              confirmationMessage="Are you sure?"
            >
              <input type="hidden" name="redirectTo" value={`/admin/users/${user.id}#office-grant`} />
              <button className={buttonVariants({ size: "app" })}>
                Unlink grant
              </button>
            </ConfirmSubmitForm>
          </div>

          <ConfirmSubmitForm
            action={`/api/admin/users/${user.id}/hcb-grant/link`}
            method="POST"
            className="max-w-sm space-y-3"
            confirmationMessage="Are you sure?"
          >
            <input type="hidden" name="redirectTo" value={`/admin/users/${user.id}#office-grant`} />
            <label className="block text-sm text-secondary">
              Link to grant ID
              <Input
                name="grantId"
                type="text"
                placeholder="grt_..."
                className="ui-input-surface !bg-muted mt-2 h-11 !rounded-none border-0 px-4 font-body text-base font-normal text-foreground placeholder:text-foreground/40 hover:!bg-muted md:text-base"
              />
            </label>
            <button className={buttonVariants({ variant: "success", size: "app" })}>
              Link grant
            </button>
          </ConfirmSubmitForm>
        </DetailSection>
      </div>

      <div id="internal-notes">
        <DetailSection
          title={t("admin.user-detail.sections.notes.title")}
          description={t("admin.user-detail.sections.notes.description")}
        >
          <DetailFieldRow
            label={t("admin.user-detail.notes.current-note")}
            value={currentUserNote}
            multiline
          />

          <form action={`/api/admin/users/${user.id}/note`} method="POST" className="max-w-xl space-y-3">
            <input type="hidden" name="redirectTo" value={`/admin/users/${user.id}#internal-notes`} />
            <label className="block text-sm text-secondary">
              {t("admin.user-detail.notes.note-label")}
              <Textarea
                name="note"
                rows={5}
                defaultValue={currentUserNote ?? ""}
                className="ui-input-surface mt-2 min-h-24 resize-none border-foreground bg-transparent px-5 py-4 font-body text-base font-normal placeholder:font-normal hover:bg-transparent md:text-base"
                placeholder={t("admin.user-detail.notes.note-placeholder")}
              />
            </label>
            <button className={buttonVariants({ size: "app" })}>
              {t("admin.user-detail.actions.save-note")}
            </button>
          </form>

          <div className="space-y-4">
            <h3 className="font-body text-sm text-secondary">
              {t("admin.user-detail.notes.history-title")}
            </h3>
            {noteHistory.length > 0 ? (
              noteHistory.map((entry) => (
                <div key={entry.id} className="border-t border-foreground/10 pt-4 first:border-t-0 first:pt-0">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="font-body text-sm text-foreground">
                      {entry.actor_display_name ??
                        entry.actor_email ??
                        entry.created_by ??
                        t("admin.user-detail.notes.unknown-actor")}
                    </span>
                    <span className="text-xs text-secondary">
                      <Timestamp value={entry.created_at} locale={locale} />
                    </span>
                  </div>
                  <div className="mt-2 whitespace-pre-line font-body text-base text-foreground break-words [overflow-wrap:anywhere]">
                      {typeof entry.note === "string" && entry.note.trim() !== ""
                        ? entry.note
                        : t("admin.user-detail.notes.cleared")}
                  </div>
                </div>
              ))
            ) : (
              <p className="font-body text-base text-foreground">{t("admin.user-detail.notes.empty")}</p>
            )}
          </div>
          <DetailPager
            label={t("common.page-fraction", { page: currentNotePage, totalPages: totalNotePages })}
            page={currentNotePage}
            totalPages={totalNotePages}
            href={(page) => {
              const search = new URLSearchParams();

              if (currentVisitPage > 1) {
                search.set("visitsPage", String(currentVisitPage));
              }

              if (page > 1) {
                search.set("notesPage", String(page));
              }

              const query = search.toString();
              return `${query ? `?${query}` : ""}#internal-notes`;
            }}
          />
        </DetailSection>
      </div>

      <DetailSection
        title={t("admin.user-detail.sections.user-profile.title")}
        description={t("admin.user-detail.sections.user-profile.description")}
      >
        <DetailFieldRow label={t("admin.user-detail.profile-fields.display-name")} value={user.display_name} />
        <DetailFieldRow label={t("admin.user-detail.profile-fields.first-name")} value={user.hca_first_name} />
        <DetailFieldRow label={t("admin.user-detail.profile-fields.last-name")} value={user.hca_last_name} />
        <DetailFieldRow label={t("admin.user-detail.profile-fields.email")} value={user.email} />
        <SlackProfile
          label={t("admin.user-detail.profile-fields.slack")}
          slackName={user.slack_name}
          slackId={user.slack_id}
          fallbackName={user.display_name}
        />
        <DetailRow label={t("admin.user-detail.profile-fields.hackatime-trust-level")}>
          <HackatimeTrustStatus
            slackId={user.slack_id}
            trustLevel={hackatimeTrust?.trustLevel}
          />
        </DetailRow>
        <DetailFieldRow label={t("admin.user-detail.profile-fields.hca-id")} value={user.hca_id} mono />
        <DetailFieldRow label={t("admin.user-detail.profile-fields.verification-status")} value={user.verification_status} />
        <DetailFieldRow
          label={t("admin.user-detail.profile-fields.hca-addresses")}
          value={
            addresses.length > 0
              ? addresses
                  .map(
                    (address, index) =>
                      `(${index + 1})\n${[
                        address.line_1 ?? null,
                        address.line_2 ?? null,
                        joinNonEmpty(
                          address.city ?? null,
                          address.state ?? null,
                          address.postal_code ?? null,
                          address.country ?? null,
                        ),
                      ]
                          .filter((part): part is string => part !== null && part !== "")
                        .join("\n")}`,
                  )
                  .join("\n\n")
              : null
          }
          multiline
        />
        <DetailFieldRow label={t("admin.user-detail.profile-fields.location")} value={joinNonEmpty(user.city, user.region, user.country_name, user.country_code)} />
        <DetailFieldRow label={t("admin.user-detail.profile-fields.postal-code")} value={user.postal_code} mono />
        <DetailFieldRow label={t("admin.user-detail.profile-fields.timezone")} value={user.timezone} mono />
        <DetailFieldRow label={t("admin.user-detail.profile-fields.network-org")} value={user.org} />
        <DetailFieldRow
          label={t("admin.user-detail.profile-fields.coordinates")}
          value={
            user.latitude == null || user.longitude == null
              ? null
              : `${user.latitude.toFixed(4)}, ${user.longitude.toFixed(4)}`
          }
          mono
        />
        <DetailFieldRow label={t("admin.user-detail.profile-fields.last-seen-ip")} value={user.last_ip} mono />
        <DetailFieldRow label={t("admin.user-detail.profile-fields.admin")} value={user.is_admin === true ? t("common.yes") : t("common.no")} />
        <DetailFieldRow label={t("admin.user-detail.profile-fields.manual-dashboard-state")} value={manualDashboardStateLabel} />
        <DetailDateRow label={t("admin.user-detail.profile-fields.created")} value={user.created_at} locale={locale} />
        <DetailDateRow label={t("admin.user-detail.profile-fields.updated")} value={user.updated_at} locale={locale} />
      </DetailSection>

      <DetailSection
        title={t("admin.user-detail.sections.applications.title")}
        description={t("admin.user-detail.sections.applications.description")}
      >
        {applications.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-foreground">
                  <th className="px-0 py-4 font-body text-sm leading-8 text-secondary">{t("admin.user-detail.applications.submitted")}</th>
                  <th className="px-4 py-4 font-body text-sm leading-8 text-secondary">{t("admin.user-detail.applications.status")}</th>
                  <th className="px-4 py-4 font-body text-sm leading-8 text-secondary">{t("admin.user-detail.applications.name")}</th>
                  <th className="px-4 py-4 font-body text-sm leading-8 text-secondary">{t("admin.user-detail.applications.open")}</th>
                </tr>
              </thead>
              <tbody>
                {applications.map((application) => (
                  <tr key={application.id} className="border-b border-foreground last:border-b-0">
                    <td className="px-0 py-4 font-body text-sm leading-8 text-foreground"><Timestamp value={application.created_at} locale={locale} /></td>
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-2">
                        <StatusBadge status={application.status} />
                        {latestApplication?.id === application.id ? (
                          <span className={pillVariants({ tone: "green" })}>
                            {t("common.latest")}
                          </span>
                        ) : (
                          <span className={pillVariants({ tone: "black" })}>
                            {t("admin.applications-list.history")}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-4 font-body text-sm leading-8 text-foreground">{application.name}</td>
                    <td className="px-4 py-4">
                      <Link
                        href={`/admin/applications/${application.id}`}
                        aria-label={t("admin.user-detail.applications.view")}
                        className="ui-open-link inline-flex font-body text-lg leading-none"
                      >
                        <span aria-hidden="true">↗</span>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="font-body text-base text-foreground">{t("admin.user-detail.applications.empty")}</p>
        )}
      </DetailSection>

      <DetailSection
        title={t("admin.user-detail.sections.latest-application-snapshot.title")}
        description={t("admin.user-detail.sections.latest-application-snapshot.description")}
      >
        {latestApplication ? (
          <>
            <DetailFieldRow label={t("admin.user-detail.latest-application-snapshot.application-id")} value={latestApplication.id} mono />
            <DetailDateRow label={t("admin.user-detail.latest-application-snapshot.submitted")} value={latestApplication.created_at} locale={locale} />
            <DetailDateRow label={t("admin.user-detail.latest-application-snapshot.updated")} value={latestApplication.updated_at} locale={locale} />
            <DetailFieldRow label={t("admin.user-detail.latest-application-snapshot.name-on-app")} value={latestApplication.name} />
            <DetailFieldRow label={t("admin.user-detail.latest-application-snapshot.date-of-birth")} value={formatDate(latestApplication.date_of_birth, locale)} />
            <DetailFieldRow label={t("admin.user-detail.latest-application-snapshot.decision-note")} value={latestApplication.decision_note} />
          </>
        ) : (
          <p className="font-body text-base text-foreground">{t("admin.user-detail.latest-application-snapshot.empty")}</p>
        )}
      </DetailSection>

      <DetailSection
        title={t("admin.user-detail.sections.permanent-rejection.title")}
        description={t("admin.user-detail.sections.permanent-rejection.description")}
      >
        <DetailDateRow label={t("admin.user-detail.permanent-rejection.rejected-permanently-at")} value={user.permanently_rejected_at} locale={locale} />
        <DetailFieldRow label={t("admin.user-detail.permanent-rejection.permanent-note")} value={user.permanent_rejection_note} />
      </DetailSection>

      <DetailSection
        title={t("admin.user-detail.sections.visits.title")}
        description={t("admin.user-detail.sections.visits.description", { duration: "10 minutes" })}
      >
        <div className="space-y-4">
          {visits.length > 0 ? (
            visits.map((visit) => {
              const visitorZone = visit.timezone ?? user.timezone;
              const localVisitTime = formatTimeInTimeZone(visit.created_at, locale, visitorZone);

              return (
                <div key={visit.id} className="pb-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-body text-sm text-foreground">{visit.ip}</span>
                    <span className="text-xs text-secondary">{visit.visit_type}</span>
                  </div>
                  <div className="mt-1 font-body text-sm text-foreground">
                    {joinNonEmpty(visit.city, visit.region, null, visit.country_code) ?? "-"}
                  </div>
                  <div className="mt-1 font-body text-sm text-foreground">{visit.org ?? t("admin.user-detail.visits.unknown-network")}</div>
                  <div className="mt-1 text-xs text-foreground">
                    <AdminLocalDateTime
                      value={visit.created_at}
                      locale={locale}
                      fallback={formatDateTime(visit.created_at, locale) ?? "-"}
                    />
                    {" · "}
                    {t("common.your-time")}
                  </div>
                  {localVisitTime !== null && visitorZone ? (
                    <div className="mt-0.5 text-xs text-secondary">
                      {t("common.visitor-time", { time: localVisitTime, zone: visitorZone })}
                    </div>
                  ) : null}
                </div>
              );
            })
          ) : (
            <p className="font-body text-base text-foreground">{t("admin.user-detail.visits.empty")}</p>
          )}
        </div>
        <DetailPager
          label={t("common.page-fraction", { page: currentVisitPage, totalPages: totalVisitPages })}
          page={currentVisitPage}
          totalPages={totalVisitPages}
          href={(page) => {
            const search = new URLSearchParams();

            if (page > 1) {
              search.set("visitsPage", String(page));
            }

            if (currentNotePage > 1) {
              search.set("notesPage", String(currentNotePage));
            }

            const query = search.toString();
            return query ? `?${query}` : "";
          }}
        />
      </DetailSection>

      <DetailSection
        title={t("admin.user-detail.sections.orders.title")}
        description={t("admin.user-detail.sections.orders.description")}
      >
        <div className="space-y-4">
          {orders.length > 0 ? (
            orders.map((order) => (
              <div key={order.id} className="flex flex-wrap items-center justify-between gap-3 pb-4">
                <span className="font-body text-sm text-foreground">{order.id}</span>
                <div className="flex items-center gap-3">
                  <StatusBadge status={order.status} />
                  <span className="text-xs text-foreground"><Timestamp value={order.created_at} locale={locale} /></span>
                </div>
              </div>
            ))
          ) : (
            <p className="font-body text-base text-foreground">{t("admin.user-detail.orders.empty")}</p>
          )}
        </div>
      </DetailSection>

      <div id="posters">
        <DetailSection
          title={t("admin.user-detail.sections.posters.title")}
          description={t("admin.user-detail.sections.posters.description")}
        >
          <div className="space-y-1">
            <p className="font-body text-base text-foreground">
              {t("admin.user-detail.posters.total", {
                count: numberFormatter.format(posterCounts.total_count),
              })}
            </p>
            <p className="font-body text-sm text-muted-foreground">
              {t("admin.user-detail.posters.breakdown", {
                pending: numberFormatter.format(posterCounts.pending_count),
                inReview: numberFormatter.format(posterCounts.in_review_count),
                success: numberFormatter.format(posterCounts.success_count),
                rejected: numberFormatter.format(posterCounts.rejected_count),
                digital: numberFormatter.format(posterCounts.digital_count),
              })}
            </p>
          </div>

          {posterPlacements.length > 0 ? (
            <div className="space-y-1">
              <h3 className="font-body text-base font-medium text-foreground">
                {t("admin.user-detail.posters.where.title")}
              </h3>
              <p className="font-body text-sm text-muted-foreground">
                {t("admin.user-detail.posters.where.description")}
              </p>
              <div className="pt-2">
                <PosterPlacementMap posters={posterPlacements} />
              </div>
            </div>
          ) : null}

          {posterList.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-foreground">
                    <th className="px-0 py-4 font-body text-sm leading-8 text-secondary">
                      {t("admin.user-detail.posters.columns.created")}
                    </th>
                    <th className="px-4 py-4 font-body text-sm leading-8 text-secondary">
                      {t("admin.user-detail.posters.columns.proof")}
                    </th>
                    <th className="px-4 py-4 font-body text-sm leading-8 text-secondary">
                      {t("admin.user-detail.posters.columns.name")}
                    </th>
                    <th className="px-4 py-4 font-body text-sm leading-8 text-secondary">
                      {t("admin.user-detail.posters.columns.code")}
                    </th>
                    <th className="px-4 py-4 font-body text-sm leading-8 text-secondary">
                      {t("admin.user-detail.posters.columns.type")}
                    </th>
                    <th className="px-4 py-4 font-body text-sm leading-8 text-secondary">
                      {t("admin.user-detail.posters.columns.status")}
                    </th>
                    <th className="px-4 py-4 font-body text-sm leading-8 text-secondary">
                      {t("admin.user-detail.posters.columns.actions")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {posterList.map((poster) => {
                    const canReject = poster.verification_status !== "rejected";
                    const proofUrl = posterProofUrls.get(poster.id) ?? null;
                    return (
                      <tr key={poster.id} className="border-b border-foreground last:border-b-0">
                        <td className="px-0 py-4 font-body text-sm leading-8 text-foreground">
                          <Timestamp value={poster.created_at} locale={locale} />
                        </td>
                        <td className="px-4 py-4">
                          {proofUrl !== null ? (
                            <ExpandableImage
                              src={proofUrl}
                              alt={poster.name ?? poster.referral_code}
                            />
                          ) : (
                            <span className="font-body text-sm text-secondary">
                              {t("admin.user-detail.posters.no-proof")}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-4 font-body text-sm leading-8 text-foreground">
                          {formatPosterLabel({
                            name: poster.name,
                            referralCode: poster.referral_code,
                            groupName: poster.group_name,
                          })}
                        </td>
                        <td className="px-4 py-4 font-body text-sm leading-8 text-foreground">
                          {poster.referral_code}
                        </td>
                        <td className="px-4 py-4 font-body text-sm leading-8 text-foreground">
                          {poster.poster_type}
                        </td>
                        <td className="px-4 py-4">
                          <span
                            className={pillVariants({
                              tone:
                                poster.verification_status === "success"
                                  ? "green"
                                  : poster.verification_status === "rejected"
                                    ? "red"
                                    : "black",
                            })}
                          >
                            {poster.verification_status}
                          </span>
                        </td>
                        <td className="px-4 py-4">
                          {canReject ? (
                            <ConfirmSubmitForm
                              action={`/api/admin/users/${user.id}/posters/${poster.id}/reject`}
                              method="POST"
                              confirmationMessage={t(
                                "admin.user-detail.posters.reject-confirmation",
                              )}
                            >
                              <input
                                type="hidden"
                                name="redirectTo"
                                value={`/admin/users/${user.id}#posters`}
                              />
                              <button className={buttonVariants({ size: "app-sm" })}>
                                {t("admin.user-detail.posters.reject")}
                              </button>
                            </ConfirmSubmitForm>
                          ) : (
                            <span className="font-body text-sm text-secondary">-</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="font-body text-base text-foreground">
              {t("admin.user-detail.posters.empty")}
            </p>
          )}

          <DetailPager
            label={t("common.page-fraction", {
              page: currentPosterPage,
              totalPages: totalPosterPages,
            })}
            page={currentPosterPage}
            totalPages={totalPosterPages}
            href={(page) => {
              const search = new URLSearchParams();
              if (currentVisitPage > 1) search.set("visitsPage", String(currentVisitPage));
              if (currentNotePage > 1) search.set("notesPage", String(currentNotePage));
              if (currentReferralPage > 1) search.set("referralsPage", String(currentReferralPage));
              if (page > 1) search.set("postersPage", String(page));
              const queryString = search.toString();
              return `${queryString ? `?${queryString}` : ""}#posters`;
            }}
          />
        </DetailSection>
      </div>

      <div id="referrals">
        <DetailSection
          title={t("admin.user-detail.sections.referrals.title")}
          description={t("admin.user-detail.sections.referrals.description")}
        >
          <div className="space-y-1">
            <p className="font-body text-base text-foreground">
              {t("admin.user-detail.referrals.total", {
                count: numberFormatter.format(referralCounts.total_count),
              })}
            </p>
            <p className="font-body text-sm text-muted-foreground">
              {t("admin.user-detail.referrals.breakdown", {
                unverified: numberFormatter.format(referralCounts.unverified_count),
                pending: numberFormatter.format(referralCounts.pending_count),
                verified: numberFormatter.format(referralCounts.verified_count),
                rejected: numberFormatter.format(referralCounts.rejected_count),
              })}
            </p>
          </div>

          {referralList.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-foreground">
                    <th className="px-0 py-4 font-body text-sm leading-8 text-secondary">
                      {t("admin.user-detail.referrals.columns.referred")}
                    </th>
                    <th className="px-4 py-4 font-body text-sm leading-8 text-secondary">
                      {t("admin.user-detail.referrals.columns.name")}
                    </th>
                    <th className="px-4 py-4 font-body text-sm leading-8 text-secondary">
                      {t("admin.user-detail.referrals.columns.email")}
                    </th>
                    <th className="px-4 py-4 font-body text-sm leading-8 text-secondary">
                      {t("admin.user-detail.referrals.columns.hours")}
                    </th>
                    <th className="px-4 py-4 font-body text-sm leading-8 text-secondary">
                      {t("admin.user-detail.referrals.columns.status")}
                    </th>
                    <th className="px-4 py-4 font-body text-sm leading-8 text-secondary">
                      {t("admin.user-detail.referrals.columns.actions")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {referralList.map((referral) => {
                    const hoursLogged = Number(referral.hours_logged);
                    const hoursApproved = Number(referral.hours_approved);
                    const isRsvp = referral.verification_status === "rsvp";
                    const canVerify =
                      !isRsvp && referral.verification_status !== "verified";
                    const canReject =
                      !isRsvp && referral.verification_status !== "rejected";
                    return (
                      <tr key={referral.id} className="border-b border-foreground last:border-b-0">
                        <td className="px-0 py-4 font-body text-sm leading-8 text-foreground">
                          <Timestamp value={referral.referred_at} locale={locale} />
                        </td>
                        <td className="px-4 py-4 font-body text-sm leading-8 text-foreground">
                          {referral.name}
                        </td>
                        <td className="px-4 py-4 font-body text-sm leading-8 text-foreground break-words [overflow-wrap:anywhere]">
                          {referral.email}
                        </td>
                        <td className="px-4 py-4 font-body text-sm leading-8 text-foreground">
                          {hoursFormatter.format(Number.isFinite(hoursApproved) ? hoursApproved : 0)}
                          {" / "}
                          {hoursFormatter.format(Number.isFinite(hoursLogged) ? hoursLogged : 0)}
                        </td>
                        <td className="px-4 py-4">
                          <span
                            className={pillVariants({
                              tone:
                                referral.verification_status === "verified"
                                  ? "green"
                                  : referral.verification_status === "rejected"
                                    ? "red"
                                    : "black",
                            })}
                          >
                            {referral.verification_status}
                          </span>
                        </td>
                        <td className="px-4 py-4">
                          {isRsvp ? (
                            <span className="font-body text-sm text-secondary">-</span>
                          ) : (
                            <div className="flex flex-wrap gap-2">
                              {canVerify ? (
                                <ConfirmSubmitForm
                                  action={`/api/admin/users/${user.id}/referrals/${referral.id}/status`}
                                  method="POST"
                                  confirmationMessage={t(
                                    "admin.user-detail.referrals.verify-confirmation",
                                  )}
                                >
                                  <input
                                    type="hidden"
                                    name="redirectTo"
                                    value={`/admin/users/${user.id}#referrals`}
                                  />
                                  <input type="hidden" name="status" value="verified" />
                                  <button
                                    className={buttonVariants({ size: "app-sm", variant: "success" })}
                                  >
                                    {t("admin.user-detail.referrals.verify")}
                                  </button>
                                </ConfirmSubmitForm>
                              ) : null}
                              {canReject ? (
                                <ConfirmSubmitForm
                                  action={`/api/admin/users/${user.id}/referrals/${referral.id}/status`}
                                  method="POST"
                                  confirmationMessage={t(
                                    "admin.user-detail.referrals.reject-confirmation",
                                  )}
                                >
                                  <input
                                    type="hidden"
                                    name="redirectTo"
                                    value={`/admin/users/${user.id}#referrals`}
                                  />
                                  <input type="hidden" name="status" value="rejected" />
                                  <button className={buttonVariants({ size: "app-sm" })}>
                                    {t("admin.user-detail.referrals.reject")}
                                  </button>
                                </ConfirmSubmitForm>
                              ) : null}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="font-body text-base text-foreground">
              {t("admin.user-detail.referrals.empty")}
            </p>
          )}

          <DetailPager
            label={t("common.page-fraction", {
              page: currentReferralPage,
              totalPages: totalReferralPages,
            })}
            page={currentReferralPage}
            totalPages={totalReferralPages}
            href={(page) => {
              const search = new URLSearchParams();
              if (currentVisitPage > 1) search.set("visitsPage", String(currentVisitPage));
              if (currentNotePage > 1) search.set("notesPage", String(currentNotePage));
              if (currentPosterPage > 1) search.set("postersPage", String(currentPosterPage));
              if (page > 1) search.set("referralsPage", String(page));
              const queryString = search.toString();
              return `${queryString ? `?${queryString}` : ""}#referrals`;
            }}
          />
        </DetailSection>
      </div>
    </div>
  );
}
