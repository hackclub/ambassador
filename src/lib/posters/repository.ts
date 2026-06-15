import sql from "@/lib/database/client";
import { normalizePosterReferralCode } from "@/lib/posters/config";
import type {
  CreatePosterGroupInput,
  CreatePosterInput,
  PosterGroupRow,
  PosterMetadata,
  PosterRow,
  PosterVerificationStatus,
} from "@/lib/posters/types";

let ensurePosterNameColumnPromise: Promise<void> | null = null;

export function ensurePosterNameColumn() {
  ensurePosterNameColumnPromise ??= (async () => {
    await sql`
      ALTER TABLE posters
      ADD COLUMN IF NOT EXISTS name TEXT
    `;

    await sql`
      UPDATE posters
      SET name = LEFT(NULLIF(BTRIM(metadata->>'name'), ''), 80)
      WHERE name IS NULL
        AND jsonb_typeof(metadata->'name') = 'string'
    `;

    await sql`
      UPDATE posters
      SET name = NULL
      WHERE name IS NOT NULL
        AND BTRIM(name) = ''
    `;
  })().catch((error) => {
    ensurePosterNameColumnPromise = null;
    throw error;
  });

  return ensurePosterNameColumnPromise;
}

async function referralCodeExists(candidate: string) {
  const row = (await sql<{ exists: boolean }[]>`
    SELECT EXISTS(
      SELECT 1 FROM posters WHERE LOWER(referral_code) = ${candidate}
      UNION ALL
      SELECT 1 FROM referral_links WHERE LOWER(code) = ${candidate}
      UNION ALL
      SELECT 1 FROM stardance_referral_codes WHERE LOWER(code) = ${candidate}
      UNION ALL
      SELECT 1 FROM users WHERE LOWER(stardance_referral_code) = ${candidate}
    ) AS exists
  `).at(0);

  return row?.exists === true;
}

async function qrTokenExists(candidate: string) {
  const row = (await sql<{ exists: boolean }[]>`
    SELECT EXISTS(
      SELECT 1 FROM posters WHERE qr_code_token = ${candidate}
    ) AS exists
  `).at(0);

  return row?.exists === true;
}

function randomFromCharset(charset: string, length: number) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte) => charset[byte % charset.length]).join("");
}

async function generateUniqueReferralCode() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = `a-${randomFromCharset("abcdefghijklmnopqrstuvwxyz0123456789", 5)}`;
    if (!(await referralCodeExists(candidate))) {
      return candidate;
    }
  }

  throw new Error("Failed to generate a unique referral code.");
}

async function generateUniqueQrToken() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = crypto.randomUUID().replace(/-/g, "");
    if (!(await qrTokenExists(candidate))) {
      return candidate;
    }
  }

  throw new Error("Failed to generate a unique QR token.");
}

export async function createPoster(input: CreatePosterInput) {
  await ensurePosterNameColumn();

  const posterType = input.posterType ?? "color";
  const id = crypto.randomUUID();
  const [referralCode, qrCodeToken] = await Promise.all([
    generateUniqueReferralCode(),
    generateUniqueQrToken(),
  ]);

  const [poster] = await sql<PosterRow[]>`
    INSERT INTO posters (
      id,
      user_id,
      poster_group_id,
      campaign_slug,
      name,
      qr_code_token,
      referral_code,
      poster_type,
      verification_status,
      metadata
    )
    VALUES (
      ${id},
      ${input.userId},
      ${input.posterGroupId ?? null},
      ${input.campaignSlug},
      ${input.name ?? null},
      ${qrCodeToken},
      ${referralCode},
      ${posterType},
      'pending',
      CAST(${JSON.stringify(input.metadata ?? {})} AS JSONB)
    )
    RETURNING *
  `;

  return poster;
}

