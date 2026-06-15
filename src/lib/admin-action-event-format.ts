import type { AdminActionEvent } from "@/lib/admin-action-events";

type AuditEventLike = {
  action: string;
  metadata: unknown;
};

type DetailRow = {
  label: string;
  value: string | null;
};

const EVENT_LABELS: Record<AdminActionEvent, string> = {
  application_deleted: "Application deleted",
  application_review_hold_updated: "Application review hold updated",
  application_tshirt_sent_updated: "Application T-shirt status updated",
  global_safeguard_updated: "Global safeguard updated",
  hcb_credentials_reauthorized: "HCB credentials reauthorized",
  poster_deleted: "Poster deleted",
  poster_deletion_reverted: "Poster deletion reverted",
  poster_group_deleted: "Poster group deleted",
  poster_rejected_by_admin: "Poster manually rejected",
  poster_approved_by_admin: "Poster proof approved",
  referral_status_updated_by_admin: "Referral status updated",
  payout_balance_adjusted: "Balance manually adjusted",
  payout_created_via_impersonation: "Payout created while impersonating",
  payout_manual_created: "Manual payout created",
  payout_retro_rejected: "Approved payout retroactively rejected",
  payout_reviewed: "Payout reviewed",
  payout_transfer_link_updated: "Payout transfer link updated",
  user_admin_password_rejected: "Superuser password rejected",
  user_demoted_from_admin: "User removed as admin",
  user_hcb_grant_linked: "HCB grant linked",
  user_hcb_grant_provisioned: "HCB grant provisioned",
  user_hcb_grant_unlinked: "HCB grant unlinked",
  user_impersonation_started: "Impersonation started",
  user_impersonation_stopped: "Impersonation stopped",
  user_manual_dashboard_state_updated: "Dashboard state updated",
  user_posters_enabled_updated: "Posters access updated",
  user_feature_flag_override_updated: "Feature flag override updated",
  user_promoted_to_admin: "User made admin",
};

const METADATA_LABELS: Record<string, string> = {
  amountCents: "Amount",
  applicationId: "Application",
  attemptedAction: "Attempted action",
  authorizedHcbUserEmail: "Authorized HCB email",
  authorizedHcbUserId: "Authorized HCB user",
  authorizedHcbUserName: "Authorized HCB name",
  campaignSlug: "Campaign",
  expiresAt: "Expires",
  flagKey: "Feature flag",
  grantId: "Grant",
  nextOverrideEnabled: "Override enabled",
  impersonationStartedAt: "Impersonation started",
  nextIsAdmin: "Next admin access",
  nextEnabled: "Next enabled state",
  nextOnHold: "Next hold state",
  nextPostersEnabled: "Next posters access",
  nextSent: "Next T-shirt status",
  nextState: "Next dashboard state",
  organizationId: "Organization",
  payoutId: "Payout",
  previousTransferLink: "Previous transfer link",
  forfeited: "Balance forfeited",
  reversed: "Balance returned",
  transferLink: "Transfer link",
  balanceAfterCents: "Balance after",
  reason: "Reason",
  publicNote: "Public note",
  posterGroupId: "Poster group",
  posterGroupName: "Poster group name",
  posterId: "Poster",
  posterName: "Poster name",
  posterIds: "Posters",
  posterCount: "Poster count",
  posterType: "Poster type",
  previousGrantId: "Previous grant",
  previousEnabled: "Previous enabled state",
  previousIsAdmin: "Previous admin access",
  previousOnHold: "Previous hold state",
  previousOrganizationId: "Previous organization",
  previousPostersEnabled: "Previous posters access",
  previousSent: "Previous T-shirt status",
  previousState: "Previous dashboard state",
  purpose: "Purpose",
  referralCode: "Referral code",
  referralCodes: "Referral codes",
  safeguard: "Safeguard",
  scopes: "Scopes",
  source: "Source",
  status: "Application status",
  targetIsAdmin: "Target was admin",
  verificationStatus: "Verification status",
};

const ACTION_LABELS: Record<string, string> = {
  demote_admin: "Remove admin access",
  promote_admin: "Make admin",
};

export function formatEventType(event: string): string {
  if (isKnownAdminActionEvent(event)) {
    return EVENT_LABELS[event];
  }

  return event
    .split("_")
    .filter(Boolean)
    .map((word, index) => index === 0 ? word : word.toLowerCase())
    .join(" ");
}

