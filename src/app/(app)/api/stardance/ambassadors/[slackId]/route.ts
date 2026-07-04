import { isApprovedAmbassadorSlackId } from "@/lib/expeditions";
import { requireStardanceDataKey } from "@/lib/stardance-data-key";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slackId: string }> },
) {
  const denied = requireStardanceDataKey(request);
  if (denied) {
    return denied;
  }

  const { slackId } = await params;

  try {
    return Response.json({
      ambassador: await isApprovedAmbassadorSlackId(decodeURIComponent(slackId)),
    });
  } catch (error) {
    console.error(error);
    return Response.json({ error: "Failed to load ambassador status." }, { status: 502 });
  }
}
