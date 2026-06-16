-- Freeze a requested payout's line items at request time, not approval time.
--
-- A requested payout used to pay out the ambassador's full *live* balance, so
-- any poster or referral verified while the payout sat pending got swept into
-- it. Now the bundle of posters/referrals is snapshotted into payout_posters /
-- payout_referrals the moment the payout is requested, so anything verified
-- afterwards accrues to the balance and rolls into the *next* payout instead.
--
-- bundle_frozen_at marks a payout that opted into this model. Payouts that were
-- already pending keep bundle_frozen_at NULL and the legacy live-balance
-- behavior; everything requested from here on freezes its bundle up front.
ALTER TABLE payouts
  ADD COLUMN IF NOT EXISTS bundle_frozen_at TIMESTAMPTZ;
