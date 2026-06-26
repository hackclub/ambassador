"use client";

import { useEffect, useId, useState } from "react";

import { ConfirmSubmitForm } from "@/components/admin/confirm-submit-form";
import { InvoiceDownloadLink } from "@/components/admin/invoice-download-link";
import { buttonVariants } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";

type ModalState = "approve" | "reject" | null;
type RejectMode = "reverse" | "freeze";

const fieldClass =
  "mt-2 w-full rounded-none border border-foreground/15 bg-muted px-4 py-3 font-body text-base font-normal text-foreground";

// The two mutually exclusive checkbox options every reject flow offers:
// "reverse" leaves/returns the money with the ambassador and keeps the
// posters/referrals payable; "freeze" means the ambassador doesn't get the
// money and the items stay consumed. `retro` only changes the wording — the
// first-time copy describes a forfeiture, the retro copy an already-debited
// balance. Exactly one box is always ticked; ticking one unticks the other.
function RejectModeOptions({
  mode,
  onModeChange,
  amountLabel,
  retro,
}: {
  mode: RejectMode;
  onModeChange: (mode: RejectMode) => void;
  amountLabel: string;
  retro: boolean;
}) {
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm text-secondary">
        {retro ? "What happened to the money?" : "What happens to the money?"}
      </legend>
      <label className="flex items-start gap-3 font-body text-sm text-foreground">
        <input
          type="checkbox"
          name="mode"
          value="reverse"
          checked={mode === "reverse"}
          onChange={() => onModeChange("reverse")}
          className="mt-1"
        />
        <span>
          Return the money to the ambassador and unfreeze posters and referrals
          <span className="block text-muted-foreground">
            {retro
              ? `${amountLabel} goes back to their balance, the posters and referrals count toward a future payout, and the transfer link is cleared.`
              : `${amountLabel} stays in their balance and the posters and referrals stay available for a future payout.`}
          </span>
        </span>
      </label>
      <label className="flex items-start gap-3 font-body text-sm text-foreground">
        <input
          type="checkbox"
          name="mode"
          value="freeze"
          checked={mode === "freeze"}
          onChange={() => onModeChange("freeze")}
          className="mt-1"
        />
        <span>
          Don&rsquo;t return the money and keep the posters and referrals frozen
          <span className="block text-muted-foreground">
            {retro
              ? "Only marks the payout rejected. The balance stays debited and the posters and referrals stay consumed."
              : `Forfeits ${amountLabel} from their balance and consumes the posters and referrals so they can never be paid out.`}
          </span>
        </span>
      </label>
    </fieldset>
  );
}

