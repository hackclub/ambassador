import Link from "next/link";
import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { DeleteApplicationButton } from "@/components/admin/delete-application-button";
import { ConfirmSubmitForm } from "@/components/admin/confirm-submit-form";
import { AdminLocalDateTime } from "@/components/admin/admin-local-time";
import { DetailDateRow, DetailFieldRow, DetailPager, DetailRow, DetailSection } from "@/components/admin/detail";
import { HackatimeTrustStatus } from "@/components/admin/hackatime-trust-status";
import { SlackAvatar, SlackProfile } from "@/components/admin/slack-profile";
import { StatusBadge } from "@/components/admin/status-badge";
import { Timestamp } from "@/components/timestamp";
import { buttonVariants } from "@/components/ui/button";
import { pillVariants } from "@/components/ui/pill";
import { Textarea } from "@/components/ui/textarea";
import { getTranslatedPageMetadata } from "@/i18n/metadata";
import { fetchHackClubAddresses } from "@/lib/auth";
import {
  APPLICATION_STATUS_ACCEPTED,
  APPLICATION_STATUS_REJECTED,
  APPLICATION_STATUS_REJECTED_PERMANENT,
  canChangeApplicationReviewStatus,
} from "@/lib/applications/status";
import sql from "@/lib/database/client";
import { ensureSchema } from "@/lib/database/ensure-schema";
import { formatDate, formatDateTime, joinNonEmpty } from "@/lib/format";
import { getCachedHackatimeTrustLevel } from "@/lib/hackatime";
import { readHcaAccessToken } from "@/lib/hca-access-token";
import { ensureUserAddressSchema } from "@/lib/database/user-address-schema";
import { normalizeHackClubAddresses } from "@/lib/settings";

type ApplicationDetailRow = {
  id: string;
  user_id: string | null;
  status: string;
  review_on_hold: boolean | null;
  name: string | null;
  applicant_email: string | null;
  applicant_slack_id: string | null;
  applicant_hca_id: string | null;
  applicant_phone: string | null;
  date_of_birth: string | null;
  address_line_1: string | null;
  address_line_2: string | null;
  address_city: string | null;
  address_state: string | null;
  address_zip: string | null;
  address_country: string | null;
  github_url: string | null;
  portfolio_url: string | null;
  application_first_thing_do: string | null;
  application_best_place_poster: string | null;
  idv_status: string | null;
  tshirt_sent: boolean | null;
  airtable_record_id: string | null;
  submitted_ip: string | null;
  latitude: number | null;
  longitude: number | null;
  city: string | null;
  region: string | null;
  country_code: string | null;
  country_name: string | null;
  decision_note: string | null;
  rejection_reason: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
  reviewed_by: string | null;
  latest_application_id: string;
  user_name: string | null;
  user_email: string | null;
  hca_first_name: string | null;
  hca_last_name: string | null;
  hca_addresses: unknown;
  hca_access_token: string | null;
  user_slack_id: string | null;
  user_slack_name: string | null;
  user_slack_avatar_url: string | null;
  user_hca_id: string | null;
  verification_status: string | null;
  user_last_ip: string | null;
  user_city: string | null;
  user_region: string | null;
  user_country_code: string | null;
  user_country_name: string | null;
  user_postal_code: string | null;
  user_timezone: string | null;
  user_org: string | null;
  user_created_at: string | null;
  reviewed_by_name: string | null;
};

type ApplicationHistoryRow = {
  id: string;
  status: string;
  name: string | null;
  decision_note: string | null;
  created_at: string;
};

type CountRow = { count: number };

type VisitRow = {
  id: string;
  ip: string;
  visit_type: string;
  city: string | null;
  region: string | null;
  country_code: string | null;
  org: string | null;
  created_at: string;
};

type OrderRow = {
  id: string;
  status: string;
  created_at: string;
};

export async function generateMetadata(): Promise<Metadata> {
  return getTranslatedPageMetadata("admin.application-detail.page-title");
}

