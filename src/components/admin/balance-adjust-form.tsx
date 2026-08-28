"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const fieldClass =
  "mt-2 w-full rounded-none border border-foreground/15 bg-muted px-4 py-3 font-body text-base font-normal text-foreground";

const ERROR_MESSAGES: Record<string, string> = {
  invalid_amount: "Enter a dollar amount. Use a minus sign to deduct.",
  reason_required: "Give a reason.",
  balance_would_go_negative: "That would take their balance below $0.",
  payout_bundle_reserved:
    "Their pending payout has already claimed that money. Deduct less, or take it off that payout first.",
  adjustment_exceeds_payout:
    "That deduction is bigger than the payout itself. Deduct less, or reject the payout instead.",
  insufficient_balance: "Their balance is below what this payout already owes them.",
  payout_already_finalized: "That payout has already been decided.",
  invalid_payout: "That payout doesn't belong to this ambassador.",
  not_reversible: "Only a manual adjustment can be removed, and never twice.",
  already_reversed: "That adjustment has already been removed.",
  not_found: "Couldn't find that ambassador.",
  forbidden: "You don't have access to do that.",
};

function messageFor(error: string | undefined, fallback: string) {
  return ERROR_MESSAGES[error ?? ""] ?? fallback;
}

/**
 * Credit or debit a balance by hand. On a payout review screen (`payoutId` set,
 * `bundles` true) the adjustment also moves that payout's total, so it is paid
 * out with it; anywhere else it only moves the balance and rolls into whatever
 * they request next.
 */
export function BalanceAdjustForm({
  userId,
  payoutId = null,
  bundles = false,
  redirectTo,
}: {
  userId: string;
  payoutId?: string | null;
  bundles?: boolean;
  redirectTo?: string;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    const form = event.currentTarget;
    const data = new FormData(form);

    try {
      const response = await fetch(`/api/admin/users/${userId}/balance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amountUsd: String(data.get("amountUsd") ?? ""),
          note: String(data.get("note") ?? ""),
          publicNote: String(data.get("publicNote") ?? ""),
          payoutId,
        }),
      });

      const body = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok) {
        setError(messageFor(body?.error, "Could not adjust the balance. Try again."));
        setSubmitting(false);
        return;
      }

      form.reset();
      setSubmitting(false);
      if (redirectTo !== undefined) {
        router.push(redirectTo);
      }
      router.refresh();
    } catch {
      setError("Something went wrong. Try again.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-8 grid max-w-md gap-3">
      <label className="block text-sm text-secondary">
        Amount in USD (negative to deduct)
        <input
          name="amountUsd"
          type="number"
          step="0.01"
          required
          placeholder="-5.00"
          className={fieldClass}
        />
      </label>
      <label className="block text-sm text-secondary">
        Reason (internal)
        <input name="note" type="text" required placeholder="Why" className={fieldClass} />
      </label>
      <label className="block text-sm text-secondary">
        Note for ambassador (optional)
        <input
          name="publicNote"
          type="text"
          placeholder="Shown to them"
          className={fieldClass}
        />
      </label>

      {error ? <p className="font-body text-sm text-primary">{error}</p> : null}

      <button
        type="submit"
        disabled={submitting}
        className={cn(buttonVariants({ variant: "default", size: "app-sm" }), "justify-self-start")}
      >
        {submitting ? "Saving…" : bundles ? "Adjust and add to this payout" : "Adjust balance"}
      </button>
    </form>
  );
}

/**
 * Take a manual adjustment back off. Writes the opposite ledger event rather
 * than deleting anything, and pulls the money back out of the payout it was
 * bundled into.
 */
export function RemoveAdjustmentButton({
  userId,
  eventId,
  confirmationMessage,
}: {
  userId: string;
  eventId: string;
  confirmationMessage: string;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    if (!window.confirm(confirmationMessage)) return;

    setError(null);
    setSubmitting(true);

    try {
      const response = await fetch(`/api/admin/users/${userId}/balance/reverse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId }),
      });

      const body = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok) {
        setError(messageFor(body?.error, "Could not remove that adjustment."));
        setSubmitting(false);
        return;
      }

      setSubmitting(false);
      router.refresh();
    } catch {
      setError("Something went wrong. Try again.");
      setSubmitting(false);
    }
  }

  return (
    <span className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={submitting}
        onClick={handleClick}
        className="ui-open-link inline-flex items-center gap-1 font-body text-sm leading-none"
      >
        {submitting ? "Removing…" : "Remove"}
      </button>
      {error ? <span className="font-body text-xs text-primary">{error}</span> : null}
    </span>
  );
}