export async function createPosterGroup(input: CreatePosterGroupInput) {
  return sql.begin(async (tx) => {
    const id = crypto.randomUUID();
    const charset = input.charset ?? "alphanumeric";
    const posterType = input.posterType ?? "color";

    const [group] = await tx<PosterGroupRow[]>`
      INSERT INTO poster_groups (
        id,
        user_id,
        campaign_slug,
        name,
        charset,
        metadata
      )
      VALUES (
        ${id},
        ${input.userId},
        ${input.campaignSlug},
        ${input.name ?? null},
        ${charset},
        CAST(${JSON.stringify({})} AS JSONB)
      )
      RETURNING *
    `;

    const posters: PosterRow[] = [];
    for (let index = 0; index < input.count; index += 1) {
      const posterId = crypto.randomUUID();
      const [referralCode, qrCodeToken] = await Promise.all([
        generateUniqueReferralCode(),
        generateUniqueQrToken(),
      ]);
      const [poster] = await tx<PosterRow[]>`
        INSERT INTO posters (
          id,
          user_id,
          poster_group_id,
          campaign_slug,
          qr_code_token,
          referral_code,
          poster_type,
          verification_status
        )
        VALUES (
          ${posterId},
          ${input.userId},
          ${group.id},
          ${input.campaignSlug},
          ${qrCodeToken},
          ${referralCode},
          ${posterType},
          'pending'
        )
        RETURNING *
      `;
      posters.push(poster);
    }

    const [updatedGroup] = await tx<PosterGroupRow[]>`
      UPDATE poster_groups
      SET poster_count = ${posters.length}, updated_at = NOW()
      WHERE id = ${group.id}
      RETURNING *
    `;

    return { group: updatedGroup, posters };
  });
}

export async function createPostersForGroup(input: {
  userId: string;
  group: PosterGroupRow;
  count: number;
  posterType: PosterRow["poster_type"];
}) {
  return sql.begin(async (tx) => {
    const posters: PosterRow[] = [];
    for (let index = 0; index < input.count; index += 1) {
      const [qrCodeToken, referralCode] = await Promise.all([
        generateUniqueQrToken(),
        generateUniqueReferralCode(),
      ]);
      const [poster] = await tx<PosterRow[]>`
        INSERT INTO posters (
          id,
          user_id,
          poster_group_id,
          campaign_slug,
          qr_code_token,
          referral_code,
          poster_type,
          verification_status
        )
        VALUES (
          ${crypto.randomUUID()},
          ${input.userId},
          ${input.group.id},
          ${input.group.campaign_slug},
          ${qrCodeToken},
          ${referralCode},
          ${input.posterType},
          'pending'
        )
        RETURNING *
      `;
      if (poster !== undefined) {
        posters.push(poster);
      }
    }

    const [updatedGroup] = await tx<PosterGroupRow[]>`
      UPDATE poster_groups
      SET poster_count = poster_count + ${posters.length}, updated_at = NOW()
      WHERE id = ${input.group.id} AND user_id = ${input.userId}
      RETURNING *
    `;

    return { group: updatedGroup ?? input.group, posters };
  });
}

export async function deletePosterById(posterId: string) {
  await sql`
    WITH deleted AS (
      UPDATE posters
      SET deleted_at = NOW(), updated_at = NOW()
      WHERE id = ${posterId} AND deleted_at IS NULL
      RETURNING poster_group_id
    )
    UPDATE poster_groups
    SET poster_count = GREATEST(poster_count - 1, 0), updated_at = NOW()
    WHERE id IN (
      SELECT poster_group_id
      FROM deleted
      WHERE poster_group_id IS NOT NULL
    )
  `;
}

export async function restoreDeletedPoster(posterId: string) {
  return sql.begin(async (tx) => {
    const [poster] = await tx<PosterRow[]>`
      UPDATE posters
      SET deleted_at = NULL, updated_at = NOW()
      WHERE id = ${posterId} AND deleted_at IS NOT NULL
      RETURNING *
    `;
    if (!poster) {
      return null;
    }
    if (poster.poster_group_id !== null) {
      await tx`
        UPDATE poster_groups
        SET poster_count = poster_count + 1, updated_at = NOW()
        WHERE id = ${poster.poster_group_id}
      `;
    }
    return poster;
  });
}

// Rebuilds a hard-deleted poster from audit metadata; proof/location/geo aren't recoverable.
export async function recreateDeletedPoster(input: {
  id: string;
  userId: string;
  campaignSlug: string;
  referralCode: string;
  posterType: string;
  verificationStatus: string;
  name: string | null;
  posterGroupId: string | null;
}): Promise<
  | { status: "recreated"; poster: PosterRow }
  | { status: "exists" }
  | { status: "code_taken" }
  | { status: "user_missing" }
