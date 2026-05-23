import QRCode from "qrcode";

import { optionalEnv } from "@/lib/env";
import {
  buildPosterReferralUrl,
  buildPosterScanUrl,
  formatPosterReferralCode,
} from "@/lib/posters/config";
import type { PosterRow } from "@/lib/posters/types";

export function createQrCodeMatrix(content: string) {
  return QRCode.create(content, {
    errorCorrectionLevel: "L",
  }).modules;
}

export async function generateQrCodePng(content: string, size: number) {
  return QRCode.toBuffer(content, {
    type: "png",
    width: Math.max(256, Math.round(size * 3)),
    margin: 2,
    errorCorrectionLevel: "L",
    color: {
      dark: "#000000",
      light: "#FFFFFF",
    },
  });
}

function getQreaderBaseUrl() {
  const url = optionalEnv("QREADER_URL");
  if (url === null || url === "") {
    throw new Error("QREADER_URL is not set. Start the qreader microservice (see docker-compose.yml).");
  }
  return url.replace(/\/+$/, "");
}

type QreaderResponse = {
  results?: string[];
  count?: number;
  error?: string;
};

export async function readQrCodesFromImageBuffer(
  buffer: Buffer,
  options: { filename?: string; contentType?: string } = {},
): Promise<string[]> {
  const base = getQreaderBaseUrl();
  const adminKey = optionalEnv("QREADER_ADMIN_KEY");
  const contentType =
    options.contentType !== undefined && options.contentType !== ""
      ? options.contentType
      : "application/octet-stream";
  const filename =
    options.filename !== undefined && options.filename !== ""
      ? options.filename
      : "proof";

  const form = new FormData();
  const blob = new Blob([new Uint8Array(buffer)], {
    type: contentType,
  });
  form.append("file", blob, filename);

  const headers: Record<string, string> = {};
  if (adminKey !== null && adminKey !== "") {
    headers["x-admin-key"] = adminKey;
  }

  const response = await fetch(`${base}/read`, {
    method: "POST",
    body: form,
    headers,
  });

  let payload: QreaderResponse = {};

  try {
    const data = await response.json();
    const record: Record<string, unknown> | null =
      typeof data === "object" && data !== null && !Array.isArray(data)
        ? Object.fromEntries(Object.entries(data))
        : null;
    payload = {
      results: Array.isArray(record?.results)
        ? record.results.filter((item): item is string => typeof item === "string")
        : undefined,
      count: typeof record?.count === "number" ? record.count : undefined,
      error: typeof record?.error === "string" ? record.error : undefined,
    };
  } catch (error) {
    console.error("Failed to parse qreader response", error);
  }

  if (!response.ok) {
    throw new Error(
      payload.error !== undefined && payload.error !== ""
        ? payload.error
        : `qreader responded with ${response.status}`,
    );
  }

  return Array.isArray(payload.results) ? payload.results.filter(Boolean) : [];
}

function normalizeQrValue(value: string) {
  return value.trim().toLowerCase().replace(/\/+$/, "");
}

export function findMatchingPoster(detectedCodes: string[], posters: PosterRow[]) {
  return posters.find((poster) => {
    const posterUrl = normalizeQrValue(buildPosterScanUrl(poster.qr_code_token));
    const legacyPosterUrl = normalizeQrValue(buildPosterReferralUrl(poster.referral_code));
    const posterCode = poster.referral_code.toLowerCase();
    const displayCode = formatPosterReferralCode(poster.referral_code).toLowerCase();

    return detectedCodes.some((entry) => {
      const normalized = normalizeQrValue(entry);
      return (
        normalized === posterUrl ||
        normalized === legacyPosterUrl ||
        normalized.includes(posterCode) ||
        normalized.includes(displayCode)
      );
    });
  }) ?? null;
}
