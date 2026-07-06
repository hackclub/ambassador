import type { Metadata } from "next";
import { forbidden, redirect } from "next/navigation";
import { getLocale } from "next-intl/server";

import { Timestamp } from "@/components/timestamp";
import { Pagination } from "@/components/ui/pagination";
import { pillVariants } from "@/components/ui/pill";
import {
  formatUsdCents,
  listBalanceTransactionsForUser,
  listPayoutsForUser,
  MIN_AMBASSADOR_PAYOUT_CENTS,
  PAYOUT_STATUS_APPROVED,
  PAYOUT_STATUS_PENDING,
  PAYOUT_STATUS_REJECTED,
} from "@/lib/payouts/service";
import { getPosterAccessState } from "@/lib/posters/access";
import { getEffectiveSafeguards } from "@/lib/safeguards";
import { getSession } from "@/lib/session";

import { RequestPayoutForm } from "./RequestPayoutForm";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Payouts" };

const STATUS_TONE = {
  [PAYOUT_STATUS_PENDING]: "black",
  [PAYOUT_STATUS_APPROVED]: "green",
  [PAYOUT_STATUS_REJECTED]: "red",
} as const;

const STATUS_LABEL = {
  [PAYOUT_STATUS_PENDING]: "Pending review",
  [PAYOUT_STATUS_APPROVED]: "Approved",
  [PAYOUT_STATUS_REJECTED]: "Rejected",
} as const;

const REASON_LABEL: Record<string, string> = {
  poster_verified: "Poster verified",
  poster_unverified: "Poster removed",
  referral_verified: "Referral verified",
  referral_unverified: "Referral removed",
  manual_adjustment: "Adjustment",
  payout_requested: "Payout requested",
  payout_approved: "Payout sent",
  payout_reverted: "Payout returned",
  payout_forfeited: "Balance forfeited",
};

const TRANSACTIONS_PAGE_SIZE = 20;

