import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import Link from "next/link";

import { ReviewDecisionActions } from "@/components/admin/review-decision-actions";
import { SlackAvatar } from "@/components/admin/slack-profile";
import { Timestamp } from "@/components/timestamp";
import { StatusBadge } from "@/components/admin/status-badge";
import { getTranslatedPageMetadata } from "@/i18n/metadata";
import {
  APPLICATION_STATUS_ACCEPTED,
  APPLICATION_STATUS_PENDING_AUTOMATIC_CHECKS,
  APPLICATION_STATUS_PENDING_REVIEW,
  APPLICATION_STATUS_REJECTED,
  getApplicationStatusMeta,
  normalizeApplicationStatus,
} from "@/lib/applications/status";
import sql from "@/lib/database/client";
import { ensureSchema } from "@/lib/database/ensure-schema";
import { formatDate } from "@/lib/format";
import { getCachedHackatimeTrustLevel } from "@/lib/hackatime";
import { ReviewModeClient } from "@/components/admin/review-mode-client";
import { HackatimeTrustStatus } from "@/components/admin/hackatime-trust-status";
import { Textarea } from "@/components/ui/textarea";
import { buttonVariants } from "@/components/ui/button";

type ReviewApplicationRow = {
  id: string;
  user_id: string | null;
  status: string;
  review_on_hold: boolean | null;
  name: string | null;
  applicant_email: string | null;
  applicant_slack_id: string | null;
  date_of_birth: string | null;
  address_city: string | null;
  address_country: string | null;
  github_url: string | null;
  portfolio_url: string | null;
  application_first_thing_do: string | null;
  application_best_place_poster: string | null;
  city: string | null;
  country_code: string | null;
  country_name: string | null;
  created_at: string;
  latest_application_id: string;
  user_name: string | null;
  user_slack_id: string | null;
  user_slack_name: string | null;
  user_slack_avatar_url: string | null;
};

type ApplicationHistoryRow = {
  id: string;
  status: string;
  name: string | null;
  created_at: string;
};

type SameCityRow = {
  id: string;
  name: string | null;
  status: string;
  user_name: string | null;
};

type NoteHistoryRow = {
  id: string;
  note: string | null;
  created_at: string;
  created_by: string | null;
  actor_display_name: string | null;
  actor_email: string | null;
};

function dedupeRepeatedLastName(value: string | null | undefined) {
  const trimmedValue = value?.trim() ?? "";

  if (trimmedValue === "") {
    return null;
  }

  const parts = trimmedValue.split(/\s+/);

  if (parts.length >= 3) {
    const lastPart = parts.at(-1)?.toLocaleLowerCase();
    const previousPart = parts.at(-2)?.toLocaleLowerCase();

    if (lastPart !== undefined && lastPart === previousPart) {
      return parts.slice(0, -1).join(" ");
    }
  }

  return trimmedValue;
}

function getApplicationNameLabel(value: string | null | undefined) {
  return dedupeRepeatedLastName(value) ?? "-";
}

function getSlackProfileUrl(slackId: string | null | undefined) {
  const trimmedSlackId = slackId?.trim() ?? "";

  if (trimmedSlackId === "") {
    return null;
  }

  return `https://hackclub.slack.com/team/${encodeURIComponent(trimmedSlackId)}`;
}

function getSlackHandleLabel(slackName: string | null | undefined) {
  const trimmedSlackName = slackName?.trim() ?? "";

  if (trimmedSlackName === "") {
    return null;
  }

  return trimmedSlackName.startsWith("@") ? trimmedSlackName : `@${trimmedSlackName}`;
}

export async function generateMetadata(): Promise<Metadata> {
  return getTranslatedPageMetadata("admin.application-detail.page-title");
}

