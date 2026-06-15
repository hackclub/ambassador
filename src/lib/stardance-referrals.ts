import "server-only";

import sql from "@/lib/database/client";
import { optionalEnv } from "@/lib/env";
import { hasApprovedAmbassadorStatus } from "@/lib/posters/access";
import { ensurePosterNameColumn } from "@/lib/posters/repository";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const CODE_LENGTH = 5;
const CODE_PATTERN = /^a-[a-z0-9]{5}$/;
const STARDANCE_BASE_URL = "https://stardance.hackclub.com";
const MAX_STARDANCE_REFERRAL_LABEL_LENGTH = 80;
const MAX_ACTIVE_REFERRAL_CODES = 500;

let ensureStardanceReferralCodeFormatPromise: Promise<void> | null = null;

type StardanceUserCodeRow = {
  stardance_referral_code: string | null;
};

export type StardanceReferralVerificationStatus =
  | "rsvp"
  | "unverified"
  | "pending"
  | "verified"
  | "rejected";

type StardanceReferralCodeKind = "primary" | "secondary";

export type StardanceReferralCodeRow = {
  id: string;
  user_id: string;
  code: string;
  label: string;
  kind: StardanceReferralCodeKind;
  archived_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

type StardanceReferralCodeRowWithUses = StardanceReferralCodeRow & {
  uses_count: string;
};

export type StardanceReferralCode = {
  id: string;
  code: string;
  label: string;
  kind: StardanceReferralCodeKind;
  shareUrl: string;
  archivedAt: string | null;
  usesCount: number;
};

export type StardanceReferral = {
  id: string;
  kind: "signup" | "poster";
  name: string;
  slackId: string;
  email: string;
  hoursLogged: number;
  hoursApproved: number;
  verificationStatus: StardanceReferralVerificationStatus;
  referredAt: string;
  referralCodeId: string;
  referralCodeLabel: string;
  posterId: string | null;
  posterName: string | null;
  posterReferralCode: string | null;
};

export class StardanceReferralCodeError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "StardanceReferralCodeError";
  }
}

function parseStoredStardanceReferralCode(value: unknown) {
  if (typeof value !== "string") return null;
  const code = value.trim();
  return CODE_PATTERN.test(code) ? code : null;
}

async function ensureStardanceReferralCodeFormat() {
  ensureStardanceReferralCodeFormatPromise ??= (async () => {
    await sql`
      ALTER TABLE users
      DROP CONSTRAINT IF EXISTS users_stardance_referral_code_format
    `;

    await sql`
      ALTER TABLE stardance_referral_codes
      DROP CONSTRAINT IF EXISTS stardance_referral_codes_code_format
    `;

    await sql`
      UPDATE users
      SET stardance_referral_code = CASE
        WHEN LOWER(stardance_referral_code) ~ '^a-[a-z0-9]{5}$'
          THEN LOWER(stardance_referral_code)
        WHEN LOWER(stardance_referral_code) ~ '^[a-z0-9]{5}$'
          THEN 'a-' || LOWER(stardance_referral_code)
        ELSE LOWER(stardance_referral_code)
      END
      WHERE stardance_referral_code IS NOT NULL
    `;

    await sql`
      UPDATE stardance_referral_codes
      SET code = CASE
        WHEN LOWER(code) ~ '^a-[a-z0-9]{5}$'
          THEN LOWER(code)
        WHEN LOWER(code) ~ '^[a-z0-9]{5}$'
          THEN 'a-' || LOWER(code)
        ELSE LOWER(code)
      END
    `;

    await sql`
      UPDATE posters
      SET referral_code = CASE
        WHEN LOWER(referral_code) ~ '^a-[a-z0-9]{5}$'
          THEN LOWER(referral_code)
        WHEN LOWER(referral_code) ~ '^[a-z0-9]{5}$'
          THEN 'a-' || LOWER(referral_code)
        ELSE LOWER(referral_code)
      END
      WHERE referral_code IS NOT NULL
    `;

    await sql`
      ALTER TABLE users
      ADD CONSTRAINT users_stardance_referral_code_format
        CHECK (stardance_referral_code IS NULL OR stardance_referral_code ~ '^a-[a-z0-9]{5}$')
    `;

    await sql`
      ALTER TABLE stardance_referral_codes
      ADD CONSTRAINT stardance_referral_codes_code_format
        CHECK (code ~ '^a-[a-z0-9]{5}$')
    `;
  })().catch((error) => {
    ensureStardanceReferralCodeFormatPromise = null;
    throw error;
  });

  return ensureStardanceReferralCodeFormatPromise;
}

