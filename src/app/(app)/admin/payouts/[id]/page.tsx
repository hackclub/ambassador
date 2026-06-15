import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import type { ReactNode } from "react";

import { ConfirmSubmitForm } from "@/components/admin/confirm-submit-form";
import { ExpandableImage } from "@/components/admin/expandable-image";
import { LineItemReview } from "@/components/admin/line-item-review";
import { PayoutFulfilmentActions, PayoutReviewActions } from "@/components/admin/payout-review-actions";
import { PayoutReviewModeClient } from "@/components/admin/payout-review-mode-client";
import { PosterPlacementMap } from "@/components/admin/poster-placement-map";
import { Timestamp } from "@/components/timestamp";
import { buttonVariants } from "@/components/ui/button";
import { pillVariants } from "@/components/ui/pill";
import {
  formatUsdCents,
  getAdminPayout,
  getPayoutBreakdown,
  listPayoutNotes,
  PAYOUT_STATUS_APPROVED,
  PAYOUT_STATUS_PENDING,
  PAYOUT_STATUS_REJECTED,
  PayoutRequestError,
} from "@/lib/payouts/service";
import { formatPosterLabel } from "@/lib/posters/format";
import { getPosterProofUrl } from "@/lib/posters/storage";
import { getActorSession } from "@/lib/session";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const STATUS_TONE = {
  [PAYOUT_STATUS_PENDING]: "black",
  [PAYOUT_STATUS_APPROVED]: "green",
  [PAYOUT_STATUS_REJECTED]: "red",
} as const;

const STATUS_LABEL = {
  [PAYOUT_STATUS_PENDING]: "Pending",
  [PAYOUT_STATUS_APPROVED]: "Approved",
  [PAYOUT_STATUS_REJECTED]: "Rejected",
} as const;

const fieldClass =
  "mt-2 w-full rounded-none border border-foreground/15 bg-muted px-4 py-3 font-body text-base font-normal text-foreground";

// A black (foreground) filled button for neutral actions, never white.
function blackBtn(size: "sm" | "app-sm" = "sm") {
  return cn(buttonVariants({ variant: "default", size }), "!bg-foreground hover:!bg-foreground/85");
}

