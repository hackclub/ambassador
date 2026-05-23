import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import fs from "node:fs/promises";

import {
  buildPosterScanUrl,
  formatPosterReferralCode,
  getPosterRenderConfig,
  resolvePosterTemplatePath,
} from "@/lib/posters/config";
import { createQrCodeMatrix, generateQrCodePng } from "@/lib/posters/qr";
import type { PosterRow, PosterStyle, PosterTemplateCoordinates } from "@/lib/posters/types";

function hexToRgb(hexColor: string) {
  const clean = hexColor.replace(/^#/, "");
  const r = Number.parseInt(clean.slice(0, 2), 16) / 255;
  const g = Number.parseInt(clean.slice(2, 4), 16) / 255;
  const b = Number.parseInt(clean.slice(4, 6), 16) / 255;
  return rgb(r, g, b);
}

function shouldDrawVectorQrCode(style: PosterStyle) {
  return style === "bw" || style === "printer_efficient" || style === "a4_bw";
}

function drawVectorQrCode(
  page: ReturnType<PDFDocument["getPage"]>,
  content: string,
  config: PosterTemplateCoordinates,
) {
  const quietZoneModules = 2;
  const matrix = createQrCodeMatrix(content);
  const moduleSize = config.size / (matrix.size + quietZoneModules * 2);

  for (let row = 0; row < matrix.size; row += 1) {
    let runStart: number | null = null;

    for (let col = 0; col <= matrix.size; col += 1) {
      const isDark = col < matrix.size && matrix.get(row, col) === 1;

      if (isDark && runStart === null) {
        runStart = col;
      }

      if ((!isDark || col === matrix.size) && runStart !== null) {
        page.drawRectangle({
          x: config.x + (runStart + quietZoneModules) * moduleSize,
          y: config.y + config.size - (row + quietZoneModules + 1) * moduleSize,
          width: (col - runStart) * moduleSize,
          height: moduleSize,
          color: rgb(0, 0, 0),
        });
        runStart = null;
      }
    }
  }
}

async function createFallbackPosterPdf(content: string) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]);
  const qr = await pdf.embedPng(await generateQrCodePng(content, 200));
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);

  page.drawImage(qr, {
    x: (page.getWidth() - 220) / 2,
    y: page.getHeight() / 2 - 30,
    width: 220,
    height: 220,
  });
  page.drawText("Scan to continue", {
    x: 200,
    y: page.getHeight() / 2 - 65,
    size: 16,
    font,
    color: rgb(0, 0, 0),
  });

  return Buffer.from(await pdf.save());
}

export async function generatePosterPdf(options: {
  campaignSlug: string;
  style: PosterStyle;
  content: string;
  referralCode: string;
}) {
  const templatePath = resolvePosterTemplatePath(options.campaignSlug, options.style);

  if (templatePath === null) {
    return createFallbackPosterPdf(options.content);
  }

  const source = await fs.readFile(templatePath);
  const pdf = await PDFDocument.load(source);
  const page = pdf.getPage(0);
  const renderConfig = getPosterRenderConfig(
    options.campaignSlug,
    options.style,
    page.getWidth(),
    page.getHeight(),
  );
  const qrConfig = renderConfig.qr;
  const textConfig = renderConfig.text;
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);

  if (shouldDrawVectorQrCode(options.style)) {
    drawVectorQrCode(page, options.content, qrConfig);
  } else {
    const qrPng = await generateQrCodePng(options.content, qrConfig.size);
    const qrImage = await pdf.embedPng(qrPng);
    page.drawImage(qrImage, {
      x: qrConfig.x,
      y: qrConfig.y,
      width: qrConfig.size,
      height: qrConfig.size,
    });
  }

  const referralText = `Ref: ${formatPosterReferralCode(options.referralCode)}`;
  const textWidth = font.widthOfTextAtSize(referralText, textConfig.size);
  page.drawText(referralText, {
    x: textConfig.x - textWidth / 2,
    y: textConfig.y,
    size: textConfig.size,
    font,
    color: hexToRgb(textConfig.color),
  });

  return Buffer.from(await pdf.save());
}

export async function generateMergedPosterGroupPdf(posters: PosterRow[]) {
  const merged = await PDFDocument.create();

  for (const poster of posters) {
    const bytes = await generatePosterPdf({
      campaignSlug: poster.campaign_slug,
      style: poster.poster_type,
      content: buildPosterScanUrl(poster.qr_code_token),
      referralCode: poster.referral_code,
    });
    const single = await PDFDocument.load(bytes);
    const copiedPages = await merged.copyPages(single, single.getPageIndices());

    for (const page of copiedPages) {
      merged.addPage(page);
    }
  }

  return Buffer.from(await merged.save());
}
