import { optionalEnv } from "@/lib/env";

export function getRequestIp(request: Request) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown"
  );
}

export function getSafeRedirectPath(
  value: FormDataEntryValue | string | null | undefined,
  fallbackPath: string,
) {
  const candidate = typeof value === "string" ? value.trim() : "";

  if (!candidate.startsWith("/") || candidate.startsWith("//") || candidate.includes("\\")) {
    return fallbackPath;
  }

  const origin = toOrigin(optionalEnv("CURRENT_DOMAIN"));

  try {
    const resolved = new URL(candidate, origin ?? "https://redirect.invalid");
    if (origin !== null && resolved.origin !== origin) {
      return fallbackPath;
    }

    const path = `${resolved.pathname}${resolved.search}${resolved.hash}`;

    if (!path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\")) {
      return fallbackPath;
    }

    return path;
  } catch {
    return fallbackPath;
  }
}

export function getAppUrl(path: string, request: Request) {
  const configuredOrigin = toOrigin(optionalEnv("CURRENT_DOMAIN"));

  if (configuredOrigin !== null) {
    return new URL(path, configuredOrigin);
  }

  return new URL(path, request.url);
}

export function getSafeRedirectUrl(
  request: Request,
  value: FormDataEntryValue | string | null | undefined,
  fallbackPath: string,
) {
  return getAppUrl(getSafeRedirectPath(value, fallbackPath), request);
}

function toOrigin(value: string | null) {
  if (value === null || value === "") return null;

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function getRequestOrigins(request: Request) {
  const requestUrl = new URL(request.url);
  const origins = new Set<string>([requestUrl.origin]);
  const configuredOrigin = toOrigin(optionalEnv("CURRENT_DOMAIN"));

  if (configuredOrigin !== null) {
    origins.add(configuredOrigin);
  }

  return origins;
}

export function isSameOriginRequest(request: Request) {
  const requestOrigin =
    toOrigin(request.headers.get("origin")) ??
    toOrigin(request.headers.get("referer"));

  if (requestOrigin === null) {
    const fetchSite = request.headers.get("sec-fetch-site");
    if (fetchSite !== null && fetchSite !== "") {
      return fetchSite === "same-origin" || fetchSite === "same-site";
    }
    return false;
  }

  return getRequestOrigins(request).has(requestOrigin);
}
