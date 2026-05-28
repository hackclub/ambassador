import "server-only";

import sql from "@/lib/database/client";
import { optionalEnv } from "@/lib/env";
import { hasApprovedAmbassadorStatus } from "@/lib/posters/access";
import { ensurePosterNameColumn } from "@/lib/posters/repository";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const CODE_LENGTH = 5;
const CODE_PATTERN = /^a-[a-z0-9]{5}$/;
const STARDANCE_BASE_URL = "https://stardance.hackclub.com";
const DEFAULT_STARDANCE_REFERRAL_LABEL = "Default";
const MAX_STARDANCE_REFERRAL_LABEL_LENGTH = 80;

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

export type StardanceReferralCodeKind = "primary" | "secondary";

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

export function isStardanceReferralCode(value: unknown): value is string {
  return parseStoredStardanceReferralCode(value) !== null;
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

export function buildStardanceReferralUrl(code: string) {
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
          ${DEFAULT_STARDANCE_REFERRAL_LABEL},
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

export async function getOrCreateStardanceReferralCode(userId: string) {
  const defaultCode = await getOrCreateDefaultStardanceReferralCodeRow(userId);
  return defaultCode.code;
}

async function countUsesByCodeId(userId: string) {
  const rows = await sql<{ referral_code_id: string; count: string }[]>`
    SELECT referral_code_id, COUNT(*)::text AS count
    FROM stardance_referrals
    WHERE user_id = ${userId}
    GROUP BY referral_code_id
  `;

  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(row.referral_code_id, Number.parseInt(row.count, 10));
  }
  return map;
}

export async function listStardanceReferralCodesForUser(userId: string) {
  await getOrCreateDefaultStardanceReferralCodeRow(userId);

  const rows = await sql<StardanceReferralCodeRow[]>`
    SELECT *
    FROM stardance_referral_codes
    WHERE user_id = ${userId}
      AND archived_at IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM posters
        WHERE posters.user_id = stardance_referral_codes.user_id
          AND (
            LOWER(posters.referral_code) = LOWER(stardance_referral_codes.code)
            OR (
              posters.referral_code ~ '^a-[a-z0-9]{5}$'
              AND stardance_referral_codes.code ~ '^[a-z0-9]{5}$'
              AND LOWER(posters.referral_code) = 'a-' || LOWER(stardance_referral_codes.code)
            )
            OR (
              posters.referral_code ~ '^[a-z0-9]{5}$'
              AND stardance_referral_codes.code ~ '^a-[a-z0-9]{5}$'
              AND 'a-' || LOWER(posters.referral_code) = LOWER(stardance_referral_codes.code)
            )
          )
      )
      AND stardance_referral_codes.label !~ '^Poster [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ORDER BY
      CASE WHEN kind = 'primary' THEN 0 ELSE 1 END,
      created_at ASC,
      id ASC
  `;

  const uses = await countUsesByCodeId(userId);
  return rows.map((row) => toStardanceReferralCode(row, uses.get(row.id) ?? 0));
}

export async function listArchivedStardanceReferralCodesForUser(userId: string) {
  const rows = await sql<StardanceReferralCodeRow[]>`
    SELECT *
    FROM stardance_referral_codes
    WHERE user_id = ${userId}
      AND archived_at IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM posters
        WHERE posters.user_id = stardance_referral_codes.user_id
          AND (
            LOWER(posters.referral_code) = LOWER(stardance_referral_codes.code)
            OR (
              posters.referral_code ~ '^a-[a-z0-9]{5}$'
              AND stardance_referral_codes.code ~ '^[a-z0-9]{5}$'
              AND LOWER(posters.referral_code) = 'a-' || LOWER(stardance_referral_codes.code)
            )
            OR (
              posters.referral_code ~ '^[a-z0-9]{5}$'
              AND stardance_referral_codes.code ~ '^a-[a-z0-9]{5}$'
              AND 'a-' || LOWER(posters.referral_code) = LOWER(stardance_referral_codes.code)
            )
          )
      )
      AND stardance_referral_codes.label !~ '^Poster [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ORDER BY archived_at DESC, id ASC
  `;

  const uses = await countUsesByCodeId(userId);
  return rows.map((row) => toStardanceReferralCode(row, uses.get(row.id) ?? 0));
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

  const [activeCountRow] = await sql<{ count: string }[]>`
    SELECT COUNT(*)::text AS count
    FROM stardance_referral_codes
    WHERE user_id = ${userId} AND archived_at IS NULL
  `;

  if (activeCountRow !== undefined && Number.parseInt(activeCountRow.count, 10) >= 100) {
    throw new StardanceReferralCodeError(
      "You can have at most 100 active referral codes. Delete one to free up space.",
      400,
    );
  }

  const duplicateLabel = (await sql<{ exists: boolean }[]>`
    SELECT EXISTS(
      SELECT 1
      FROM stardance_referral_codes
      WHERE user_id = ${userId}
        AND id <> ${codeId}
        AND archived_at IS NULL
        AND LOWER(label) = LOWER(${existing.label})
    ) AS exists
  `).at(0);

  if (duplicateLabel?.exists === true) {
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

  const [existing] = await sql<StardanceReferralCodeRow[]>`
    SELECT *
    FROM stardance_referral_codes
    WHERE id = ${codeId} AND user_id = ${userId}
    LIMIT 1
  `;

  if (existing === undefined || existing.archived_at !== null) {
    throw new StardanceReferralCodeError("Referral code not found.", 404);
  }

  const duplicateLabel = (await sql<{ exists: boolean }[]>`
    SELECT EXISTS(
      SELECT 1
      FROM stardance_referral_codes
      WHERE user_id = ${userId}
        AND id <> ${codeId}
        AND archived_at IS NULL
        AND LOWER(label) = LOWER(${label})
    ) AS exists
  `).at(0);

  if (duplicateLabel?.exists === true) {
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

  const [activeCountRow] = await sql<{ count: string }[]>`
    SELECT COUNT(*)::text AS count
    FROM stardance_referral_codes
    WHERE user_id = ${userId} AND archived_at IS NULL
  `;

  if (activeCountRow !== undefined && Number.parseInt(activeCountRow.count, 10) >= 100) {
    throw new StardanceReferralCodeError(
      "You can have at most 100 active referral codes. Delete one to free up space.",
      400,
    );
  }

  const duplicateLabel = (await sql<{ exists: boolean }[]>`
    SELECT EXISTS(
      SELECT 1
      FROM stardance_referral_codes
      WHERE user_id = ${userId}
        AND archived_at IS NULL
        AND LOWER(label) = LOWER(${label})
    ) AS exists
  `).at(0);

  if (duplicateLabel?.exists === true) {
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

type StardanceRsvpReferralPayload = {
  id: string;
  email: string;
  ref: string;
  createdAt: string;
};

type StardanceRsvpReferralRow = {
  id: string;
  user_id: string;
  referral_code_id: string;
  name: string;
  slack_id: string;
  email: string;
  hours_logged: number;
  hours_approved: number;
  verification_status: Extract<StardanceReferralVerificationStatus, "rsvp">;
  referred_at: string;
};

type PosterReferralCodeRow = {
  id: string;
  user_id: string;
  referral_code: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseStardanceRsvpReferral(value: unknown) {
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

  return {
    id: String(id),
    email,
    ref,
    createdAt,
  } satisfies StardanceRsvpReferralPayload;
}

async function fetchStardanceRsvpReferralsForCode(
  code: string,
  apiKey: string,
) {
  const baseUrl = optionalEnv("STARDANCE_API_BASE_URL") ?? STARDANCE_BASE_URL;
  const url = new URL(
    `/api/v1/ambassador_referrals/${encodeURIComponent(code)}`,
    baseUrl,
  );

  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${apiKey}`,
      accept: "application/json",
    },
  });

  if (response.status === 404) return [];

  if (!response.ok) {
    throw new Error(`Stardance RSVP API returned ${response.status}.`);
  }

  const body: unknown = await response.json();
  const referrals = isRecord(body) && Array.isArray(body.referrals)
    ? body.referrals
    : [];

  return referrals
    .map(parseStardanceRsvpReferral)
    .filter((referral): referral is StardanceRsvpReferralPayload => referral !== null);
}

async function fetchAllStardanceRsvpReferrals(apiKey: string) {
  const baseUrl = optionalEnv("STARDANCE_API_BASE_URL") ?? STARDANCE_BASE_URL;
  const url = new URL("/api/v1/ambassador_referrals", baseUrl);

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
  const referrals = isRecord(body) && Array.isArray(body.referrals)
    ? body.referrals
    : [];

  return referrals
    .map(parseStardanceRsvpReferral)
    .filter((referral): referral is StardanceRsvpReferralPayload => referral !== null);
}

async function upsertStardanceRsvpReferralRows(rows: StardanceRsvpReferralRow[]) {
  if (rows.length === 0) return;

  await sql`
    INSERT INTO stardance_referrals ${sql(rows)}
    ON CONFLICT (id) DO UPDATE
    SET
      user_id = EXCLUDED.user_id,
      referral_code_id = EXCLUDED.referral_code_id,
      name = CASE
        WHEN stardance_referrals.verification_status = 'rsvp' THEN EXCLUDED.name
        ELSE stardance_referrals.name
      END,
      slack_id = CASE
        WHEN stardance_referrals.verification_status = 'rsvp' THEN EXCLUDED.slack_id
        ELSE stardance_referrals.slack_id
      END,
      email = CASE
        WHEN stardance_referrals.verification_status = 'rsvp' THEN EXCLUDED.email
        ELSE stardance_referrals.email
      END,
      hours_logged = CASE
        WHEN stardance_referrals.verification_status = 'rsvp' THEN EXCLUDED.hours_logged
        ELSE stardance_referrals.hours_logged
      END,
      hours_approved = CASE
        WHEN stardance_referrals.verification_status = 'rsvp' THEN EXCLUDED.hours_approved
        ELSE stardance_referrals.hours_approved
      END,
      verification_status = CASE
        WHEN stardance_referrals.verification_status = 'rsvp' THEN EXCLUDED.verification_status
        ELSE stardance_referrals.verification_status
      END,
      referred_at = CASE
        WHEN stardance_referrals.verification_status = 'rsvp' THEN EXCLUDED.referred_at
        ELSE stardance_referrals.referred_at
      END
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
    ORDER BY created_at ASC, id ASC
  `;

  if (codes.length === 0) return;

  const rows: StardanceRsvpReferralRow[] = [];

  await Promise.all(codes.map(async (code) => {
    const referrals = await fetchStardanceRsvpReferralsForCode(code.code, apiKey);

    for (const referral of referrals) {
      if (referral.ref !== code.code) continue;

      const email = referral.email.trim().toLowerCase();
      if (email === "") continue;

      rows.push({
        id: `rsvp:${referral.id}`,
        user_id: userId,
        referral_code_id: code.id,
        name: email,
        slack_id: "",
        email,
        hours_logged: 0,
        hours_approved: 0,
        verification_status: "rsvp",
        referred_at: new Date(referral.createdAt).toISOString(),
      });
    }
  }));

  await upsertStardanceRsvpReferralRows(rows);
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
  const rows: StardanceRsvpReferralRow[] = [];

  for (const referral of referrals) {
    const code = codeByRef.get(referral.ref);
    if (code === undefined) continue;

    const email = referral.email.trim().toLowerCase();
    if (email === "") continue;

    rows.push({
      id: `rsvp:${referral.id}`,
      user_id: code.user_id,
      referral_code_id: code.id,
      name: email,
      slack_id: "",
      email,
      hours_logged: 0,
      hours_approved: 0,
      verification_status: "rsvp",
      referred_at: new Date(referral.createdAt).toISOString(),
    });
  }

  await upsertStardanceRsvpReferralRows(rows);
  return { processed: referrals.length, insertedOrUpdated: rows.length };
}

export async function listStardanceReferralsForUser(
  userId: string,
  options: { query?: string | null } = {},
): Promise<StardanceReferral[]> {
  const query = options.query?.trim() ?? "";
  const pattern = query === "" ? null : `%${query.toLowerCase()}%`;
  await ensurePosterNameColumn();

  const rows = pattern === null
    ? await sql<StardanceReferralRow[]>`
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
        ORDER BY r.referred_at DESC, r.id ASC
      `
    : await sql<StardanceReferralRow[]>`
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
            LOWER(c.label) LIKE ${pattern}
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

export async function seedFakeStardanceReferralsForUser(userId: string) {
  if (process.env.NODE_ENV === "production") {
    return;
  }

  await sql`
    UPDATE stardance_referrals
    SET verification_status = 'unverified'
    WHERE user_id = ${userId} AND verification_status = 'rejected'
  `;

  const [existing] = await sql<{ count: string }[]>`
    SELECT COUNT(*)::text AS count
    FROM stardance_referrals
    WHERE user_id = ${userId}
  `;

  if (existing !== undefined && Number.parseInt(existing.count, 10) > 0) {
    return;
  }

  const codes = await sql<StardanceReferralCodeRow[]>`
    SELECT *
    FROM stardance_referral_codes
    WHERE user_id = ${userId} AND archived_at IS NULL
  `;

  if (codes.length === 0) {
    return;
  }

  const sampleNames = [
    "Aria Patel", "Ben Carter", "Cleo Nakamura", "Dani Ortiz", "Eli Becker",
    "Farah Idris", "Gus Lindqvist", "Hana Park", "Iris Vaughn", "Jules Tan",
    "Kai Mendez", "Lior Avraham", "Mira Singh", "Noor Hassan", "Omar Rivers",
    "Pia Conti", "Quinn Hayes", "Rafa Dovado", "Sana Karim", "Theo Walsh",
  ];
  const statuses: StardanceReferralVerificationStatus[] = [
    "unverified", "pending", "verified", "verified",
  ];

  const rowsToInsert = sampleNames.map((name, idx) => {
    const code = codes[idx % codes.length]!;
    const handle = name.toLowerCase().replace(/[^a-z]+/g, "");
    const hoursLogged = Math.round((idx * 1.7 + 3) * 10) / 10;
    const hoursApproved = Math.round(hoursLogged * 0.65 * 10) / 10;
    const daysAgo = idx * 3 + 1;
    return {
      id: crypto.randomUUID(),
      user_id: userId,
      referral_code_id: code.id,
      name,
      slack_id: `U${handle.toUpperCase().slice(0, 8)}`,
      email: `${handle}@example.test`,
      hours_logged: hoursLogged,
      hours_approved: hoursApproved,
      verification_status: statuses[idx % statuses.length]!,
      referred_at: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString(),
    };
  });

  await sql`
    INSERT INTO stardance_referrals ${sql(rowsToInsert)}
  `;
}
