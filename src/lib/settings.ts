export type HackClubAddress = {
  first_name?: string;
  last_name?: string;
  line_1?: string;
  line_2?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country?: string;
  phone_number?: string;
};

export const SUPPORTED_AMBASSADOR_REGIONS = [
  "Australia",
  "Canada",
  "EU",
  "New Zealand",
  "United Kingdom",
  "United States",
  "Other",
] as const;

export type AmbassadorRegion = (typeof SUPPORTED_AMBASSADOR_REGIONS)[number];
type AmbassadorRegionInput = string | null | undefined;

const AMBASSADOR_REGION_FLAGS: Record<AmbassadorRegion, string> = {
  Australia: "🇦🇺",
  Canada: "🇨🇦",
  EU: "🇪🇺",
  "New Zealand": "🇳🇿",
  "United Kingdom": "🇬🇧",
  "United States": "🇺🇸",
  Other: "🌐",
};

/** Flag emoji for an ambassador region; a globe for unknown or unset regions. */
export function ambassadorRegionFlag(region: string | null | undefined): string {
  if (region !== null && region !== undefined && region in AMBASSADOR_REGION_FLAGS) {
    return AMBASSADOR_REGION_FLAGS[region as AmbassadorRegion];
  }

  return "🌐";
}

const REGION_CODES: Array<readonly [string, AmbassadorRegion]> = [
  ["au", "Australia"],
  ["ca", "Canada"],
  ["nz", "New Zealand"],
  ["gb", "United Kingdom"],
  ["us", "United States"],
];

const EU_COUNTRY_NAMES = [
  "austria",
  "belgium",
  "bulgaria",
  "croatia",
  "cyprus",
  "czechia",
  "denmark",
  "estonia",
  "finland",
  "france",
  "germany",
  "greece",
  "hungary",
  "ireland",
  "italy",
  "latvia",
  "lithuania",
  "luxembourg",
  "malta",
  "netherlands",
  "poland",
  "portugal",
  "romania",
  "slovakia",
  "slovenia",
  "spain",
  "sweden",
];

const EU_COUNTRY_CODES = [
  "at",
  "be",
  "bg",
  "hr",
  "cy",
  "cz",
  "de",
  "dk",
  "ee",
  "es",
  "fi",
  "fr",
  "gr",
  "hu",
  "ie",
  "it",
  "lt",
  "lu",
  "lv",
  "mt",
  "nl",
  "pl",
  "pt",
  "ro",
  "se",
  "si",
  "sk",
];

const REGION_NAMES: Array<readonly [string, AmbassadorRegion]> = [
  ["australia", "Australia"],
  ["canada", "Canada"],
  ["czech republic", "EU"],
  ["republic of ireland", "EU"],
  ["the netherlands", "EU"],
  ["europe", "EU"],
  ["european union", "EU"],
  ["new zealand", "New Zealand"],
  ["great britain", "United Kingdom"],
  ["england", "United Kingdom"],
  ["northern ireland", "United Kingdom"],
  ["scotland", "United Kingdom"],
  ["united kingdom", "United Kingdom"],
  ["united kingdom of great britain and northern ireland", "United Kingdom"],
  ["wales", "United Kingdom"],
  ["united states", "United States"],
  ["united states of america", "United States"],
  ["usa", "United States"],
];

function normalizeRegionName(value: string) {
  return value.trim().toLowerCase();
}

function normalizeRegionCandidate(value: string) {
  return normalizeRegionName(value)
    .replace(/\./g, "")
    .replace(/\s+/g, " ");
}

const REGION_LOOKUP = new Map<string, AmbassadorRegion>([
  ...SUPPORTED_AMBASSADOR_REGIONS.map((region) => [normalizeRegionCandidate(region), region] as const),
  ...REGION_CODES.map(([candidate, region]) => [normalizeRegionCandidate(candidate), region] as const),
  ...REGION_NAMES.map(([candidate, region]) => [normalizeRegionCandidate(candidate), region] as const),
  ...EU_COUNTRY_NAMES.map((country) => [normalizeRegionCandidate(country), "EU"] as const),
  ...EU_COUNTRY_CODES.map((countryCode) => [normalizeRegionCandidate(countryCode), "EU"] as const),
]);

