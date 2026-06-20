-- Back-freeze legacy pending payouts to their request-time bundle.
--
-- Payouts requested before 00042 carry bundle_frozen_at NULL, so the service
-- still reads their amount and line items from the *live* balance: every poster
-- or referral verified while they sit pending gets swept in. Their amount_cents
-- was already frozen to the balance at request time (the old createPayoutForUser
-- inserted the live balance into it), so the dollar figure is already correct.
-- Only the live-balance display and approval path is wrong.
--
-- This rolls each such payout back to request time: snapshot exactly the posters
-- and referrals that were already verified when it was submitted, then stamp
-- bundle_frozen_at so the service reads that snapshot instead of the live
-- balance. Anything verified afterwards stays on the balance and rolls into the
-- next payout, which is what should have happened all along. amount_cents is
-- left untouched; the remainder over the snapshotted items reconciles as misc
-- (the meetup adjustments and debt that were part of the request-time balance).
--
-- Posters carry verified_at, so their request-time membership is exact.
-- Referrals have no verified-at column, so we approximate with referred_at: a
-- referral referred before the request but verified after it is kept here rather
-- than rolled forward. There is no recorded data to draw the line more precisely.

-- 1. Posters verified at or before the payout was requested. The NOT IN guard
--    skips any poster already consumed by another (approved) payout's bundle.
INSERT INTO payout_posters (payout_id, poster_id, amount_cents)
SELECT pay.id, p.id, 100
FROM payouts pay
JOIN posters p ON p.user_id = pay.user_id
WHERE pay.status = 'pending'
  AND pay.created_by_admin_id IS NULL
  AND pay.bundle_frozen_at IS NULL
  AND p.deleted_at IS NULL
  AND p.verification_status = 'success'
  AND p.verified_at <= pay.submitted_at
  AND p.id NOT IN (SELECT poster_id FROM payout_posters)
ON CONFLICT (payout_id, poster_id) DO NOTHING;

-- 2. Referrals verified at or before the payout was requested (approximated by
--    referred_at; see the header note).
INSERT INTO payout_referrals (payout_id, referral_id, amount_cents)
SELECT pay.id, r.id, 50
FROM payouts pay
JOIN stardance_referrals r ON r.user_id = pay.user_id
WHERE pay.status = 'pending'
  AND pay.created_by_admin_id IS NULL
  AND pay.bundle_frozen_at IS NULL
  AND r.verification_status = 'verified'
  AND r.referred_at <= pay.submitted_at
  AND r.id NOT IN (SELECT referral_id FROM payout_referrals)
ON CONFLICT (payout_id, referral_id) DO NOTHING;

-- 3. Stamp the freeze last, so the two INSERTs above still saw these payouts as
--    legacy (bundle_frozen_at NULL) while building their snapshots.
UPDATE payouts
SET bundle_frozen_at = submitted_at,
    updated_at = NOW()
WHERE status = 'pending'
  AND created_by_admin_id IS NULL
  AND bundle_frozen_at IS NULL;