export function formatAuditEventSummary(event: AuditEventLike): string {
  const metadata = getMetadataRecord(event.metadata) ?? {};

  switch (event.action) {
    case "application_deleted":
      return joinSentenceParts(
        `Deleted application ${formatMetadataValue(metadata.applicationId)}.`,
        metadata.status ? `It was ${formatMetadataValue(metadata.status)}.` : null,
      );
    case "application_review_hold_updated":
      return `Changed review hold from ${formatBooleanState(metadata.previousOnHold, "on hold", "not on hold")} to ${formatBooleanState(metadata.nextOnHold, "on hold", "not on hold")}.`;
    case "application_tshirt_sent_updated":
      return `Changed T-shirt status from ${formatBooleanState(metadata.previousSent, "sent", "not sent")} to ${formatBooleanState(metadata.nextSent, "sent", "not sent")}.`;
    case "global_safeguard_updated":
      return `Changed ${formatMetadataValue(metadata.safeguard)} from ${formatBooleanState(metadata.previousEnabled, "enabled", "disabled")} to ${formatBooleanState(metadata.nextEnabled, "enabled", "disabled")}.`;
    case "hcb_credentials_reauthorized":
      return joinSentenceParts(
        `Reauthorized HCB credentials for ${formatMetadataValue(metadata.authorizedHcbUserName ?? metadata.authorizedHcbUserEmail ?? metadata.authorizedHcbUserId)}.`,
        metadata.expiresAt ? `Expires ${formatMetadataValue(metadata.expiresAt)}.` : null,
      );
    case "poster_deleted":
      return joinSentenceParts(
        `Deleted poster ${formatMetadataValue(metadata.referralCode ?? metadata.posterId)}.`,
        metadata.posterName ? `It was named ${formatMetadataValue(metadata.posterName)}.` : null,
        metadata.posterGroupName ? `It belonged to ${formatMetadataValue(metadata.posterGroupName)}.` : null,
      );
    case "poster_deletion_reverted":
      return joinSentenceParts(
        `Restored deleted poster ${formatMetadataValue(metadata.referralCode ?? metadata.posterId)}.`,
        metadata.posterName ? `It was named ${formatMetadataValue(metadata.posterName)}.` : null,
      );
    case "poster_group_deleted":
      return joinSentenceParts(
        `Deleted poster group ${formatMetadataValue(metadata.posterGroupName ?? metadata.posterGroupId)}.`,
        `It contained ${formatMetadataValue(metadata.posterCount)} poster${metadata.posterCount === 1 ? "" : "s"}.`,
      );
    case "poster_rejected_by_admin":
      return joinSentenceParts(
        `Manually rejected poster ${formatMetadataValue(metadata.referralCode ?? metadata.posterId)}.`,
        metadata.reason ? `Reason: ${formatMetadataValue(metadata.reason)}.` : null,
      );
    case "poster_approved_by_admin":
      return metadata.status === "in_review"
        ? `Reverted poster ${formatMetadataValue(metadata.referralCode ?? metadata.posterId)} back to review.`
        : `Approved poster proof ${formatMetadataValue(metadata.referralCode ?? metadata.posterId)}.`;
    case "referral_status_updated_by_admin":
      return `Set referral ${formatMetadataValue(metadata.referralId)} status to ${formatMetadataValue(metadata.nextStatus)}.`;
    case "payout_balance_adjusted":
      return joinSentenceParts(
        `Adjusted balance by ${formatMetadataValue(metadata.amountCents)} cents.`,
        metadata.reason ? `Reason: ${formatMetadataValue(metadata.reason)}.` : null,
      );
    case "payout_created_via_impersonation":
      return `Created payout ${formatMetadataValue(metadata.payoutId)} for ${formatMetadataValue(metadata.amountCents)} cents while impersonating this user.`;
    case "payout_manual_created":
      return `Created a manual payout ${formatMetadataValue(metadata.payoutId)} of ${formatMetadataValue(metadata.amountCents)} cents.`;
    case "payout_retro_rejected":
      return joinSentenceParts(
        `Retroactively rejected approved payout ${formatMetadataValue(metadata.payoutId)}.`,
        metadata.reversed === true
          ? `Returned ${formatMetadataValue(metadata.amountCents)} cents to the balance.`
          : "The balance stayed debited.",
      );
    case "payout_reviewed":
      return joinSentenceParts(
        `Marked payout ${formatMetadataValue(metadata.payoutId)} as ${formatMetadataValue(metadata.status)}.`,
        metadata.forfeited === true
          ? `Forfeited ${formatMetadataValue(metadata.amountCents)} cents from the balance.`
          : null,
      );
    case "payout_transfer_link_updated":
      return `Updated the transfer link on payout ${formatMetadataValue(metadata.payoutId)}.`;
    case "user_admin_password_rejected":
      return `Rejected a superuser password attempt for ${formatAction(metadata.attemptedAction)}.`;
    case "user_demoted_from_admin":
      return "Removed admin access from this user.";
    case "user_hcb_grant_linked":
      return `Linked HCB grant ${formatMetadataValue(metadata.grantId)}.`;
    case "user_hcb_grant_provisioned":
      return `Provisioned HCB grant ${formatMetadataValue(metadata.grantId)}.`;
    case "user_hcb_grant_unlinked":
      return `Unlinked HCB grant ${formatMetadataValue(metadata.previousGrantId)}.`;
    case "user_impersonation_started":
      return `Started impersonating a ${formatBooleanState(metadata.targetIsAdmin, "admin", "non-admin")} user.`;
    case "user_impersonation_stopped":
      return metadata.impersonationStartedAt
        ? `Stopped impersonation that started ${formatMetadataValue(metadata.impersonationStartedAt)}.`
        : "Stopped impersonating this user.";
    case "user_manual_dashboard_state_updated":
      return `Changed dashboard state from ${formatNullableState(metadata.previousState)} to ${formatNullableState(metadata.nextState)}.`;
    case "user_posters_enabled_updated":
      return `Changed posters access from ${formatBooleanState(metadata.previousPostersEnabled, "enabled", "disabled")} to ${formatBooleanState(metadata.nextPostersEnabled, "enabled", "disabled")}.`;
    case "user_feature_flag_override_updated":
      return `${formatBooleanState(metadata.nextOverrideEnabled, "Granted", "Removed")} per-user override for ${formatMetadataValue(metadata.flagKey)}.`;
    case "user_promoted_to_admin":
      return "Granted admin access to this user.";
    default:
      return getFallbackSummary(metadata);
  }
}

