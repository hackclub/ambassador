import Link from "next/link";
import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";

import { Timestamp } from "@/components/timestamp";
import { Pagination } from "@/components/ui/pagination";
import { SearchBar } from "@/components/admin/search-bar";
import { SortToggle } from "@/components/admin/sort-toggle";
import { StatusFilter } from "@/components/admin/status-filter";
import { SlackAvatar } from "@/components/admin/slack-profile";
import { StatusBadge } from "@/components/admin/status-badge";
import { pillVariants } from "@/components/ui/pill";
import { getTranslatedPageMetadata } from "@/i18n/metadata";
import {
  APPLICATION_STATUS_ACCEPTED,
  APPLICATION_STATUS_PENDING_AUTOMATIC_CHECKS,
  APPLICATION_STATUS_PENDING_REVIEW,
  APPLICATION_STATUS_REJECTED,
  APPLICATION_STATUS_REJECTED_PERMANENT,
} from "@/lib/applications/status";
import sql from "@/lib/database/client";
import { ensureSchema } from "@/lib/database/ensure-schema";

type ApplicationListRow = {
  id: string;
  status: string;
  name: string | null;
  applicant_email: string | null;
  applicant_slack_id: string | null;
  address_city: string | null;
  address_state: string | null;
  address_country: string | null;
  submitted_ip: string | null;
  city: string | null;
  country_code: string | null;
  created_at: string;
  is_latest: boolean;
  review_on_hold: boolean | null;
  user_name: string | null;
  user_email: string | null;
  slack_id: string | null;
  slack_name: string | null;
};

type ApplicationListResultRow = {
  applications: ApplicationListRow[];
  total: number;
};

const APPLICATION_STATUS_FILTER_OPTIONS = [
  { value: "__on_hold", labelKey: "admin.status-filter.on-hold" },
  { value: APPLICATION_STATUS_PENDING_AUTOMATIC_CHECKS, labelKey: "admin.status-filter.pending-automatic-checks" },
  { value: APPLICATION_STATUS_PENDING_REVIEW, labelKey: "admin.status-filter.pending-review" },
  { value: APPLICATION_STATUS_ACCEPTED, labelKey: "admin.status-filter.accepted" },
  { value: APPLICATION_STATUS_REJECTED, labelKey: "admin.status-filter.rejected" },
  { value: APPLICATION_STATUS_REJECTED_PERMANENT, labelKey: "admin.status-filter.rejected-permanently" },
] as const;

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

export async function generateMetadata(): Promise<Metadata> {
  return getTranslatedPageMetadata("admin.applications-list.metadata.title");
}