export function canAccessStardanceReferrals(input: {
  latestApplicationStatus?: string | null;
  manualDashboardState?: string | null;
  isOnboardingComplete?: boolean;
  isAdmin?: boolean;
} | null | undefined) {
  if (input?.isAdmin === true) {
    return true;
  }

  return hasApprovedAmbassadorStatus(input) && input?.isOnboardingComplete === true;
}

function buildStardanceReferralUrl(code: string) {
  return `${optionalEnv("STARDANCE_REFERRAL_BASE_URL") ?? STARDANCE_BASE_URL}/${code}`;
}

function toStardanceReferralCode(
  row: StardanceReferralCodeRow,
  usesCount = 0,
): StardanceReferralCode {
  const code = row.code;
  return {
    id: row.id,
    code,
    label: row.label,
    kind: row.kind,
    shareUrl: buildStardanceReferralUrl(code),
    archivedAt: row.archived_at?.toISOString() ?? null,
    usesCount,
  };
}

function randomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  let code = "";

  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += ALPHABET[bytes[i]! % ALPHABET.length];
  }

  return code;
}

async function generateUniqueCode() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = `a-${randomCode()}`;

    const existing = (await sql<{ exists: boolean }[]>`
      SELECT EXISTS(
        SELECT 1 FROM stardance_referral_codes WHERE LOWER(code) = ${candidate}
        UNION ALL
        SELECT 1 FROM users WHERE LOWER(stardance_referral_code) = ${candidate}
        UNION ALL
        SELECT 1 FROM posters WHERE LOWER(referral_code) = ${candidate}
        UNION ALL
        SELECT 1 FROM referral_links WHERE LOWER(code) = ${candidate}
      ) AS exists
    `).at(0);

    if (existing?.exists !== true) {
      return candidate;
    }
  }

  throw new Error("Failed to generate a unique Stardance referral code.");
}

async function getOrCreateDefaultStardanceReferralCodeRow(userId: string) {
  await ensureStardanceReferralCodeFormat();

  return sql.begin(async (transaction) => {
    const lockedUser = (await transaction<StardanceUserCodeRow[]>`
      SELECT stardance_referral_code
      FROM users
      WHERE id = ${userId}
      LIMIT 1
      FOR UPDATE
    `).at(0);

    if (lockedUser === undefined) {
      throw new Error(`User ${userId} not found.`);
    }

    const existingPrimary = (await transaction<StardanceReferralCodeRow[]>`
      SELECT *
      FROM stardance_referral_codes
      WHERE user_id = ${userId}
        AND kind = 'primary'
      LIMIT 1
    `).at(0);

    if (existingPrimary !== undefined) {
      const existingPrimaryCode = existingPrimary.code;
      if (lockedUser.stardance_referral_code !== existingPrimaryCode) {
        await transaction`
          UPDATE users
          SET stardance_referral_code = ${existingPrimaryCode}
          WHERE id = ${userId}
        `;
      }

      return { ...existingPrimary, code: existingPrimaryCode };
    }

    const currentCode = parseStoredStardanceReferralCode(lockedUser.stardance_referral_code);

    for (let attempt = 0; attempt < 50; attempt += 1) {
      const candidate =
        attempt === 0 && currentCode !== null
          ? currentCode
          : await generateUniqueCode();

      const [created] = await transaction<StardanceReferralCodeRow[]>`
        INSERT INTO stardance_referral_codes (id, user_id, code, label, kind)
        VALUES (
          ${crypto.randomUUID()},
          ${userId},
          ${candidate},
          ${"Default"},
          'primary'
        )
        ON CONFLICT DO NOTHING
        RETURNING *
      `;

      if (created !== undefined) {
        const createdCode = created.code;
        if (lockedUser.stardance_referral_code !== createdCode) {
          await transaction`
            UPDATE users
            SET stardance_referral_code = ${createdCode}
            WHERE id = ${userId}
          `;
        }

        return { ...created, code: createdCode };
      }

      const raced = (await transaction<StardanceReferralCodeRow[]>`
        SELECT *
        FROM stardance_referral_codes
        WHERE user_id = ${userId}
          AND kind = 'primary'
        LIMIT 1
      `).at(0);

      if (raced !== undefined) {
        const racedCode = raced.code;
        if (lockedUser.stardance_referral_code !== racedCode) {
          await transaction`
            UPDATE users
            SET stardance_referral_code = ${racedCode}
            WHERE id = ${userId}
          `;
        }

        return { ...raced, code: racedCode };
      }
    }

    throw new Error("Failed to assign a Stardance referral code.");
  });
}

