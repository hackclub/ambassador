import {
  addPostersToGroupForUser,
  deletePosterGroupForUser,
  getPosterGroupForUserOrThrow,
  moveGroupForUser,
  renamePosterGroupForUser,
  toClientPosterGroupDetail,
} from "@/lib/posters/service";
import { logAdminActionEvent } from "@/lib/admin-action-events";
import { isSameOriginRequest, posterErrorResponse, requirePosterSession } from "@/lib/posters/http";
import { checkRateLimit, getRateLimitKey, rateLimitResponse } from "@/lib/rate-limit";
import { revalidatePath } from "next/cache";

export const runtime = "nodejs";

export async function GET(_request: Request, context: RouteContext<"/api/poster-groups/[id]">) {
  try {
    const session = await requirePosterSession();
    const { id } = await context.params;
    const { group, posters } = await getPosterGroupForUserOrThrow(session.sub, id);
    return Response.json(toClientPosterGroupDetail(group, posters));
  } catch (error) {
    return posterErrorResponse(error, "Failed to load poster group.", 404);
  }
}

export async function POST(request: Request, context: RouteContext<"/api/poster-groups/[id]">) {
  if (!isSameOriginRequest(request)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    const session = await requirePosterSession();
    const rateLimit = await checkRateLimit({
      scope: "poster-create",
      key: getRateLimitKey(session.sub),
      limit: 1_000,
    });

    if (!rateLimit.ok) {
      return rateLimitResponse(rateLimit);
    }

    const { id } = await context.params;
    const body = await request.json();
    const payload: Record<string, unknown> | null =
      typeof body === "object" && body !== null && !Array.isArray(body)
        ? Object.fromEntries(Object.entries(body))
        : null;
    const result = await addPostersToGroupForUser({
      userId: session.sub,
      groupId: id,
      count: typeof payload?.count === "number" && Number.isFinite(payload.count) ? payload.count : 1,
    });
    return Response.json(toClientPosterGroupDetail(result.group, result.posters), {
      status: 201,
    });
  } catch (error) {
    return posterErrorResponse(error, "Failed to add posters to group.", 400);
  }
}

export async function PATCH(request: Request, context: RouteContext<"/api/poster-groups/[id]">) {
  if (!isSameOriginRequest(request)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    const session = await requirePosterSession();
    const rateLimit = await checkRateLimit({
      scope: "poster-write",
      key: getRateLimitKey(session.sub),
      limit: 1_000,
    });

    if (!rateLimit.ok) {
      return rateLimitResponse(rateLimit);
    }

    const { id } = await context.params;
    const body = (await request.json().catch(() => null)) as
      | { action?: unknown; targetGroupId?: unknown; name?: unknown }
      | null;

    // Move/merge the whole group: targetGroupId is another group id, or null to
    // send every poster back to ungrouped.
    if (body?.action === "move") {
      const target = body.targetGroupId;
      if (target !== null && typeof target !== "string") {
        return Response.json({ error: "Invalid target group." }, { status: 400 });
      }
      const result = await moveGroupForUser({
        userId: session.sub,
        sourceGroupId: id,
        targetGroupId: target,
      });
      return Response.json(result);
    }

    const rawName = body?.name;
    if (rawName !== null && typeof rawName !== "string" && rawName !== undefined) {
      return Response.json({ error: "Invalid name." }, { status: 400 });
    }

    const result = await renamePosterGroupForUser(
      session.sub,
      id,
      typeof rawName === "string" ? rawName : null,
    );
    return Response.json(result);
  } catch (error) {
    return posterErrorResponse(error, "Failed to rename poster group.", 400);
  }
}

export async function DELETE(request: Request, context: RouteContext<"/api/poster-groups/[id]">) {
  if (!isSameOriginRequest(request)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    const session = await requirePosterSession();
    const rateLimit = await checkRateLimit({
      scope: "poster-write",
      key: getRateLimitKey(session.sub),
      limit: 1_000,
    });

    if (!rateLimit.ok) {
      return rateLimitResponse(rateLimit);
    }

    const { id } = await context.params;
    const result = await deletePosterGroupForUser(session.sub, id);
    await logAdminActionEvent({
      actorUserId: session.impersonator?.sub ?? session.sub,
      targetUserId: result.group.user_id,
      action: "poster_group_deleted",
      metadata: {
        posterGroupId: result.group.id,
        posterGroupName: result.group.name ?? null,
        campaignSlug: result.group.campaign_slug,
        posterCount: result.posters.length,
        posterIds: result.posters.map((poster) => poster.id),
        referralCodes: result.posters.map((poster) => poster.referral_code),
      },
    });
    revalidatePath("/admin/audit-log");
    return Response.json(toClientPosterGroupDetail(result.group, result.posters));
  } catch (error) {
    return posterErrorResponse(error, "Failed to delete poster group.", 400);
  }
}
