import fs from "node:fs";
import path from "node:path";

import { optionalEnv } from "@/lib/env";
import {
  formatPosterStyle,
  parsePosterStyle,
  type PosterStyle,
  type PosterStyleBase,
  type PosterTemplateCoordinates,
  type PosterTemplateTextCoordinates,
} from "@/lib/posters/types";

const DEFAULT_CURRENT_DOMAIN = "http://localhost:7171";
const projectRoot = /* turbopackIgnore: true */ process.cwd();
const publicPosterRoot = path.join(projectRoot, "public", "posters");

export const DEFAULT_POSTER_CAMPAIGN = optionalEnv("POSTER_DEFAULT_CAMPAIGN") ?? "default";

type PosterCampaignConfigFile = {
  displayName?: string;
  redirectBaseUrl?: string;
  templates?: Partial<Record<string, string>>;
  regions?: Partial<Record<string, string>>;
  qrCoordinates?: Partial<Record<string, Partial<PosterTemplateCoordinates>>>;
  referralTextCoordinates?: Partial<Record<string, Partial<PosterTemplateTextCoordinates>>>;
};

const defaultTemplateFilenames: Record<PosterStyleBase, string> = {
  color: "stardance.pdf",
  bw: "stardance-bw.pdf",
  printer_efficient: "stardance-bw.pdf",
  a4: "stardance-a4.pdf",
  a4_bw: "stardance-a4-bw.pdf",
};

const REGIONAL_PAPER: Record<PosterStyleBase, "letter" | "a4"> = {
  color: "letter",
  bw: "letter",
  printer_efficient: "letter",
  a4: "a4",
  a4_bw: "a4",
};

const REGIONAL_COLOR: Record<PosterStyleBase, "color" | "bw"> = {
  color: "color",
  bw: "bw",
  printer_efficient: "bw",
  a4: "color",
  a4_bw: "bw",
};

function regionalTemplateFilename(base: PosterStyleBase, region: string) {
  return `regionals/stardance-${REGIONAL_PAPER[base]}-${REGIONAL_COLOR[base]}-${region}.pdf`;
}

function posterTemplateFilename(
  config: PosterCampaignConfigFile,
  style: PosterStyle,
  base: PosterStyleBase,
  region: string | null,
) {
  return (
    config.templates?.[style] ??
    (region !== null
      ? regionalTemplateFilename(base, region)
      : config.templates?.[base] ?? defaultTemplateFilenames[base])
  );
}

function posterTemplateRoots() {
  return [
    optionalEnv("POSTER_TEMPLATE_ROOT"),
    publicPosterRoot,
  ].filter((value): value is string => Boolean(value));
}

export function normalizeCampaignSlug(campaignSlug?: string | null) {
  const normalized =
    campaignSlug
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-") ?? "";

  let start = 0;
  let end = normalized.length;

  while (normalized.charAt(start) === "-") {
    start += 1;
  }

  while (end > start && normalized.charAt(end - 1) === "-") {
    end -= 1;
  }

  return normalized.slice(start, end) || DEFAULT_POSTER_CAMPAIGN;
}

