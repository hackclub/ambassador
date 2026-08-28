import "server-only";

import { randomUUID } from "node:crypto";

import { type AirtableRecord, createAirtableClient } from "@/lib/airtable";
import {
  type AmbassadorFieldKey,
  type MeetupFieldKey,
  getAirtableBaseId,
  getAirtableFieldId,
  getAirtableFieldName,
  getAirtableFieldValue,
  getAirtableTableId,
} from "@/lib/airtable-schema";
import sql from "@/lib/database/client";
import { hasApprovedAmbassadorStatus } from "@/lib/posters/access";

export type Expedition = {
  id: string;
  name: string | null;
  prettyName: string | null;
  slug: string | null;
  date: string | null;
  concluded: boolean;
  venue: {
    name: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    country: string | null;
  };
  latitude: number | null;
  longitude: number | null;
  channelId: string | null;
  ambassadorSlackId: string | null;
  ambassadorName: string | null;
  googleMapsUrl: string | null;
  appleMapsUrl: string | null;
  participantSlackIds: string[];
};

export type AmbassadorExpedition = Pick<
  Expedition,
  | "id"
  | "name"
  | "prettyName"
  | "slug"
  | "date"
  | "concluded"
  | "venue"
  | "latitude"
  | "longitude"
  | "channelId"
  | "ambassadorSlackId"
  | "ambassadorName"
  | "googleMapsUrl"
  | "appleMapsUrl"
  | "participantSlackIds"
> & {
  status: string | null;
};

export type CreateExpeditionInput = {
  title: string;
  startsAt: string;
  venueName?: string;
  venueAddress: string;
  venueCity: string;
  venueState?: string;
  venueZip?: string;
  venueCountry?: string;
  googleMapsUrl?: string;
  appleMapsUrl?: string;
  ambassadorSlackId: string;
};

function toText(value: unknown): string | null {
  const text = Array.isArray(value) ? value.find((item) => typeof item === "string") : value;
  return typeof text === "string" && text.trim() !== "" ? text.trim() : null;
}

function toCoordinate(value: unknown): number | null {
  const parsed = Number.parseFloat(toText(value) ?? "");
  return Number.isFinite(parsed) ? parsed : null;
}

function firstLinkedId(value: unknown): string | null {
  return Array.isArray(value) ? value.find((item): item is string => typeof item === "string") ?? null : null;
}

function getClient() {
  const client = createAirtableClient(getAirtableBaseId());
  if (!client) throw new Error("AIRTABLE_PAT is not set");
  return client;
}

async function listAllRecords(table: string, options: { filterByFormula?: string; fields: string[] }) {
  const client = getClient();
  const records: AirtableRecord<Record<string, unknown>>[] = [];
  let offset: string | undefined;

  do {
    const page = await client.listRecords<Record<string, unknown>>(
      table,
      { filterByFormula: options.filterByFormula, fields: options.fields, pageSize: 100, offset },
      { returnFieldsByFieldId: true },
    );
    records.push(...page.records);
    offset = page.offset;
  } while (offset);

  return records;
}

const CACHE_TTL_MS = 60_000;

function cached<T>(load: () => Promise<T>) {
  let entry: { promise: Promise<T>; expiresAt: number } | null = null;

  return () => {
    if (entry === null || Date.now() > entry.expiresAt) {
      const next = { promise: load(), expiresAt: Date.now() + CACHE_TTL_MS };
      next.promise.catch(() => {
        if (entry === next) entry = null;
      });
      entry = next;
    }
    return entry.promise;
  };
}

const MEETUP_FIELD_KEYS: MeetupFieldKey[] = [
  "name", "prettyName", "slug", "date", "concluded", "channelId",
  "ambassadorSlackId", "ambassador", "venueName", "venueAddress", "venueCity",
  "venueState", "venueZip", "venueCountry", "latitude", "longitude", "googleMapsUrl", "appleMapsUrl",
];

const AMBASSADOR_MEETUP_FIELD_KEYS: MeetupFieldKey[] = [
  ...MEETUP_FIELD_KEYS,
  "status",
];