export async function listStardanceReferralCodesForUser(userId: string) {
  await getOrCreateDefaultStardanceReferralCodeRow(userId);

  const rows = await sql<StardanceReferralCodeRowWithUses[]>`
    SELECT c.*, COUNT(r.id)::text AS uses_count
    FROM stardance_referral_codes c
    LEFT JOIN stardance_referrals r ON r.referral_code_id = c.id
    WHERE c.user_id = ${userId}
      AND c.archived_at IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM posters
        WHERE posters.user_id = c.user_id
          AND (
            LOWER(posters.referral_code) = LOWER(c.code)
            OR (
              posters.referral_code ~ '^a-[a-z0-9]{5}$'
              AND c.code ~ '^[a-z0-9]{5}$'
              AND LOWER(posters.referral_code) = 'a-' || LOWER(c.code)
            )
            OR (
              posters.referral_code ~ '^[a-z0-9]{5}$'
              AND c.code ~ '^a-[a-z0-9]{5}$'
              AND 'a-' || LOWER(posters.referral_code) = LOWER(c.code)
            )
          )
      )
      AND c.label !~ '^Poster [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    GROUP BY c.id
    ORDER BY
      CASE WHEN c.kind = 'primary' THEN 0 ELSE 1 END,
      c.created_at ASC,
      c.id ASC
  `;

  return rows.map((row) => toStardanceReferralCode(row, Number.parseInt(row.uses_count, 10)));
}

export async function listArchivedStardanceReferralCodesForUser(userId: string) {
  const rows = await sql<StardanceReferralCodeRowWithUses[]>`
    SELECT c.*, COUNT(r.id)::text AS uses_count
    FROM stardance_referral_codes c
    LEFT JOIN stardance_referrals r ON r.referral_code_id = c.id
    WHERE c.user_id = ${userId}
      AND c.archived_at IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM posters
        WHERE posters.user_id = c.user_id
          AND (
            LOWER(posters.referral_code) = LOWER(c.code)
            OR (
              posters.referral_code ~ '^a-[a-z0-9]{5}$'
              AND c.code ~ '^[a-z0-9]{5}$'
              AND LOWER(posters.referral_code) = 'a-' || LOWER(c.code)
            )
            OR (
              posters.referral_code ~ '^[a-z0-9]{5}$'
              AND c.code ~ '^a-[a-z0-9]{5}$'
              AND 'a-' || LOWER(posters.referral_code) = LOWER(c.code)
            )
          )
      )
      AND c.label !~ '^Poster [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    GROUP BY c.id
    ORDER BY c.archived_at DESC, c.id ASC
  `;

  return rows.map((row) => toStardanceReferralCode(row, Number.parseInt(row.uses_count, 10)));
}

