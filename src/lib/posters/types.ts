export const POSTER_STYLES = ["color", "bw", "printer_efficient", "a4", "a4_bw"] as const;
const POSTER_REGION_CODE_PATTERN = /^[a-z]{2,8}$/;
export const MAX_POSTERS_PER_GROUP = 250;
export const MAX_POSTERS_PER_USER = 31250;
export const MAX_GROUPS_PER_USER = 625;

export type PosterStyleBase = (typeof POSTER_STYLES)[number];
export type PosterStyle = PosterStyleBase | `${PosterStyleBase}:${string}`;
export type PosterVerificationStatus =
  | "pending"
  | "in_review"
  | "success"
  | "rejected"
  | "digital";
export type PosterGroupCharset = "alphanumeric" | "numeric" | "alpha";

export function isPosterStyleBase(value: unknown): value is PosterStyleBase {
  return typeof value === "string" && (POSTER_STYLES as readonly string[]).includes(value);
}

export function parsePosterStyle(
  value: string,
): { base: PosterStyleBase; region: string | null } | null {
  const colonIndex = value.indexOf(":");
  if (colonIndex === -1) {
    return isPosterStyleBase(value) ? { base: value, region: null } : null;
  }
  const base = value.slice(0, colonIndex);
  const region = value.slice(colonIndex + 1);
  if (!isPosterStyleBase(base)) return null;
  if (!POSTER_REGION_CODE_PATTERN.test(region)) return null;
  return { base, region };
}

export function formatPosterStyle(base: PosterStyleBase, region: string | null): PosterStyle {
  return region === null ? base : (`${base}:${region}` as PosterStyle);
}

export function getPosterStyleBase(value: string): PosterStyleBase | null {
  return parsePosterStyle(value)?.base ?? null;
}

export type PosterMetadata = Record<string, unknown>;

export type PosterGroupRow = {
  id: string;
  user_id: string;
  campaign_slug: string;
  name: string | null;
  poster_count: number;
  charset: PosterGroupCharset;
  metadata: PosterMetadata;
  created_at: Date;
  updated_at: Date;
};

export type PosterRow = {
  id: string;
  user_id: string;
  poster_group_id: string | null;
  campaign_slug: string;
  name: string | null;
  qr_code_token: string;
  referral_code: string;
  poster_type: PosterStyle;
  verification_status: PosterVerificationStatus;
  verified_at: Date | null;
  rejection_reason: string | null;
  location_description: string | null;
  latitude: number | null;
  longitude: number | null;
  location_accuracy: number | null;
  geo_country_code: string | null;
  geo_country_name: string | null;
  geo_state: string | null;
  proof_path: string | null;
  proof_original_name: string | null;
  proof_content_type: string | null;
  proof_size_bytes: number | null;
  detected_qr_codes: string[];
  metadata: PosterMetadata;
  submitted_at: Date | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
};

export type PosterTemplateCoordinates = {
  x: number;
  y: number;
  size: number;
};

export type PosterTemplateTextCoordinates = {
  x: number;
  y: number;
  size: number;
  color: string;
};

export type CreatePosterInput = {
  userId: string;
  campaignSlug: string;
  posterType?: PosterStyle;
  posterGroupId?: string | null;
  charset?: PosterGroupCharset;
  name?: string | null;
  metadata?: PosterMetadata;
};

export type CreatePosterGroupInput = {
  userId: string;
  campaignSlug: string;
  count: number;
  name?: string | null;
  charset?: PosterGroupCharset;
  posterType?: PosterStyle;
};

export type SubmitPosterProofInput = {
  userId: string;
  posterId: string;
  file: File;
  locationDescription?: string | null;
  latitude: number;
  longitude: number;
  locationAccuracy?: number | null;
};

export type VerifiedPosterDisplay = {
  name: string | null;
  referralCode: string;
  groupName: string | null;
};

export type PublicScanResult = {
  status: ScanMatchResult["status"];
  detectedQrCodes: string[];
  message: string;
  verifiedPoster?: VerifiedPosterDisplay;
};

export type ScanMatchResult =
  | {
      status: "success" | "auto_matched" | "already_verified";
      detectedQrCodes: string[];
      poster: PosterRow;
      matchedPoster?: PosterRow;
      verifiedPoster: VerifiedPosterDisplay;
      message: string;
    }
  | {
      status: "no_match" | "no_qr";
      detectedQrCodes: string[];
      message: string;
      poster?: PosterRow | null;
      matchedPoster?: PosterRow | null;
    }
  | {
      status: "in_review";
      detectedQrCodes: string[];
      poster: PosterRow;
      message: string;
    };
