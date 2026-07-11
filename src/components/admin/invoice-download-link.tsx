import Icon from "@hackclub/icons";

import { cn } from "@/lib/utils";

// Backgroundless, subtext-style link to the HCB invoice PDF. Lives next to the
// Decision/Fulfilment headings and inside the approve & pay modal, since the
// invoice is what the admin uploads to make the transfer on HCB.
export function InvoiceDownloadLink({
  payoutId,
  label = "Download HCB invoice",
  local = false,
  className,
}: {
  payoutId: string;
  label?: string;
  /** Include the local-currency estimate line on the invoice. */
  local?: boolean;
  className?: string;
}) {
  return (
    <a
      href={`/api/admin/payouts/${payoutId}/invoice${local ? "?local=1" : ""}`}
      className={cn(
        "ui-hover-underline inline-flex items-center gap-1 font-body text-sm text-muted-foreground hover:text-foreground",
        className,
      )}
    >
      <Icon glyph="download" size={16} />
      {label}
    </a>
  );
}
