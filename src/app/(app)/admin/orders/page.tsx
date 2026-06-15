import Link from "next/link";
import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";

import { ConfirmSubmitForm } from "@/components/admin/confirm-submit-form";
import { Timestamp } from "@/components/timestamp";
import { Pagination } from "@/components/ui/pagination";
import { SearchBar } from "@/components/admin/search-bar";
import { StatusFilter } from "@/components/admin/status-filter";
import { SlackAvatar } from "@/components/admin/slack-profile";
import { WarehouseStats } from "@/components/admin/warehouse-stats";
import { pillVariants } from "@/components/ui/pill";
import { getTranslatedPageMetadata } from "@/i18n/metadata";
import sql from "@/lib/database/client";
import { ensureSchema } from "@/lib/database/ensure-schema";
import { getHcbOauthConnection } from "@/lib/hcb/service";
import {
  buildEmptyShirtStockBySize,
  isShirtSizeInStock,
  ORDER_STATUS_APPROVED,
  ORDER_STATUS_CANCELLED,
  ORDER_STATUS_FAILED,
  ORDER_STATUS_PENDING,
  ORDER_STATUS_REJECTED,
  SHIRT_SIZES,
} from "@/lib/shop";
import { loadAvailableShirtStockBySize } from "@/lib/shirt/stock";
import { formatHackClubAddress, type HackClubAddress } from "@/lib/settings";

type OrderRow = {
  id: string;
  status: string;
  sku: string | null;
  variant: string | null;
  address: HackClubAddress | null;
  note: string | null;
  created_at: string;
  dispatch_at: string | null;
  user_name: string | null;
  user_email: string | null;
  user_slack_id: string | null;
  user_slack_name: string | null;
};

const ORDER_STATUS_FILTER_OPTIONS = [
  { value: ORDER_STATUS_PENDING, labelKey: "admin.orders.status-filter.pending" },
  { value: ORDER_STATUS_APPROVED, labelKey: "admin.orders.status-filter.approved" },
  { value: ORDER_STATUS_REJECTED, labelKey: "admin.orders.status-filter.rejected" },
  { value: ORDER_STATUS_FAILED, labelKey: "admin.orders.status-filter.failed" },
  { value: ORDER_STATUS_CANCELLED, labelKey: "admin.orders.status-filter.cancelled" },
] as const;

const HCB_AUTH_STATUS_MESSAGES = new Map<string, string>([
  ["connected", "HCB authorization updated."],
  ["denied", "HCB authorization was cancelled."],
  ["invalid_state", "HCB authorization failed because the state did not match."],
  ["missing_code", "HCB authorization failed because no code was returned."],
  ["forbidden", "HCB authorization requires an active admin session."],
  ["failed", "HCB authorization failed."],
]);

type OrderListResultRow = {
  orders: OrderRow[];
  total: number;
};

