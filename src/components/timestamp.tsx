import { formatDate, formatDateTime } from "@/lib/format";

import { LocalDateTime } from "./local-date-time";

export function Timestamp({
  value,
  locale,
  dateOnly = false,
  empty = "-",
}: {
  value: string | number | Date | null | undefined;
  locale: string;
  dateOnly?: boolean;
  empty?: string;
}) {
  const fallback = (dateOnly ? formatDate(value, locale) : formatDateTime(value, locale)) ?? empty;
  return (
    <LocalDateTime value={value} locale={locale} dateOnly={dateOnly} fallback={fallback} empty={empty} />
  );
}
