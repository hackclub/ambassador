import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";

import { ManualPayoutForm } from "@/components/admin/manual-payout-form";
import { Timestamp } from "@/components/timestamp";
import { pillVariants } from "@/components/ui/pill";
import {
  formatUsdCents,
  listAdminPayouts,
  PAYOUT_STATUS_APPROVED,
  PAYOUT_STATUS_PENDING,
  PAYOUT_STATUS_REJECTED,
} from "@/lib/payouts/service";
import { getActorSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Payouts" };

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

export default async function AdminPayoutsPage() {
  const session = await getActorSession();
  if (!session) redirect("/");

  const [{ payouts }, locale] = await Promise.all([listAdminPayouts(), getLocale()]);

  // Queue = pending, oldest first (order received).
  const pending = payouts
    .filter((p) => p.status === PAYOUT_STATUS_PENDING)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const finalized = payouts.filter((p) => p.status !== PAYOUT_STATUS_PENDING);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-4xl leading-[3rem] text-foreground">Payouts</h1>
        <div className="flex flex-wrap items-center gap-4">
          {pending.length > 0 ? (
            <Link
              href={`/admin/payouts/${pending[0].id}`}
              className="ui-open-link inline-flex items-center gap-1 whitespace-nowrap font-body text-lg leading-none"
            >
              Review queue ({pending.length}) <span aria-hidden="true">↗</span>
            </Link>
          ) : null}
          <ManualPayoutForm />
        </div>
      </div>

      <section>
        <h2 className="text-2xl leading-8 text-foreground">Review queue</h2>
        <p className="mt-2 font-body text-base text-muted-foreground">Oldest first.</p>
        <div className="mt-4">
          {pending.length === 0 ? (
            <p className="font-body text-base text-muted-foreground">Nothing waiting for review.</p>
          ) : (
            <PayoutTable payouts={pending} locale={locale} />
          )}
        </div>
      </section>

      <section>
        <h2 className="text-2xl leading-8 text-foreground">Recent decisions</h2>
        <div className="mt-4">
          {finalized.length === 0 ? (
            <p className="font-body text-base text-muted-foreground">No decisions yet.</p>
          ) : (
            <PayoutTable payouts={finalized.slice(0, 50)} locale={locale} />
          )}
        </div>
      </section>
    </div>
  );
}

function PayoutTable({
  payouts,
  locale,
}: {
  payouts: Awaited<ReturnType<typeof listAdminPayouts>>["payouts"];
  locale: string;
}) {
  return (
    <div className="ui-table-group">
      <table className="w-full border-collapse font-body text-sm">
        <thead>
          <tr className="border-b border-foreground text-left text-secondary">
            <th className="py-4 pr-4 font-bold leading-8">Ambassador</th>
            <th className="py-4 pr-4 font-bold leading-8">Amount</th>
            <th className="py-4 pr-4 font-bold leading-8">Method</th>
            <th className="py-4 pr-4 font-bold leading-8">Submitted</th>
            <th className="py-4 pr-4 font-bold leading-8">Status</th>
            <th className="py-4 pr-1 font-bold leading-8" />
          </tr>
        </thead>
        <tbody>
          {payouts.map((payout) => (
            <tr key={payout.id} className="border-b border-foreground last:border-b-0">
              <td className="py-4 pr-4 leading-8 text-foreground">
                {payout.ambassador.legalName ?? payout.ambassador.displayName}
                <span className="block text-xs leading-4 text-muted-foreground">
                  {payout.ambassador.email}
                </span>
              </td>
              <td className="py-4 pr-4 leading-8 text-foreground">{formatUsdCents(payout.amountCents)}</td>
              <td className="py-4 pr-4 leading-8 text-foreground">{payout.bankTransferMethod}</td>
              <td className="py-4 pr-4 leading-8 text-muted-foreground">
                <Timestamp value={payout.submittedAt} locale={locale} />
              </td>
              <td className="py-4 pr-4 leading-8">
                <span className={pillVariants({ tone: STATUS_TONE[payout.status] })}>
                  {STATUS_LABEL[payout.status]}
                </span>
              </td>
              <td className="py-4 pr-1 text-right leading-8">
                <Link
                  href={`/admin/payouts/${payout.id}`}
                  aria-label="Open payout"
                  className="ui-open-link inline-flex font-body text-lg leading-none"
                >
                  <span aria-hidden="true">↗</span>
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