export async function restoreStardanceReferralCodeForUser(userId: string, codeId: string) {
  const [existing] = await sql<StardanceReferralCodeRow[]>`
    SELECT *
    FROM stardance_referral_codes
    WHERE id = ${codeId} AND user_id = ${userId}
    LIMIT 1
  `;

  if (existing === undefined) {
    throw new StardanceReferralCodeError("Referral code not found.", 404);
  }

  if (existing.archived_at === null) {
    return toStardanceReferralCode(existing);
  }

  const [constraints] = await sql<{ active_count: string; duplicate_label: boolean }[]>`
    SELECT
      COUNT(*) FILTER (WHERE archived_at IS NULL)::text AS active_count,
      EXISTS(
        SELECT 1
        FROM stardance_referral_codes
        WHERE user_id = ${userId}
          AND id <> ${codeId}
          AND archived_at IS NULL
          AND LOWER(label) = LOWER(${existing.label})
      ) AS duplicate_label
    FROM stardance_referral_codes
    WHERE user_id = ${userId}
  `;

  if (constraints !== undefined && Number.parseInt(constraints.active_count, 10) >= MAX_ACTIVE_REFERRAL_CODES) {
    throw new StardanceReferralCodeError(
      `You can have at most ${MAX_ACTIVE_REFERRAL_CODES} active referral codes. Delete one to free up space.`,
      400,
    );
  }

  if (constraints?.duplicate_label === true) {
    throw new StardanceReferralCodeError(
      "An active referral code already uses that label. Rename it first.",
      409,
    );
  }

  const [restored] = await sql<StardanceReferralCodeRow[]>`
    UPDATE stardance_referral_codes
    SET archived_at = NULL, updated_at = NOW()
    WHERE id = ${codeId} AND user_id = ${userId}
    RETURNING *
  `;

  if (restored === undefined) {
    throw new StardanceReferralCodeError("Referral code not found.", 404);
  }

  return toStardanceReferralCode(restored);
}

export async function archiveStardanceReferralCodeForUser(userId: string, codeId: string) {
  const [existing] = await sql<StardanceReferralCodeRow[]>`
    SELECT *
    FROM stardance_referral_codes
    WHERE id = ${codeId} AND user_id = ${userId}
    LIMIT 1
  `;

  if (existing === undefined) {
    throw new StardanceReferralCodeError("Referral code not found.", 404);
  }

  if (existing.kind === "primary") {
    throw new StardanceReferralCodeError("The default referral code cannot be archived.", 400);
  }

  if (existing.archived_at !== null) {
    return toStardanceReferralCode(existing);
  }

  const [archived] = await sql<StardanceReferralCodeRow[]>`
    UPDATE stardance_referral_codes
    SET archived_at = NOW(), updated_at = NOW()
    WHERE id = ${codeId} AND user_id = ${userId}
    RETURNING *
  `;

  if (archived === undefined) {
    throw new StardanceReferralCodeError("Referral code not found.", 404);
  }

  return toStardanceReferralCode(archived);
}

export async function renameStardanceReferralCodeForUser(
  userId: string,
  codeId: string,
  rawLabel: string,
) {
  const label = rawLabel.trim();

  if (label === "") {
    throw new StardanceReferralCodeError("Referral code label is required.", 400);
  }

  if (label.length > MAX_STARDANCE_REFERRAL_LABEL_LENGTH) {
    throw new StardanceReferralCodeError("Referral code labels must be 80 characters or fewer.", 400);
  }

  const [existing] = await sql<(StardanceReferralCodeRow & { duplicate_label: boolean })[]>`
    SELECT c.*,
           EXISTS(
             SELECT 1
             FROM stardance_referral_codes other
             WHERE other.user_id = ${userId}
               AND other.id <> c.id
               AND other.archived_at IS NULL
               AND LOWER(other.label) = LOWER(${label})
           ) AS duplicate_label
    FROM stardance_referral_codes c
    WHERE c.id = ${codeId} AND c.user_id = ${userId}
    LIMIT 1
  `;

  if (existing === undefined || existing.archived_at !== null) {
    throw new StardanceReferralCodeError("Referral code not found.", 404);
  }

  if (existing.duplicate_label) {
    throw new StardanceReferralCodeError("A referral code with that label already exists.", 409);
  }

  const [updated] = await sql<StardanceReferralCodeRow[]>`
    UPDATE stardance_referral_codes
    SET label = ${label}, updated_at = NOW()
    WHERE id = ${codeId} AND user_id = ${userId}
    RETURNING *
  `;

  if (updated === undefined) {
    throw new StardanceReferralCodeError("Referral code not found.", 404);
  }

  return toStardanceReferralCode(updated);
}