export default async function PayoutsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/");

  // Clamp untrusted input to a finite, bounded page so bad values can't yield
  // NaN (→ a crash) or an enormous, expensive offset.
  const requestedPage = Math.floor(Number((await searchParams).page ?? "1"));
  const page = Number.isFinite(requestedPage)
    ? Math.min(Math.max(requestedPage, 1), 100_000)
    : 1;

  const [user, safeguards] = await Promise.all([
    getPosterAccessState(session.sub),
    getEffectiveSafeguards(session.sub),
  ]);
  if (user === null) forbidden();

  // The flag only gates *requesting* a payout; the page itself always works.
  const canSubmit = safeguards.payoutsEnabled;

  const [{ balance, payouts }, { transactions, total: transactionsTotal }, locale] =
    await Promise.all([
      listPayoutsForUser(session.sub),
      listBalanceTransactionsForUser(session.sub, {
        limit: TRANSACTIONS_PAGE_SIZE,
        offset: (page - 1) * TRANSACTIONS_PAGE_SIZE,
      }),
      getLocale(),
    ]);

  const hasPending = payouts.some((p) => p.status === PAYOUT_STATUS_PENDING);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-8">
        <header className="mb-12">
          <p className="font-body text-sm leading-4 text-secondary">Your balance</p>
          <p className="text-4xl font-bold text-acceptance tabular-nums sm:text-5xl">{formatUsdCents(balance.balanceCents)}</p>
          <p className="mt-4 max-w-prose font-body text-base text-muted-foreground">
            You earn $1.00 for every verified poster and $0.50 for every verified referral.{" "}
            {canSubmit
              ? `Request a payout once you reach ${formatUsdCents(MIN_AMBASSADOR_PAYOUT_CENTS)}.`
              : "Payout requests open soon."}
          </p>
        </header>

        {/* Request */}
        <section className="mb-12">
          <p className="font-body text-sm leading-4 text-secondary">Cash out</p>
          <h2 className="text-2xl leading-8 text-foreground">Request a payout</h2>
          <div className="ui-group mt-4">
            {hasPending ? (
              <p className="font-body text-base text-muted-foreground">
                You have a payout under review. You can request another once it&rsquo;s resolved.
              </p>
            ) : !canSubmit ? (
              <div className="space-y-1">
                <p className="font-body text-base text-foreground">
                  Payout requests aren&rsquo;t open yet.
                </p>
                <p className="font-body text-sm text-muted-foreground">
                  Your balance keeps growing with every verified poster and referral. Once requests
                  open, you&rsquo;ll cash out the full amount right here.
                </p>
              </div>
            ) : balance.balanceCents < MIN_AMBASSADOR_PAYOUT_CENTS ? (
              <p className="font-body text-base text-muted-foreground">
                You need at least {formatUsdCents(MIN_AMBASSADOR_PAYOUT_CENTS)} to request a payout.
                Keep placing posters!
              </p>
            ) : (
              <>
                <p className="mb-4 font-body text-base text-muted-foreground">
                  This pays out your full balance of {formatUsdCents(balance.balanceCents)}.
                </p>
                <RequestPayoutForm
                  amountLabel={formatUsdCents(balance.balanceCents)}
                  allowAch={user.ambassador_region === "United States"}
                />
              </>
            )}
          </div>
        </section>

        {/* Payout history */}
        <section className="mb-12">
          <p className="font-body text-sm leading-4 text-secondary">History</p>
          <h2 className="text-2xl leading-8 text-foreground">Payouts</h2>
          <div className="ui-group mt-4 space-y-4">
            {payouts.length === 0 ? (
              <p className="font-body text-base text-muted-foreground">No payouts yet.</p>
            ) : (
              payouts.map((payout) => (
                <div
                  key={payout.id}
                  className="flex flex-wrap items-center justify-between gap-3"
                >
                  <div>
                    <p className="font-body text-base text-foreground">
                      {formatUsdCents(payout.amountCents)}{" "}
                      <span className="text-sm text-muted-foreground">
                        · {payout.bankTransferMethod}
                      </span>
                    </p>
                    <p className="font-body text-xs text-muted-foreground">
                      <Timestamp value={payout.submittedAt} locale={locale} />
                    </p>
                    {payout.publicComment ? (
                      <p className="mt-1 font-body text-sm text-foreground">{payout.publicComment}</p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={pillVariants({ tone: STATUS_TONE[payout.status] })}>
                      {STATUS_LABEL[payout.status]}
                    </span>
                    {payout.status === PAYOUT_STATUS_APPROVED ? (
                      <a
                        href={`/api/payouts/${payout.id}/invoice`}
                        className="font-body text-sm text-primary hover:underline"
                      >
                        Invoice
                      </a>
                    ) : null}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Transactions */}
        <section>
          <p className="font-body text-sm leading-4 text-secondary">Activity</p>
          <h2 className="text-2xl leading-8 text-foreground">Transactions</h2>
          <div className="ui-group mt-4 space-y-4">
            {transactions.length === 0 ? (
              <p className="font-body text-base text-muted-foreground">No transactions yet.</p>
            ) : (
              transactions.map((tx) => (
                <div
                  key={tx.id}
                  className="flex flex-wrap items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="font-body text-sm text-foreground">
                      {tx.publicNote ?? REASON_LABEL[tx.reason] ?? tx.reason.replaceAll("_", " ")}
                    </p>
                    <p className="font-body text-xs text-muted-foreground">
                      <Timestamp value={tx.createdAt} locale={locale} />
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p
                      className={`font-body text-sm ${tx.amountCents < 0 ? "text-primary" : "text-acceptance"}`}
                    >
                      {tx.amountCents >= 0 ? "+" : ""}
                      {formatUsdCents(tx.amountCents)}
                    </p>
                    <p className="font-body text-xs text-muted-foreground">
                      {formatUsdCents(tx.balanceAfterCents)}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
          <Pagination
            totalCount={transactionsTotal}
            pageSize={TRANSACTIONS_PAGE_SIZE}
            labels={{ previous: "Previous", next: "Next", of: "of" }}
          />
        </section>
    </div>
  );
}