export default async function AdminApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string; status?: string; sort?: string }>;
}) {
  const [t, locale, query] = await Promise.all([getTranslations(), getLocale(), searchParams]);
  await ensureSchema();

  const page = Math.max(1, Number(query.page ?? "1"));
  const offset = (page - 1) * 20;
  const search = query.q?.trim() ?? "";
  const searchFilter = search ? `%${search}%` : null;
  const statusFilter = query.status?.trim() ?? "";
  const filterOnHold = statusFilter === "__on_hold";
  const filterByStatus = statusFilter !== "" && !filterOnHold ? statusFilter : null;
  const sortOrder = query.sort === "newest" ? "DESC" : "ASC";

  const applicationList = (await sql<ApplicationListResultRow[]>`
    WITH filtered AS (
      SELECT a.id, a.user_id, a.status, a.name, a.applicant_email, a.applicant_slack_id,
             a.address_city, a.address_state, a.address_country, a.submitted_ip,
             a.city, a.country_code, a.created_at, a.review_on_hold,
             u.display_name AS user_name, u.email AS user_email, u.slack_id, u.slack_name
      FROM applications a
      LEFT JOIN users u ON u.id = a.user_id
      WHERE (${searchFilter}::text IS NULL OR (
        a.name ILIKE ${searchFilter}
        OR a.applicant_email ILIKE ${searchFilter}
        OR a.applicant_slack_id ILIKE ${searchFilter}
        OR u.display_name ILIKE ${searchFilter}
        OR u.email ILIKE ${searchFilter}
        OR u.slack_id ILIKE ${searchFilter}
        OR u.slack_name ILIKE ${searchFilter}
      ))
      AND (
        (${filterOnHold}::boolean IS TRUE AND a.review_on_hold IS TRUE)
        OR (${filterOnHold}::boolean IS FALSE AND (${filterByStatus}::text IS NULL OR a.status = ${filterByStatus}))
      )
    ),
    page AS (
      SELECT *, COUNT(*) OVER()::int AS total
      FROM filtered
      ORDER BY created_at ${sortOrder === "ASC" ? sql`ASC` : sql`DESC`}
      LIMIT ${20} OFFSET ${offset}
    ),
    page_with_latest AS (
      SELECT page.*, COALESCE(latest.id = page.id, TRUE) AS is_latest
      FROM page
      LEFT JOIN LATERAL (
        SELECT id
        FROM applications
        WHERE (page.user_id IS NOT NULL AND user_id = page.user_id)
           OR (page.user_id IS NULL AND page.applicant_email IS NOT NULL AND user_id IS NULL AND LOWER(applicant_email) = LOWER(page.applicant_email))
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      ) latest ON true
    )
    SELECT
      COALESCE(
        jsonb_agg(to_jsonb(page_with_latest) - 'total' - 'user_id' ORDER BY page_with_latest.created_at ${sortOrder === "ASC" ? sql`ASC` : sql`DESC`}),
        '[]'::jsonb
      ) AS applications,
      COALESCE(MAX(page_with_latest.total), (SELECT COUNT(*)::int FROM filtered)) AS total
    FROM page_with_latest
  `).at(0);

  const applications = applicationList?.applications ?? [];
  const totalCount = applicationList?.total ?? 0;

  // The review-mode queue: latest pending-review applications not on hold. This
  // mirrors the WHERE in the review-mode entry page (locks are transient, so
  // they don't change the queue size).
  const reviewQueueCount =
    (await sql<{ count: number }[]>`
      SELECT COUNT(*)::int AS count
      FROM applications a
      LEFT JOIN LATERAL (
        SELECT id
        FROM applications
        WHERE (a.user_id IS NOT NULL AND user_id = a.user_id)
           OR (a.user_id IS NULL AND a.applicant_email IS NOT NULL AND user_id IS NULL AND LOWER(applicant_email) = LOWER(a.applicant_email))
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      ) latest ON true
      WHERE a.status = ${APPLICATION_STATUS_PENDING_REVIEW}
        AND a.review_on_hold IS NOT TRUE
        AND COALESCE(latest.id, a.id) = a.id
    `).at(0)?.count ?? 0;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-4xl leading-[3rem] text-foreground">{t("admin.applications-list.title")}</h1>
        <Link
          href="/admin/applications/review"
          className="ui-open-link inline-flex items-center gap-1 whitespace-nowrap font-body text-lg leading-none"
        >
          Review Mode ({reviewQueueCount}) <span aria-hidden="true">↗</span>
        </Link>
      </header>
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-full max-w-sm">
          <SearchBar placeholder={t("admin.search-placeholder")} strongPlaceholder />
        </div>
        <div className="flex w-full min-w-0 items-center gap-2 sm:ml-auto sm:w-auto">
          <div className="min-w-0 flex-1 sm:flex-none">
            <StatusFilter
              placeholder={t("admin.status-filter.all")}
              options={APPLICATION_STATUS_FILTER_OPTIONS.map((option) => ({
                value: option.value,
                label: t(option.labelKey),
              }))}
            />
          </div>
          <SortToggle storageKey="admin:applications:sort" />
        </div>
      </div>
      <div className="ui-table-group">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-foreground">
              <th className="px-4 py-4 font-body text-base leading-8 text-secondary">{t("admin.applications-list.columns.applicant")}</th>
              <th className="px-4 py-4 font-body text-base leading-8 text-secondary">{t("admin.applications-list.columns.name-on-app")}</th>
              <th className="px-4 py-4 font-body text-base leading-8 text-secondary">{t("admin.applications-list.columns.status")}</th>
              <th className="px-4 py-4 font-body text-base leading-8 text-secondary">{t("admin.applications-list.columns.location")}</th>
              <th className="px-4 py-4 font-body text-base leading-8 text-secondary">{t("admin.applications-list.columns.submitted")}</th>
              <th className="px-4 py-4 font-body text-base leading-8 text-secondary">{t("admin.applications-list.columns.open")}</th>
            </tr>
          </thead>
          <tbody>
            {applications.map((application) => {
              const applicantName =
                dedupeRepeatedLastName(application.user_name) ??
                dedupeRepeatedLastName(application.name) ??
                "-";
              const applicationName = dedupeRepeatedLastName(application.name) ?? "-";

              return (
                <tr key={application.id} className="border-b border-foreground last:border-b-0">
                  <td className="px-4 py-4">
                    <div className="flex items-center gap-3">
                      <div className="relative shrink-0">
                        <SlackAvatar
                          slackId={application.slack_id ?? application.applicant_slack_id}
                          fallbackName={application.slack_name ?? applicantName}
                          sizeClassName="h-12 w-12"
                        />
                        {application.review_on_hold === true ? (
                          <span
                            aria-label={t("admin.applications-list.on-hold")}
                            className="absolute bottom-0 right-0 flex h-5 w-5 items-center justify-center rounded-full border border-foreground bg-card text-xs leading-none"
                          >
                            ⚠️
                          </span>
                        ) : null}
                      </div>
                      <div>
                        <div className="font-body text-base text-foreground">
                          {applicantName}
                        </div>
                        <div className="font-body text-sm text-foreground">
                          {application.user_email ?? application.applicant_email ?? "-"}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-4 font-body text-base leading-8 text-foreground">
                    {applicationName}
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex items-center gap-2">
                      <StatusBadge status={application.status} />
                      {application.is_latest === true ? (
                        <span className={pillVariants({ tone: "green" })}>
                          {t("admin.applications-list.latest")}
                        </span>
                      ) : (
                        <span className={pillVariants({ tone: "black" })}>
                          {t("admin.applications-list.history")}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-4 font-body text-base leading-8 text-foreground">
                    {application.city !== null && application.country_code !== null
                      ? `${application.city}, ${application.country_code}`
                      : application.address_city !== null && application.address_country !== null
                        ? `${application.address_city}, ${application.address_country}`
                        : "-"}
                  </td>
                  <td className="px-4 py-4 font-body text-base leading-8 text-foreground">
                    <Timestamp value={application.created_at} locale={locale} dateOnly />
                  </td>
                  <td className="px-4 py-4">
                    <Link
                      href={`/admin/applications/${application.id}`}
                      aria-label={t("admin.applications-list.view-details")}
                      className="ui-open-link inline-flex font-body text-lg leading-none"
                    >
                      <span aria-hidden="true">↗</span>
                    </Link>
                  </td>
                </tr>
              );
            })}
            {applications.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center font-body text-base text-foreground">
                  {t("admin.applications-list.empty")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <Pagination
          totalCount={totalCount}
          pageSize={20}
          labels={{
            previous: t("admin.pagination.previous"),
            next: t("admin.pagination.next"),
            of: t("admin.pagination.of"),
          }}
        />
      </div>
    </div>
  );
}
