import { payoutErrorResponse, requirePayoutSession } from "@/lib/payouts/http";
import { renderPayoutInvoicePdf } from "@/lib/payouts/payout-invoice";
import {
  getAdminPayout,
  PAYOUT_STATUS_APPROVED,
  PayoutRequestError,
} from "@/lib/payouts/service";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: RouteContext<"/api/payouts/[id]/invoice">,
) {
  try {
    const session = await requirePayoutSession();
    const { id } = await context.params;
    const payout = await getAdminPayout(id);
    if (payout.userId !== session.sub) {
      throw new PayoutRequestError("not_found", 404);
    }
    if (payout.status !== PAYOUT_STATUS_APPROVED) {
      throw new PayoutRequestError("invoice_unavailable", 409);
    }
    const withLocalEstimate = new URL(request.url).searchParams.get("local") === "1";
    const pdf = await renderPayoutInvoicePdf(payout, withLocalEstimate);

    return new Response(pdf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="payout-${payout.id}.pdf"`,
      },
    });
  } catch (error) {
    return payoutErrorResponse(error, "invoice_error");
  }
}
