import { revalidatePath } from "next/cache";

import { logAdminActionEvent } from "@/lib/admin-action-events";
import { getMetadataRecord } from "@/lib/admin-action-event-format";
import { isUserAdmin } from "@/lib/applications/review";
import sql from "@/lib/database/client";
import { ensureSchema } from "@/lib/database/ensure-schema";
import { getSafeRedirectUrl, isSameOriginRequest } from "@/lib/http";
import { recreateDeletedPoster, restoreDeletedPoster } from "@/lib/posters/repository";
import { getActorSession } from "@/lib/session";

export const runtime = "nodejs";

function metaString(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  return typeof value === "string" && value !== "" ? value : null;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isSameOriginRequest(request)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const session = await getActorSession();
  if (!session) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  await ensureSchema();
  if (!(await isUserAdmin(session.sub))) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const formData = await request.formData();
  const back = getSafeRedirectUrl(request, formData.get("redirectTo"), `/admin/audit-log/${id}`);

  const event = (await sql<{ action: string; metadata: unknown; target_user_id: string | null }[]>`
    SELECT action, metadata, target_user_id
    FROM admin_action_events
    WHERE id = ${id}
    LIMIT 1
  `).at(0) ?? null;

  if (event === null || event.action !== "poster_deleted") {
    return Response.redirect(back);
  }
  const metadata = getMetadataRecord(event.metadata) ?? {};
  const posterId = metaString(metadata, "posterId");

  if (posterId === null) {
    return Response.redirect(back);
  }

  let restored = await restoreDeletedPoster(posterId);

  if (restored === null) {
    const stillExists = (await sql`SELECT 1 FROM posters WHERE id = ${posterId} LIMIT 1`).at(0) !== undefined;
    const userId = event.target_user_id;
    const referralCode = metaString(metadata, "referralCode");
    const campaignSlug = metaString(metadata, "campaignSlug");
    if (!stillExists && userId !== null && referralCode !== null && campaignSlug !== null) {
      const status = metaString(metadata, "verificationStatus");
      const result = await recreateDeletedPoster({
        id: posterId,
        userId,
        campaignSlug,
        referralCode,
        posterType: metaString(metadata, "posterType") ?? "color",
        verificationStatus:
          status !== null && ["pending", "in_review", "success", "rejected", "digital"].includes(status)
            ? status
            : "pending",
        name: metaString(metadata, "posterName"),
        posterGroupId: metaString(metadata, "posterGroupId"),
      });
      if (result.status === "recreated") {
        restored = result.poster;
      }
    }
  }

  if (restored !== null) {
    await logAdminActionEvent({
      actorUserId: session.sub,
      targetUserId: restored.user_id,
      action: "poster_deletion_reverted",
      metadata: {
        posterId: restored.id,
        referralCode: restored.referral_code,
        posterName: restored.name ?? null,
        originalEventId: id,
      },
    });
    revalidatePath(`/admin/users/${restored.user_id}`);
  }
  revalidatePath("/admin/audit-log");
  revalidatePath(`/admin/audit-log/${id}`);

  return Response.redirect(back);
}