export default async function AdminPayoutReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getActorSession();
  if (!session) redirect("/");

  const { id } = await params;

  let payout: Awaited<ReturnType<typeof getAdminPayout>>;
  let breakdown: Awaited<ReturnType<typeof getPayoutBreakdown>>;
  let notes: Awaited<ReturnType<typeof listPayoutNotes>>;
  try {
    [payout, breakdown, notes] = await Promise.all([
      getAdminPayout(id),
      getPayoutBreakdown(id),
      listPayoutNotes(id),
    ]);
  } catch (error) {
    if (error instanceof PayoutRequestError && error.status === 404) notFound();
    throw error;
  }

  const locale = await getLocale();
  const ambassadorId = payout.ambassador.id;
  const redirectTo = `/admin/payouts/${id}`;
  const isPending = payout.status === PAYOUT_STATUS_PENDING;
  // Manual payouts are admin-created one-offs: fixed amount, no line items,
  // nothing to do with the ambassador's balance.
  const isManual = payout.createdByAdminId !== null;
  const decisionAmountCents = isManual ? payout.amountCents : breakdown.balanceCents;
  const name = payout.ambassador.legalName ?? payout.ambassador.displayName;

  const proofUrls = new Map(
    await Promise.all(
      breakdown.posters.map(async (poster) => {
        const isImage =
          poster.proofPath !== null &&
          poster.proofPath !== "" &&
          (poster.proofContentType === null || poster.proofContentType.startsWith("image/"));
        const url = isImage
          ? await getPosterProofUrl(poster.proofPath, poster.proofContentType)
          : null;
        return [poster.id, url] as const;
      }),
    ),
  );

  const address = payout.ambassador.address;
  const addressText = [
    [address.line1, address.line2].filter(Boolean).join(", "),
    [address.city, address.state, address.country].filter(Boolean).join(", "),
    address.postalCode,
  ]
    .filter((line) => line && line.length > 0)
    .join("\n");

  const mapPosters = breakdown.posters
    .filter((p) => p.latitude !== null && p.longitude !== null)
    .map((p) => ({
      id: p.id,
      name: p.name,
      referralCode: p.referralCode,
      groupName: p.groupName,
      latitude: p.latitude as number,
      longitude: p.longitude as number,
      status: p.verificationStatus,
      address: p.locationDescription,
    }));

  return (
    <PayoutReviewModeClient payoutId={id} isPending={isPending}>
      <div className="space-y-12">
        <Link href="/admin/payouts" className="ui-open-link inline-flex items-center gap-1 font-body text-sm">
          <span aria-hidden>←</span> Payouts
        </Link>

        {/* Header */}
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="truncate text-3xl leading-[3rem] text-foreground">{name}</h1>
              <span className={pillVariants({ tone: STATUS_TONE[payout.status] })}>
                {STATUS_LABEL[payout.status]}
              </span>
            </div>
            <p className="mt-1 font-body text-sm text-secondary">{payout.ambassador.email}</p>
          </div>
          <Link
            href={`/admin/users/${ambassadorId}`}
            className="ui-open-link inline-flex items-center gap-1 whitespace-nowrap font-body text-lg leading-none"
          >
            Full profile <span aria-hidden>↗</span>
          </Link>
        </header>

        {/* Amount */}
        <section>
          <p className="text-xs text-secondary">
            {isPending
              ? isManual
                ? "Amount to pay out"
                : "Balance to pay out"
              : payout.status === PAYOUT_STATUS_APPROVED
                ? "Paid out"
                : "Not paid out"}
          </p>
          <p className="text-4xl text-foreground">{formatUsdCents(payout.amountCents)}</p>
          <p className="mt-1 font-body text-sm text-muted-foreground">
            {isPending
              ? isManual
                ? "A fixed amount, set when this payout was created. Their balance is not involved."
                : "The full balance. Approving or rejecting items below changes it."
              : (
                <>
                  Reviewed{payout.reviewedAt ? <> <Timestamp value={payout.reviewedAt} locale={locale} /></> : null}.
                </>
              )}
          </p>
          {payout.status === PAYOUT_STATUS_APPROVED ? (
            <a
              href={`/api/admin/payouts/${id}/invoice`}
              className={cn(blackBtn("app-sm"), "mt-4")}
            >
              Download HCB invoice
            </a>
          ) : null}
        </section>

        {/* Details */}
        <section>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Legal name" value={name} />
            <Field label="Email" value={payout.ambassador.email} />
            <Field label="Source" value={isManual ? "Manual (created by an admin)" : "Requested by ambassador"} />
            <Field label="Method" value={payout.bankTransferMethod.toUpperCase()} />
            <Field label="Bank" value={payout.bankingInstitutionName} />
            {payout.bankTransferMethod === "wise" ? (
              <Field label="IBAN" value={payout.iban} />
            ) : (
              <>
                <Field label="Account number" value={payout.accountNumber} />
                <Field label="Routing number" value={payout.routingNumber} />
              </>
            )}
            <Field label="Address" value={addressText} className="sm:col-span-2 lg:col-span-3" />
            {payout.ambassadorNotes ? (
              <Field label="Their notes" value={payout.ambassadorNotes} className="sm:col-span-2 lg:col-span-3" />
            ) : null}
          </div>
        </section>

        {/* Map */}
        {!isManual && mapPosters.length > 0 ? (
          <section>
            <h2 className="text-xl text-foreground">Where the posters are</h2>
            <p className="mt-1 font-body text-sm text-muted-foreground">
              Click a spot to zoom to it.
            </p>
            <div className="mt-4">
              <PosterPlacementMap posters={mapPosters} />
            </div>
          </section>
        ) : null}

        {/* Posters */}
        {!isManual ? (
        <section>
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-xl text-foreground">Posters</h2>
            <span className="text-xs text-secondary">{formatUsdCents(breakdown.posterCountedCents)}</span>
          </div>
          <p className="mt-1 font-body text-sm text-muted-foreground">
            {isPending
              ? "The verified posters this payout will pay for."
              : payout.status === PAYOUT_STATUS_APPROVED
                ? "The posters this payout paid for."
                : "The posters this payout consumed."}
          </p>
          <div className="mt-4">
            {breakdown.posters.length === 0 ? (
              <p className="font-body text-base text-muted-foreground">None.</p>
            ) : (
              <LineItemReview
                items={breakdown.posters.map((poster) => {
                  const proofUrl = proofUrls.get(poster.id) ?? null;
                  return {
                    id: poster.id,
                    needsReview: false,
                    content: (
                      <div className="flex flex-wrap items-start gap-4">
                        {proofUrl ? (
                          <ExpandableImage src={proofUrl} alt={formatPosterLabel(poster)} />
                        ) : (
                          <div className="flex h-16 w-16 items-center justify-center border border-foreground/15 bg-muted font-body text-xs text-muted-foreground">
                            no proof
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="font-body text-base text-foreground">
                            {formatPosterLabel(poster)}
                          </p>
                          {poster.locationDescription ? (
                            <p className="font-body text-sm text-muted-foreground">
                              {poster.locationDescription}
                            </p>
                          ) : null}
                          <p className="font-body text-sm text-muted-foreground">
                            {formatUsdCents(poster.amountCents)} · {poster.verificationStatus}
                          </p>
                        </div>
                        {isPending ? (
                          <div className="flex shrink-0 flex-wrap gap-2">
                            <ItemForm
                              action={`/api/admin/users/${ambassadorId}/posters/${poster.id}/approve`}
                              redirectTo={redirectTo}
                              fields={{ status: "pending", payoutId: id }}
                              label="Remove"
                              className={blackBtn()}
                              confirm="Remove this poster from the payout? Claws back $1 and sends it back to pending verification."
                            />
                            <ItemForm
                              action={`/api/admin/users/${ambassadorId}/posters/${poster.id}/reject`}
                              redirectTo={redirectTo}
                              fields={{ payoutId: id }}
                              label="Reject"
                              className={buttonVariants({ variant: "destructive", size: "sm" })}
                              confirm="Reject this poster? Claws back $1."
                            />
                          </div>
                        ) : null}
                      </div>
                    ),
                  };
                })}
              />
            )}
          </div>
        </section>
        ) : null}

        {/* Referrals */}
        {!isManual ? (
        <section>
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-xl text-foreground">Referrals</h2>
            <span className="text-xs text-secondary">{formatUsdCents(breakdown.referralCountedCents)}</span>
          </div>
          <p className="mt-1 font-body text-sm text-muted-foreground">
            {isPending
              ? "The verified referrals this payout will pay for."
              : payout.status === PAYOUT_STATUS_APPROVED
                ? "The referrals this payout paid for."
                : "The referrals this payout consumed."}
          </p>
          <div className="mt-4">
            {breakdown.referrals.length === 0 ? (
              <p className="font-body text-base text-muted-foreground">None.</p>
            ) : (
              <LineItemReview
                items={breakdown.referrals.map((referral) => {
                  const isRsvp = referral.id.startsWith("rsvp:");
                  return {
                    id: referral.id,
                    needsReview: false,
                    content: (
                      <div className="flex flex-wrap items-start gap-4">
                        <div className="min-w-0 flex-1">
                          <p className="font-body text-base text-foreground">{referral.name}</p>
                          <p className="font-body text-sm text-muted-foreground">
                            {formatUsdCents(referral.amountCents)} · {referral.verificationStatus}
                            {referral.codeLabel ? ` · ${referral.codeLabel}` : ""}
                          </p>
                        </div>
                        {isPending && !isRsvp ? (
                          <div className="flex shrink-0 flex-wrap gap-2">
                            <ItemForm
                              action={`/api/admin/users/${ambassadorId}/referrals/${referral.id}/status`}
                              redirectTo={redirectTo}
                              fields={{ status: "pending", payoutId: id }}
                              label="Remove"
                              className={blackBtn()}
                              confirm="Remove this referral from the payout? Claws back $0.50 and sends it back to pending verification."
                            />
                            <ItemForm
                              action={`/api/admin/users/${ambassadorId}/referrals/${referral.id}/status`}
                              redirectTo={redirectTo}
                              fields={{ status: "rejected", payoutId: id }}
                              label="Reject"
                              className={buttonVariants({ variant: "destructive", size: "sm" })}
                              confirm="Reject this referral? Claws back $0.50."
                            />
                          </div>
                        ) : null}
                      </div>
                    ),
                  };
                })}
              />
            )}
          </div>
        </section>
        ) : null}

        {/* Adjustments */}
        {!isManual ? (
        <section>
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-xl text-foreground">Adjustments</h2>
            <span className="text-xs text-secondary">{formatUsdCents(breakdown.miscCents)}</span>
          </div>
          <p className="mt-1 font-body text-sm text-muted-foreground">
            Meetup stuff and deductions.
          </p>
          {breakdown.ledger.length > 0 ? (
            <div className="mt-4 space-y-2">
              {breakdown.ledger.map((entry) => (
                <div key={entry.id} className="flex items-center justify-between gap-3 font-body text-sm">
                  <span className="text-foreground">
                    {entry.publicNote ?? entry.note ?? entry.reason.replaceAll("_", " ")}
                    <span className="block text-xs text-muted-foreground">
                      <Timestamp value={entry.createdAt} locale={locale} />
                    </span>
                  </span>
                  <span className={entry.amountCents < 0 ? "text-primary" : "text-acceptance"}>
                    {entry.amountCents >= 0 ? "+" : ""}
                    {formatUsdCents(entry.amountCents)}
                  </span>
                </div>
              ))}
            </div>
          ) : null}

          {isPending ? (
            <form
              action={`/api/admin/users/${ambassadorId}/balance`}
              method="POST"
              className="mt-8 grid max-w-md gap-3"
            >
              <input type="hidden" name="redirectTo" value={redirectTo} />
              <input type="hidden" name="payoutId" value={id} />
              <label className="block text-sm text-secondary">
                Amount in USD (negative to deduct)
                <input name="amountUsd" type="number" step="0.01" required placeholder="-5.00" className={fieldClass} />
              </label>
              <label className="block text-sm text-secondary">
                Reason (internal)
                <input name="note" type="text" required placeholder="Why" className={fieldClass} />
              </label>
              <label className="block text-sm text-secondary">
                Note for ambassador (optional)
                <input name="publicNote" type="text" placeholder="Shown to them" className={fieldClass} />
              </label>
              <button className={cn(buttonVariants({ variant: "default", size: "app-sm" }), "justify-self-start")}>
                Adjust balance
              </button>
            </form>
          ) : null}
        </section>
        ) : null}

        {/* Internal notes */}
        <section>
          <h2 className="text-xl text-foreground">Internal notes</h2>
          <p className="mt-1 font-body text-sm text-muted-foreground">
            Only admins see these.
          </p>
          {notes.length > 0 ? (
            <div className="mt-4 space-y-4">
              {notes.map((note) => (
                <div key={note.id}>
                  <p className="font-body text-base whitespace-pre-line text-foreground">{note.note}</p>
                  <p className="mt-1 font-body text-xs text-muted-foreground">
                    {note.authorName ?? "Unknown admin"} · <Timestamp value={note.createdAt} locale={locale} />
                  </p>
                </div>
              ))}
            </div>
          ) : null}
          <form
            action={`/api/admin/payouts/${id}/notes`}
            method="POST"
            className="mt-8 grid max-w-md gap-3"
          >
            <input type="hidden" name="redirectTo" value={redirectTo} />
            <label className="block text-sm text-secondary">
              Add a note
              <textarea name="note" rows={2} required placeholder="Context for other admins" className={cn(fieldClass, "resize-none")} />
            </label>
            <button className={cn(buttonVariants({ variant: "default", size: "app-sm" }), "justify-self-start")}>
              Add note
            </button>
          </form>
        </section>

        {/* Decision / fulfilment */}
        {isPending ? (
          <section>
            <h2 className="text-xl text-foreground">Decision</h2>
            <div className="mt-4">
              <PayoutReviewActions
                payoutId={id}
                amountLabel={formatUsdCents(decisionAmountCents)}
                canApprove={decisionAmountCents > 0}
                manual={isManual}
              />
            </div>
          </section>
        ) : (
          <section>
            <h2 className="text-xl text-foreground">Fulfilment</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="Reviewed">
                {payout.reviewedAt ? <Timestamp value={payout.reviewedAt} locale={locale} /> : "-"}
              </Field>
              {payout.transferLink ? (
                <div className="sm:col-span-2">
                  <div className="text-xs text-secondary">Transfer link</div>
                  <a
                    href={payout.transferLink}
                    target="_blank"
                    rel="noreferrer"
                    className="ui-hover-underline mt-1 block break-all font-body text-base text-secondary hover:text-foreground"
                  >
                    {payout.transferLink}
                  </a>
                </div>
              ) : null}
              {payout.publicComment ? <Field label="Note to ambassador" value={payout.publicComment} /> : null}
              {payout.adminComment ? <Field label="Internal note" value={payout.adminComment} /> : null}
            </div>
            {payout.status === PAYOUT_STATUS_APPROVED ? (
              <div className="mt-8">
                <PayoutFulfilmentActions
                  payoutId={id}
                  amountLabel={formatUsdCents(payout.amountCents)}
                  transferLink={payout.transferLink}
                  manual={isManual}
                />
              </div>
            ) : null}
          </section>
        )}
      </div>
    </PayoutReviewModeClient>
  );
}

function Field({
  label,
  value,
  children,
  className,
}: {
  label: string;
  value?: string | null;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="text-xs text-secondary">{label}</div>
      <div className="mt-1 break-words whitespace-pre-line font-body text-base text-foreground">
        {children ?? (value && value.trim() !== "" ? value : "-")}
      </div>
    </div>
  );
}

function ItemForm({
  action,
  redirectTo,
  fields,
  label,
  className,
  confirm,
}: {
  action: string;
  redirectTo: string;
  fields: Record<string, string>;
  label: string;
  className: string;
  confirm?: string;
}) {
  return (
    <ConfirmSubmitForm action={action} method="POST" confirmationMessage={confirm}>
      <input type="hidden" name="redirectTo" value={redirectTo} />
      {Object.entries(fields).map(([key, value]) => (
        <input key={key} type="hidden" name={key} value={value} />
      ))}
      <button className={className}>{label}</button>
    </ConfirmSubmitForm>
  );
}
