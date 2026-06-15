import Link from "next/link";
import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { ConfirmSubmitForm } from "@/components/admin/confirm-submit-form";
import { DetailFieldRow, DetailSection } from "@/components/admin/detail";
import { Timestamp } from "@/components/timestamp";
import { buttonVariants } from "@/components/ui/button";
import {
  formatAuditEventSummary,
  formatEventType,
  getAuditEventDetailRows,
  getMetadataRecord,
} from "@/lib/admin-action-event-format";
import sql from "@/lib/database/client";
import { ensureSchema } from "@/lib/database/ensure-schema";
import { getTranslatedPageMetadata } from "@/i18n/metadata";
import { cn } from "@/lib/utils";

type AuditLogEventRow = {
  id: string;
  actor_user_id: string | null;
  target_user_id: string | null;
  action: string;
  metadata: Record<string, unknown>;
  created_at: string;
  actor_display_name: string | null;
  actor_email: string | null;
  target_display_name: string | null;
  target_email: string | null;
};

export async function generateMetadata(): Promise<Metadata> {
  return getTranslatedPageMetadata("admin.audit-log.event-detail.metadata.title");
}

export default async function AdminAuditLogEventPage({
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

  const event = (await sql<AuditLogEventRow[]>`
    SELECT
      e.id, e.actor_user_id, e.target_user_id, e.action, e.metadata, e.created_at,
      actor.display_name AS actor_display_name,
      actor.email AS actor_email,
      target.display_name AS target_display_name,
      target.email AS target_email
    FROM admin_action_events e
    LEFT JOIN users actor ON actor.id = e.actor_user_id
    LEFT JOIN users target ON target.id = e.target_user_id
    WHERE e.id = ${id}
    LIMIT 1
  `).at(0) ?? null;

  if (event === null) {
    notFound();
  }

  const detailRows = getAuditEventDetailRows(event.metadata);

  const metadataRecord = getMetadataRecord(event.metadata) ?? {};
  const deletedPosterId =
    event.action === "poster_deleted" && typeof metadataRecord.posterId === "string"
      ? metadataRecord.posterId
      : null;
  let reversal: "deleted" | "live" | "recreatable" | "gone" | null = null;
  if (deletedPosterId !== null) {
    const poster = (await sql<{ deleted_at: string | null }[]>`
      SELECT deleted_at FROM posters WHERE id = ${deletedPosterId} LIMIT 1
    `).at(0);
    if (poster !== undefined) {
      reversal = poster.deleted_at === null ? "live" : "deleted";
    } else {
      const recreatable =
        event.target_user_id !== null &&
        typeof metadataRecord.referralCode === "string" &&
        typeof metadataRecord.campaignSlug === "string";
      reversal = recreatable ? "recreatable" : "gone";
    }
  }

  return (
    <div className="space-y-8">
      <header className="space-y-4">
        <div className="flex flex-wrap items-center gap-3 text-sm text-secondary">
          <Link href="/admin/audit-log" className="hover:text-foreground">
            {t("admin.audit-log.event-detail.breadcrumb")}
          </Link>
          <span>/</span>
          <span className="font-body text-foreground">{event.id}</span>
        </div>
        <div className="space-y-2">
          <h1 className="text-4xl leading-[3rem] text-foreground">{formatEventType(event.action)}</h1>
          <p className="max-w-3xl font-body text-base text-foreground">
            {formatAuditEventSummary(event)}
          </p>
        </div>
      </header>

      <DetailSection
        title={t("admin.audit-log.event-detail.sections.event.title")}
        description={t("admin.audit-log.event-detail.sections.event.description")}
      >
        <DetailFieldRow
          label={t("admin.audit-log.event-detail.fields.event-id")}
          value={event.id}
        />
        <DetailFieldRow
          label={t("admin.audit-log.columns.event")}
          value={formatEventType(event.action)}
        />
        <div className="grid gap-2 sm:grid-cols-[14rem_minmax(0,1fr)] sm:gap-5">
          <div className="text-sm text-secondary">{t("admin.audit-log.columns.when")}</div>
          <div className="font-body text-base text-foreground">
            <Timestamp value={event.created_at} locale={locale} />
          </div>
        </div>
      </DetailSection>

      <DetailSection
        title={t("admin.audit-log.event-detail.sections.people.title")}
        description={t("admin.audit-log.event-detail.sections.people.description")}
      >
        <UserEventRow
          label={t("admin.audit-log.columns.actor")}
          userId={event.actor_user_id}
          displayName={event.actor_display_name}
          email={event.actor_email}
          emptyLabel={t("admin.audit-log.system")}
        />
        <UserEventRow
          label={t("admin.audit-log.columns.target")}
          userId={event.target_user_id}
          displayName={event.target_display_name}
          email={event.target_email}
          emptyLabel="-"
        />
      </DetailSection>

      <DetailSection
        title={t("admin.audit-log.event-detail.sections.details.title")}
        description={t("admin.audit-log.event-detail.sections.details.description")}
      >
        {detailRows.length > 0 ? (
          detailRows.map((row) => (
            <AuditDetailRow key={row.label} label={row.label} value={row.value} />
          ))
        ) : (
          <p className="font-body text-base text-foreground">
            {t("admin.audit-log.event-detail.no-details")}
          </p>
        )}
      </DetailSection>

      {reversal !== null ? (
        <DetailSection
          title={t("admin.audit-log.event-detail.reverse.title")}
          description={t("admin.audit-log.event-detail.reverse.description")}
        >
          {reversal === "deleted" || reversal === "recreatable" ? (
            <ConfirmSubmitForm
              action={`/api/admin/audit-log/${event.id}/revert`}
              method="POST"
              confirmationMessage={
                reversal === "recreatable"
                  ? t("admin.audit-log.event-detail.reverse.recreate-confirm")
                  : t("admin.audit-log.event-detail.reverse.confirm")
              }
            >
              <input type="hidden" name="redirectTo" value={`/admin/audit-log/${event.id}`} />
              {reversal === "recreatable" ? (
                <p className="mb-3 font-body text-sm text-muted-foreground">
                  {t("admin.audit-log.event-detail.reverse.recreate-note")}
                </p>
              ) : null}
              <button className={cn(buttonVariants({ variant: "default", size: "app-sm" }))}>
                {reversal === "recreatable"
                  ? t("admin.audit-log.event-detail.reverse.recreate-action")
                  : t("admin.audit-log.event-detail.reverse.action")}
              </button>
            </ConfirmSubmitForm>
          ) : (
            <p className="font-body text-base text-foreground">
              {reversal === "live"
                ? t("admin.audit-log.event-detail.reverse.already-restored")
                : t("admin.audit-log.event-detail.reverse.unavailable")}
            </p>
          )}
        </DetailSection>
      ) : null}
    </div>
  );
}

function AuditDetailRow({
  label,
  value,
}: {
  label: string;
  value: string | null;
}) {
  const displayValue = value !== null && value.trim() !== "" ? value : "-";

  return (
    <div className="grid gap-2 sm:grid-cols-[14rem_minmax(0,1fr)] sm:gap-5">
      <div className="text-sm text-secondary">{label}</div>
      <div className="break-words font-body text-base font-bold text-foreground [overflow-wrap:anywhere]">
        {displayValue}
      </div>
    </div>
  );
}

function UserEventRow({
  label,
  userId,
  displayName,
  email,
  emptyLabel,
}: {
  label: string;
  userId: string | null;
  displayName: string | null;
  email: string | null;
  emptyLabel: string;
}) {
  const name = displayName ?? email ?? userId;

  return (
    <div className="grid gap-2 sm:grid-cols-[14rem_minmax(0,1fr)] sm:gap-5">
      <div className="text-sm text-secondary">{label}</div>
      <div className="font-body text-base text-foreground break-words [overflow-wrap:anywhere]">
        {userId !== null && name !== null ? (
          <Link href={`/admin/users/${userId}`} className="ui-open-link">
            {name}
          </Link>
        ) : (
          emptyLabel
        )}
      </div>
    </div>
  );
}