async function fetchAmbassadorNames(): Promise<Map<string, string>> {
  const records = await listAllRecords(getAirtableTableId("ambassadors"), {
    fields: (["preferredName", "firstName", "lastName"] as const).map((key) =>
      getAirtableFieldId("ambassadors", key),
    ),
  });

  const names = new Map<string, string>();

  for (const record of records) {
    const value = (key: AmbassadorFieldKey) => getAirtableFieldValue(record.fields, "ambassadors", key);
    const full = [toText(value("firstName")), toText(value("lastName"))]
      .filter((part): part is string => part !== null)
      .join(" ");
    const name = toText(value("preferredName")) ?? (full || null);
    if (name !== null) names.set(record.id, name);
  }

  return names;
}

async function fetchParticipantSlackIds(): Promise<Map<string, string[]>> {
  const records = await listAllRecords(getAirtableTableId("meetupParticipants"), {
    fields: (["meetup", "slackId"] as const).map((key) =>
      getAirtableFieldId("meetupParticipants", key),
    ),
  });

  const byMeetup = new Map<string, string[]>();

  for (const record of records) {
    const slackId = toText(getAirtableFieldValue(record.fields, "meetupParticipants", "slackId"));
    if (slackId === null) continue;

    const meetupIds = getAirtableFieldValue(record.fields, "meetupParticipants", "meetup");
    if (!Array.isArray(meetupIds)) continue;

    for (const id of meetupIds) {
      if (typeof id !== "string") continue;
      const list = byMeetup.get(id);
      if (list) list.push(slackId);
      else byMeetup.set(id, [slackId]);
    }
  }

  return byMeetup;
}

async function fetchPublicExpeditions(): Promise<Expedition[]> {
  const [records, ambassadorNames, slackIdsByMeetup] = await Promise.all([
    listAllRecords(getAirtableTableId("meetups"), {
      filterByFormula: `{${getAirtableFieldName("meetups", "status")}} = "Approved"`,
      fields: MEETUP_FIELD_KEYS.map((key) => getAirtableFieldId("meetups", key)),
    }),
    fetchAmbassadorNames(),
    fetchParticipantSlackIds(),
  ]);

  return records.map((record) => {
    const value = (key: MeetupFieldKey) => getAirtableFieldValue(record.fields, "meetups", key);
    const ambassadorId = firstLinkedId(value("ambassador"));

    return {
      id: record.id,
      name: toText(value("name")),
      prettyName: toText(value("prettyName")),
      slug: toText(value("slug")),
      date: toText(value("date")),
      concluded: value("concluded") === true,
      venue: {
        name: toText(value("venueName")),
        address: toText(value("venueAddress")),
        city: toText(value("venueCity")),
        state: toText(value("venueState")),
        country: toText(value("venueCountry")),
      },
      latitude: toCoordinate(value("latitude")),
      longitude: toCoordinate(value("longitude")),
      channelId: toText(value("channelId")),
      ambassadorSlackId: toText(value("ambassadorSlackId")),
      ambassadorName: ambassadorId === null ? null : ambassadorNames.get(ambassadorId) ?? null,
      googleMapsUrl: toText(value("googleMapsUrl")),
      appleMapsUrl: toText(value("appleMapsUrl")),
      participantSlackIds: slackIdsByMeetup.get(record.id) ?? [],
    };
  });
}

export const listPublicExpeditions = cached(fetchPublicExpeditions);

export async function isApprovedAmbassadorSlackId(slackIdInput: string) {
  const slackId = slackIdInput.trim();
  if (slackId === "") return false;

  const row = (await sql<{
    manual_dashboard_state: string | null;
    latest_application_status: string | null;
  }[]>`
    SELECT
      users.manual_dashboard_state,
      latest_application.status AS latest_application_status
    FROM users
    LEFT JOIN LATERAL (
      SELECT status
      FROM applications
      WHERE user_id = users.id
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    ) latest_application ON true
    WHERE users.slack_id = ${slackId}
    LIMIT 1
  `).at(0);

  return hasApprovedAmbassadorStatus({
    latestApplicationStatus: row?.latest_application_status ?? null,
    manualDashboardState: row?.manual_dashboard_state ?? null,
  });
}

