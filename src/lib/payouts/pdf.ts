import fs from "node:fs/promises";
import path from "node:path";

import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, PDFFont, PDFImage, PDFPage, rgb } from "pdf-lib";

// ---------------------------------------------------------------------------
// Invoice SDK
//
// Generates ambassador payout invoices as PDFs, reproducing the "Invoice 6"
// design from the Stardance Ambassador Invoice Figma file
// (https://www.figma.com/design/Mo41fW2lACiJtVTZB8lgdt).
//
// An invoice always has exactly one service line and 0% tax. Callers supply
// only what varies: the invoice number, issued date, the recipient ("from"),
// the single service (description + amount) and the payout method. Everything
// else (logo, the "Invoice" wordmark, the Hack Foundation billing block, all
// labels, USD currency and the page layout) is fixed by the design.
//
// `createInvoicePdf(invoice)` is the single entry point.
// ---------------------------------------------------------------------------

// === Public API ============================================================

/** The party an invoice is billed from (the ambassador). */
export type InvoiceParty = {
  name: string;
  /** Address lines, one entry per rendered line (may be empty). */
  addressLines: string[];
  /** Optional contact line rendered under the address. */
  email?: string;
};

/** The single service line. Quantity is always 1; only the amount varies. */
export type InvoiceService = {
  description: string;
  amountCents: number;
};

export type InvoicePayment =
  | { method: "ach"; bankName: string; accountNumber: string; routingNumber: string }
  | { method: "wise"; bankName: string; iban: string };

export type Invoice = {
  /** Rendered after a leading "#". */
  number: string;
  issued: Date;
  from: InvoiceParty;
  service: InvoiceService;
  payment: InvoicePayment;
};

// === Fixed design ==========================================================

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;

// Inter metrics (unitsPerEm 2048, ascent 1984, descent -494) used to place text
// baselines exactly where Figma places them within a line box.
const INTER_ASCENT_RATIO = 1984 / 2048;
const INTER_DESCENT_RATIO = 494 / 2048;

const COLORS = {
  ink: "#1A1C21", // headings, labels, total
  muted: "#5E6470", // secondary values
  accent: "#7241FA", // amount due
  line: "#D7DAE0", // dividers
} as const;

const CURRENCY_SYMBOL = "$";
const AMOUNT_DUE_PREFIX = "US$";

const TITLE = "Invoice";

const BILLED_TO = {
  name: "The Hack Foundation",
  lines: ["8605 Santa Monica Blvd #86294", "West Hollywood, CA - 90069", "+1-855-625-HACK"],
} as const;

const LABELS = {
  issued: "Issued",
  billedTo: "Billed to",
  from: "From",
  service: "Service",
  quantity: "Qty",
  rate: "Rate",
  lineTotal: "Line total",
  subtotal: "Subtotal",
  tax: "Tax (0%)",
  total: "Total",
  amountDue: "Amount due",
  payTo: "Pay to the following:",
  ach: "ACH",
  wise: "Wise",
  bankName: "Bank Name:",
  accountNumber: "Account Number:",
  routingNumber: "Routing Number:",
  iban: "IBAN:",
} as const;

const FONT_FILES = {
  regular: "Inter-Regular.ttf", // 400
  medium: "Inter-Medium.ttf", // 500
  semibold: "Inter-SemiBold.ttf", // 600
  bold: "Inter-Bold.ttf", // 700
} as const;

type FontWeightKey = keyof typeof FONT_FILES;

const assetsRoot = path.join(/* turbopackIgnore: true */ process.cwd(), "public", "payouts");

// --- Layout (Figma top-left coordinates) -----------------------------------
const LEFT = 40;
const RIGHT_EDGE = 555; // content right margin / right-aligned column edge
const RATE_RIGHT = 456; // right edge of the "Rate" column
const QTY_X = 352;
const TOTALS_LABEL_X = 352;

const TABLE_HEADER_TOP = 264;
const TABLE_HEADER_DIVIDER_Y = 288;
const SERVICE_ROW_TOP = 298;
const ITEMS_DIVIDER_Y = 347;
const SUBTOTAL_Y = 357;
const SUBTOTAL_DIVIDER_Y = 381;
const TAX_Y = 391;
const TAX_DIVIDER_Y = 415;
const TOTAL_Y = 425;
const AMOUNT_DUE_Y = 459;
const PAY_TITLE_Y = 507;
const PAY_BOX_TOP = 531;
const PAY_BOX_BOTTOM = 613;

// === Assets ================================================================

