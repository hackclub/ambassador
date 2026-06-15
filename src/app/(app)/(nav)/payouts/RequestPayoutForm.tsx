"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { PayoutMethodPicker, type PayoutMethod } from "@/components/payout-method-picker";
import { buttonVariants } from "@/components/ui/button";

const inputClass =
  "mt-1 h-11 w-full rounded-none border border-foreground/15 bg-muted px-4 font-body text-base font-normal text-foreground placeholder:text-foreground/40 focus:border-foreground focus:outline-none";

const ERROR_MESSAGES: Record<string, string> = {
  payout_already_pending: "You already have a payout under review.",
  minimum_payout_not_met: "You need at least $20.00 to request a payout.",
  insufficient_balance: "Your balance is too low to request a payout.",
  invalid_iban: "That IBAN doesn't look right.",
  invalid_account_number: "That account number doesn't look right.",
  invalid_routing_number: "Routing numbers must be 9 digits.",
  invalid_banking_institution_name: "Enter your bank's name.",
  ach_not_available_for_region: "ACH is only for US ambassadors. Use Wise instead.",
  payouts_disabled: "Payouts aren't available right now.",
};

export function RequestPayoutForm({
  amountLabel,
  allowAch = false,
}: {
  amountLabel: string;
  allowAch?: boolean;
}) {
  const router = useRouter();
  const [method, setMethod] = useState<PayoutMethod>("wise");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    const form = new FormData(event.currentTarget);
    const payload = {
      bankTransferMethod: method,
      bankingInstitutionName: String(form.get("bankingInstitutionName") ?? ""),
      iban: String(form.get("iban") ?? ""),
      accountNumber: String(form.get("accountNumber") ?? ""),
      routingNumber: String(form.get("routingNumber") ?? ""),
      ambassadorNotes: String(form.get("ambassadorNotes") ?? ""),
    };

    try {
      const response = await fetch("/api/payouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(ERROR_MESSAGES[data?.error ?? ""] ?? "Could not submit your payout. Try again.");
        setSubmitting(false);
        return;
      }

      router.refresh();
    } catch {
      setError("Something went wrong. Try again.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PayoutMethodPicker value={method} onChange={setMethod} allowAch={allowAch} />

      <label className="block font-body text-sm text-secondary">
        Banking institution name
        <input name="bankingInstitutionName" type="text" required maxLength={200} className={inputClass} />
      </label>

      {method === "wise" ? (
        <label className="block font-body text-sm text-secondary">
          IBAN
          <input name="iban" type="text" required className={inputClass} placeholder="GB29 NWBK ..." />
        </label>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block font-body text-sm text-secondary">
            Account number
            <input name="accountNumber" type="text" required inputMode="numeric" className={inputClass} />
          </label>
          <label className="block font-body text-sm text-secondary">
            Routing number
            <input name="routingNumber" type="text" required inputMode="numeric" className={inputClass} placeholder="9 digits" />
          </label>
        </div>
      )}

      <label className="block font-body text-sm text-secondary">
        Notes (optional)
        <textarea
          name="ambassadorNotes"
          rows={2}
          className="mt-1 w-full resize-none rounded-none border border-foreground/15 bg-muted px-4 py-3 font-body text-base font-normal text-foreground placeholder:text-foreground/40 focus:border-foreground focus:outline-none"
        />
      </label>

      {error ? <p className="font-body text-sm text-primary">{error}</p> : null}

      <button
        type="submit"
        disabled={submitting}
        className={`${buttonVariants({ variant: "success", size: "app" })} w-full sm:w-auto`}
      >
        {submitting ? "Submitting…" : `Request payout of ${amountLabel}`}
      </button>
    </form>
  );
}
