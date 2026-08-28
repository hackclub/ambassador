import { logAdminActionEvent } from "@/lib/admin-action-events";
import { isSameOriginRequest } from "@/lib/http";
import {
  readJsonObject,
  payoutErrorResponse,
  requirePayoutSession,
  requirePayoutsEnabled,
} from "@/lib/payouts/http";
import {
  createPayoutForUser,
  listPayoutsForUser,
  parseCreatePayoutPayload,
} from "@/lib/payouts/service";
import { checkRateLimit, getRateLimitKey, rateLimitResponse } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function GET() {
  try {
    const session = await requirePayoutSession();
    return Response.json(await listPayoutsForUser(session.sub));
  } catch (error) {
    return payoutErrorResponse(error);
  }
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const session = await requirePayoutSession();
    // Submitting is the one thing the flag gates.
    await requirePayoutsEnabled(session.sub);
    const rateLimit = await checkRateLimit({
      scope: "payout-create",
      key: getRateLimitKey(session.sub),
      limit: 50,
    });

    if (!rateLimit.ok) {
      return rateLimitResponse(rateLimit);
    }

    const payload = await readJsonObject(request);
    const parsed = parseCreatePayoutPayload(payload);
    const payout = await createPayoutForUser({
      userId: session.sub,
      bankInfo: parsed.bankInfo,
      ambassadorNotes: parsed.ambassadorNotes,
    });

    // A payout created through the user-facing route while an admin is
    // impersonating is otherwise indistinguishable from a genuine self-submission
    // (created_by_admin_id is null). Attribute it to the acting admin so the
    // action is auditable.
    if (session.impersonator) {
      await logAdminActionEvent({
        actorUserId: session.impersonator.sub,
        targetUserId: session.sub,
        action: "payout_created_via_impersonation",
        metadata: {
          payoutId: payout.id,
          amountCents: payout.amountCents,
          impersonationStartedAt: session.impersonationStartedAt ?? null,
        },
      });
    }

    return Response.json({ payout }, { status: 201 });
  } catch (error) {
    return payoutErrorResponse(error);
  }
}