type LoadedAssets = {
  fonts: Record<FontWeightKey, Uint8Array>;
  flag: Uint8Array;
};

let assetsPromise: Promise<LoadedAssets> | null = null;

async function loadAssets(): Promise<LoadedAssets> {
  if (assetsPromise === null) {
    assetsPromise = (async () => {
      const fontsDir = path.join(assetsRoot, "fonts");
      const [regular, medium, semibold, bold, flag] = await Promise.all([
        fs.readFile(path.join(fontsDir, FONT_FILES.regular)),
        fs.readFile(path.join(fontsDir, FONT_FILES.medium)),
        fs.readFile(path.join(fontsDir, FONT_FILES.semibold)),
        fs.readFile(path.join(fontsDir, FONT_FILES.bold)),
        fs.readFile(path.join(assetsRoot, "ambassador-flag.png")),
      ]);

      return {
        fonts: {
          regular: new Uint8Array(regular),
          medium: new Uint8Array(medium),
          semibold: new Uint8Array(semibold),
          bold: new Uint8Array(bold),
        },
        flag: new Uint8Array(flag),
      };
    })();
  }

  return assetsPromise;
}

// === Drawing primitives ====================================================

function hexToRgb(hexColor: string) {
  const clean = hexColor.replace(/^#/, "");
  return rgb(
    Number.parseInt(clean.slice(0, 2), 16) / 255,
    Number.parseInt(clean.slice(2, 4), 16) / 255,
    Number.parseInt(clean.slice(4, 6), 16) / 255,
  );
}

function formatCurrency(cents: number) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function formatIssued(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${month}/${day}/${date.getFullYear()}`;
}

type Drawer = {
  page: PDFPage;
  fonts: Record<FontWeightKey, PDFFont>;
};

type TextOptions = {
  /** Figma top-left x of the text box. */
  x: number;
  /** Figma top-left y of the text box. */
  y: number;
  size?: number;
  lineHeight?: number;
  weight?: FontWeightKey;
  color?: string;
  /** Right edge for right-aligned text (Figma x + box width). */
  rightEdge?: number;
  uppercase?: boolean;
  letterSpacing?: number;
};

/** Baseline offset from the top of a Figma line box, matching Figma's metrics. */
function baselineFromTop(size: number, lineHeight: number) {
  return (lineHeight + (INTER_ASCENT_RATIO - INTER_DESCENT_RATIO) * size) / 2;
}

function drawText(drawer: Drawer, text: string, options: TextOptions) {
  const size = options.size ?? 10;
  const lineHeight = options.lineHeight ?? 14;
  const weight = options.weight ?? "regular";
  const font = drawer.fonts[weight];
  const value = options.uppercase ? text.toUpperCase() : text;
  const color = hexToRgb(options.color ?? COLORS.ink);
  const characterSpacing = options.letterSpacing ?? 0;

  const baselineY = PAGE_HEIGHT - (options.y + baselineFromTop(size, lineHeight));

  let x = options.x;
  if (options.rightEdge !== undefined) {
    const width =
      font.widthOfTextAtSize(value, size) + characterSpacing * Math.max(0, value.length - 1);
    x = options.rightEdge - width;
  }

  drawer.page.drawText(value, {
    x,
    y: baselineY,
    size,
    font,
    color,
    lineHeight,
    ...(characterSpacing !== 0 ? { characterSpacing } : {}),
  });
}

/** Draw a stack of lines from a Figma top-left, advancing by lineHeight. */
function drawLines(
  drawer: Drawer,
  lines: string[],
  options: Omit<TextOptions, "y"> & { y: number },
) {
  const lineHeight = options.lineHeight ?? 14;
  lines.forEach((line, index) => {
    drawText(drawer, line, { ...options, y: options.y + index * lineHeight });
  });
}

function drawHLine(drawer: Drawer, x: number, y: number, width: number) {
  drawer.page.drawLine({
    start: { x, y: PAGE_HEIGHT - y },
    end: { x: x + width, y: PAGE_HEIGHT - y },
    thickness: 0.5,
    color: hexToRgb(COLORS.line),
  });
}

function drawVLine(drawer: Drawer, x: number, y: number, height: number) {
  drawer.page.drawLine({
    start: { x, y: PAGE_HEIGHT - y },
    end: { x, y: PAGE_HEIGHT - (y + height) },
    thickness: 0.5,
    color: hexToRgb(COLORS.line),
  });
}

function achLines(payment: InvoicePayment) {
  if (payment.method !== "ach") {
    return [LABELS.bankName, LABELS.accountNumber, LABELS.routingNumber];
  }
  return [
    `${LABELS.bankName} ${payment.bankName}`,
    `${LABELS.accountNumber} ${payment.accountNumber}`,
    `${LABELS.routingNumber} ${payment.routingNumber}`,
  ];
}

function wiseLines(payment: InvoicePayment) {
  if (payment.method !== "wise") {
    return [LABELS.bankName, LABELS.iban];
  }
  return [`${LABELS.bankName} ${payment.bankName}`, `${LABELS.iban} ${payment.iban}`];
}

// === Entry point ===========================================================

export async function createInvoicePdf(invoice: Invoice): Promise<Uint8Array<ArrayBuffer>> {
  const assets = await loadAssets();
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);

  // NOTE: fonts are embedded in full (no `{ subset: true }`). The @pdf-lib/fontkit
  // subsetter mangles glyph ids on these Inter builds, dropping characters from
  // the rendered text, so subsetting must stay off until that is resolved.
  const [regular, medium, semibold, bold] = await Promise.all([
    pdf.embedFont(assets.fonts.regular),
    pdf.embedFont(assets.fonts.medium),
    pdf.embedFont(assets.fonts.semibold),
    pdf.embedFont(assets.fonts.bold),
  ]);
  const flag: PDFImage = await pdf.embedPng(assets.flag);

  const drawer: Drawer = {
    page: pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]),
    fonts: { regular, medium, semibold, bold },
  };

  // Single line, 0% tax: subtotal, total and amount due all equal the amount.
  const amount = invoice.service.amountCents;

  // --- Header -------------------------------------------------------------
  drawText(drawer, TITLE, {
    x: LEFT,
    y: 32,
    size: 28,
    lineHeight: 32,
    weight: "semibold",
    color: COLORS.ink,
    uppercase: true,
  });
  drawText(drawer, `#${invoice.number}`, {
    x: LEFT,
    y: 64,
    size: 11,
    lineHeight: 16,
    weight: "medium",
    color: COLORS.muted,
    uppercase: true,
    letterSpacing: 0.33,
  });
  drawer.page.drawImage(flag, { x: 473, y: PAGE_HEIGHT - 23 - 82, width: 82, height: 82 });

  // --- Three-column info band ---------------------------------------------
  drawHLine(drawer, LEFT, 112, 515);
  drawVLine(drawer, 206, 112, 125);
  drawVLine(drawer, 388, 112, 125);
  drawHLine(drawer, LEFT, 237, 515);

  drawText(drawer, LABELS.issued, { x: LEFT, y: 126, weight: "semibold", color: COLORS.ink });
  drawText(drawer, formatIssued(invoice.issued), {
    x: LEFT,
    y: 146,
    weight: "semibold",
    color: COLORS.muted,
  });

  drawText(drawer, LABELS.billedTo, { x: 222, y: 126, weight: "semibold", color: COLORS.ink });
  drawText(drawer, BILLED_TO.name, { x: 222, y: 146, weight: "semibold", color: COLORS.muted });
  drawLines(drawer, [...BILLED_TO.lines], { x: 222, y: 162, weight: "regular", color: COLORS.muted });

  drawText(drawer, LABELS.from, { x: 404, y: 126, weight: "semibold", color: COLORS.ink });
  drawText(drawer, invoice.from.name, { x: 404, y: 146, weight: "semibold", color: COLORS.muted });
  drawLines(
    drawer,
    [...invoice.from.addressLines, ...(invoice.from.email ? [invoice.from.email] : [])],
    { x: 404, y: 162, weight: "regular", color: COLORS.muted },
  );

  // --- Service line -------------------------------------------------------
  drawText(drawer, LABELS.service, { x: LEFT, y: TABLE_HEADER_TOP, weight: "semibold", color: COLORS.ink });
  drawText(drawer, LABELS.quantity, { x: QTY_X, y: TABLE_HEADER_TOP, weight: "semibold", color: COLORS.ink });
  drawText(drawer, LABELS.rate, {
    x: 420,
    y: TABLE_HEADER_TOP,
    weight: "semibold",
    color: COLORS.ink,
    rightEdge: RATE_RIGHT,
  });
  drawText(drawer, LABELS.lineTotal, {
    x: 504,
    y: TABLE_HEADER_TOP,
    weight: "semibold",
    color: COLORS.ink,
    rightEdge: RIGHT_EDGE,
  });
  drawHLine(drawer, LEFT, TABLE_HEADER_DIVIDER_Y, 515);

  drawText(drawer, invoice.service.description, {
    x: LEFT,
    y: SERVICE_ROW_TOP,
    weight: "semibold",
    color: COLORS.ink,
  });
  drawText(drawer, "1", { x: QTY_X, y: SERVICE_ROW_TOP, weight: "medium", color: COLORS.muted });
  drawText(drawer, `${CURRENCY_SYMBOL}${formatCurrency(amount)}`, {
    x: 0,
    y: SERVICE_ROW_TOP,
    weight: "medium",
    color: COLORS.muted,
    rightEdge: RATE_RIGHT,
  });
  drawText(drawer, `${CURRENCY_SYMBOL}${formatCurrency(amount)}`, {
    x: 0,
    y: SERVICE_ROW_TOP,
    weight: "medium",
    color: COLORS.muted,
    rightEdge: RIGHT_EDGE,
  });
  drawHLine(drawer, LEFT, ITEMS_DIVIDER_Y, 515);

  // --- Totals (single line, tax fixed at 0%) ------------------------------
  drawText(drawer, LABELS.subtotal, { x: TOTALS_LABEL_X, y: SUBTOTAL_Y, weight: "semibold", color: COLORS.ink });
  drawText(drawer, `${CURRENCY_SYMBOL}${formatCurrency(amount)}`, {
    x: 0,
    y: SUBTOTAL_Y,
    weight: "medium",
    color: COLORS.muted,
    rightEdge: RIGHT_EDGE,
  });
  drawHLine(drawer, 352, SUBTOTAL_DIVIDER_Y, 203);

  drawText(drawer, LABELS.tax, { x: TOTALS_LABEL_X, y: TAX_Y, weight: "semibold", color: COLORS.ink });
  drawText(drawer, `${CURRENCY_SYMBOL}${formatCurrency(0)}`, {
    x: 0,
    y: TAX_Y,
    weight: "medium",
    color: COLORS.muted,
    rightEdge: RIGHT_EDGE,
  });
  drawHLine(drawer, 352, TAX_DIVIDER_Y, 203);

  drawText(drawer, LABELS.total, { x: TOTALS_LABEL_X, y: TOTAL_Y, weight: "semibold", color: COLORS.ink });
  drawText(drawer, `${CURRENCY_SYMBOL}${formatCurrency(amount)}`, {
    x: 0,
    y: TOTAL_Y,
    weight: "medium",
    color: COLORS.ink,
    rightEdge: RIGHT_EDGE,
  });

  drawText(drawer, LABELS.amountDue, { x: TOTALS_LABEL_X, y: AMOUNT_DUE_Y, weight: "bold", color: COLORS.accent });
  drawText(drawer, `${AMOUNT_DUE_PREFIX} ${formatCurrency(amount)}`, {
    x: 0,
    y: AMOUNT_DUE_Y,
    weight: "bold",
    color: COLORS.accent,
    rightEdge: RIGHT_EDGE,
  });

  // --- Payment box (both methods shown; the used one is filled in) --------
  const payHeight = PAY_BOX_BOTTOM - PAY_BOX_TOP;
  drawText(drawer, LABELS.payTo, { x: LEFT, y: PAY_TITLE_Y, weight: "semibold", color: COLORS.ink });
  drawHLine(drawer, LEFT, PAY_BOX_TOP, 515);
  drawHLine(drawer, 39, PAY_BOX_BOTTOM, 515);
  drawVLine(drawer, LEFT, PAY_BOX_TOP, payHeight);
  drawVLine(drawer, 297, PAY_BOX_TOP, payHeight);
  drawVLine(drawer, 554, PAY_BOX_TOP, payHeight);

  drawText(drawer, LABELS.ach, { x: 56, y: PAY_BOX_TOP + 10, weight: "semibold", color: COLORS.ink });
  drawLines(drawer, achLines(invoice.payment), {
    x: 56,
    y: PAY_BOX_TOP + 30,
    weight: "semibold",
    color: COLORS.muted,
  });

  drawText(drawer, LABELS.wise, { x: 308, y: PAY_BOX_TOP + 10, weight: "semibold", color: COLORS.ink });
  drawLines(drawer, wiseLines(invoice.payment), {
    x: 308,
    y: PAY_BOX_TOP + 30,
    weight: "semibold",
    color: COLORS.muted,
  });

  // Copy into a fresh ArrayBuffer-backed view so the result is a valid
  // `BodyInit` for `new Response(...)` (pdf-lib returns Uint8Array<ArrayBufferLike>).
  return new Uint8Array(await pdf.save());
}
