ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_stardance_referral_code_format;

ALTER TABLE stardance_referral_codes
  DROP CONSTRAINT IF EXISTS stardance_referral_codes_code_format;

UPDATE users
SET stardance_referral_code = CASE
  WHEN LOWER(stardance_referral_code) ~ '^a-[a-z0-9]{5}$'
    THEN LOWER(stardance_referral_code)
  WHEN LOWER(stardance_referral_code) ~ '^[a-z0-9]{5}$'
    THEN 'a-' || LOWER(stardance_referral_code)
  ELSE LOWER(stardance_referral_code)
END
WHERE stardance_referral_code IS NOT NULL;

UPDATE stardance_referral_codes
SET code = CASE
  WHEN LOWER(code) ~ '^a-[a-z0-9]{5}$'
    THEN LOWER(code)
  WHEN LOWER(code) ~ '^[a-z0-9]{5}$'
    THEN 'a-' || LOWER(code)
  ELSE LOWER(code)
END;

UPDATE posters
SET referral_code = CASE
  WHEN LOWER(referral_code) ~ '^a-[a-z0-9]{5}$'
    THEN LOWER(referral_code)
  WHEN LOWER(referral_code) ~ '^[a-z0-9]{5}$'
    THEN 'a-' || LOWER(referral_code)
  ELSE LOWER(referral_code)
END
WHERE referral_code IS NOT NULL;

ALTER TABLE users
  ADD CONSTRAINT users_stardance_referral_code_format
    CHECK (stardance_referral_code IS NULL OR stardance_referral_code ~ '^a-[a-z0-9]{5}$');

ALTER TABLE stardance_referral_codes
  ADD CONSTRAINT stardance_referral_codes_code_format
    CHECK (code ~ '^a-[a-z0-9]{5}$');