function meetupRecordToAmbassadorExpedition(
  record: AirtableRecord<Record<string, unknown>>,
  ambassadorNames: Map<string, string>,
  slackIdsByMeetup: Map<string, string[]>,
): AmbassadorExpedition {
  const value = (key: MeetupFieldKey) => getAirtableFieldValue(record.fields, "meetups", key);
  const ambassadorId = firstLinkedId(value("ambassador"));

  return {
    id: record.id,
    name: toText(value("name")),
    prettyName: toText(value("prettyName")),
    slug: toText(value("slug")),
    date: toText(value("date")),
    concluded: value("concluded") === true,
    status: toText(value("status")),
    venue: {
      name: toText(value("venueName")),
      address: toText(value("venueAddress")),
      city: toText(value("venueCity")),
      state: toText(value("venueState")),
      country: toText(value("venueCountry")),
    },
    latitude: toCoordinate(value("latitude")),
    longitude: toCoordinate(value("longitude")),
    channelId: toText(value("channelId")),
    ambassadorSlackId: toText(value("ambassadorSlackId")),
    ambassadorName: ambassadorId === null ? null : ambassadorNames.get(ambassadorId) ?? null,
    googleMapsUrl: toText(value("googleMapsUrl")),
    appleMapsUrl: toText(value("appleMapsUrl")),
    participantSlackIds: slackIdsByMeetup.get(record.id) ?? [],
  };
}

function airtableStringLiteral(value: string) {
  return `"${value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"`;
}

export async function listAmbassadorExpeditions(
  ambassadorSlackId: string,
): Promise<AmbassadorExpedition[]> {
  const slackId = ambassadorSlackId.trim();
  if (slackId === "") return [];

  const [records, ambassadorNames, slackIdsByMeetup] = await Promise.all([
    listAllRecords(getAirtableTableId("meetups"), {
      filterByFormula: `{${getAirtableFieldName("meetups", "ambassadorSlackId")}} = ${airtableStringLiteral(slackId)}`,
      fields: AMBASSADOR_MEETUP_FIELD_KEYS.map((key) => getAirtableFieldId("meetups", key)),
    }),
    fetchAmbassadorNames(),
    fetchParticipantSlackIds(),
  ]);

  return records
    .map((record) => meetupRecordToAmbassadorExpedition(record, ambassadorNames, slackIdsByMeetup))
    .sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")));
}

function requiredText(value: string, fieldName: string) {
  const trimmed = value.trim();
  if (trimmed === "") {
    throw new Error(`${fieldName} is required`);
  }
  return trimmed;
}

function optionalText(value: string | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? undefined : trimmed;
}

function slugify(input: string) {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `${slug || "expedition"}-${randomUUID().slice(0, 8)}`;
}

export async function createAmbassadorExpedition(input: CreateExpeditionInput) {
  const title = requiredText(input.title, "Title");
  const startsAt = requiredText(input.startsAt, "Date/time");
  const venueAddress = requiredText(input.venueAddress, "Address");
  const venueCity = requiredText(input.venueCity, "City");
  const ambassadorSlackId = requiredText(input.ambassadorSlackId, "Slack ID");

  const client = getClient();
  const fields = {
    [getAirtableFieldId("meetups", "name")]: title,
    [getAirtableFieldId("meetups", "prettyName")]: title,
    [getAirtableFieldId("meetups", "slug")]: slugify(title),
    [getAirtableFieldId("meetups", "date")]: startsAt,
    [getAirtableFieldId("meetups", "status")]: "Pending",
    [getAirtableFieldId("meetups", "ambassadorSlackId")]: ambassadorSlackId,
    [getAirtableFieldId("meetups", "venueName")]: optionalText(input.venueName),
    [getAirtableFieldId("meetups", "venueAddress")]: venueAddress,
    [getAirtableFieldId("meetups", "venueCity")]: venueCity,
    [getAirtableFieldId("meetups", "venueState")]: optionalText(input.venueState),
    [getAirtableFieldId("meetups", "venueZip")]: optionalText(input.venueZip),
    [getAirtableFieldId("meetups", "venueCountry")]: optionalText(input.venueCountry) ?? "US",
    [getAirtableFieldId("meetups", "googleMapsUrl")]: optionalText(input.googleMapsUrl),
    [getAirtableFieldId("meetups", "appleMapsUrl")]: optionalText(input.appleMapsUrl),
  };

  const record = await client.createRecord<Record<string, unknown>>(
    getAirtableTableId("meetups"),
    fields,
  );

  return meetupRecordToAmbassadorExpedition(record, new Map(), new Map());
}