export function readPosterCampaignConfig(campaignSlug: string): PosterCampaignConfigFile {
  const normalizedCampaignSlug = normalizeCampaignSlug(campaignSlug);
  let configPath: string | null = null;

  for (const root of posterTemplateRoots()) {
    const candidate = path.join(root, normalizedCampaignSlug, "config.json");

    if (fs.existsSync(candidate)) {
      configPath = candidate;
      break;
    }
  }

  if (configPath === null) {
    return {};
  }

  try {
    const raw = fs.readFileSync(configPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function defaultRenderCoordinates(pageWidth: number, pageHeight: number) {
  const margin = 36;
  const size = Math.round(Math.min(pageWidth, pageHeight) * 0.22);

  return {
    qr: {
      x: Math.max(margin, pageWidth - size - margin),
      y: margin,
      size,
    },
    text: {
      x: Math.max(margin, pageWidth - size / 2 - margin),
      y: Math.max(18, margin - 6),
      size: 16,
      color: "000000",
    },
  };
}

export function resolvePosterTemplatePath(campaignSlug: string, style: PosterStyle) {
  const slug = normalizeCampaignSlug(campaignSlug);
  const config = readPosterCampaignConfig(slug);
  const parsed = parsePosterStyle(style);
  if (parsed === null) return null;
  const { base, region } = parsed;

  const filename = posterTemplateFilename(config, style, base, region);

  for (const root of posterTemplateRoots()) {
    const campaignTemplate = path.join(root, slug, filename);
    if (fs.existsSync(campaignTemplate)) {
      return campaignTemplate;
    }

    const defaultTemplate = path.join(root, DEFAULT_POSTER_CAMPAIGN, filename);
    if (fs.existsSync(defaultTemplate)) {
      return defaultTemplate;
    }
  }

  return null;
}

export function isPosterStyleAvailable(campaignSlug: string, style: PosterStyle) {
  return resolvePosterTemplatePath(campaignSlug, style) !== null;
}

export function getPosterRenderConfig(
  campaignSlug: string,
  style: PosterStyle,
  pageWidth: number,
  pageHeight: number,
) {
  const defaults = defaultRenderCoordinates(pageWidth, pageHeight);
  const config = readPosterCampaignConfig(normalizeCampaignSlug(campaignSlug));
  const parsed = parsePosterStyle(style);
  const base: string = parsed?.base ?? style;
  const qrOverrides = config.qrCoordinates?.[style] ?? config.qrCoordinates?.[base] ?? {};
  const textOverrides =
    config.referralTextCoordinates?.[style] ?? config.referralTextCoordinates?.[base] ?? {};

  return {
    qr: {
      x: qrOverrides.x ?? defaults.qr.x,
      y: qrOverrides.y ?? defaults.qr.y,
      size: qrOverrides.size ?? defaults.qr.size,
    },
    text: {
      x: textOverrides.x ?? defaults.text.x,
      y: textOverrides.y ?? defaults.text.y,
      size: textOverrides.size ?? defaults.text.size,
      color: textOverrides.color ?? defaults.text.color,
    },
  };
}

export function normalizePosterReferralCode(referralCode: string) {
  const trimmed = referralCode.trim();
  const legacyStardanceCode = /^a[!-]?([a-z0-9]{5})$/i.exec(trimmed);
  if (legacyStardanceCode?.[1] !== undefined) {
    return `a-${legacyStardanceCode[1].toLowerCase()}`;
  }

  if (/^[a-z0-9]{5}$/i.test(trimmed)) {
    return `a-${trimmed.toLowerCase()}`;
  }

  return trimmed;
}

export function formatPosterReferralCode(referralCode: string) {
  return referralCode.trim();
}

export function buildPosterReferralUrl(referralCode: string) {
  return `${optionalEnv("CURRENT_DOMAIN") ?? DEFAULT_CURRENT_DOMAIN}/p/${encodeURIComponent(formatPosterReferralCode(referralCode))}`;
}

export function buildPosterScanUrl(referralCode: string) {
  return `https://stardance.space/${normalizePosterReferralCode(referralCode)}`;
}

export type PosterRegionInfo = {
  code: string;
  name: string;
};

export type PosterCampaignSummary = {
  slug: string;
  displayName: string;
  styles: PosterStyle[];
  regions: PosterRegionInfo[];
  previewUrls: Partial<Record<PosterStyle, string>>;
};

const AVAILABLE_STYLES: PosterStyleBase[] = ["color", "bw", "a4", "a4_bw"];

function encodeStylePath(slug: string, filename: string) {
  const parts = filename.split("/").map((segment) => encodeURIComponent(segment));
  return `/posters/${encodeURIComponent(slug)}/${parts.join("/")}`;
}

function previewFilename(templateFilename: string) {
  return templateFilename.replace(/\.pdf$/i, ".webp");
}

function discoverRegionalCodes(campaignDir: string) {
  const regionalsDir = path.join(campaignDir, "regionals");
  let entries: string[];
  try {
    entries = fs.readdirSync(regionalsDir);
  } catch {
    return [] as string[];
  }
  const codes = new Set<string>();
  for (const entry of entries) {
    const match = /^stardance-(?:letter|a4)-(?:color|bw)-([a-z]{2,8})\.pdf$/i.exec(entry);
    if (match) {
      codes.add(match[1].toLowerCase());
    }
  }
  return [...codes].sort();
}

const DISPLAY_NAMES_BY_REGION_CODE: Record<string, string> = {
  in: "India",
  us: "United States",
  ca: "Canada",
  uk: "United Kingdom",
  au: "Australia",
  nz: "New Zealand",
};

function regionDisplayName(code: string, override?: string) {
  if (override !== undefined && override.trim() !== "") return override;
  return DISPLAY_NAMES_BY_REGION_CODE[code] ?? code.toUpperCase();
}

export function listPosterCampaigns(): PosterCampaignSummary[] {
  const seen = new Map<string, PosterCampaignSummary>();

  for (const root of posterTemplateRoots()) {
    let entries: string[];
    try {
      entries = fs.readdirSync(root);
    } catch {
      continue;
    }

    for (const slug of entries) {
      if (seen.has(slug)) continue;
      const campaignDir = path.join(root, slug);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(campaignDir);
      } catch {
        continue;
      }
      if (!stat.isDirectory()) continue;

      const config = readPosterCampaignConfig(slug);

      const englishStyles: PosterStyle[] = AVAILABLE_STYLES.filter((base) => {
        const filename = config.templates?.[base] ?? defaultTemplateFilenames[base];
        return fs.existsSync(path.join(campaignDir, filename));
      });

      const discoveredCodes = discoverRegionalCodes(campaignDir);
      const regions: PosterRegionInfo[] = discoveredCodes.map((code) => ({
        code,
        name: regionDisplayName(code, config.regions?.[code]),
      }));

      const regionalStyles: PosterStyle[] = [];
      for (const region of regions) {
        for (const base of AVAILABLE_STYLES) {
          const filename = regionalTemplateFilename(base, region.code);
          if (fs.existsSync(path.join(campaignDir, filename))) {
            regionalStyles.push(formatPosterStyle(base, region.code));
          }
        }
      }

      const styles = [...englishStyles, ...regionalStyles];
      if (styles.length === 0) continue;

      const displayName =
        typeof config.displayName === "string"
          ? config.displayName
          : slug.charAt(0).toUpperCase() + slug.slice(1);

      const previewUrls = Object.fromEntries(
        styles.flatMap((style) => {
          const parsed = parsePosterStyle(style);
          if (parsed === null) return [];
          const filename = posterTemplateFilename(config, style, parsed.base, parsed.region);
          const preview = previewFilename(filename);
          if (!fs.existsSync(path.join(publicPosterRoot, slug, preview))) return [];
          return [[style, encodeStylePath(slug, preview)]];
        }),
      ) as Partial<Record<PosterStyle, string>>;

      seen.set(slug, { slug, displayName, styles, regions, previewUrls });
    }
  }

  return [...seen.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export function buildPosterRedirectUrl(referralCode: string, campaignSlug: string) {
  void campaignSlug;
  return `https://stardance.space/${normalizePosterReferralCode(referralCode)}`;
}
