import {
  buildPosterRedirectUrl,
  buildPosterScanUrl,
  formatPosterReferralCode,
  isPosterStyleAvailable,
  normalizeCampaignSlug,
} from "@/lib/posters/config";
import { generateMergedPosterGroupPdf, generatePosterPdf } from "@/lib/posters/pdf";
import {
  createPoster,
  createPosterGroup,
  createPostersForGroup,
  countStardanceReferralsByPosterId,
  countStardanceReferralsForPoster,
  countUserPosterGroups,
  countUserPosters,
  deletePosterById,
  deletePosterGroupById,
  findPosterByPublicScanCode,
  findPosterForUser,
  findPosterGroupForUser,
  findPosterGroupById,
  getGroupPosters,
  getUserPendingPosters,
  listUserPosterGroups,
  listUserPosters,
  movePosterToGroup,
  updatePosterGroupName,
  updatePosterMetadata,
  updatePosterName,
  updatePosterProofAndVerification,
} from "@/lib/posters/repository";
import { findMatchingPoster, readQrCodesFromImageBuffer } from "@/lib/posters/qr";
import { deletePosterProofFile, savePosterProofFile } from "@/lib/posters/storage";
import { PosterRequestError } from "@/lib/posters/http";
import {
  MAX_POSTERS_PER_GROUP,
  MAX_POSTERS_PER_USER,
  parsePosterStyle,
  type CreatePosterGroupInput,
  type CreatePosterInput,
  type PosterGroupCharset,
  type PosterRow,
  type PosterStyle,
  type ScanMatchResult,
  type SubmitPosterProofInput,
  type VerifiedPosterDisplay,
} from "@/lib/posters/types";

const MAX_POSTER_NAME_LENGTH = 80;

function isPosterStyle(value: string | null | undefined): value is PosterStyle {
  return typeof value === "string" && parsePosterStyle(value) !== null;
}

function requireAvailablePosterStyle(campaignSlug: string, value: string | null | undefined) {
  const posterType = isPosterStyle(value) ? value : "color";
  if (!isPosterStyleAvailable(campaignSlug, posterType)) {
    throw new PosterRequestError("That poster style is not available for this campaign.", 400);
  }
  return posterType;
}

function isPosterGroupCharset(value: string | null | undefined): value is PosterGroupCharset {
  return value === "alphanumeric" || value === "numeric" || value === "alpha";
}

function normalizePosterName(value: string | null | undefined) {
  const name = value?.trim() ?? "";
  return name === "" ? null : name.slice(0, MAX_POSTER_NAME_LENGTH);
}

function requirePosterName(value: string | null | undefined, label: string) {
  const name = normalizePosterName(value);
  if (name === null) {
    throw new PosterRequestError(`${label} is required.`, 400);
  }
  return name;
}

