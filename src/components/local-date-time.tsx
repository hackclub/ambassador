"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

export function LocalDateTime({
  value,
  locale,
  dateOnly = false,
  fallback,
  empty = "-",
}: {
  value: string | number | Date | null | undefined;
  locale: string;
  dateOnly?: boolean;
  fallback?: string | null;
  empty?: string;
}) {
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

  if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) {
    return <>{fallback ?? empty}</>;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return <>{fallback ?? empty}</>;

  // Show the fallback until hydrated so SSR and the first client render agree.
  if (!hydrated) return <>{fallback ?? empty}</>;

  const options: Intl.DateTimeFormatOptions = dateOnly
    ? { month: "short", day: "numeric", year: "numeric" }
    : {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      };

  return <time dateTime={date.toISOString()}>{date.toLocaleString(locale, options)}</time>;
}