export function resolveDetectedAmbassadorRegion(
  ...detectedRegions: AmbassadorRegionInput[]
): AmbassadorRegion | null {
  let sawCandidate = false;

  for (const detectedRegion of detectedRegions) {
    if (
      detectedRegion === null ||
      detectedRegion === undefined ||
      detectedRegion.trim() === ""
    ) {
      continue;
    }

    sawCandidate = true;
    const normalizedDetectedRegion = normalizeRegionCandidate(detectedRegion);
    const matchedRegion = REGION_LOOKUP.get(normalizedDetectedRegion);
    if (matchedRegion) {
      return matchedRegion;
    }
  }

  return sawCandidate ? "Other" : null;
}

function isHackClubAddress(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readAddressField(
  address: Record<string, unknown>,
  ...keys: string[]
) {
  for (const key of keys) {
    const value = address[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

function coerceHackClubAddress(value: unknown): HackClubAddress | null {
  if (typeof value === "string") {
    try {
      return coerceHackClubAddress(JSON.parse(value) as unknown);
    } catch {
      return null;
    }
  }

  if (!isHackClubAddress(value)) {
    return null;
  }

  const address: HackClubAddress = {
    first_name: readAddressField(value, "first_name", "firstName"),
    last_name: readAddressField(value, "last_name", "lastName"),
    line_1: readAddressField(value, "line_1", "line1", "address_line_1", "addressLine1"),
    line_2: readAddressField(value, "line_2", "line2", "address_line_2", "addressLine2"),
    city: readAddressField(value, "city", "locality"),
    state: readAddressField(value, "state", "region"),
    postal_code: readAddressField(
      value,
      "postal_code",
      "postalCode",
      "zip",
      "zipcode",
      "address_zip",
      "addressZip",
    ),
    country: readAddressField(
      value,
      "country",
      "country_name",
      "countryName",
      "address_country",
      "addressCountry",
    ),
    phone_number: readAddressField(value, "phone_number", "phoneNumber"),
  };

  return Object.values(address).some((field) => field !== "") ? address : null;
}

export function normalizeHackClubAddresses(value: unknown): HackClubAddress[] {
  if (Array.isArray(value)) {
    return value
      .map((address) => coerceHackClubAddress(address))
      .filter((address): address is HackClubAddress => !!address);
  }

  const address = coerceHackClubAddress(value);
  if (address) {
    return [address];
  }

  if (typeof value !== "string") {
    return [];
  }

  try {
    return normalizeHackClubAddresses(JSON.parse(value) as unknown);
  } catch {
    return [];
  }
}

export function isCompleteHackClubAddress(address: HackClubAddress) {
  const normalizedAddress = coerceHackClubAddress(address);
  if (!normalizedAddress) {
    return false;
  }

  return [
    normalizedAddress.line_1,
    normalizedAddress.city,
    normalizedAddress.state,
    normalizedAddress.postal_code,
    normalizedAddress.country,
  ].every((field) => typeof field === "string" && field.trim() !== "");
}

export function formatHackClubAddress(address: unknown) {
  const normalizedAddress = coerceHackClubAddress(address);
  if (!normalizedAddress) {
    return "";
  }

  const locality = [
    normalizedAddress.city,
    normalizedAddress.state,
    normalizedAddress.postal_code,
  ]
    .filter(Boolean)
    .join(", ");

  return [
    normalizedAddress.line_1,
    normalizedAddress.line_2,
    locality,
    normalizedAddress.country,
  ]
    .filter(Boolean)
    .join(", ");
}

export function resolveAmbassadorRegion(
  currentRegion: string | null,
  ...detectedRegions: AmbassadorRegionInput[]
) {
  const resolvedCurrentRegion = resolveDetectedAmbassadorRegion(currentRegion);
  const resolvedDetectedRegion = resolveDetectedAmbassadorRegion(...detectedRegions);

  if (resolvedCurrentRegion) {
    if (
      resolvedCurrentRegion === "Other" &&
      resolvedDetectedRegion &&
      resolvedDetectedRegion !== "Other"
    ) {
      return resolvedDetectedRegion;
    }

    return resolvedCurrentRegion;
  }

  if (resolvedDetectedRegion) {
    return resolvedDetectedRegion;
  }

  return "United States";
}