> {
  const qrCodeToken = await generateUniqueQrToken();
  return sql.begin(async (tx) => {
    const [existing] = await tx`SELECT 1 FROM posters WHERE id = ${input.id} LIMIT 1`;
    if (existing) return { status: "exists" };

    const [codeOwner] = await tx`
      SELECT 1 FROM posters WHERE LOWER(referral_code) = LOWER(${input.referralCode}) LIMIT 1
    `;
    if (codeOwner) return { status: "code_taken" };

    const [owner] = await tx`SELECT 1 FROM users WHERE id = ${input.userId} LIMIT 1`;
    if (!owner) return { status: "user_missing" };

    let groupId: string | null = null;
    if (input.posterGroupId !== null) {
      const [group] = await tx<{ id: string }[]>`
        SELECT id FROM poster_groups WHERE id = ${input.posterGroupId} AND user_id = ${input.userId} LIMIT 1
      `;
      groupId = group ? group.id : null;
    }

    const [poster] = await tx<PosterRow[]>`
      INSERT INTO posters (
        id, user_id, poster_group_id, campaign_slug, name,
        qr_code_token, referral_code, poster_type, verification_status, metadata
      )
      VALUES (
        ${input.id}, ${input.userId}, ${groupId}, ${input.campaignSlug}, ${input.name},
        ${qrCodeToken}, ${input.referralCode}, ${input.posterType}, ${input.verificationStatus}, '{}'::jsonb
      )
      RETURNING *
    `;

    if (groupId !== null) {
      await tx`
        UPDATE poster_groups
        SET poster_count = poster_count + 1, updated_at = NOW()
        WHERE id = ${groupId}
      `;
    }

    return { status: "recreated", poster };
  });
}

export async function deletePosterGroupById(groupId: string) {
  await sql.begin(async (tx) => {
    await tx`
      UPDATE posters
      SET deleted_at = NOW(), updated_at = NOW()
      WHERE poster_group_id = ${groupId} AND deleted_at IS NULL
    `;
    await tx`
      DELETE FROM poster_groups
      WHERE id = ${groupId}
    `;
  });
}

export async function listUserPosterGroups(userId: string) {
  return sql<PosterGroupRow[]>`
    SELECT *
    FROM poster_groups
    WHERE user_id = ${userId}
    ORDER BY created_at DESC, id DESC
  `;
}

export async function listUserPostersWithReferralCounts(userId: string) {
  const rows = await sql<(PosterRow & { stardance_referral_count: string })[]>`
    SELECT p.*, COUNT(r.id)::text AS stardance_referral_count
    FROM posters p
    LEFT JOIN stardance_referral_codes c
      ON c.user_id = p.user_id
      AND (
        LOWER(c.code) = LOWER(p.referral_code)
        OR (
          c.code ~ '^[a-z0-9]{5}$'
          AND p.referral_code ~ '^a-[a-z0-9]{5}$'
          AND 'a-' || LOWER(c.code) = LOWER(p.referral_code)
        )
      )
    LEFT JOIN stardance_referrals r ON r.referral_code_id = c.id
    WHERE p.user_id = ${userId}
      AND p.deleted_at IS NULL
    GROUP BY p.id
    ORDER BY p.created_at DESC, p.id DESC
  `;

  return rows.map(({ stardance_referral_count: stardanceReferralCount, ...poster }) => ({
    poster,
    referralCount: Number.parseInt(stardanceReferralCount, 10),
  }));
}

export async function countStardanceReferralsForPosterIds(userId: string, posterIds: string[]) {
  if (posterIds.length === 0) {
    return new Map<string, number>();
  }

  const rows = await sql<{ poster_id: string; count: string }[]>`
    SELECT p.id AS poster_id, COUNT(r.id)::text AS count
    FROM posters p
    LEFT JOIN stardance_referral_codes c
      ON c.user_id = p.user_id
      AND (
        LOWER(c.code) = LOWER(p.referral_code)
        OR (
          c.code ~ '^[a-z0-9]{5}$'
          AND p.referral_code ~ '^a-[a-z0-9]{5}$'
          AND 'a-' || LOWER(c.code) = LOWER(p.referral_code)
        )
      )
    LEFT JOIN stardance_referrals r ON r.referral_code_id = c.id
    WHERE p.user_id = ${userId}
      AND p.id = ANY(${posterIds})
      AND p.deleted_at IS NULL
    GROUP BY p.id
  `;

  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.poster_id, Number.parseInt(row.count, 10));
  }
  return counts;
}

export async function countStardanceReferralsForPoster(poster: PosterRow) {
  const row = (await sql<{ count: string }[]>`
    SELECT COUNT(r.id)::text AS count
    FROM stardance_referral_codes c
    JOIN stardance_referrals r ON r.referral_code_id = c.id
    WHERE c.user_id = ${poster.user_id}
      AND (
        LOWER(c.code) = LOWER(${poster.referral_code})
        OR (
          c.code ~ '^[a-z0-9]{5}$'
          AND ${poster.referral_code} ~ '^a-[a-z0-9]{5}$'
          AND 'a-' || LOWER(c.code) = LOWER(${poster.referral_code})
        )
      )
  `).at(0);

  return Number.parseInt(row?.count ?? "0", 10);
}

