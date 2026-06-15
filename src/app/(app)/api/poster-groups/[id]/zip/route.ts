import { getPosterGroupZipForUser } from "@/lib/posters/service";
import { posterErrorResponse, requirePosterSession } from "@/lib/posters/http";
import { checkRateLimit, getRateLimitKey, rateLimitResponse } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function GET(request: Request, context: RouteContext<"/api/poster-groups/[id]/zip">) {
  try {
    const session = await requirePosterSession();
    const rateLimit = await checkRateLimit({
      scope: "poster-download",
      key: getRateLimitKey(session.sub),
      limit: 1_000,
    });

    if (!rateLimit.ok) {
      return rateLimitResponse(rateLimit);
    }

    const { id } = await context.params;
    const unverifiedOnly = new URL(request.url).searchParams.get("scope") === "unverified";
    const { group, posters, zip } = await getPosterGroupZipForUser(session.sub, id, { unverifiedOnly });
    if (posters.length === 0) {
      return Response.json(
        { error: unverifiedOnly ? "No unverified posters to download." : "No posters to download." },
        { status: 404 },
      );
    }
    const safeName = (group.name ?? `group-${group.id}`).replace(/[^a-z0-9-_]+/gi, "-");
    const prefix = unverifiedOnly ? "unverified-posters" : "posters";

    return new Response(zip, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${prefix}-${safeName}.zip"`,
      },
    });
  } catch (error) {
    return posterErrorResponse(error, "Failed to generate poster group ZIP.", 404);
  }
}
