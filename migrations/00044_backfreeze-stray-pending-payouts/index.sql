-- Re-sweep: freeze any requested pending payout still missing its bundle.
--
-- 00043 back-froze the legacy pending payouts, but it ran exactly once, and it
-- could only catch payouts that were pending and unfrozen at that moment. The
-- June 20 reports (a pending payout still growing with each verified poster,
-- hours after 00043 landed) were resolved by hand in production rather than by
-- the sweep, so a row patched around it, or requested in the gap between the
-- commit and its deploy, can still carry bundle_frozen_at NULL. The service
-- reads such a payout from the *live* balance: everything verified while it
-- sits pending gets swept in, and approving it pays out the whole balance.
--
-- The statements below are 00043 verbatim; see that header for the snapshot
-- semantics (posters by verified_at, referrals approximated by referred_at,
-- amount_cents left at the request-time balance, remainder reconciling as
-- misc). Every statement is gated on bundle_frozen_at IS NULL, so with no
-- stray rows this whole migration is a no-op; createPayoutForUser has stamped
-- bundle_frozen_at on every payout since 00042, so strays cannot reappear
-- after this sweep.

-- 1. Posters verified at or before the payout was requested. The NOT IN guard
--    skips any poster already consumed by another payout's bundle.
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
--    referred_at; see the 00043 header note).
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

-- 3. Stamp the freeze last, so the two INSERTs above still saw these payouts
--    as unfrozen (bundle_frozen_at NULL) while building their snapshots.
UPDATE payouts
SET bundle_frozen_at = submitted_at,
    updated_at = NOW()
WHERE status = 'pending'
  AND created_by_admin_id IS NULL
  AND bundle_frozen_at IS NULL;
