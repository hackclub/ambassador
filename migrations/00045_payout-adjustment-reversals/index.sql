-- Removable manual adjustments.
--
-- An admin can bundle a manual adjustment into a pending payout (the ledger
-- event credits/debits the balance, and the payout's frozen amount_cents moves
-- with it). Removing that adjustment writes an opposite ledger event rather
-- than deleting anything, so the event-sourced balance and its triggers stay
-- exactly as they are.
--
-- reverses_event_id points at the adjustment being undone. The partial unique
-- index is what makes "remove" safe: an adjustment can be reversed at most
-- once, so a double-submit or a stale page can't debit the balance twice.
ALTER TABLE payout_balance_events
  ADD COLUMN IF NOT EXISTS reverses_event_id TEXT REFERENCES payout_balance_events(id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payout_balance_events_reverses
  ON payout_balance_events (reverses_event_id)
  WHERE reverses_event_id IS NOT NULL;
