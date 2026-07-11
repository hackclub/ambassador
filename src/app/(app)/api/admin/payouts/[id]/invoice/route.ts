import { randomInt } from "node:crypto";

import { logAdminActionEvent } from "@/lib/admin-action-events";
import { payoutErrorResponse, requireAdminActorSession } from "@/lib/payouts/http";
import { renderPayoutInvoicePdf } from "@/lib/payouts/payout-invoice";
import { getAdminPayout } from "@/lib/payouts/service";

export const runtime = "nodejs";

// Lowercase alphanumerics, no vowels-vs-digits ambiguity to worry about since
// it is opaque. randomInt is CSPRNG-backed and rejection-samples internally, so
// each pick is uniform over the alphabet with no modulo bias.
const SUFFIX_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

function randomFilenameSuffix(length: number) {
  let suffix = "";
  for (let i = 0; i < length; i += 1) {
    suffix += SUFFIX_ALPHABET[randomInt(SUFFIX_ALPHABET.length)];
  }
  return suffix;
}

function slugifyLegalName(name: string | null | undefined) {
  const slug = (name ?? "")
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return slug === "" ? "ambassador" : slug;
}

export async function GET(
  request: Request,
  context: RouteContext<"/api/admin/payouts/[id]/invoice">,
) {
  try {
    const session = await requireAdminActorSession();
    const { id } = await context.params;
    const payout = await getAdminPayout(id);
    const withLocalEstimate = new URL(request.url).searchParams.get("local") === "1";
    const pdf = await renderPayoutInvoicePdf(payout, withLocalEstimate);

    const filename = `${payout.id}-${slugifyLegalName(payout.ambassador.legalName)}-${randomFilenameSuffix(5)}.pdf`;

    await logAdminActionEvent({
      actorUserId: session.sub,
      targetUserId: payout.ambassador.id,
      action: "payout_invoice_downloaded",
      metadata: {
        payoutId: payout.id,
        filename,
        amountCents: payout.amountCents,
      },
    });

    return new Response(pdf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    return payoutErrorResponse(error, "invoice_error");
  }
}
