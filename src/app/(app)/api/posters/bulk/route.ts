import {
  getBulkPosterPdfForUser,
  getBulkPosterZipForUser,
  getUnverifiedPosterPdfForUser,
} from "@/lib/posters/service";
import { posterErrorResponse, requirePosterSession } from "@/lib/posters/http";
import { checkRateLimit, getRateLimitKey, rateLimitResponse } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const session = await requirePosterSession();
    const rateLimit = await checkRateLimit({
      scope: "poster-bulk-download",
      key: getRateLimitKey(session.sub),
      limit: 300,
    });

    if (!rateLimit.ok) {
      return rateLimitResponse(rateLimit);
    }

    const { searchParams } = new URL(request.url);
    const format = searchParams.get("format") === "zip" ? "zip" : "pdf";
    const unverifiedOnly = searchParams.get("scope") === "unverified";

    // The unverified scope is PDF-only (one printable sheet of what's left).
    if (format === "zip" && !unverifiedOnly) {
      const { zip, count } = await getBulkPosterZipForUser(session.sub);
      if (count === 0) {
        return Response.json({ error: "No posters to download." }, { status: 404 });
      }
      return new Response(zip, {
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="posters.zip"`,
        },
      });
    }

    const { pdf, count } = unverifiedOnly
      ? await getUnverifiedPosterPdfForUser(session.sub)
      : await getBulkPosterPdfForUser(session.sub);
    if (count === 0) {
      return Response.json(
        { error: unverifiedOnly ? "No unverified posters to download." : "No posters to download." },
        { status: 404 },
      );
    }
    return new Response(pdf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${unverifiedOnly ? "unverified-posters" : "all-posters"}.pdf"`,
      },
    });
  } catch (error) {
    return posterErrorResponse(error, "Failed to generate bulk download.", 500);
  }
}
