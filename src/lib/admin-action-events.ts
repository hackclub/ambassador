import { randomUUID } from "node:crypto";

import sql from "@/lib/database/client";

export type AdminActionEvent =
  | "application_deleted"
  | "application_review_hold_updated"
  | "hcb_credentials_reauthorized"
  | "global_safeguard_updated"
  | "application_tshirt_sent_updated"
  | "poster_deleted"
  | "poster_deletion_reverted"
  | "poster_group_deleted"
  | "poster_rejected_by_admin"
  | "poster_approved_by_admin"
  | "referral_status_updated_by_admin"
  | "payout_balance_adjusted"
  | "payout_balance_adjustment_removed"
  | "payout_created_via_impersonation"
  | "payout_invoice_downloaded"
  | "payout_manual_created"
  | "payout_retro_rejected"
  | "payout_reviewed"
  | "payout_transfer_link_updated"
  | "user_admin_password_rejected"
  | "user_demoted_from_admin"
  | "user_impersonation_started"
  | "user_impersonation_stopped"
  | "user_hcb_grant_linked"
  | "user_hcb_grant_provisioned"
  | "user_hcb_grant_unlinked"
  | "user_manual_dashboard_state_updated"
  | "user_posters_enabled_updated"
  | "user_feature_flag_override_updated"
  | "user_promoted_to_admin";

export async function logAdminActionEvent(input: {
  actorUserId: string | null;
  targetUserId?: string | null;
  action: AdminActionEvent;
  metadata?: Record<string, unknown>;
  createdAt?: string | Date;
}) {
  await sql`
    INSERT INTO admin_action_events (
      id,
      actor_user_id,
      target_user_id,
      action,
      metadata,
      created_at
    )
    VALUES (
      ${randomUUID()},
      ${input.actorUserId ?? null},
      ${input.targetUserId ?? null},
      ${input.action},
      CAST(${JSON.stringify(input.metadata ?? {})} AS JSONB),
      ${input.createdAt ?? new Date()}
    )
  `;
}
