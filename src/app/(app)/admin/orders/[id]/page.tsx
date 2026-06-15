import Link from "next/link";
import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { ConfirmSubmitForm } from "@/components/admin/confirm-submit-form";
import { DetailDateRow, DetailFieldRow, DetailSection } from "@/components/admin/detail";
import { SlackAvatar } from "@/components/admin/slack-profile";
import { buttonVariants } from "@/components/ui/button";
import { pillVariants } from "@/components/ui/pill";
import { Textarea } from "@/components/ui/textarea";
import { getTranslatedPageMetadata } from "@/i18n/metadata";
import sql from "@/lib/database/client";
import { ensureSchema } from "@/lib/database/ensure-schema";
import { formatDateTime } from "@/lib/format";
import { formatHackClubAddress, type HackClubAddress } from "@/lib/settings";
import {
  buildWarehousePublicOrderUrl,
  buildWarehouseTrackingUrl,
  isOrderWithinEmbargo,
  ORDER_STATUS_APPROVED,
  ORDER_STATUS_CANCELLED,
  ORDER_STATUS_FAILED,
  ORDER_STATUS_PENDING,
  ORDER_STATUS_REJECTED,
} from "@/lib/shop";
import { parseWarehouseOrderResponse } from "@/lib/warehouse";

export async function generateMetadata(): Promise<Metadata> {
  return getTranslatedPageMetadata("admin.order-detail.page-title");
}

type OrderDetailRow = {
  id: string;
  user_id: string;
  status: string;
  sku: string | null;
  variant: string | null;
  quantity: number | null;
  address: HackClubAddress | null;
  warehouse_order_id: string | null;
  warehouse_status: string | null;
  warehouse_payload: unknown | null;
  note: string | null;
  internal_fail_reason: string | null;
  reviewed_at: string | null;
  dispatch_at: string | null;
  created_at: string;
  updated_at: string;
  user_name: string | null;
  user_email: string | null;
  user_slack_id: string | null;
  user_slack_name: string | null;
  reviewed_by_name: string | null;
};

type OrderIdRow = {
  id: string;
};