export async function createStardanceReferralCodeForUser(userId: string, rawLabel: string) {
  const label = rawLabel.trim();

  if (label === "") {
    throw new StardanceReferralCodeError("Referral code label is required.", 400);
  }

  if (label.length > MAX_STARDANCE_REFERRAL_LABEL_LENGTH) {
    throw new StardanceReferralCodeError("Referral code labels must be 80 characters or fewer.", 400);
  }

  await getOrCreateDefaultStardanceReferralCodeRow(userId);

  const [constraints] = await sql<{ active_count: string; duplicate_label: boolean }[]>`
    SELECT
      COUNT(*) FILTER (WHERE archived_at IS NULL)::text AS active_count,
      EXISTS(
        SELECT 1
        FROM stardance_referral_codes
        WHERE user_id = ${userId}
          AND archived_at IS NULL
          AND LOWER(label) = LOWER(${label})
      ) AS duplicate_label
    FROM stardance_referral_codes
    WHERE user_id = ${userId}
  `;

  if (constraints !== undefined && Number.parseInt(constraints.active_count, 10) >= MAX_ACTIVE_REFERRAL_CODES) {
    throw new StardanceReferralCodeError(
      `You can have at most ${MAX_ACTIVE_REFERRAL_CODES} active referral codes. Delete one to free up space.`,
      400,
    );
  }

  if (constraints?.duplicate_label === true) {
    throw new StardanceReferralCodeError("A referral code with that label already exists.", 409);
  }

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const [created] = await sql<StardanceReferralCodeRow[]>`
      INSERT INTO stardance_referral_codes (id, user_id, code, label, kind)
      VALUES (${crypto.randomUUID()}, ${userId}, ${await generateUniqueCode()}, ${label}, 'secondary')
      ON CONFLICT DO NOTHING
      RETURNING *
    `;

    if (created !== undefined) {
      return toStardanceReferralCode(created);
    }

    const raced = (await sql<{ exists: boolean }[]>`
      SELECT EXISTS(
        SELECT 1
        FROM stardance_referral_codes
        WHERE user_id = ${userId}
          AND archived_at IS NULL
          AND LOWER(label) = LOWER(${label})
      ) AS exists
    `).at(0);

    if (raced?.exists === true) {
      throw new StardanceReferralCodeError("A referral code with that label already exists.", 409);
    }
  }

  throw new Error("Failed to create a Stardance referral code.");
}

type StardanceReferralRow = {
  id: string;
  user_id: string;
  referral_code_id: string;
  name: string;
  slack_id: string;
  email: string;
  hours_logged: string;
  hours_approved: string;
  verification_status: StardanceReferralVerificationStatus;
  referred_at: Date;
  referral_code_label: string;
  is_poster_referral: boolean;
  poster_id: string | null;
  poster_name: string | null;
  poster_referral_code: string | null;
};

type StardanceFeedReferral = {
  id: string;
  isRsvp: boolean;
  email: string;
  ref: string;
  userRef: string | null;
  createdAt: string;
  onboardedAt: string | null;
  verificationStatus: string | null;
  banned: boolean;
  hoursLogged: number;
  hoursApproved: number;
  displayName: string | null;
  slackId: string | null;
  clickConfirmedAt: string | null;
  replyConfirmedAt: string | null;
  signupConfirmationSentAt: string | null;
};

type StardanceReferralUpsertRow = {
  id: string;
  user_id: string;
  referral_code_id: string;
  name: string;
  slack_id: string;
  email: string;
  hours_logged: number;
  hours_approved: number;
  verification_status: StardanceReferralVerificationStatus;
  referred_at: string;
  user_ref: string | null;
  onboarded_at: string | null;
  click_confirmed_at: string | null;
  reply_confirmed_at: string | null;
  signup_confirmation_sent_at: string | null;
};

