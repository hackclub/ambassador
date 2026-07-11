import "server-only";

// HCB sends Wise transfers in the recipient account's local currency, so the
// admin needs an indicative local figure next to the USD amount (and on the
// invoice) to enter the transfer. The currency comes from the IBAN's leading
// country code; the rate comes from the keyless open.er-api.com feed
// (refreshed daily upstream) and is cached in memory, serving stale on fetch
// failure since the figure is indicative either way.

// IBAN-registry countries mapped to the domestic currency a Wise transfer to
// that IBAN pays out in. USD-pegged countries map to USD so no conversion line
// is shown for them.
const IBAN_COUNTRY_CURRENCIES: Record<string, string> = {
  AD: "EUR", AE: "AED", AL: "ALL", AT: "EUR", AZ: "AZN", BA: "BAM",
  BE: "EUR", BG: "BGN", BH: "BHD", BI: "BIF", BR: "BRL", BY: "BYN",
  CH: "CHF", CR: "CRC", CY: "EUR", CZ: "CZK", DE: "EUR", DJ: "DJF",
  DK: "DKK", DO: "DOP", EE: "EUR", EG: "EGP", ES: "EUR", FI: "EUR",
  FK: "FKP", FO: "DKK", FR: "EUR", GB: "GBP", GE: "GEL", GI: "GIP",
  GL: "DKK", GR: "EUR", GT: "GTQ", HN: "HNL", HR: "EUR", HU: "HUF",
  IE: "EUR", IL: "ILS", IQ: "IQD", IS: "ISK", IT: "EUR", JO: "JOD",
  KW: "KWD", KZ: "KZT", LB: "LBP", LC: "XCD", LI: "CHF", LT: "EUR",
  LU: "EUR", LV: "EUR", LY: "LYD", MC: "EUR", MD: "MDL", ME: "EUR",
  MK: "MKD", MN: "MNT", MR: "MRU", MT: "EUR", MU: "MUR", NI: "NIO",
  NL: "EUR", NO: "NOK", OM: "OMR", PK: "PKR", PL: "PLN", PS: "ILS",
  PT: "EUR", QA: "QAR", RO: "RON", RS: "RSD", RU: "RUB", SA: "SAR",
  SC: "SCR", SD: "SDG", SE: "SEK", SI: "EUR", SK: "EUR", SM: "EUR",
  SO: "SOS", ST: "STN", SV: "USD", TL: "USD", TN: "TND", TR: "TRY",
  UA: "UAH", VA: "EUR", VG: "USD", XK: "EUR", YE: "YER",
};

export type LocalAmount = {
  currency: string;
  /** Major units of `currency`, unrounded. */
  amount: number;
  /** USD to `currency` rate used. */
  rate: number;
};

/** The domestic currency of the IBAN's country, or null when unknown. */
export function currencyForIban(iban: string | null): string | null {
  if (!iban) return null;
  return IBAN_COUNTRY_CURRENCIES[iban.trim().slice(0, 2).toUpperCase()] ?? null;
}

/** "EUR 11.34" style, with the currency's own minor-unit precision. */
export function formatLocalAmount(local: LocalAmount): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: local.currency,
    currencyDisplay: "code",
  }).format(local.amount);
}

let cachedRates: { rates: Record<string, number>; fetchedAt: number } | null = null;

async function getUsdRates(): Promise<Record<string, number> | null> {
  if (cachedRates && Date.now() - cachedRates.fetchedAt < 6 * 60 * 60 * 1000) {
    return cachedRates.rates;
  }

  try {
    const response = await fetch("https://open.er-api.com/v6/latest/USD", {
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) return cachedRates?.rates ?? null;
    const payload = (await response.json()) as {
      result?: string;
      rates?: Record<string, number>;
    };
    if (payload.result !== "success" || !payload.rates) return cachedRates?.rates ?? null;
    cachedRates = { rates: payload.rates, fetchedAt: Date.now() };
    return cachedRates.rates;
  } catch {
    return cachedRates?.rates ?? null;
  }
}

/**
 * Best-effort indicative local-currency equivalent of a USD amount for a Wise
 * payout. Returns null when the IBAN country is unknown, the account is
 * USD-denominated, or no rate is available, so callers simply omit the
 * conversion.
 */
export async function getLocalAmountForIban(
  iban: string | null,
  usdCents: number,
): Promise<LocalAmount | null> {
  const currency = currencyForIban(iban);
  if (!currency || currency === "USD") return null;

  const rate = (await getUsdRates())?.[currency];
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) return null;

  return { currency, amount: (usdCents / 100) * rate, rate };
}