export function PayoutReviewActions({
  payoutId,
  amountLabel,
  canApprove,
  manual,
}: {
  payoutId: string;
  amountLabel: string;
  canApprove: boolean;
  manual: boolean;
}) {
  const [modal, setModal] = useState<ModalState>(null);
  const [mode, setMode] = useState<RejectMode>("reverse");
  const action = `/api/admin/payouts/${payoutId}/review`;
  const redirectTo = `/admin/payouts/${payoutId}`;

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        {canApprove ? (
          <button
            type="button"
            className={buttonVariants({ variant: "success", size: "app" })}
            onClick={() => setModal("approve")}
          >
            Approve &amp; pay {amountLabel}
          </button>
        ) : (
          <p className="font-body text-sm text-secondary">
            Nothing left to pay out, so you can only reject this payout.
          </p>
        )}
        <button
          type="button"
          className={buttonVariants({ size: "app" })}
          onClick={() => setModal("reject")}
        >
          Reject
        </button>
      </div>

      {modal === "approve" ? (
        <Modal title={`Approve & pay ${amountLabel}`} onClose={() => setModal(null)}>
          <ConfirmSubmitForm
            action={action}
            method="POST"
            className="space-y-4"
            confirmationMessage={`Pay out ${amountLabel}?`}
          >
            <input type="hidden" name="redirectTo" value={redirectTo} />
            <input type="hidden" name="action" value="approve" />
            <label className="block text-sm text-secondary">
              HCB transfer link
              <Input name="transferLink" type="url" required placeholder="https://hcb.hackclub.com/…" className={fieldClass} />
            </label>
            <HcbTransferHint payoutId={payoutId} />
            <InvoiceDownloadLink payoutId={payoutId} label="Download the invoice for the HCB transfer" />
            <label className="block text-sm text-secondary">
              Note for the ambassador (optional)
              <Textarea name="publicComment" rows={2} className={fieldClass} placeholder="Shows up on their payout" />
            </label>
            <label className="block text-sm text-secondary">
              Internal note (optional)
              <Textarea name="adminComment" rows={2} className={fieldClass} placeholder="Admins only" />
            </label>
            <ModalButtons submitLabel={`Pay ${amountLabel}`} variant="success" onCancel={() => setModal(null)} />
          </ConfirmSubmitForm>
        </Modal>
      ) : null}

      {modal === "reject" ? (
        <Modal title="Reject payout" onClose={() => setModal(null)}>
          <ConfirmSubmitForm
            action={action}
            method="POST"
            className="space-y-4"
            confirmationMessage={
              manual
                ? "Reject this manual payout?"
                : mode === "reverse"
                  ? `Reject this payout? They keep ${amountLabel} in their balance.`
                  : `Reject this payout and forfeit ${amountLabel}?`
            }
          >
            <input type="hidden" name="redirectTo" value={redirectTo} />
            <input type="hidden" name="action" value="reject" />
            {manual ? (
              <p className="font-body text-sm text-muted-foreground">
                Manual payouts never touch the balance, so this only marks the payout rejected.
              </p>
            ) : (
              <RejectModeOptions
                mode={mode}
                onModeChange={setMode}
                amountLabel={amountLabel}
                retro={false}
              />
            )}
            <label className="block text-sm text-secondary">
              Reason for the ambassador
              <Textarea name="publicComment" rows={3} required placeholder="Why it was rejected" className={fieldClass} />
            </label>
            <label className="block text-sm text-secondary">
              Internal note (optional)
              <Textarea name="adminComment" rows={2} className={fieldClass} placeholder="Admins only" />
            </label>
            <ModalButtons submitLabel="Reject payout" variant="default" onCancel={() => setModal(null)} />
          </ConfirmSubmitForm>
        </Modal>
      ) : null}
    </>
  );
}

type FulfilmentModal = "edit-link" | "retro-reject" | null;