export async function generateMetadata(): Promise<Metadata> {
  return getTranslatedPageMetadata("admin.orders.metadata.title");
}

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string; hcb?: string; status?: string }>;
}) {
  const [t, locale, query] = await Promise.all([getTranslations(), getLocale(), searchParams]);
  await ensureSchema();

  const page = Math.max(1, Number(query.page ?? "1"));
  const offset = (page - 1) * 20;
  const search = query.q?.trim() ?? "";
  const searchFilter = search ? `%${search}%` : null;
  const statusFilter = query.status?.trim() ?? "";
  const filterByStatus = statusFilter !== "" ? statusFilter : null;

  const [orderList, hcbConnection, stockBySize] = await Promise.all([
    sql<OrderListResultRow[]>`
      WITH filtered AS (
        SELECT o.id, o.status, o.sku, o.variant, o.address, o.note, o.created_at, o.dispatch_at,
               u.display_name AS user_name, u.email AS user_email,
               u.slack_id AS user_slack_id, u.slack_name AS user_slack_name
        FROM orders o
        LEFT JOIN users u ON u.id = o.user_id
        WHERE (${searchFilter}::text IS NULL OR (
          u.display_name ILIKE ${searchFilter}
          OR u.email ILIKE ${searchFilter}
          OR u.slack_id ILIKE ${searchFilter}
          OR u.slack_name ILIKE ${searchFilter}
        ))
        AND (
          ${filterByStatus}::text IS NULL OR o.status = ${filterByStatus}
        )
      ),
      page AS (
        SELECT *, COUNT(*) OVER()::int AS total
        FROM filtered
        ORDER BY
          CASE WHEN status = ${ORDER_STATUS_PENDING} THEN 0 ELSE 1 END,
          created_at DESC
        LIMIT ${20} OFFSET ${offset}
      )
      SELECT
        COALESCE(
          jsonb_agg(
            to_jsonb(page) - 'total'
            ORDER BY CASE WHEN page.status = ${ORDER_STATUS_PENDING} THEN 0 ELSE 1 END, page.created_at DESC
          ),
          '[]'::jsonb
        ) AS orders,
        COALESCE(MAX(page.total), (SELECT COUNT(*)::int FROM filtered)) AS total
      FROM page
    `,
    getHcbOauthConnection(),
    loadAvailableShirtStockBySize().catch(() => buildEmptyShirtStockBySize()),
  ]);

  const orders = orderList.at(0)?.orders ?? [];
  const totalCount = orderList.at(0)?.total ?? 0;
  const hcbStatus = query.hcb?.trim() ?? "";
  const hcbStatusMessage = hcbStatus === "" ? null : HCB_AUTH_STATUS_MESSAGES.get(hcbStatus) ?? null;
  const lastHcbError = hcbConnection?.lastError?.trim() ?? "";
  return (
    <div className="space-y-4">
      <header className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-6 gap-y-4">
            <h1 className="text-4xl leading-[3rem] text-foreground">{t("admin.orders.title")}</h1>
            <div className="flex flex-wrap items-center self-center gap-x-4 gap-y-2 font-body text-sm text-foreground tabular-nums">
              {SHIRT_SIZES.map((size) => {
                const stock = stockBySize[size];
                return (
                  <div key={size} className="flex items-center gap-2">
                    <span className="text-secondary">{size}</span>
                    <span>
                      {isShirtSizeInStock(stock)
                        ? t("admin.orders.warehouse.stock-left", { count: stock })
                        : t("admin.orders.warehouse.stock-out")}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
          <ConfirmSubmitForm
            action="/api/admin/hcb/authorize"
            method="POST"
            confirmationMessage="Re-authorize the HCB integration?"
          >
            <button
              type="submit"
              data-slot="open-link"
              className="ui-open-link inline-flex font-body text-lg leading-none"
            >
              Re-authorize HCB ↗
            </button>
          </ConfirmSubmitForm>
        </div>
        {lastHcbError !== "" || hcbStatusMessage !== null ? (
          <div className="space-y-1">
            {lastHcbError !== "" ? (
              <p className="font-body text-sm text-foreground">{`Last HCB error: ${lastHcbError}`}</p>
            ) : null}
            {hcbStatusMessage !== null ? (
              <p className="font-body text-sm text-foreground">{hcbStatusMessage}</p>
            ) : null}
          </div>
        ) : null}
        <WarehouseStats locale={locale} />
      </header>
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-full max-w-sm">
          <SearchBar placeholder={t("admin.search-placeholder")} strongPlaceholder />
        </div>
        <div className="w-full sm:ml-auto sm:w-auto">
          <StatusFilter
            placeholder={t("admin.orders.status-filter.all")}
            options={ORDER_STATUS_FILTER_OPTIONS.map((option) => ({
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
              <th className="px-4 py-4 font-body text-base leading-8 text-secondary">
                {t("admin.orders.columns.user")}
              </th>
              <th className="px-4 py-4 font-body text-base leading-8 text-secondary">
                {t("admin.orders.columns.item")}
              </th>
              <th className="px-4 py-4 font-body text-base leading-8 text-secondary">
                {t("admin.orders.columns.address")}
              </th>
              <th className="px-4 py-4 font-body text-base leading-8 text-secondary">
                {t("admin.orders.columns.status")}
              </th>
              <th className="px-4 py-4 font-body text-base leading-8 text-secondary">
                {t("admin.orders.columns.placed")}
              </th>
              <th className="px-4 py-4 font-body text-base leading-8 text-secondary">
                {t("admin.orders.columns.open")}
              </th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.id} className="border-b border-foreground last:border-b-0 align-top">
                <td className="px-4 py-4">
                  <div className="flex items-center gap-3">
                    <SlackAvatar
                      slackId={order.user_slack_id}
                      fallbackName={order.user_slack_name ?? order.user_name}
                      sizeClassName="h-12 w-12"
                    />
                    <div>
                      <div className="font-body text-base text-foreground">
                        {order.user_name ?? "-"}
                      </div>
                      <div className="font-body text-sm text-black">
                        {order.user_email ?? "-"}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-4 font-body text-base text-foreground">
                  <div>{order.sku ?? "-"}</div>
                  {order.variant !== null && order.variant !== "" ? (
                    <div className="font-body text-sm text-black">
                      {t("admin.orders.size", { size: order.variant })}
                    </div>
                  ) : null}
                </td>
                <td className="px-4 py-4 max-w-xs font-body text-sm text-foreground">
                  {formatHackClubAddress(order.address) || "-"}
                </td>
                <td className="px-4 py-4">
                  <span
                    className={pillVariants({
                      tone:
                        order.status === ORDER_STATUS_APPROVED
                          ? "green"
                          : order.status === ORDER_STATUS_REJECTED ||
                              order.status === ORDER_STATUS_FAILED ||
                              order.status === ORDER_STATUS_CANCELLED
                            ? "red"
                            : "black",
                    })}
                  >
                    {order.status === ORDER_STATUS_PENDING
                      ? t("admin.orders.status-display.pending")
                      : order.status}
                  </span>
                  {order.note !== null && order.note.trim() !== "" ? (
                    <p className="mt-2 max-w-xs font-body text-sm text-primary">
                      {order.note}
                    </p>
                  ) : null}
                </td>
                <td className="px-4 py-4 font-body text-base leading-8 text-foreground">
                  <Timestamp value={order.created_at} locale={locale} dateOnly />
                </td>
                <td className="px-4 py-4">
                  <Link
                    href={`/admin/orders/${order.id}`}
                    aria-label={t("admin.orders.view-order")}
                    className="ui-open-link inline-flex font-body text-lg leading-none"
                  >
                    <span aria-hidden="true">↗</span>
                  </Link>
                </td>
              </tr>
            ))}
            {orders.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center font-body text-base text-foreground">
                  {t("admin.orders.empty")}
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