export async function countUserPosters(userId: string) {
  const row = (await sql<{ count: string }[]>`
    SELECT COUNT(*)::text AS count
    FROM posters
    WHERE user_id = ${userId} AND deleted_at IS NULL
  `).at(0);

  return Number.parseInt(row?.count ?? "0", 10);
}

export async function countUserPosterUsage(userId: string) {
  const row = (await sql<{ poster_count: string; group_count: string }[]>`
    SELECT
      (SELECT COUNT(*)::text FROM posters WHERE user_id = ${userId} AND deleted_at IS NULL) AS poster_count,
      (SELECT COUNT(*)::text FROM poster_groups WHERE user_id = ${userId}) AS group_count
  `).at(0);

  return {
    posterCount: Number.parseInt(row?.poster_count ?? "0", 10),
    groupCount: Number.parseInt(row?.group_count ?? "0", 10),
  };
}

export async function findPosterForUser(userId: string, posterId: string) {
  const poster = (await sql<PosterRow[]>`
    SELECT *
    FROM posters
    WHERE id = ${posterId} AND user_id = ${userId} AND deleted_at IS NULL
    LIMIT 1
  `).at(0);

  return poster ?? null;
}

export async function findPosterGroupForUser(userId: string, groupId: string) {
  const group = (await sql<PosterGroupRow[]>`
    SELECT *
    FROM poster_groups
    WHERE id = ${groupId} AND user_id = ${userId}
    LIMIT 1
  `).at(0);

  return group ?? null;
}

export async function findPosterGroupById(groupId: string) {
  const group = (await sql<PosterGroupRow[]>`
    SELECT *
    FROM poster_groups
    WHERE id = ${groupId}
    LIMIT 1
  `).at(0);

  return group ?? null;
}

async function findPosterByReferralCode(referralCode: string) {
  const normalizedCode = normalizePosterReferralCode(referralCode);
  const poster = (await sql<PosterRow[]>`
    SELECT *
    FROM posters
    WHERE LOWER(referral_code) = LOWER(${normalizedCode}) AND deleted_at IS NULL
    LIMIT 1
  `).at(0);

  return poster ?? null;
}

export async function findPosterByPublicScanCode(scanCode: string) {
  const trimmed = scanCode.trim();

  if (/^[a-f0-9]{32}$/i.test(trimmed)) {
    const poster = (await sql<PosterRow[]>`
      SELECT *
      FROM posters
      WHERE qr_code_token = ${trimmed.toLowerCase()} AND deleted_at IS NULL
      LIMIT 1
    `).at(0);

    return poster ?? null;
  }

  if (/^(?:a[!-]?[a-z0-9]{5}|[a-z0-9]{5}|AMB-[A-Z1-9]{8})$/i.test(trimmed)) {
    return findPosterByReferralCode(trimmed);
  }

  return null;
}

export async function getGroupPosters(groupId: string) {
  return sql<PosterRow[]>`
    SELECT *
    FROM posters
    WHERE poster_group_id = ${groupId} AND deleted_at IS NULL
    ORDER BY created_at ASC, id ASC
  `;
}

export async function getUserPendingPosters(userId: string, campaignSlug?: string, excludeId?: string) {
  return sql<PosterRow[]>`
    SELECT *
    FROM posters
    WHERE user_id = ${userId}
      AND deleted_at IS NULL
      AND verification_status = 'pending'
      ${campaignSlug !== undefined && campaignSlug !== "" ? sql`AND campaign_slug = ${campaignSlug}` : sql``}
      ${excludeId !== undefined && excludeId !== "" ? sql`AND id != ${excludeId}` : sql``}
    ORDER BY created_at ASC
  `;
}