type PosterReferralCodeRow = {
  id: string;
  user_id: string;
  referral_code: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseFiniteHours(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function parseTimestamp(value: unknown): string | null {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : null;
}

function parseStardanceFeedReferral(value: unknown): StardanceFeedReferral | null {
  if (!isRecord(value)) return null;

  const id = value.id;
  const email = value.email;
  const ref = value.ref;
  const createdAt = value.created_at;

  if (
    (typeof id !== "string" && typeof id !== "number") ||
    typeof email !== "string" ||
    typeof ref !== "string" ||
    typeof createdAt !== "string" ||
    Number.isNaN(Date.parse(createdAt))
  ) {
    return null;
  }

  const userRef = typeof value.user_ref === "string" ? value.user_ref.trim() : "";

  return {
    id: String(id),
    isRsvp: value.rsvp === true,
    email: email.trim().toLowerCase(),
    ref: ref.trim().toLowerCase(),
    userRef: userRef === "" ? null : userRef,
    createdAt,
    onboardedAt: parseTimestamp(value.onboarded_at),
    verificationStatus:
      typeof value.verification_status === "string" ? value.verification_status : null,
    banned: value.banned === true,
    hoursLogged: parseFiniteHours(value.hours_logged),
    hoursApproved: parseFiniteHours(value.hours_approved),
    displayName: typeof value.display_name === "string" ? value.display_name : null,
    slackId: typeof value.slack_id === "string" ? value.slack_id : null,
    clickConfirmedAt: parseTimestamp(value.click_confirmed_at),
    replyConfirmedAt: parseTimestamp(value.reply_confirmed_at),
    signupConfirmationSentAt: parseTimestamp(value.signup_confirmation_sent_at),
  };
}

function deriveVerificationStatus(
  referral: StardanceFeedReferral,
): StardanceReferralVerificationStatus {
  if (referral.isRsvp) return "rsvp";
  if (referral.banned) return "rejected";

  switch (referral.verificationStatus) {
    case "verified":
      return "verified";
    case "pending":
      return "pending";
    case "ineligible":
      return "rejected";
    default:
      return "unverified";
  }
}

async function fetchAllStardanceRsvpReferrals(apiKey: string) {
  const baseUrl = optionalEnv("STARDANCE_API_BASE_URL") ?? STARDANCE_BASE_URL;
  const url = new URL("/api/v1/ambassador_referrals", baseUrl);
  url.searchParams.set("rsvp", "true");

  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${apiKey}`,
      accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Stardance RSVP API returned ${response.status}.`);
  }

  const body: unknown = await response.json();
  const referrals = isRecord(body) && Array.isArray(body.referrals) ? body.referrals : [];

  return referrals
    .map((value) => parseStardanceFeedReferral(value))
    .filter((referral): referral is StardanceFeedReferral => referral !== null);
}

function buildStardanceReferralRows(
  referrals: StardanceFeedReferral[],
  codeByRef: Map<string, StardanceReferralCodeRow>,
) {
  const rows: StardanceReferralUpsertRow[] = [];

  for (const referral of referrals) {
    const code = codeByRef.get(referral.ref);
    if (code === undefined) continue;
    if (referral.email === "") continue;

    rows.push({
      id: `${referral.isRsvp ? "rsvp" : "user"}:${referral.id}`,
      user_id: code.user_id,
      referral_code_id: code.id,
      name: referral.displayName?.trim() || referral.email,
      slack_id: referral.slackId ?? "",
      email: referral.email,
      hours_logged: referral.hoursLogged,
      hours_approved: referral.hoursApproved,
      verification_status: deriveVerificationStatus(referral),
      referred_at: new Date(referral.createdAt).toISOString(),
      user_ref: referral.userRef,
      onboarded_at: referral.onboardedAt,
      click_confirmed_at: referral.clickConfirmedAt,
      reply_confirmed_at: referral.replyConfirmedAt,
      signup_confirmation_sent_at: referral.signupConfirmationSentAt,
    });
  }

  return rows;
}