export function getAuditEventDetailRows(metadata: unknown): DetailRow[] {
  const record = getMetadataRecord(metadata);

  if (record === null) {
    return metadata === null || metadata === undefined || metadata === ""
      ? []
      : [{ label: "Details", value: formatMetadataValue(metadata) }];
  }

  return Object.entries(record)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => ({
      label: METADATA_LABELS[key] ?? formatMetadataKey(key),
      value: formatMetadataValue(value),
    }));
}

export function getMetadataRecord(metadata: unknown): Record<string, unknown> | null {
  if (typeof metadata === "string") {
    const trimmedMetadata = metadata.trim();

    if (trimmedMetadata === "") {
      return null;
    }

    try {
      return getMetadataRecord(JSON.parse(trimmedMetadata));
    } catch {
      return null;
    }
  }

  if (
    typeof metadata === "object" &&
    metadata !== null &&
    !Array.isArray(metadata)
  ) {
    return metadata as Record<string, unknown>;
  }

  return null;
}

function isKnownAdminActionEvent(event: string): event is AdminActionEvent {
  return Object.hasOwn(EVENT_LABELS, event);
}

function formatBooleanState(value: unknown, trueLabel: string, falseLabel: string) {
  return value === true ? trueLabel : falseLabel;
}

function formatNullableState(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return "not set";
  }

  return formatMetadataValue(value);
}

function formatMetadataValue(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "not set";
  }

  if (typeof value === "boolean") {
    return value ? "yes" : "no";
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value.toLocaleString("en-US") : String(value);
  }

  if (typeof value === "string") {
    return ACTION_LABELS[value] ?? value.replaceAll("_", " ");
  }

  if (Array.isArray(value)) {
    return value.length > 0
      ? value.map((item) => formatMetadataValue(item)).join(", ")
      : "none";
  }

  if (typeof value === "object") {
    return Object.entries(value)
      .map(([key, nestedValue]) => `${formatMetadataKey(key)}: ${formatMetadataValue(nestedValue)}`)
      .join(", ");
  }

  return String(value);
}

function formatMetadataKey(key: string) {
  return key
    .replaceAll("_", " ")
    .replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`)
    .trim()
    .replace(/^./, (letter) => letter.toUpperCase());
}

function formatAction(value: unknown) {
  return typeof value === "string"
    ? ACTION_LABELS[value] ?? formatMetadataValue(value)
    : "this admin action";
}

function getFallbackSummary(metadata: unknown) {
  const rows = getAuditEventDetailRows(metadata);

  if (rows.length === 0) {
    return "No additional details recorded.";
  }

  return rows.map((row) => `${row.label}: ${row.value ?? "not set"}`).join("; ");
}

function joinSentenceParts(...parts: Array<string | null>) {
  return parts.filter((part): part is string => part !== null && part.trim() !== "").join(" ");
}