// Post-approval actions: fix a wrong transfer link, or take the approval
// back entirely. For requested payouts, retro-rejecting offers two modes:
// reverse (the transfer was canceled or never sent, so the money returns to
// the balance and the line items become payable again) or freeze (the money
// stays debited). Manual payouts never touched the balance, so rejecting one
// is just a status flip.
export function PayoutFulfilmentActions({
  payoutId,
  amountLabel,
  transferLink,
  manual,
}: {
  payoutId: string;
  amountLabel: string;
  transferLink: string | null;
  manual: boolean;
}) {
  const [modal, setModal] = useState<FulfilmentModal>(null);
  const [mode, setMode] = useState<"reverse" | "freeze">("reverse");
  const action = `/api/admin/payouts/${payoutId}/review`;
  const redirectTo = `/admin/payouts/${payoutId}`;

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={buttonVariants({ size: "app-sm" })}
          onClick={() => setModal("edit-link")}
        >
          Edit transfer link
        </button>
        <button
          type="button"
          className={buttonVariants({ variant: "destructive", size: "app-sm" })}
          onClick={() => setModal("retro-reject")}
        >
          Reject retroactively
        </button>
      </div>

      {modal === "edit-link" ? (
        <Modal title="Edit transfer link" onClose={() => setModal(null)}>
          <ConfirmSubmitForm
            action={action}
            method="POST"
            className="space-y-4"
            confirmationMessage="Replace the transfer link on this payout?"
          >
            <input type="hidden" name="redirectTo" value={redirectTo} />
            <input type="hidden" name="action" value="update_transfer_link" />
            <label className="block text-sm text-secondary">
              HCB transfer link
              <Input
                name="transferLink"
                type="url"
                required
                defaultValue={transferLink ?? ""}
                placeholder="https://hcb.hackclub.com/…"
                className={fieldClass}
              />
            </label>
            <ModalButtons submitLabel="Save link" variant="default" onCancel={() => setModal(null)} />
          </ConfirmSubmitForm>
        </Modal>
      ) : null}

      {modal === "retro-reject" ? (
        <Modal title={`Reject approved payout (${amountLabel})`} onClose={() => setModal(null)}>
          <ConfirmSubmitForm
            action={action}
            method="POST"
            className="space-y-4"
            confirmationMessage={
              manual
                ? "Reject this manual payout?"
                : mode === "reverse"
                  ? `Reject this payout and return ${amountLabel} to their balance?`
                  : `Reject this payout and keep ${amountLabel} debited?`
            }
          >
            <input type="hidden" name="redirectTo" value={redirectTo} />
            <input type="hidden" name="action" value="retro_reject" />
            {manual ? (
              <p className="font-body text-sm text-muted-foreground">
                Manual payouts never touch the balance, so this only marks the payout rejected.
              </p>
            ) : (
              <RejectModeOptions
                mode={mode}
                onModeChange={setMode}
                amountLabel={amountLabel}
                retro
              />
            )}
            <label className="block text-sm text-secondary">
              Reason for the ambassador
              <Textarea name="publicComment" rows={3} required placeholder="Why it was rejected" className={fieldClass} />
            </label>
            <label className="block text-sm text-secondary">
              Internal note (optional)
              <Textarea name="adminComment" rows={2} className={fieldClass} placeholder="Admins only" />
            </label>
            <ModalButtons submitLabel="Reject payout" variant="default" onCancel={() => setModal(null)} />
          </ConfirmSubmitForm>
        </Modal>
      ) : null}
    </>
  );
}

type TransferCheck = {
  available: boolean;
  matches: Array<{ date: string; memo: string | null; type: string; pending: boolean }>;
};

// Non-blocking hint from HCB's public Transparency API: shared /hcb/ links
// can't be resolved directly, so we match the payout amount against the org's
// recent ledger instead. Renders nothing when the check isn't available.
function HcbTransferHint({ payoutId }: { payoutId: string }) {
  const [check, setCheck] = useState<TransferCheck | "loading" | "unavailable">("loading");

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/admin/payouts/${payoutId}/transfer-check`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data: TransferCheck | null) => {
        if (!cancelled) setCheck(data && data.available ? data : "unavailable");
      })
      .catch(() => {
        if (!cancelled) setCheck("unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, [payoutId]);

  if (check === "loading") {
    return (
      <p className="font-body text-sm text-muted-foreground">
        Checking HCB for a transaction matching this amount…
      </p>
    );
  }

  if (check === "unavailable") {
    return null;
  }

  if (check.matches.length === 0) {
    return (
      <p className="font-body text-sm text-secondary">
        Heads up: no transaction for this amount on HCB yet. Double-check the link.
      </p>
    );
  }

  return (
    <p className="font-body text-sm text-secondary">
      Found on HCB:{" "}
      {check.matches
        .map((match) =>
          `${match.memo ?? match.type.replaceAll("_", " ")} (${match.date}${match.pending ? ", pending" : ""})`,
        )
        .join("; ")}
    </p>
  );
}

export function ModalButtons({
  submitLabel,
  variant,
  onCancel,
}: {
  submitLabel: string;
  variant: "success" | "default";
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-3">
      <button
        type="button"
        className="ui-open-link inline-flex items-center gap-1 font-body text-lg leading-none"
        onClick={onCancel}
      >
        Cancel
      </button>
      <button className={buttonVariants({ variant, size: "app" })}>{submitLabel}</button>
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const titleId = useId();
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      className="ui-modal-backdrop items-center p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="ui-card w-full max-w-lg space-y-4 shadow-xl"
      >
        <h3 id={titleId} className="text-xl text-foreground">
          {title}
        </h3>
        {children}
      </div>
    </div>
  );
}