async function ingestStardanceRsvpReferralRows(rows: StardanceReferralUpsertRow[]) {
  if (rows.length === 0) return;

  // Status ratchets forward (rsvp -> unverified -> pending -> verified); 'rejected' is terminal both ways.
  await sql`
    INSERT INTO stardance_referrals ${sql(rows)}
    ON CONFLICT (id) DO UPDATE
    SET
      user_id = EXCLUDED.user_id,
      referral_code_id = EXCLUDED.referral_code_id,
      name = EXCLUDED.name,
      slack_id = EXCLUDED.slack_id,
      email = EXCLUDED.email,
      hours_logged = EXCLUDED.hours_logged,
      hours_approved = EXCLUDED.hours_approved,
      referred_at = EXCLUDED.referred_at,
      user_ref = EXCLUDED.user_ref,
      onboarded_at = EXCLUDED.onboarded_at,
      click_confirmed_at = EXCLUDED.click_confirmed_at,
      reply_confirmed_at = EXCLUDED.reply_confirmed_at,
      signup_confirmation_sent_at = EXCLUDED.signup_confirmation_sent_at,
      verification_status = CASE
        WHEN stardance_referrals.verification_status = 'rejected'
          THEN stardance_referrals.verification_status
        WHEN EXCLUDED.verification_status = 'rejected'
          THEN EXCLUDED.verification_status
        WHEN ARRAY_POSITION(
            ARRAY['rsvp', 'unverified', 'pending', 'verified'],
            EXCLUDED.verification_status
          ) > ARRAY_POSITION(
            ARRAY['rsvp', 'unverified', 'pending', 'verified'],
            stardance_referrals.verification_status
          )
          THEN EXCLUDED.verification_status
        ELSE stardance_referrals.verification_status
      END
  `;

  // Drop an rsvp: row superseded by a user: row, but never one a payout references (CASCADE would erase the line).
  await sql`
    DELETE FROM stardance_referrals AS stale
    WHERE stale.id LIKE 'rsvp:%'
      AND EXISTS (
        SELECT 1
        FROM stardance_referrals AS keep
        WHERE keep.id LIKE 'user:%'
          AND LOWER(keep.email) = LOWER(stale.email)
      )
      AND NOT EXISTS (
        SELECT 1 FROM payout_referrals pr WHERE pr.referral_id = stale.id
      )
  `;

  // Reject self-referrals (referred contact is the ambassador, by email or Slack id); the balance trigger claws back any credit.
  const userIds = [...new Set(rows.map((row) => row.user_id))];
  await sql`
    UPDATE stardance_referrals AS referral
    SET verification_status = 'rejected'
    FROM users AS owner
    WHERE owner.id = referral.user_id
      AND referral.user_id = ANY(${userIds}::text[])
      AND referral.verification_status <> 'rejected'
      AND (
        (owner.email IS NOT NULL AND referral.email <> '' AND LOWER(referral.email) = LOWER(owner.email))
        OR (owner.slack_id IS NOT NULL AND owner.slack_id <> '' AND referral.slack_id = owner.slack_id)
      )
  `;
}

async function ensurePosterReferralCodeRows(userId?: string) {
  await ensureStardanceReferralCodeFormat();
  await ensurePosterNameColumn();

  const posters = userId === undefined
    ? await sql<PosterReferralCodeRow[]>`
        SELECT p.id, p.user_id, p.referral_code
        FROM posters p
        WHERE p.referral_code ~ '^a-[a-z0-9]{5}$'
          AND NOT EXISTS (
            SELECT 1
            FROM stardance_referral_codes c
            WHERE c.user_id = p.user_id
              AND (
                c.code = p.referral_code
                OR (
                  c.code ~ '^[a-z0-9]{5}$'
                  AND p.referral_code = 'a-' || c.code
                )
              )
          )
      `
    : await sql<PosterReferralCodeRow[]>`
        SELECT p.id, p.user_id, p.referral_code
        FROM posters p
        WHERE p.user_id = ${userId}
          AND p.referral_code ~ '^a-[a-z0-9]{5}$'
          AND NOT EXISTS (
            SELECT 1
            FROM stardance_referral_codes c
            WHERE c.user_id = p.user_id
              AND (
                c.code = p.referral_code
                OR (
                  c.code ~ '^[a-z0-9]{5}$'
                  AND p.referral_code = 'a-' || c.code
                )
              )
          )
      `;

  const rows: Array<{
    id: string;
    user_id: string;
    code: string;
    label: string;
    kind: StardanceReferralCodeKind;
  }> = posters.map((poster) => ({
    id: crypto.randomUUID(),
    user_id: poster.user_id,
    code: poster.referral_code,
    label: `Poster ${poster.id}`,
    kind: "secondary",
  }));

  if (rows.length === 0) return;

  await sql`
    INSERT INTO stardance_referral_codes ${sql(rows)}
    ON CONFLICT DO NOTHING
  `;
}

export async function syncStardanceRsvpReferralsForUser(userId: string) {
  const apiKey = optionalEnv("STARDANCE_API_KEY");
  if (apiKey === null) return;

  await getOrCreateDefaultStardanceReferralCodeRow(userId);
  await ensurePosterReferralCodeRows(userId);

  const codes = await sql<StardanceReferralCodeRow[]>`
    SELECT *
    FROM stardance_referral_codes
    WHERE user_id = ${userId}
      AND code ~ '^a-[a-z0-9]{5}$'
  `;

  if (codes.length === 0) return;

  const codeByRef = new Map<string, StardanceReferralCodeRow>(
    codes.map((code) => [code.code, code]),
  );
  const referrals = await fetchAllStardanceRsvpReferrals(apiKey);
  await ingestStardanceRsvpReferralRows(buildStardanceReferralRows(referrals, codeByRef));
}