export default async function AdminApplicationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ visitsPage?: string }>;
}) {
  const [{ id }, query, t, locale] = await Promise.all([
    params,
    searchParams,
    getTranslations(),
    getLocale(),
  ]);
  const requestedVisitsPage = Number(query.visitsPage ?? "1");
  const visitsPage = Number.isFinite(requestedVisitsPage) && requestedVisitsPage > 0
    ? Math.floor(requestedVisitsPage)
    : 1;
  await ensureSchema();
  await ensureUserAddressSchema();

  const application = (await sql<ApplicationDetailRow[]>`
    SELECT a.id, a.user_id, a.status, a.review_on_hold, a.name, a.applicant_email, a.applicant_slack_id,
           a.applicant_hca_id,
           a.applicant_phone, a.date_of_birth, a.address_line_1, a.address_line_2,
           a.address_city, a.address_state, a.address_zip, a.address_country,
           a.github_url, a.portfolio_url, a.application_first_thing_do,
           a.application_best_place_poster, a.idv_status, a.tshirt_shipped AS tshirt_sent, a.airtable_record_id,
           a.submitted_ip, a.latitude, a.longitude, a.city, a.region, a.country_code, a.country_name,
           a.decision_note, a.rejection_reason, a.reviewed_at, a.created_at, a.updated_at, a.reviewed_by,
           COALESCE(latest.id, a.id) AS latest_application_id,
           u.display_name AS user_name, u.email AS user_email, u.hca_first_name, u.hca_last_name,
           u.hca_addresses, u.hca_access_token,
           u.slack_id AS user_slack_id, u.slack_name AS user_slack_name,
           u.slack_avatar_url AS user_slack_avatar_url, u.hca_id AS user_hca_id, u.verification_status,
           u.last_ip AS user_last_ip, u.city AS user_city, u.region AS user_region,
           u.country_code AS user_country_code, u.country_name AS user_country_name,
           u.postal_code AS user_postal_code, u.timezone AS user_timezone, u.org AS user_org,
           u.created_at AS user_created_at, reviewer.display_name AS reviewed_by_name
    FROM applications a
    LEFT JOIN users u ON u.id = a.user_id
    LEFT JOIN users reviewer ON reviewer.id = a.reviewed_by
    LEFT JOIN LATERAL (
      SELECT id
      FROM applications
      WHERE (a.user_id IS NOT NULL AND user_id = a.user_id)
         OR (a.user_id IS NULL AND a.applicant_email IS NOT NULL AND user_id IS NULL AND LOWER(applicant_email) = LOWER(a.applicant_email))
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    ) latest ON true
    WHERE a.id = ${id}
    LIMIT 1
  `).at(0) ?? null;

  if (application === null) notFound();

  const storedAddresses = Array.isArray(application.hca_addresses)
    ? application.hca_addresses.filter(
        (address): address is Record<string, unknown> =>
          address !== null && typeof address === "object",
      )
    : [];
  const hcaAccessToken = readHcaAccessToken(application.hca_access_token);
  const liveAddresses = hcaAccessToken !== null
    ? await fetchHackClubAddresses(hcaAccessToken).catch((error) => {
        console.error("Failed to load live Hack Club Auth addresses", {
          applicationId: application.id,
          userId: application.user_id,
          error,
        });
        return [];
      })
    : [];
  const addresses = normalizeHackClubAddresses(liveAddresses.length > 0 ? liveAddresses : storedAddresses);
  const hackatimeSlackId = application.user_slack_id ?? application.applicant_slack_id;
  const hackatimeTrust = await getCachedHackatimeTrustLevel(hackatimeSlackId);

  const [history, visitCountResult, visits, orders] = await Promise.all([
    application.user_id !== null
      ? sql<ApplicationHistoryRow[]>`
          SELECT id, status, name, decision_note, created_at
          FROM applications
          WHERE user_id = ${application.user_id}
          ORDER BY created_at DESC, id DESC
        `
      : application.applicant_email !== null && application.applicant_email.trim() !== ""
        ? sql<ApplicationHistoryRow[]>`
            SELECT id, status, name, decision_note, created_at
            FROM applications
            WHERE user_id IS NULL AND LOWER(applicant_email) = LOWER(${application.applicant_email})
            ORDER BY created_at DESC, id DESC
          `
        : sql<ApplicationHistoryRow[]>`
            SELECT id, status, name, decision_note, created_at
            FROM applications
            WHERE id = ${application.id}
          `,
    application.user_id !== null
      ? sql<CountRow[]>`
          SELECT COUNT(*)::int AS count
          FROM ip_visits
          WHERE user_id = ${application.user_id}
        `.then((rows) => rows.at(0)?.count ?? 0)
      : Promise.resolve(0),
    application.user_id !== null
      ? sql<VisitRow[]>`
          SELECT id, ip, visit_type, city, region, country_code, org, created_at
          FROM ip_visits
          WHERE user_id = ${application.user_id}
          ORDER BY created_at DESC
          LIMIT 3
          OFFSET ${(visitsPage - 1) * 3}
        `
      : Promise.resolve([]),
    application.user_id !== null
      ? sql<OrderRow[]>`
          SELECT id, status, created_at
          FROM orders
          WHERE user_id = ${application.user_id}
          ORDER BY created_at DESC
          LIMIT 10
        `
      : Promise.resolve([]),
  ]);

  const isLatest = application.latest_application_id === application.id;
  const totalVisitPages = Math.max(1, Math.ceil(visitCountResult / 3));
  const currentVisitPage = Math.min(visitsPage, totalVisitPages);
  const canAccept = canChangeApplicationReviewStatus(application.status, APPLICATION_STATUS_ACCEPTED);
  const canReject = canChangeApplicationReviewStatus(application.status, APPLICATION_STATUS_REJECTED);
  const canRejectPermanently = canChangeApplicationReviewStatus(
    application.status,
    APPLICATION_STATUS_REJECTED_PERMANENT,
  );

  return (
    <div className="space-y-12">
      <header className="space-y-4">
        <div className="flex flex-wrap items-center gap-3 text-sm text-secondary">
          <Link href="/admin/applications" className="hover:text-foreground">
            {t("admin.application-detail.breadcrumb")}
          </Link>
          <span>/</span>
          <span className="font-body text-foreground">{application.id}</span>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-4">
              <SlackAvatar
                slackId={application.user_slack_id ?? application.applicant_slack_id}
                fallbackName={application.user_slack_name ?? application.user_name ?? application.name}
                sizeClassName="h-16 w-16"
                textClassName="text-lg"
              />
              <h1 className="text-4xl leading-[3rem] text-foreground">{application.name ?? application.user_name}</h1>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <StatusBadge status={application.status} />
              {application.review_on_hold === true ? (
                <span className="font-body text-sm text-secondary">
                  ⚠️ {t("admin.applications-list.on-hold")}
                </span>
              ) : null}
              {isLatest ? (
                <span className={pillVariants({ tone: "green" })}>
                  {t("admin.application-detail.latest-application")}
                </span>
              ) : (
                <span className={pillVariants({ tone: "black" })}>
                  {t("admin.application-detail.historical-application")}
                </span>
              )}
            </div>
          </div>
          {application.user_id !== null ? (
            <Link
              href={`/admin/users/${application.user_id}`}
              aria-label={t("admin.application-detail.open-user-page")}
              className="ui-open-link inline-flex font-body text-lg leading-none"
            >
              <span aria-hidden="true">↗</span>
            </Link>
          ) : null}
        </div>
      </header>

      {!isLatest && (
        <section className="pt-4">
          <h2 className="text-2xl leading-8 text-foreground">{t("admin.application-detail.locked.title")}</h2>
          <p className="mt-2 max-w-3xl font-body text-base text-foreground">
            {t("admin.application-detail.locked.body")}{" "}
            <Link
              href={`/admin/applications/${application.latest_application_id}`}
              aria-label={t("admin.application-detail.locked.cta")}
              className="ui-open-link ml-2 inline-flex"
            >
              <span aria-hidden="true">↗</span>
            </Link>
          </p>
        </section>
      )}

      <DetailSection
        title={t("admin.application-detail.sections.review-actions.title")}
        description={t("admin.application-detail.sections.review-actions.description")}
      >
        <DeleteApplicationButton
          applicationId={application.id}
          label={t("admin.application-detail.actions.delete")}
          confirmationMessage={t("admin.application-detail.actions.confirmations.delete")}
        />

        <ConfirmSubmitForm
          action={`/api/admin/applications/${application.id}/hold`}
          method="POST"
          className="max-w-xl"
          confirmationMessage={
            application.review_on_hold === true
              ? t("admin.application-detail.actions.confirmations.remove-hold")
              : t("admin.application-detail.actions.confirmations.put-on-hold")
          }
        >
          <input type="hidden" name="redirectTo" value={`/admin/applications/${application.id}`} />
          <input
            type="hidden"
            name="onHold"
            value={application.review_on_hold === true ? "false" : "true"}
          />
          <button className={buttonVariants({ size: "app" })}>
            {application.review_on_hold === true
              ? t("admin.application-detail.actions.remove-hold")
              : t("admin.application-detail.actions.put-on-hold")}
          </button>
        </ConfirmSubmitForm>

        {isLatest ? (
          <div className="space-y-8">
            {canAccept ? (
              <form action={`/api/admin/applications/${application.id}/approve`} method="POST" className="max-w-xl space-y-3">
                <input type="hidden" name="redirectTo" value={`/admin/applications/${application.id}`} />
                <button className={buttonVariants({ variant: "success", size: "app" })}>
                  {t("admin.application-detail.actions.accept")}
                </button>
              </form>
            ) : null}

            {canReject ? (
              <ConfirmSubmitForm
                action={`/api/admin/applications/${application.id}/reject`}
                method="POST"
                className="max-w-xl space-y-3"
                confirmationMessage={t("common.confirm-destructive")}
              >
                <input type="hidden" name="redirectTo" value={`/admin/applications/${application.id}`} />
                <label className="block text-sm text-secondary">
                  {t("admin.application-detail.actions.reject-note-label")}
                  <Textarea
                    name="note"
                    required
                    rows={5}
                    className="ui-input-surface mt-2 min-h-24 resize-none border-foreground bg-transparent px-5 py-4 font-body text-base font-normal placeholder:font-normal hover:bg-transparent md:text-base"
                    placeholder={t("admin.application-detail.actions.reject-note-placeholder")}
                  />
                </label>
                <button className={buttonVariants({ size: "app" })}>
                  {t("admin.application-detail.actions.reject-with-note")}
                </button>
              </ConfirmSubmitForm>
            ) : null}

            {canRejectPermanently ? (
              <ConfirmSubmitForm
                action={`/api/admin/applications/${application.id}/reject-permanently`}
                method="POST"
                className="max-w-xl space-y-3"
                confirmationMessage={t("common.confirm-destructive")}
              >
                <input type="hidden" name="redirectTo" value={`/admin/applications/${application.id}`} />
                <label className="block text-sm text-secondary">
                  {t("admin.application-detail.actions.permanent-rejection-note-label")}
                  <Textarea
                    name="note"
                    rows={4}
                    className="ui-input-surface mt-2 min-h-20 resize-none border-foreground bg-transparent px-5 py-4 font-body text-base font-normal placeholder:font-normal hover:bg-transparent md:text-base"
                    placeholder={t("admin.application-detail.actions.permanent-rejection-note-placeholder")}
                  />
                </label>
                <button className={buttonVariants({ size: "app" })}>
                  {t("admin.application-detail.actions.reject-permanently")}
                </button>
              </ConfirmSubmitForm>
            ) : null}

            <form
              action={`/api/admin/applications/${application.id}/tshirt-sent`}
              method="POST"
              className="max-w-xl space-y-3"
            >
              <input type="hidden" name="redirectTo" value={`/admin/applications/${application.id}`} />
              <input
                type="hidden"
                name="sent"
                value={application.tshirt_sent === true ? "false" : "true"}
              />
              <button
                className={buttonVariants({
                  variant: application.tshirt_sent === true ? "default" : "success",
                  size: "app",
                })}
              >
                {application.tshirt_sent === true
                  ? t("admin.application-detail.actions.mark-tshirt-unsent")
                  : t("admin.application-detail.actions.mark-tshirt-sent")}
              </button>
            </form>

            {application.user_id !== null ? (
              <Link
                href={`/admin/users/${application.user_id}#internal-notes`}
                className={buttonVariants({ variant: "outline", size: "app" })}
              >
                {t("admin.application-detail.actions.open-internal-notes")}
              </Link>
            ) : null}
          </div>
        ) : (
          <p className="font-body text-base text-foreground">
            {t("admin.application-detail.actions.historical-disabled")}
          </p>
        )}
      </DetailSection>

      <DetailSection
        title={t("admin.application-detail.sections.application-answers.title")}
        description={t("admin.application-detail.sections.application-answers.description")}
      >
        <DetailFieldRow label={t("admin.application-detail.answers.name")} value={application.name} />
        {/* Date of birth is a calendar date, not an instant - never shift it into
            the reader's timezone (that can roll it back a day). */}
        <DetailFieldRow
          label={t("admin.application-detail.answers.date-of-birth")}
          value={formatDate(application.date_of_birth, locale)}
        />
        <DetailFieldRow label={t("admin.application-detail.answers.email")} value={application.applicant_email} />
        <DetailFieldRow label={t("admin.application-detail.answers.slack-id")} value={application.applicant_slack_id} mono />
        <DetailFieldRow label={t("admin.application-detail.answers.hca-id")} value={application.applicant_hca_id} mono />
        <DetailFieldRow label={t("admin.application-detail.answers.phone")} value={application.applicant_phone} />
        <DetailFieldRow
          label={t("admin.application-detail.answers.address")}
          value={joinNonEmpty(
            application.address_line_1,
            application.address_line_2,
            application.address_city,
            application.address_state,
            application.address_zip,
            application.address_country,
          )}
        />
        <DetailFieldRow label={t("admin.application-detail.answers.github-url")} value={application.github_url} />
        <DetailFieldRow label={t("admin.application-detail.answers.portfolio-url")} value={application.portfolio_url} />
        <div className="space-y-1">
          <div className="text-sm text-secondary">
            {t("admin.application-detail.answers.first-thing-do")}
          </div>
          <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] font-body text-base leading-relaxed text-foreground">
            {application.application_first_thing_do ?? "-"}
          </p>
        </div>
        <div className="space-y-1">
          <div className="text-sm text-secondary">
            {t("admin.application-detail.answers.best-place-poster")}
          </div>
          <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] font-body text-base leading-relaxed text-foreground">
            {application.application_best_place_poster ?? "-"}
          </p>
        </div>
      </DetailSection>

      <DetailSection
        title={t("admin.application-detail.sections.application-metadata.title")}
        description={t("admin.application-detail.sections.application-metadata.description")}
      >
        <DetailDateRow label={t("admin.application-detail.metadata.submitted")} value={application.created_at} locale={locale} />
        <DetailDateRow label={t("admin.application-detail.metadata.last-updated")} value={application.updated_at} locale={locale} />
        <DetailDateRow label={t("admin.application-detail.metadata.reviewed")} value={application.reviewed_at} locale={locale} />
        <DetailFieldRow label={t("admin.application-detail.metadata.reviewed-by")} value={application.reviewed_by_name} />
        <DetailFieldRow label={t("admin.application-detail.metadata.airtable-record-id")} value={application.airtable_record_id} mono />
        <DetailFieldRow label={t("admin.application-detail.metadata.submitted-ip")} value={application.submitted_ip} mono />
        <DetailFieldRow
          label={t("admin.application-detail.metadata.application-location")}
          value={joinNonEmpty(
            application.address_city ?? application.city,
            application.address_state ?? application.region,
            application.address_country ?? application.country_name,
            application.country_code,
          )}
        />
        <DetailFieldRow
          label={t("admin.application-detail.metadata.coordinates")}
          value={
            application.latitude == null || application.longitude == null
              ? null
              : `${application.latitude.toFixed(4)}, ${application.longitude.toFixed(4)}`
          }
          mono
        />
        <DetailFieldRow label={t("admin.application-detail.metadata.idv-status")} value={application.idv_status} />
        <DetailFieldRow
          label={t("admin.application-detail.metadata.tshirt-sent")}
          value={application.tshirt_sent === true ? t("common.yes") : t("common.no")}
        />
        <DetailFieldRow
          label={t("admin.application-detail.metadata.decision-note")}
          value={application.rejection_reason ?? application.decision_note}
        />
      </DetailSection>

      <DetailSection
        title={t("admin.application-detail.sections.applicant.title")}
        description={t("admin.application-detail.sections.applicant.description")}
      >
        <DetailFieldRow label={t("admin.application-detail.applicant-fields.display-name")} value={application.user_name} />
        <DetailFieldRow label={t("admin.application-detail.applicant-fields.first-name")} value={application.hca_first_name} />
        <DetailFieldRow label={t("admin.application-detail.applicant-fields.last-name")} value={application.hca_last_name} />
        <DetailFieldRow label={t("admin.application-detail.applicant-fields.email")} value={application.user_email} />
        <SlackProfile
          label={t("admin.application-detail.applicant-fields.slack")}
          slackName={application.user_slack_name ?? application.applicant_slack_id}
          slackId={application.user_slack_id ?? application.applicant_slack_id}
          fallbackName={application.user_name ?? application.name}
        />
        <DetailRow label={t("admin.application-detail.applicant-fields.hackatime-trust-level")}>
          <HackatimeTrustStatus
            slackId={hackatimeSlackId}
            trustLevel={hackatimeTrust?.trustLevel}
          />
        </DetailRow>
        <DetailFieldRow label={t("admin.application-detail.applicant-fields.hca-id")} value={application.user_hca_id} mono />
        <DetailFieldRow label={t("admin.application-detail.applicant-fields.verification-status")} value={application.verification_status} />
        <DetailFieldRow
          label={t("admin.application-detail.applicant-fields.hca-addresses")}
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
        <DetailFieldRow
          label={t("admin.application-detail.applicant-fields.user-location")}
          value={joinNonEmpty(
            application.user_city,
            application.user_region,
            application.user_country_name,
            application.user_country_code,
          )}
        />
        <DetailFieldRow label={t("admin.application-detail.applicant-fields.postal-code")} value={application.user_postal_code} mono />
        <DetailFieldRow label={t("admin.application-detail.applicant-fields.timezone")} value={application.user_timezone} mono />
        <DetailFieldRow label={t("admin.application-detail.applicant-fields.network-org")} value={application.user_org} />
        <DetailFieldRow label={t("admin.application-detail.applicant-fields.last-seen-ip")} value={application.user_last_ip} mono />
        <DetailDateRow label={t("admin.application-detail.applicant-fields.user-created")} value={application.user_created_at} locale={locale} />
      </DetailSection>

      <DetailSection
        title={t("admin.application-detail.sections.history.title")}
        description={t("admin.application-detail.sections.history.description")}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-foreground">
                <th className="px-0 py-4 font-body text-base leading-8 text-secondary">{t("admin.application-detail.history.when")}</th>
                <th className="px-4 py-4 font-body text-base leading-8 text-secondary">{t("admin.application-detail.history.status")}</th>
                <th className="px-4 py-4 font-body text-base leading-8 text-secondary">{t("admin.application-detail.history.name")}</th>
                <th className="px-4 py-4 font-body text-base leading-8 text-secondary">{t("admin.application-detail.history.open")}</th>
              </tr>
            </thead>
            <tbody>
              {history.map((entry) => (
                <tr key={entry.id} className="border-b border-foreground last:border-b-0">
                  <td className="px-0 py-4 font-body text-sm leading-8 text-foreground"><Timestamp value={entry.created_at} locale={locale} /></td>
                  <td className="px-4 py-4">
                    <div className="flex items-center gap-2">
                      <StatusBadge status={entry.status} />
                      {entry.id === application.latest_application_id ? (
                        <span className={pillVariants({ tone: "green" })}>{t("common.latest")}</span>
                      ) : (
                        <span className={pillVariants({ tone: "black" })}>
                          {t("admin.applications-list.history")}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-4 font-body text-sm leading-8 text-foreground">{entry.name ?? "-"}</td>
                  <td className="px-4 py-4">
                    <Link
                      href={`/admin/applications/${entry.id}`}
                      aria-label={t("admin.application-detail.history.view")}
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
      </DetailSection>

      <DetailSection
        title={t("admin.application-detail.sections.visits.title")}
        description={t("admin.application-detail.sections.visits.description", { duration: "10 minutes" })}
      >
        <div className="space-y-4">
          {visits.length > 0 ? (
            visits.map((visit) => (
              <div key={visit.id} className="pb-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-body text-sm text-foreground">{visit.ip}</span>
                  <span className="text-xs text-secondary">{visit.visit_type}</span>
                </div>
                <div className="mt-1 font-body text-sm text-foreground">
                  {joinNonEmpty(visit.city, visit.region, null, visit.country_code) ?? "-"}
                </div>
                <div className="mt-1 font-body text-sm text-foreground">{visit.org ?? t("admin.application-detail.visits.unknown-network")}</div>
                <div className="mt-1 text-xs text-foreground">
                  <AdminLocalDateTime
                    value={visit.created_at}
                    locale={locale}
                    fallback={formatDateTime(visit.created_at, locale) ?? "-"}
                  />
                  {" · "}
                  {t("common.your-time")}
                </div>
              </div>
            ))
          ) : (
            <p className="font-body text-base text-foreground">{t("admin.application-detail.visits.empty")}</p>
          )}
        </div>
        <DetailPager
          label={t("common.page-fraction", { page: currentVisitPage, totalPages: totalVisitPages })}
          page={currentVisitPage}
          totalPages={totalVisitPages}
          href={(page) => `?visitsPage=${page}`}
          outlined
        />
      </DetailSection>

      <DetailSection
        title={t("admin.application-detail.sections.orders.title")}
        description={t("admin.application-detail.sections.orders.description")}
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
            <p className="font-body text-base text-foreground">{t("admin.application-detail.orders.empty")}</p>
          )}
        </div>
      </DetailSection>
    </div>
  );
}
