import {
  createAmbassadorExpedition,
  listAmbassadorExpeditions,
} from "@/lib/expeditions";
import { getPosterAccessState, hasApprovedAmbassadorStatus } from "@/lib/posters/access";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireExpeditionSession() {
  const session = await getSession();
  if (!session) {
    return { response: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const user = await getPosterAccessState(session.sub);
  if (
    user === null ||
    (!session.impersonator && !session.isAdmin && !user.is_admin &&
      !hasApprovedAmbassadorStatus({
        latestApplicationStatus: user.latest_application_status ?? null,
        manualDashboardState: user.manual_dashboard_state ?? null,
      }))
  ) {
    return { response: Response.json({ error: "Forbidden" }, { status: 403 }) };
  }

  const slackId = user.slack_id ?? session.slackId ?? null;
  if (!slackId) {
    return { response: Response.json({ error: "Slack account required" }, { status: 400 }) };
  }

  return { slackId };
}

export async function GET() {
  const result = await requireExpeditionSession();
  if ("response" in result) return result.response;

  try {
    return Response.json({
      expeditions: await listAmbassadorExpeditions(result.slackId),
    });
  } catch (error) {
    console.error(error);
    return Response.json({ error: "Failed to load expeditions." }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const result = await requireExpeditionSession();
  if ("response" in result) return result.response;

  const formData = await request.formData();

  try {
    const expedition = await createAmbassadorExpedition({
      title: String(formData.get("title") ?? ""),
      startsAt: String(formData.get("startsAt") ?? ""),
      venueName: String(formData.get("venueName") ?? ""),
      venueAddress: String(formData.get("venueAddress") ?? ""),
      venueCity: String(formData.get("venueCity") ?? ""),
      venueState: String(formData.get("venueState") ?? ""),
      venueZip: String(formData.get("venueZip") ?? ""),
      venueCountry: String(formData.get("venueCountry") ?? ""),
      googleMapsUrl: String(formData.get("googleMapsUrl") ?? ""),
      appleMapsUrl: String(formData.get("appleMapsUrl") ?? ""),
      ambassadorSlackId: result.slackId,
    });

    return Response.json({ expedition }, { status: 201 });
  } catch (error) {
    console.error(error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to submit expedition." },
      { status: 400 },
    );
  }
}
