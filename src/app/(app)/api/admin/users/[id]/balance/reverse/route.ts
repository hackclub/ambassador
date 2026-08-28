import { revalidatePath } from "next/cache";

import { logAdminActionEvent } from "@/lib/admin-action-events";
import { getSafeRedirectUrl, isSameOriginRequest } from "@/lib/http";
import {
  readJsonOrForm,
  payoutErrorResponse,
  requireAdminActorSession,
} from "@/lib/payouts/http";
import { PayoutRequestError, reverseBalanceAdjustment } from "@/lib/payouts/service";

export const runtime = "nodejs";

// Remove a manual balance adjustment. The ledger event stays; an opposite one
// is written against it, and if the adjustment was bundled into a pending
// payout that payout's total comes back down too.
export async function POST(
  request: Request,
  context: RouteContext<"/api/admin/users/[id]/balance/reverse">,
) {
  if (!isSameOriginRequest(request)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const session = await requireAdminActorSession();
    const { id } = await context.params;
    const { data, isForm } = await readJsonOrForm(request);

    const eventId = typeof data.eventId === "string" ? data.eventId.trim() : "";
    if (eventId === "") {
      throw new PayoutRequestError("invalid_event", 400);
    }

    const result = await reverseBalanceAdjustment({
      eventId,
      userId: id,
      adminUserId: session.sub,
    });

    await logAdminActionEvent({
      actorUserId: session.sub,
      targetUserId: id,
      action: "payout_balance_adjustment_removed",
      metadata: {
        eventId,
        // The reversal's own amount, so this reads as the money that moved.
        amountCents: result.amountCents,
        balanceAfterCents: result.balanceCents,
        payoutId: result.payoutId,
        bundled: result.bundled,
        payoutAmountCents: result.payoutAmountCents,
      },
    });

    revalidatePath(`/admin/users/${id}`);
    revalidatePath("/admin/payouts");
    if (result.payoutId !== null) {
      revalidatePath(`/admin/payouts/${result.payoutId}`);
    }
    revalidatePath("/dashboard");
    revalidatePath("/payouts");

    if (isForm) {
      return Response.redirect(
        getSafeRedirectUrl(request, data.redirectTo as string, `/admin/users/${id}#balance`),
      );
    }

    return Response.json(result);
  } catch (error) {
    return payoutErrorResponse(error);
  }
}