export default async function AdminOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [{ id }, t, locale] = await Promise.all([
    params,
    getTranslations(),
    getLocale(),
  ]);
  await ensureSchema();

  const order = (await sql<OrderDetailRow[]>`
    SELECT o.id, o.user_id, o.status, o.sku, o.variant, o.quantity, o.address,
           o.warehouse_order_id, o.warehouse_status, o.warehouse_payload,
           o.note, o.internal_fail_reason,
           o.reviewed_at, o.dispatch_at, o.created_at, o.updated_at,
           u.display_name AS user_name, u.email AS user_email,
           u.slack_id AS user_slack_id, u.slack_name AS user_slack_name,
           reviewer.display_name AS reviewed_by_name
    FROM orders o
    LEFT JOIN users u ON u.id = o.user_id
    LEFT JOIN users reviewer ON reviewer.id = o.reviewed_by
    WHERE o.id = ${id}
    LIMIT 1
  `).at(0) ?? null;

  if (order === null) notFound();

  const redirectTo = `/admin/orders/${order.id}`;
  const warehousePayload = parseWarehouseOrderResponse(order.warehouse_payload);
  const addressString =
    formatHackClubAddress(order.address) ||
    formatHackClubAddress(warehousePayload?.address) ||
    null;
  const latestOrder = (await sql<OrderIdRow[]>`
    SELECT id
    FROM orders
    WHERE user_id = ${order.user_id}
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `).at(0) ?? null;
  const isLatestOrder = latestOrder?.id === order.id;
  const withinEmbargo = isOrderWithinEmbargo(order.status, order.dispatch_at);
  const warehouseOrderId = order.warehouse_order_id ?? warehousePayload?.id ?? null;
  const warehouseUrl = warehouseOrderId === null ? null : buildWarehouseTrackingUrl(warehouseOrderId);
  const publicOrderUrl = warehouseOrderId === null ? null : buildWarehousePublicOrderUrl(warehouseOrderId);
  const warehouseStatus = order.warehouse_status ?? warehousePayload?.status ?? null;
  const warehouseAddress = formatHackClubAddress(warehousePayload?.address) || null;
  const warehouseTags =
    warehousePayload?.tags !== undefined && warehousePayload.tags.length > 0
      ? warehousePayload.tags.join(", ")
      : null;

  return (
    <div className="space-y-12">
      <header className="space-y-4">
        <div className="flex flex-wrap items-center gap-3 text-sm text-secondary">
          <Link href="/admin/orders" className="hover:text-foreground">
            {t("admin.order-detail.breadcrumb")}
          </Link>
          <span>/</span>
          <span className="font-body text-foreground">{order.id}</span>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-4">
              <SlackAvatar
                slackId={order.user_slack_id}
                fallbackName={order.user_slack_name ?? order.user_name}
                sizeClassName="h-16 w-16"
                textClassName="text-lg"
              />
              <h1 className="text-4xl leading-[3rem] text-foreground">
                {order.user_name ?? t("admin.order-detail.unknown-user")}
              </h1>
            </div>
            <div className="flex flex-wrap items-center gap-3">
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
            </div>
          </div>
          {order.user_id ? (
            <Link
              href={`/admin/users/${order.user_id}`}
              aria-label={t("admin.order-detail.open-user-page")}
              className="ui-open-link inline-flex font-body text-lg leading-none"
            >
              <span aria-hidden="true">↗</span>
            </Link>
          ) : null}
        </div>
      </header>

      <DetailSection
        title={t("admin.order-detail.sections.review-actions.title")}
        description={t("admin.order-detail.sections.review-actions.description")}
      >
        {isLatestOrder ? (
          order.status === ORDER_STATUS_PENDING ? (
            <div className="space-y-8">
              <div className="max-w-xl space-y-2">
                <p className="font-body text-base text-foreground">
                  {withinEmbargo
                    ? t("admin.order-detail.actions.embargo-active", {
                        dispatchAt: formatDateTime(order.dispatch_at, locale) ?? "",
                      })
                    : t("admin.order-detail.actions.embargo-expired-auto")}
                </p>
                {withinEmbargo ? (
                  <p className="font-body text-sm text-secondary">
                    {t("admin.order-detail.actions.embargo-bypass-explainer")}
                  </p>
                ) : null}
              </div>

              <ConfirmSubmitForm
                action={`/api/admin/orders/${order.id}/approve`}
                method="POST"
                className="max-w-xl space-y-3"
                confirmationMessages={
                  withinEmbargo
                    ? [
                        t("admin.order-detail.actions.bypass-confirmation-first"),
                        t("admin.order-detail.actions.bypass-confirmation-second"),
                      ]
                    : [
                        t("admin.order-detail.actions.approve-confirmation-first"),
                        t("admin.order-detail.actions.approve-confirmation-second"),
                      ]
                }
              >
                <input type="hidden" name="redirectTo" value={redirectTo} />
                <button className={buttonVariants({ variant: "success", size: "app" })}>
                  {warehouseOrderId !== null
                    ? t("admin.order-detail.actions.approve-existing")
                    : withinEmbargo
                      ? t("admin.order-detail.actions.bypass-embargo")
                      : t("admin.order-detail.actions.approve")}
                </button>
              </ConfirmSubmitForm>

              <ConfirmSubmitForm
                action={`/api/admin/orders/${order.id}/reject`}
                method="POST"
                className="max-w-xl space-y-3"
                confirmationMessage={t("common.confirm-destructive")}
              >
                <input type="hidden" name="redirectTo" value={redirectTo} />
                <label className="block text-sm text-secondary">
                  {t("admin.order-detail.actions.reject-note-label")}
                  <Textarea
                    name="note"
                    rows={4}
                    className="ui-input-surface mt-2 min-h-20 resize-none border-foreground bg-transparent px-5 py-4 font-body text-base font-normal placeholder:font-normal hover:bg-transparent md:text-base"
                    placeholder={t("admin.order-detail.actions.reject-note-placeholder")}
                  />
                </label>
                <button className={buttonVariants({ size: "app" })}>
                  {t("admin.order-detail.actions.reject")}
                </button>
              </ConfirmSubmitForm>
            </div>
          ) : (
            <p className="font-body text-base text-foreground">
              {t("admin.order-detail.actions.non-pending")}
            </p>
          )
        ) : (
          <p className="font-body text-base text-foreground">
            {t("admin.order-detail.actions.historical-order")}
          </p>
        )}
      </DetailSection>

      <DetailSection
        title={t("admin.order-detail.sections.order.title")}
        description={t("admin.order-detail.sections.order.description")}
      >
        <DetailFieldRow label={t("admin.order-detail.fields.order-id")} value={order.id} mono />
        <DetailFieldRow label={t("admin.order-detail.fields.sku")} value={order.sku} mono />
        <DetailFieldRow label={t("admin.order-detail.fields.variant")} value={order.variant} />
        <DetailFieldRow
          label={t("admin.order-detail.fields.quantity")}
          value={order.quantity != null ? String(order.quantity) : null}
        />
        <DetailFieldRow
          label={t("admin.order-detail.fields.address")}
          value={addressString}
          multiline
        />
        <DetailFieldRow
          label={t("admin.order-detail.fields.note")}
          value={order.note}
          multiline
        />
      </DetailSection>

      <DetailSection
        title={t("admin.order-detail.sections.warehouse.title")}
        description={t("admin.order-detail.sections.warehouse.description")}
      >
        <DetailFieldRow
          label={t("admin.order-detail.fields.warehouse-order-id")}
          value={warehouseOrderId}
          mono
        />
        <DetailFieldRow
          label={t("admin.order-detail.fields.warehouse-status")}
          value={warehouseStatus}
        />
        <DetailFieldRow
          label={t("admin.order-detail.fields.warehouse-address")}
          value={warehouseAddress}
          multiline
        />
        <DetailFieldRow
          label={t("admin.order-detail.fields.recipient-email")}
          value={warehousePayload?.recipient_email}
        />
        <DetailFieldRow
          label={t("admin.order-detail.fields.tracking-number")}
          value={warehousePayload?.tracking_number}
          mono
        />
        <DetailFieldRow
          label={t("admin.order-detail.fields.carrier")}
          value={warehousePayload?.carrier}
        />
        <DetailFieldRow
          label={t("admin.order-detail.fields.service")}
          value={warehousePayload?.service}
        />
        <DetailDateRow
          label={t("admin.order-detail.fields.dispatched-at")}
          value={warehousePayload?.dispatched_at ?? null}
          locale={locale}
        />
        <DetailDateRow
          label={t("admin.order-detail.fields.mailed-at")}
          value={warehousePayload?.mailed_at ?? null}
          locale={locale}
        />
        <DetailFieldRow
          label={t("admin.order-detail.fields.warehouse-tags")}
          value={warehouseTags}
        />
        <DetailFieldRow
          label={t("admin.order-detail.fields.internal-fail-reason")}
          value={order.internal_fail_reason}
          multiline
        />
        {warehouseUrl !== null || publicOrderUrl !== null ? (
          <div className="flex flex-wrap gap-3">
            {warehouseUrl !== null ? (
              <a
                href={warehouseUrl}
                target="_blank"
                rel="noreferrer"
                className={buttonVariants({ size: "app-sm" })}
              >
                {t("admin.order-detail.actions.open-warehouse-order")}
                <span aria-hidden="true">↗</span>
              </a>
            ) : null}
            {publicOrderUrl !== null ? (
              <a
                href={publicOrderUrl}
                target="_blank"
                rel="noreferrer"
                className={buttonVariants({ size: "app-sm" })}
              >
                {t("admin.order-detail.actions.open-public-order")}
                <span aria-hidden="true">↗</span>
              </a>
            ) : null}
          </div>
        ) : null}
      </DetailSection>

      <DetailSection
        title={t("admin.order-detail.sections.metadata.title")}
        description={t("admin.order-detail.sections.metadata.description")}
      >
        <DetailDateRow
          label={t("admin.order-detail.fields.placed")}
          value={order.created_at}
          locale={locale}
        />
        <DetailDateRow
          label={t("admin.order-detail.fields.last-updated")}
          value={order.updated_at}
          locale={locale}
        />
        <DetailDateRow
          label={t("admin.order-detail.fields.dispatch-at")}
          value={order.dispatch_at}
          locale={locale}
        />
        <DetailDateRow
          label={t("admin.order-detail.fields.reviewed")}
          value={order.reviewed_at}
          locale={locale}
        />
        <DetailFieldRow
          label={t("admin.order-detail.fields.reviewed-by")}
          value={order.reviewed_by_name}
        />
        <DetailFieldRow
          label={t("admin.order-detail.fields.user-email")}
          value={order.user_email}
        />
      </DetailSection>
    </div>
  );
}