export default async function ReviewModePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [{ id }, locale, t] = await Promise.all([
    params,
    getLocale(),
    getTranslations(),
  ]);
  await ensureSchema();

  const application = (await sql<ReviewApplicationRow[]>`
    SELECT a.id, a.user_id, a.status, a.review_on_hold, a.name, a.applicant_email, a.applicant_slack_id,
           a.date_of_birth, a.address_city, a.address_country,
           a.github_url, a.portfolio_url,
           a.application_first_thing_do, a.application_best_place_poster,
           a.city, a.country_code, a.country_name, a.created_at,
           COALESCE(latest.id, a.id) AS latest_application_id,
           u.display_name AS user_name,
           u.slack_id AS user_slack_id, u.slack_name AS user_slack_name,
           u.slack_avatar_url AS user_slack_avatar_url
    FROM applications a
    LEFT JOIN users u ON u.id = a.user_id
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

  const resolvedCity = application.address_city ?? application.city;
  const resolvedCountryName = application.address_country ?? application.country_name;
  const resolvedCountryCode = application.country_code;
  const resolvedCountry =
    resolvedCountryName ?? resolvedCountryCode;

  // Find other applications from same city
  const sameCityApplications =
    resolvedCity && (resolvedCountryName ?? resolvedCountryCode)
    ? await sql<SameCityRow[]>`
        SELECT a.id, a.name, a.status, u.display_name AS user_name
        FROM applications a
        LEFT JOIN users u ON u.id = a.user_id
        LEFT JOIN LATERAL (
          SELECT id
          FROM applications
          WHERE (a.user_id IS NOT NULL AND user_id = a.user_id)
             OR (a.user_id IS NULL AND a.applicant_email IS NOT NULL AND user_id IS NULL AND LOWER(applicant_email) = LOWER(a.applicant_email))
          ORDER BY created_at DESC, id DESC
          LIMIT 1
        ) latest ON true
        WHERE (LOWER(a.address_city) = LOWER(${resolvedCity}) OR LOWER(a.city) = LOWER(${resolvedCity}))
          AND (
            (
              ${resolvedCountryName}::text IS NOT NULL
              AND (
                LOWER(a.address_country) = LOWER(${resolvedCountryName})
                OR LOWER(a.country_name) = LOWER(${resolvedCountryName})
              )
            )
            OR (
              ${resolvedCountryCode}::text IS NOT NULL
              AND LOWER(a.country_code) = LOWER(${resolvedCountryCode})
            )
          )
          AND a.id != ${application.id}
          AND COALESCE(latest.id, a.id) = a.id
          AND a.status IN (${APPLICATION_STATUS_PENDING_REVIEW}, ${APPLICATION_STATUS_PENDING_AUTOMATIC_CHECKS}, ${APPLICATION_STATUS_REJECTED}, ${APPLICATION_STATUS_ACCEPTED})
        ORDER BY a.created_at DESC
        LIMIT 20
      `
    : [];

  const acceptedSameCity = sameCityApplications.filter(
    (a) => a.status === APPLICATION_STATUS_ACCEPTED,
  );
  const pendingOrRejectedSameCity = sameCityApplications.filter(
    (a) =>
      a.status === APPLICATION_STATUS_PENDING_REVIEW ||
      a.status === APPLICATION_STATUS_PENDING_AUTOMATIC_CHECKS ||
      a.status === APPLICATION_STATUS_REJECTED,
  );

  // Application history
  const history = application.user_id
    ? await sql<ApplicationHistoryRow[]>`
        SELECT id, status, name, created_at
        FROM applications
        WHERE user_id = ${application.user_id}
        ORDER BY created_at DESC, id DESC
      `
    : application.applicant_email
      ? await sql<ApplicationHistoryRow[]>`
          SELECT id, status, name, created_at
          FROM applications
          WHERE user_id IS NULL AND LOWER(applicant_email) = LOWER(${application.applicant_email})
          ORDER BY created_at DESC, id DESC
        `
      : [];

  // Internal notes (only available when linked to a user)
  const [latestNoteEvent, noteHistory] = application.user_id
    ? await Promise.all([
        sql<{ note: string | null }[]>`
          SELECT note
          FROM user_note_events
          WHERE user_id = ${application.user_id}
          ORDER BY created_at DESC, id DESC
          LIMIT 1
        `.then((rows) => rows.at(0) ?? null),
        sql<NoteHistoryRow[]>`
          SELECT une.id, une.note, une.created_at, une.created_by,
                 actor.display_name AS actor_display_name, actor.email AS actor_email
          FROM user_note_events une
          LEFT JOIN users actor ON actor.id = une.created_by
          WHERE une.user_id = ${application.user_id}
          ORDER BY une.created_at DESC, une.id DESC
          LIMIT 5
        `,
      ])
    : [null, [] as NoteHistoryRow[]];

  const currentUserNote =
    typeof latestNoteEvent?.note === "string" && latestNoteEvent.note.trim().length > 0
      ? latestNoteEvent.note
      : null;

  const displayName =
    dedupeRepeatedLastName(application.user_name) ??
    dedupeRepeatedLastName(application.name) ??
    "Unknown";
  const slackId = application.user_slack_id ?? application.applicant_slack_id;
  const hackatimeTrust = await getCachedHackatimeTrustLevel(slackId);
  const trimmedSlackId = slackId?.trim() ?? "";
  const slackProfileUrl = getSlackProfileUrl(slackId);
  const applicationNameLabel = getApplicationNameLabel(application.name);
  const titleName = applicationNameLabel !== "-" ? applicationNameLabel : displayName;
  const slackHandleLabel = getSlackHandleLabel(
    application.user_slack_name ??
      dedupeRepeatedLastName(application.user_name),
  );
  const titleSlackLabel = slackHandleLabel ?? "No Slack linked";
  const applicationStatusMeta = getApplicationStatusMeta(t);
  const age = application.date_of_birth
    ? Math.floor(
        (Date.now() - new Date(application.date_of_birth).getTime()) /
          (365.25 * 24 * 60 * 60 * 1000),
      )
    : null;
  const canAccept =
    application.status === APPLICATION_STATUS_PENDING_REVIEW ||
    application.status === APPLICATION_STATUS_PENDING_AUTOMATIC_CHECKS ||
    application.status === APPLICATION_STATUS_REJECTED;
  const canReject =
    application.status === APPLICATION_STATUS_PENDING_REVIEW ||
    application.status === APPLICATION_STATUS_PENDING_AUTOMATIC_CHECKS ||
    application.status === APPLICATION_STATUS_ACCEPTED;

  const getRelatedApplicationLabel = (entry: SameCityRow) =>
    dedupeRepeatedLastName(entry.user_name) ??
    getApplicationNameLabel(entry.name);

  const getRelatedApplicationStatusLabel = (status: string) => {
    const normalizedStatus = normalizeApplicationStatus(status);

    return normalizedStatus
      ? applicationStatusMeta[normalizedStatus].label
      : status;
  };

  return (
    <ReviewModeClient applicationId={application.id}>
      <div className="space-y-12">
        {/* Priority banner: accepted from same city */}
        {acceptedSameCity.length > 0 && (
          <div className="border border-[var(--acceptance)]/40 bg-[var(--acceptance)]/10 p-4">
            <p className="font-body text-sm text-foreground">
              <span className="font-bold text-[var(--acceptance)]">{t("admin.application-detail.review.banners.already-accepted-from", { city: resolvedCity ?? "" })}</span>{" "}
              {acceptedSameCity.map((a, i) => (
                <span key={a.id}>
                  {i > 0 && ", "}
                  <Link
                    href={`/admin/applications/${a.id}`}
                    className="ui-hover-underline text-[var(--acceptance)] hover:opacity-80"
                  >
                    {getRelatedApplicationLabel(a)}
                  </Link>{" "}
                  ({getRelatedApplicationStatusLabel(a.status)})
                </span>
              ))}
            </p>
          </div>
        )}

        {/* Warning banner: pending/rejected from same city */}
        {pendingOrRejectedSameCity.length > 0 && (
          <div className="border border-[var(--primary)]/40 bg-[var(--primary)]/10 p-4">
            <p className="font-body text-sm text-foreground">
              <span className="font-bold text-[var(--primary)]">{t("admin.application-detail.review.banners.other-applications-from", { city: resolvedCity ?? "" })}</span>{" "}
              {pendingOrRejectedSameCity.map((a, i) => (
                <span key={a.id}>
                  {i > 0 && ", "}
                  <Link
                    href={`/admin/applications/${a.id}`}
                    className="ui-hover-underline text-[var(--primary)] hover:opacity-80"
                  >
                    {getRelatedApplicationLabel(a)}
                  </Link>{" "}
                  ({getRelatedApplicationStatusLabel(a.status)})
                </span>
              ))}
            </p>
          </div>
        )}

        {/* Header */}
        <header className="grid gap-x-4 gap-y-1 md:grid-cols-[auto_minmax(0,1fr)_auto] md:grid-rows-[minmax(3rem,auto)_auto] md:items-start">
          <div className="md:row-span-2">
            <SlackAvatar
              slackId={slackId}
              fallbackName={titleName}
              sizeClassName="h-14 w-14"
              textClassName="text-lg"
            />
          </div>
          <div className="min-w-0 flex min-h-12 items-center md:col-start-2 md:row-start-1">
            <h1 className="truncate text-3xl leading-[3rem] text-foreground">
              {titleName}
              {" ("}
              {slackHandleLabel !== null && slackProfileUrl !== null ? (
                <a
                  href={slackProfileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ui-hover-underline text-secondary hover:text-foreground focus-visible:text-foreground"
                >
                  {slackHandleLabel}
                </a>
              ) : (
                <span className="text-secondary">{titleSlackLabel}</span>
              )}
              {")"}
            </h1>
          </div>
          <div className="flex min-h-12 items-center justify-start md:col-start-3 md:row-start-1 md:justify-end">
            <Link
              href={`/admin/applications/${application.id}`}
              className="ui-open-link inline-flex items-center gap-1 whitespace-nowrap font-body text-lg leading-none"
            >
              {t("admin.application-detail.review.open-full-application")} <span aria-hidden="true">↗</span>
            </Link>
          </div>
          <div className="flex flex-wrap items-center gap-3 md:col-start-2 md:col-end-4 md:row-start-2">
            <StatusBadge status={application.status} />
            {application.review_on_hold === true ? (
              <span className="font-body text-sm text-secondary">
                ⚠️ {t("admin.applications-list.on-hold")}
              </span>
            ) : null}
          </div>
        </header>

        {/* Application info grid */}
        <section>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <div className="text-xs text-secondary">{t("admin.application-detail.answers.name")}</div>
              <div className="font-body text-base text-foreground mt-1">
                {applicationNameLabel}
                {trimmedSlackId !== "" ? ` (${trimmedSlackId})` : ""}
              </div>
            </div>
            <div>
              <div className="text-xs text-secondary">{t("admin.application-detail.review.fields.age-dob")}</div>
              <div className="font-body text-base text-foreground mt-1">
                {age !== null ? `${age} years old` : ""}{application.date_of_birth ? ` (${formatDate(application.date_of_birth, locale)})` : " -"}
              </div>
            </div>
            <div>
              <div className="text-xs text-secondary">{t("admin.application-detail.review.fields.city")}</div>
              <div className="font-body text-base text-foreground mt-1">{resolvedCity ?? "-"}</div>
            </div>
            <div>
              <div className="text-xs text-secondary">{t("admin.application-detail.review.fields.country")}</div>
              <div className="font-body text-base text-foreground mt-1">
                {application.country_name ?? resolvedCountry ?? "-"}
              </div>
            </div>
            <div>
              <div className="text-xs text-secondary">{t("admin.application-detail.review.fields.hackatime-trust")}</div>
              <div className="mt-1">
                <HackatimeTrustStatus
                  slackId={slackId}
                  trustLevel={hackatimeTrust?.trustLevel}
                />
              </div>
            </div>
            <div>
              <div className="text-xs text-secondary">{t("admin.application-detail.review.fields.github")}</div>
              <div className="font-body text-base text-foreground mt-1">
                {application.github_url ? (
                  <a
                    href={application.github_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ui-hover-underline text-secondary hover:text-foreground focus-visible:text-foreground"
                  >
                    {t("admin.application-detail.review.fields.visit")}
                  </a>
                ) : "-"}
              </div>
            </div>
            <div>
              <div className="text-xs text-secondary">{t("admin.application-detail.review.fields.portfolio")}</div>
              <div className="font-body text-base text-foreground mt-1">
                {application.portfolio_url ? (
                  <a
                    href={application.portfolio_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ui-hover-underline text-secondary hover:text-foreground focus-visible:text-foreground"
                  >
                    {t("admin.application-detail.review.fields.visit")}
                  </a>
                ) : "-"}
              </div>
            </div>
          </div>
        </section>

        {/* Application questions */}
        <section className="space-y-4">
          <h2 className="text-xl text-foreground">{t("admin.application-detail.review.sections.questions")}</h2>
          <div className="space-y-4">
            <div>
              <div className="text-xs text-secondary mb-1">{t("admin.application-detail.review.questions.first-thing-do")}</div>
              <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] font-body text-base leading-relaxed text-foreground">
                {application.application_first_thing_do ?? "-"}
              </p>
            </div>
            <div>
              <div className="text-xs text-secondary mb-1">{t("admin.application-detail.review.questions.best-place-poster")}</div>
              <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] font-body text-base leading-relaxed text-foreground">
                {application.application_best_place_poster ?? "-"}
              </p>
            </div>
          </div>
        </section>

        {/* Previous applications */}
        {history.length > 1 && (
          <section className="space-y-4">
            <h2 className="text-xl text-foreground">{t("admin.application-detail.review.sections.previous-applications")}</h2>
            <div className="space-y-2">
              {history.map((entry) => (
                <div key={entry.id} className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-x-3 py-2 border-b border-foreground/5 last:border-0">
                  <StatusBadge status={entry.status} />
                  <span className="font-body text-sm text-foreground">
                    {getApplicationNameLabel(entry.name)}
                  </span>
                  <span className="font-body text-xs text-secondary tabular-nums">
                    <Timestamp value={entry.created_at} locale={locale} dateOnly />
                  </span>
                  <Link
                    href={`/admin/applications/${entry.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ui-open-link inline-flex items-center leading-none"
                    aria-label={t("admin.application-detail.review.open-application")}
                  >
                    <span aria-hidden="true">↗</span>
                  </Link>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Internal notes */}
        {application.user_id !== null && (
          <section className="space-y-4">
            <h2 className="text-xl text-foreground">{t("admin.user-detail.sections.notes.title")}</h2>
            {currentUserNote !== null && (
              <div>
                <div className="text-xs text-secondary mb-1">{t("admin.user-detail.notes.current-note")}</div>
                <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] font-body text-base leading-relaxed text-foreground">
                  {currentUserNote}
                </p>
              </div>
            )}
            <form action={`/api/admin/users/${application.user_id}/note`} method="POST" className="space-y-3">
              <input type="hidden" name="redirectTo" value={`/admin/applications/review/${application.id}`} />
              <label className="block text-sm text-secondary">
                {t("admin.user-detail.notes.note-label")}
                <Textarea
                  name="note"
                  rows={4}
                  defaultValue={currentUserNote ?? ""}
                  className="ui-input-surface mt-2 min-h-20 resize-none border-foreground bg-transparent px-5 py-4 font-body text-base font-normal placeholder:font-normal hover:bg-transparent md:text-base"
                  placeholder={t("admin.user-detail.notes.note-placeholder")}
                />
              </label>
              <button className={buttonVariants({ size: "app" })}>
                {t("admin.user-detail.actions.save-note")}
              </button>
            </form>
            {noteHistory.length > 0 && (
              <div className="space-y-3 border-t border-foreground/10 pt-4">
                <h3 className="font-body text-sm text-secondary">{t("admin.user-detail.notes.history-title")}</h3>
                {noteHistory.map((entry) => (
                  <div key={entry.id} className="border-t border-foreground/5 pt-3 first:border-t-0 first:pt-0">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <span className="font-body text-sm text-foreground">
                        {entry.actor_display_name ?? entry.actor_email ?? entry.created_by ?? t("admin.user-detail.notes.unknown-actor")}
                      </span>
                      <span className="text-xs text-secondary">
                        <Timestamp value={entry.created_at} locale={locale} />
                      </span>
                    </div>
                    <div className="mt-1 whitespace-pre-line font-body text-sm text-foreground break-words [overflow-wrap:anywhere]">
                      {typeof entry.note === "string" && entry.note.trim() !== ""
                        ? entry.note
                        : t("admin.user-detail.notes.cleared")}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Actions menu */}
        <section>
          <h2 className="text-xl text-foreground mb-4">{t("admin.application-detail.review.sections.decision")}</h2>
          <ReviewDecisionActions
            applicationId={application.id}
            canAccept={canAccept}
            canReject={canReject}
            isOnHold={application.review_on_hold === true}
            acceptLabel={t("admin.application-detail.actions.accept")}
            deleteLabel={t("admin.application-detail.actions.delete")}
            deleteConfirmationMessage={t("admin.application-detail.actions.confirmations.delete")}
            destructiveConfirmationMessage={t("common.confirm-destructive")}
            putOnHoldConfirmationMessage={t("admin.application-detail.actions.confirmations.put-on-hold")}
            putOnHoldLabel={t("admin.application-detail.actions.put-on-hold")}
            rejectLabel={t("admin.user-detail.actions.reject")}
            rejectNoteLabel={t("admin.application-detail.actions.reject-note-label")}
            rejectNotePlaceholder={t("admin.application-detail.actions.reject-note-placeholder")}
            rejectSubmitLabel={t("admin.application-detail.actions.reject-with-note")}
            permanentRejectLabel={t("admin.application-detail.actions.reject-permanently")}
            permanentRejectNoteLabel={t("admin.application-detail.actions.permanent-rejection-note-label")}
            permanentRejectNotePlaceholder={t("admin.application-detail.actions.permanent-rejection-note-placeholder")}
            removeHoldConfirmationMessage={t("admin.application-detail.actions.confirmations.remove-hold")}
            removeHoldLabel={t("admin.application-detail.actions.remove-hold")}
          />
        </section>
      </div>
    </ReviewModeClient>
  );
}
