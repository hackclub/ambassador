import Link from "next/link";
import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";

import { Timestamp } from "@/components/timestamp";
import { Pagination } from "@/components/ui/pagination";
import { SearchBar } from "@/components/admin/search-bar";
import { StatusFilter } from "@/components/admin/status-filter";
import { SlackAvatar } from "@/components/admin/slack-profile";
import { StatusBadge } from "@/components/admin/status-badge";
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

type UserListRow = {
  id: string;
  email: string | null;
  display_name: string;
  slack_id: string | null;
  slack_name: string | null;
  is_admin: boolean | null;
  created_at: string;
  latest_application_id: string | null;
  latest_application_status: string | null;
  application_count: number;
};

type UserListResultRow = {
  users: UserListRow[];
  total: number;
};

const APPLICATION_STATUS_FILTER_OPTIONS = [
  { value: APPLICATION_STATUS_PENDING_AUTOMATIC_CHECKS, labelKey: "admin.status-filter.pending-automatic-checks" },
  { value: APPLICATION_STATUS_PENDING_REVIEW, labelKey: "admin.status-filter.pending-review" },
  { value: APPLICATION_STATUS_ACCEPTED, labelKey: "admin.status-filter.accepted" },
  { value: APPLICATION_STATUS_REJECTED, labelKey: "admin.status-filter.rejected" },
  { value: APPLICATION_STATUS_REJECTED_PERMANENT, labelKey: "admin.status-filter.rejected-permanently" },
  { value: "none", labelKey: "admin.status-filter.none" },
] as const;

export async function generateMetadata(): Promise<Metadata> {
  return getTranslatedPageMetadata("admin.users-list.metadata.title");
}

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string; status?: string }>;
}) {
  const [t, locale, query] = await Promise.all([getTranslations(), getLocale(), searchParams]);
  await ensureSchema();

  const page = Math.max(1, Number(query.page ?? "1"));
  const offset = (page - 1) * 20;
  const search = query.q?.trim() ?? "";
  const searchFilter = search ? `%${search}%` : null;
  const statusFilter = query.status?.trim() ?? "";
  // "none" means users with no application; otherwise filter by latest_application_status value
  const filterByNone = statusFilter === "none";
  const filterByStatus = !filterByNone && statusFilter !== "" ? statusFilter : null;

  const userList = (await sql<UserListResultRow[]>`
    WITH filtered AS (
      SELECT u.id, u.email, u.display_name, u.slack_id, u.slack_name, u.is_admin,
             u.created_at, latest.id AS latest_application_id, latest.status AS latest_application_status
      FROM users u
      LEFT JOIN LATERAL (
        SELECT id, status
        FROM applications
        WHERE user_id = u.id
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      ) latest ON true
      WHERE (${searchFilter}::text IS NULL OR (
        u.display_name ILIKE ${searchFilter}
        OR u.email ILIKE ${searchFilter}
        OR u.slack_id ILIKE ${searchFilter}
        OR u.slack_name ILIKE ${searchFilter}
      ))
      AND (
        ${filterByNone} = false OR latest.id IS NULL
      )
      AND (
        ${filterByStatus}::text IS NULL OR latest.status = ${filterByStatus}
      )
    ),
    page AS (
      SELECT *, COUNT(*) OVER()::int AS total
      FROM filtered
      ORDER BY created_at DESC
      LIMIT ${20} OFFSET ${offset}
    ),
    page_with_counts AS (
      SELECT page.*, app_count.application_count
      FROM page
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS application_count
        FROM applications
        WHERE user_id = page.id
      ) app_count ON true
    )
    SELECT
      COALESCE(jsonb_agg(to_jsonb(page_with_counts) - 'total' ORDER BY page_with_counts.created_at DESC), '[]'::jsonb) AS users,
      COALESCE(MAX(page_with_counts.total), (SELECT COUNT(*)::int FROM filtered)) AS total
    FROM page_with_counts
  `).at(0);

  const users = userList?.users ?? [];
  const totalCount = userList?.total ?? 0;

  return (
    <div className="space-y-4">
      <header className="space-y-2">
        <h1 className="text-4xl leading-[3rem] text-foreground">{t("admin.users-list.title")}</h1>
      </header>
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-full max-w-sm">
          <SearchBar placeholder={t("admin.search-placeholder")} strongPlaceholder />
        </div>
        <div className="w-full sm:ml-auto sm:w-auto">
          <StatusFilter
            placeholder={t("admin.status-filter.all")}
            options={APPLICATION_STATUS_FILTER_OPTIONS.map((option) => ({
              value: option.value,
              label: t(option.labelKey),
            }))}
          />
        </div>
      </div>
      <div className="ui-table-group">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-foreground">
              <th className="px-4 py-4 font-body text-base leading-8 text-secondary">{t("admin.users-list.columns.name")}</th>
              <th className="px-4 py-4 font-body text-base leading-8 text-secondary">{t("admin.users-list.columns.email")}</th>
              <th className="px-4 py-4 font-body text-base leading-8 text-secondary">{t("admin.users-list.columns.latest-app")}</th>
              <th className="px-4 py-4 font-body text-base leading-8 text-secondary">{t("admin.users-list.columns.apps")}</th>
              <th className="px-4 py-4 font-body text-base leading-8 text-secondary">{t("admin.users-list.columns.admin")}</th>
              <th className="px-4 py-4 font-body text-base leading-8 text-secondary">{t("admin.users-list.columns.joined")}</th>
              <th className="px-4 py-4 font-body text-base leading-8 text-secondary">{t("admin.users-list.columns.open")}</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} className="border-b border-foreground last:border-b-0">
                <td className="px-4 py-4">
                  <div className="flex items-center gap-3">
                    <SlackAvatar
                      slackId={user.slack_id}
                      fallbackName={user.slack_name ?? user.display_name}
                      sizeClassName="h-12 w-12"
                    />
                    <div className="font-body text-base text-foreground">{user.display_name}</div>
                  </div>
                </td>
                <td className="px-4 py-4 font-body text-base leading-8 text-foreground">{user.email ?? "-"}</td>
                <td className="px-4 py-4">
                  {user.latest_application_status !== null ? (
                    <StatusBadge status={user.latest_application_status} />
                  ) : (
                    <span className="font-body text-base text-foreground">{t("admin.users-list.no-application")}</span>
                  )}
                </td>
                <td className="px-4 py-4 font-body text-base leading-8 text-foreground">
                  {user.application_count}
                </td>
                <td className="px-4 py-4 font-body text-base leading-8">
                  {user.is_admin === true ? (
                    <span className="text-acceptance">{t("common.yes")}</span>
                  ) : (
                    <span className="text-foreground">{t("common.no")}</span>
                  )}
                </td>
                <td className="px-4 py-4 font-body text-base leading-8 text-foreground">
                  <Timestamp value={user.created_at} locale={locale} dateOnly />
                </td>
                <td className="px-4 py-4">
                  <Link
                    href={`/admin/users/${user.id}`}
                    aria-label={t("admin.users-list.view-user")}
                    className="ui-open-link inline-flex font-body text-lg leading-none"
                  >
                    <span aria-hidden="true">↗</span>
                  </Link>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center font-body text-base text-foreground">
                  {t("admin.users-list.empty")}
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