export async function syncAllStardanceRsvpReferrals() {
  const apiKey = optionalEnv("STARDANCE_API_KEY");
  if (apiKey === null) {
    return { processed: 0, insertedOrUpdated: 0 };
  }

  await ensurePosterReferralCodeRows();

  const codes = await sql<StardanceReferralCodeRow[]>`
    SELECT *
    FROM stardance_referral_codes
    WHERE code ~ '^a-[a-z0-9]{5}$'
  `;

  if (codes.length === 0) {
    return { processed: 0, insertedOrUpdated: 0 };
  }

  const codeByRef = new Map<string, StardanceReferralCodeRow>(
    codes.map((code) => [code.code, code]),
  );
  const referrals = await fetchAllStardanceRsvpReferrals(apiKey);
  const rows = buildStardanceReferralRows(referrals, codeByRef);
  await ingestStardanceRsvpReferralRows(rows);
  return { processed: referrals.length, insertedOrUpdated: rows.length };
}

export async function listStardanceReferralsForUser(
  userId: string,
  options: { query?: string | null } = {},
): Promise<StardanceReferral[]> {
  const query = options.query?.trim() ?? "";
  const pattern = query === "" ? null : `%${query.toLowerCase()}%`;
  await ensurePosterNameColumn();

  const rows = await sql<StardanceReferralRow[]>`
    SELECT
      r.id,
      r.user_id,
      r.referral_code_id,
      r.name,
      r.slack_id,
      r.email,
      r.hours_logged::text AS hours_logged,
      r.hours_approved::text AS hours_approved,
      r.verification_status,
      r.referred_at,
      c.label AS referral_code_label,
      (
        p.id IS NOT NULL
        OR c.label ~ '^Poster [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      ) AS is_poster_referral,
      p.id AS poster_id,
      NULLIF(BTRIM(p.name), '') AS poster_name,
      COALESCE(p.referral_code, c.code) AS poster_referral_code
    FROM stardance_referrals r
    JOIN stardance_referral_codes c ON c.id = r.referral_code_id
    LEFT JOIN posters p ON p.user_id = r.user_id AND (
      LOWER(p.referral_code) = LOWER(c.code)
      OR (
        p.referral_code ~ '^a-[a-z0-9]{5}$'
        AND c.code ~ '^[a-z0-9]{5}$'
        AND LOWER(p.referral_code) = 'a-' || LOWER(c.code)
      )
      OR (
        p.referral_code ~ '^[a-z0-9]{5}$'
        AND c.code ~ '^a-[a-z0-9]{5}$'
        AND 'a-' || LOWER(p.referral_code) = LOWER(c.code)
      )
    )
    WHERE r.user_id = ${userId}
      AND (
        ${pattern}::text IS NULL
        OR LOWER(c.label) LIKE ${pattern}
        OR LOWER(NULLIF(BTRIM(p.name), '')) LIKE ${pattern}
        OR LOWER(p.referral_code) LIKE ${pattern}
      )
    ORDER BY r.referred_at DESC, r.id ASC
  `;

  return rows
    .map((row) => ({
      id: row.id,
      kind: row.is_poster_referral ? "poster" as const : "signup" as const,
      name: row.name,
      slackId: row.slack_id,
      email: row.email,
      hoursLogged: Number.parseFloat(row.hours_logged),
      hoursApproved: Number.parseFloat(row.hours_approved),
      verificationStatus: row.verification_status,
      referredAt: row.referred_at.toISOString(),
      referralCodeId: row.referral_code_id,
      referralCodeLabel: row.referral_code_label,
      posterId: row.poster_id,
      posterName: row.poster_name,
      posterReferralCode: row.poster_referral_code,
    }))
    .sort((a, b) => {
      const diff = new Date(b.referredAt).getTime() - new Date(a.referredAt).getTime();
      return diff !== 0 ? diff : a.id.localeCompare(b.id);
    });
}