export async function updatePosterProofAndVerification(input: {
  posterId: string;
  proofPath: string;
  proofOriginalName: string | null;
  proofContentType: string | null;
  proofSizeBytes: number;
  locationDescription?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  locationAccuracy?: number | null;
  detectedQrCodes: string[];
  verificationStatus: PosterVerificationStatus;
  metadata?: PosterMetadata;
  submittedAt?: boolean;
  verifiedAt?: boolean;
}) {
  const [poster] = await sql<PosterRow[]>`
    UPDATE posters
    SET
      proof_path = ${input.proofPath},
      proof_original_name = ${input.proofOriginalName},
      proof_content_type = ${input.proofContentType},
      proof_size_bytes = ${input.proofSizeBytes},
      location_description = COALESCE(${input.locationDescription ?? null}, location_description),
      latitude = COALESCE(${input.latitude ?? null}, latitude),
      longitude = COALESCE(${input.longitude ?? null}, longitude),
      location_accuracy = COALESCE(${input.locationAccuracy ?? null}, location_accuracy),
      detected_qr_codes = CAST(${JSON.stringify(input.detectedQrCodes)} AS JSONB),
      metadata = CAST(${JSON.stringify(input.metadata ?? {})} AS JSONB),
      verification_status = ${input.verificationStatus},
      submitted_at = CASE
        WHEN ${input.submittedAt ?? false} THEN NOW()
        ELSE submitted_at
      END,
      verified_at = CASE
        WHEN ${input.verifiedAt ?? false} THEN NOW()
        ELSE verified_at
      END,
      updated_at = NOW()
    WHERE id = ${input.posterId}
    RETURNING *
  `;

  return poster;
}

export async function updatePosterGeo(
  posterId: string,
  geo: { country_code: string | null; country_name: string | null; state: string | null },
) {
  await sql`
    UPDATE posters
    SET geo_country_code = ${geo.country_code},
        geo_country_name = ${geo.country_name},
        geo_state = ${geo.state}
    WHERE id = ${posterId}
  `;
}

export async function updatePosterMetadata(posterId: string, metadata: PosterMetadata) {
  const [poster] = await sql<PosterRow[]>`
    UPDATE posters
    SET metadata = CAST(${JSON.stringify(metadata)} AS JSONB), updated_at = NOW()
    WHERE id = ${posterId}
    RETURNING *
  `;

  return poster;
}

export async function updatePosterName(posterId: string, name: string | null) {
  await ensurePosterNameColumn();

  const [poster] = await sql<PosterRow[]>`
    UPDATE posters
    SET
      name = ${name},
      updated_at = NOW()
    WHERE id = ${posterId}
    RETURNING *
  `;

  return poster;
}

export async function movePosterToGroup(
  posterId: string,
  nextGroupId: string | null,
) {
  return sql.begin(async (tx) => {
    const [current] = await tx<{ poster_group_id: string | null }[]>`
      SELECT poster_group_id
      FROM posters
      WHERE id = ${posterId}
      FOR UPDATE
    `;
    if (!current) {
      return null;
    }

    const previousGroupId = current.poster_group_id;
    if (previousGroupId === nextGroupId) {
      const [unchanged] = await tx<PosterRow[]>`
        SELECT * FROM posters WHERE id = ${posterId}
      `;
      return unchanged ?? null;
    }

    const [poster] = await tx<PosterRow[]>`
      UPDATE posters
      SET poster_group_id = ${nextGroupId}, updated_at = NOW()
      WHERE id = ${posterId}
      RETURNING *
    `;

    if (previousGroupId !== null) {
      await tx`
        UPDATE poster_groups
        SET poster_count = GREATEST(poster_count - 1, 0), updated_at = NOW()
        WHERE id = ${previousGroupId}
      `;
    }
    if (nextGroupId !== null) {
      await tx`
        UPDATE poster_groups
        SET poster_count = poster_count + 1, updated_at = NOW()
        WHERE id = ${nextGroupId}
      `;
    }

    return poster ?? null;
  });
}

export async function moveGroupPosters(sourceGroupId: string, targetGroupId: string | null) {
  return sql.begin(async (tx) => {
    const [{ count }] = await tx<{ count: string }[]>`
      SELECT COUNT(*)::text AS count
      FROM posters
      WHERE poster_group_id = ${sourceGroupId} AND deleted_at IS NULL
    `;
    const moved = Number.parseInt(count ?? "0", 10);

    if (moved > 0) {
      await tx`
        UPDATE posters
        SET poster_group_id = ${targetGroupId}, updated_at = NOW()
        WHERE poster_group_id = ${sourceGroupId} AND deleted_at IS NULL
      `;
      if (targetGroupId !== null) {
        await tx`
          UPDATE poster_groups
          SET poster_count = poster_count + ${moved}, updated_at = NOW()
          WHERE id = ${targetGroupId}
        `;
      }
    }

    await tx`
      DELETE FROM poster_groups
      WHERE id = ${sourceGroupId}
    `;

    return moved;
  });
}

export async function updatePosterGroupName(groupId: string, name: string | null) {
  const [group] = await sql<PosterGroupRow[]>`
    UPDATE poster_groups
    SET name = ${name}, updated_at = NOW()
    WHERE id = ${groupId}
    RETURNING *
  `;

  return group;
}