function getPosterMetadataObject(poster: PosterRow): Record<string, unknown> {
  const value = poster.metadata as unknown;
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function getPosterName(poster: PosterRow) {
  const name = poster.name?.trim() ?? "";
  return name === "" ? null : name;
}

async function buildVerifiedPosterDisplay(poster: PosterRow): Promise<VerifiedPosterDisplay> {
  let groupName: string | null = null;
  if (poster.poster_group_id !== null) {
    const group = await findPosterGroupById(poster.poster_group_id);
    const trimmed = group?.name?.trim() ?? "";
    groupName = trimmed === "" ? null : trimmed;
  }
  return {
    name: getPosterName(poster),
    referralCode: poster.referral_code,
    groupName,
  };
}

function toClientPoster(poster: PosterRow, scanCount = 0) {
  return {
    ...poster,
    name: getPosterName(poster),
    scanCount,
  };
}

async function persistPosterDecision(input: {
  poster: PosterRow;
  file: File;
  detectedQrCodes: string[];
  verificationStatus: PosterRow["verification_status"];
  locationDescription?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  locationAccuracy?: number | null;
  metadata?: Record<string, unknown>;
}) {
  const stored = await savePosterProofFile(input.poster.id, input.file);

  try {
    return await updatePosterProofAndVerification({
      posterId: input.poster.id,
      proofPath: stored.key,
      proofOriginalName: input.file.name || null,
      proofContentType: input.file.type || null,
      proofSizeBytes: stored.size,
      locationDescription: input.locationDescription,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      locationAccuracy: input.locationAccuracy ?? null,
      detectedQrCodes: input.detectedQrCodes,
      verificationStatus: input.verificationStatus,
      metadata: {
        ...getPosterMetadataObject(input.poster),
        detected_qr_codes: input.detectedQrCodes,
        ...input.metadata,
      },
      submittedAt: true,
      verifiedAt: input.verificationStatus === "success",
    });
  } catch (error) {
    await deletePosterProofFile(stored.key);
    throw error;
  }
}

export async function listPosterDataForUser(userId: string) {
  const [groups, posters, referralCounts] = await Promise.all([
    listUserPosterGroups(userId),
    listUserPosters(userId),
    countStardanceReferralsByPosterId(userId),
  ]);

  const groupedPosters = new Map<string, ReturnType<typeof toClientPoster>[]>();
  const standalonePosters: ReturnType<typeof toClientPoster>[] = [];

  for (const poster of posters) {
    const clientPoster = toClientPoster(poster, referralCounts.get(poster.id) ?? 0);
    if (poster.poster_group_id !== null) {
      const existing = groupedPosters.get(poster.poster_group_id) ?? [];
      existing.push(clientPoster);
      groupedPosters.set(poster.poster_group_id, existing);
    } else {
      standalonePosters.push(clientPoster);
    }
  }

  return {
    groups: groups.map((group) => ({
      ...group,
      posters: groupedPosters.get(group.id) ?? [],
    })),
    standalonePosters,
  };
}

export async function createSinglePosterForUser(
  input: Omit<CreatePosterInput, "userId" | "campaignSlug" | "posterType" | "charset"> & {
    userId: string;
    campaignSlug?: string | null;
    posterType?: string | null;
    charset?: string | null;
    name?: string | null;
  },
) {
  const campaignSlug = normalizeCampaignSlug(input.campaignSlug);
  const posterType = requireAvailablePosterStyle(campaignSlug, input.posterType);
  const charset = isPosterGroupCharset(input.charset) ? input.charset : "alphanumeric";
  const name = normalizePosterName(input.name);
  const existingCount = await countUserPosters(input.userId);
  if (existingCount >= MAX_POSTERS_PER_USER) {
    throw new PosterRequestError(`You can have at most ${MAX_POSTERS_PER_USER} posters.`, 400);
  }

  return createPoster({
    userId: input.userId,
    campaignSlug,
    posterType,
    charset,
    posterGroupId: null,
    name,
  });
}

export async function createPosterGroupForUser(
  input: Omit<
    CreatePosterGroupInput,
    "userId" | "campaignSlug" | "posterType" | "charset"
  > & {
    userId: string;
    campaignSlug?: string | null;
    posterType?: string | null;
    charset?: string | null;
  },
) {
  const [existingPosterCount, existingGroupCount] = await Promise.all([
    countUserPosters(input.userId),
    countUserPosterGroups(input.userId),
  ]);
  if (existingGroupCount >= 300) {
    throw new PosterRequestError("You can have at most 300 poster groups.", 400);
  }
  const remaining = MAX_POSTERS_PER_USER - existingPosterCount;
  if (input.count > 0 && remaining <= 0) {
    throw new PosterRequestError(`You can have at most ${MAX_POSTERS_PER_USER} posters.`, 400);
  }
  const count = Math.min(Math.max(input.count, 0), MAX_POSTERS_PER_GROUP, Math.max(remaining, 0));
  const campaignSlug = normalizeCampaignSlug(input.campaignSlug);
  const posterType = requireAvailablePosterStyle(campaignSlug, input.posterType);
  const charset = isPosterGroupCharset(input.charset) ? input.charset : "alphanumeric";
  const name = requirePosterName(input.name, "Poster group name");

  return createPosterGroup({
    userId: input.userId,
    campaignSlug,
    count,
    name,
    charset,
    posterType,
  });
}

export async function getPosterForUserOrThrow(userId: string, posterId: string) {
  const poster = await findPosterForUser(userId, posterId);
  if (!poster) {
    throw new PosterRequestError("Poster not found.", 404);
  }
  return poster;
}

export async function getPosterGroupForUserOrThrow(userId: string, groupId: string) {
  const group = await findPosterGroupForUser(userId, groupId);
  if (!group) {
    throw new PosterRequestError("Poster group not found.", 404);
  }
  const posters = await getGroupPosters(group.id);
  return { group, posters };
}

export async function addPostersToGroupForUser(input: {
  userId: string;
  groupId: string;
  count: number;
}) {
  const { group, posters } = await getPosterGroupForUserOrThrow(input.userId, input.groupId);
  const count = Math.max(1, Math.floor(input.count));
  const [userPosterCount] = await Promise.all([countUserPosters(input.userId)]);
  const remaining = Math.min(
    MAX_POSTERS_PER_GROUP - posters.length,
    MAX_POSTERS_PER_USER - userPosterCount,
  );
  if (remaining <= 0) {
    throw new PosterRequestError(`Poster groups can have at most ${MAX_POSTERS_PER_GROUP} posters.`, 400);
  }
  if (count > remaining) {
    throw new PosterRequestError(`You can add at most ${remaining} more poster${remaining === 1 ? "" : "s"} to this group.`, 400);
  }

  return createPostersForGroup({
    userId: input.userId,
    group,
    count,
    posterType: posters[0]?.poster_type ?? "color",
  });
}

export async function renamePosterForUser(
  userId: string,
  posterId: string,
  name: string | null,
) {
  const poster = await getPosterForUserOrThrow(userId, posterId);
  const normalized = normalizePosterName(name);
  const updated = await updatePosterName(poster.id, normalized);
  return { poster: toClientPoster(updated) };
}

export async function movePosterForUser(input: {
  userId: string;
  posterId: string;
  groupId: string | null;
}) {
  const poster = await getPosterForUserOrThrow(input.userId, input.posterId);

  if (input.groupId !== null) {
    const { group, posters } = await getPosterGroupForUserOrThrow(input.userId, input.groupId);
    if (poster.poster_group_id !== group.id) {
      if (posters.length >= MAX_POSTERS_PER_GROUP) {
        throw new PosterRequestError(
          `Poster groups can have at most ${MAX_POSTERS_PER_GROUP} posters.`,
          400,
        );
      }
    }
  }

  const updated = await movePosterToGroup(poster.id, input.groupId);
  if (!updated) {
    throw new PosterRequestError("Poster not found.", 404);
  }
  return { poster: toClientPoster(updated) };
}

export async function renamePosterGroupForUser(
  userId: string,
  groupId: string,
  name: string | null,
) {
  const { group } = await getPosterGroupForUserOrThrow(userId, groupId);
  const normalized = normalizePosterName(name);
  const updated = await updatePosterGroupName(group.id, normalized);
  return { group: updated };
}

export async function deletePosterForUser(userId: string, posterId: string) {
  const poster = await getPosterForUserOrThrow(userId, posterId);
  if (poster.verification_status === "success") {
    throw new PosterRequestError("Accepted posters cannot be deleted.", 400);
  }
  if ((await countStardanceReferralsForPoster(poster)) > 0) {
    throw new PosterRequestError("Posters with referrals cannot be deleted.", 400);
  }

  await deletePosterById(poster.id);
  return { poster };
}

export async function deletePosterGroupForUser(userId: string, groupId: string) {
  const { group, posters } = await getPosterGroupForUserOrThrow(userId, groupId);
  if (posters.some((poster) => poster.verification_status === "success")) {
    throw new PosterRequestError("Poster groups with accepted posters cannot be deleted.", 400);
  }
  const referralCounts = await Promise.all(
    posters.map((poster) => countStardanceReferralsForPoster(poster)),
  );
  if (referralCounts.some((count) => count > 0)) {
    throw new PosterRequestError("Poster groups with referrals cannot be deleted.", 400);
  }

  await deletePosterGroupById(group.id);
  return { group, posters };
}

export async function getPosterPdfForUser(userId: string, posterId: string) {
  const poster = await getPosterForUserOrThrow(userId, posterId);
  return {
    poster,
    pdf: await generatePosterPdf({
      campaignSlug: poster.campaign_slug,
      style: poster.poster_type,
      content: buildPosterScanUrl(poster.referral_code),
      referralCode: poster.referral_code,
    }),
  };
}

export async function getPosterGroupPdfForUser(userId: string, groupId: string) {
  const { group, posters } = await getPosterGroupForUserOrThrow(userId, groupId);
  return {
    group,
    posters,
    pdf: await generateMergedPosterGroupPdf(posters),
  };
}

async function generatePosterZip(posters: PosterRow[]) {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  await Promise.all(
    posters.map(async (poster) => {
      const bytes = await generatePosterPdf({
        campaignSlug: poster.campaign_slug,
        style: poster.poster_type,
        content: buildPosterScanUrl(poster.referral_code),
        referralCode: poster.referral_code,
      });
      const safe = formatPosterReferralCode(poster.referral_code).replace(/[^a-zA-Z0-9_-]/g, "");
      zip.file(`poster-${safe}.pdf`, bytes);
    }),
  );
  return zip.generateAsync({ type: "arraybuffer" });
}

export async function getPosterGroupZipForUser(userId: string, groupId: string) {
  const { group, posters } = await getPosterGroupForUserOrThrow(userId, groupId);
  return {
    group,
    posters,
    zip: await generatePosterZip(posters),
  };
}

export async function getBulkPosterPdfForUser(userId: string) {
  const { groups, standalonePosters } = await listPosterDataForUser(userId);
  const allPosters = [
    ...standalonePosters,
    ...groups.flatMap((g) => g.posters),
  ];
  return {
    pdf: await generateMergedPosterGroupPdf(allPosters),
    count: allPosters.length,
  };
}

export async function getBulkPosterZipForUser(userId: string) {
  const { groups, standalonePosters } = await listPosterDataForUser(userId);
  const allPosters = [
    ...standalonePosters,
    ...groups.flatMap((g) => g.posters),
  ];
  return {
    zip: await generatePosterZip(allPosters),
    count: allPosters.length,
  };
}

export async function submitPosterProof(input: SubmitPosterProofInput): Promise<ScanMatchResult> {
  const poster = await getPosterForUserOrThrow(input.userId, input.posterId);

  if (!Number.isFinite(input.latitude) || !Number.isFinite(input.longitude)) {
    throw new PosterRequestError("Precise location is required to submit proof.", 400);
  }

  const detectedQrCodes = await readQrCodesFromImageBuffer(
    Buffer.from(await input.file.arrayBuffer()),
  );

  const currentPosterMatches = findMatchingPoster(detectedQrCodes, [poster]);

  if (poster.verification_status === "success") {
    return {
      status: "already_verified",
      detectedQrCodes,
      poster,
      verifiedPoster: await buildVerifiedPosterDisplay(poster),
      message: "This poster is already approved.",
    };
  }

  if (currentPosterMatches) {
    const approvedPoster = await persistPosterDecision({
      poster,
      file: input.file,
      detectedQrCodes,
      verificationStatus: "success",
      locationDescription: input.locationDescription,
      latitude: input.latitude,
      longitude: input.longitude,
      locationAccuracy: input.locationAccuracy ?? null,
      metadata: {
        auto_verified: true,
        expected_url: buildPosterScanUrl(poster.referral_code),
      },
    });

    return {
      status: "success",
      detectedQrCodes,
      poster: approvedPoster,
      verifiedPoster: await buildVerifiedPosterDisplay(approvedPoster),
      message: "Poster verified automatically.",
    };
  }

  const userPendingPosters = await getUserPendingPosters(input.userId, poster.campaign_slug, poster.id);
  const matchedPoster = findMatchingPoster(detectedQrCodes, userPendingPosters);

  if (matchedPoster) {
    const approvedPoster = await persistPosterDecision({
      poster: matchedPoster,
      file: input.file,
      detectedQrCodes,
      verificationStatus: "success",
      locationDescription: input.locationDescription,
      latitude: input.latitude,
      longitude: input.longitude,
      locationAccuracy: input.locationAccuracy ?? null,
      metadata: {
        auto_verified: true,
        auto_matched_from_poster_id: poster.id,
        expected_url: buildPosterScanUrl(matchedPoster.referral_code),
      },
    });

    await updatePosterMetadata(poster.id, {
      ...getPosterMetadataObject(poster),
      proof_transferred_to_poster_id: matchedPoster.id,
      auto_match_transfer_at: new Date().toISOString(),
      detected_qr_codes: detectedQrCodes,
    });

    return {
      status: "auto_matched",
      detectedQrCodes,
      poster,
      matchedPoster: approvedPoster,
      verifiedPoster: await buildVerifiedPosterDisplay(approvedPoster),
      message: "Matched this upload to one of your other posters and approved it.",
    };
  }

  const reviewPoster = await persistPosterDecision({
    poster,
    file: input.file,
    detectedQrCodes,
    verificationStatus: "in_review",
    locationDescription: input.locationDescription,
    latitude: input.latitude,
    longitude: input.longitude,
    locationAccuracy: input.locationAccuracy ?? null,
    metadata: {
      auto_verification_result: detectedQrCodes.length === 0 ? "qr_not_found" : "no_match",
      expected_url: buildPosterScanUrl(poster.referral_code),
    },
  });

  return {
    status: "in_review",
    detectedQrCodes,
    poster: reviewPoster,
    message:
      detectedQrCodes.length === 0
        ? "No QR code was detected, so this proof was sent to review."
        : "QR detected, but it did not match your pending posters. Sent to review.",
  };
}

export async function scanAnyUserPoster(input: {
  userId: string;
  file: File;
  locationDescription?: string | null;
  latitude: number;
  longitude: number;
  locationAccuracy?: number | null;
}): Promise<ScanMatchResult> {
  const posters = await getUserPendingPosters(input.userId);
  const detectedQrCodes = await readQrCodesFromImageBuffer(
    Buffer.from(await input.file.arrayBuffer()),
  );

  if (detectedQrCodes.length === 0) {
    return {
      status: "no_qr",
      detectedQrCodes,
      message: "No valid QR code detected in the image.",
    };
  }

  const matchedPoster = findMatchingPoster(detectedQrCodes, posters);
  if (!matchedPoster) {
    return {
      status: "no_match",
      detectedQrCodes,
      message: "QR detected, but it does not match any of your pending posters.",
    };
  }

  return submitPosterProof({
    userId: input.userId,
    posterId: matchedPoster.id,
    file: input.file,
    locationDescription: input.locationDescription,
    latitude: input.latitude,
    longitude: input.longitude,
    locationAccuracy: input.locationAccuracy ?? null,
  });
}

export async function resolvePublicPosterScan(code: string) {
  const poster = await findPosterByPublicScanCode(code);
  if (!poster) {
    return null;
  }

  return {
    poster,
    redirectUrl: buildPosterRedirectUrl(poster.referral_code, poster.campaign_slug),
  };
}
