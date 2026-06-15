import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";

type AirtableIdRef = {
  id: string;
  name: string;
};

type AirtableChoiceRef = AirtableIdRef;

export type ApplicationFieldKey =
  | "id"
  | "status"
  | "rejectionReason"
  | "preferredName"
  | "firstName"
  | "lastName"
  | "email"
  | "slackId"
  | "birthdate"
  | "addressLine1"
  | "addressLine2"
  | "addressCity"
  | "addressState"
  | "addressZip"
  | "addressCountry"
  | "phone"
  | "githubUrl"
  | "portfolioUrl"
  | "applicationFirstThingDo"
  | "applicationBestPlacePoster"
  | "idvStatus"
  | "ambassadors";

export type AmbassadorFieldKey =
  | "preferredName"
  | "firstName"
  | "lastName"
  | "onboardingStatus"
  | "tshirtSent";

export type OnboardingFieldKey =
  | "id"
  | "ambassador"
  | "status"
  | "hcbEmail";

export type MeetupFieldKey =
  | "name"
  | "prettyName"
  | "slug"
  | "season"
  | "date"
  | "concluded"
  | "status"
  | "channelId"
  | "ambassadorSlackId"
  | "ambassador"
  | "venueName"
  | "venueAddress"
  | "venueCity"
  | "venueState"
  | "venueZip"
  | "venueCountry"
  | "latitude"
  | "longitude"
  | "googleMapsUrl"
  | "appleMapsUrl";

export type MeetupParticipantFieldKey =
  | "meetup"
  | "name"
  | "email"
  | "slackId";

type AirtableTableKey =
  | "applications"
  | "ambassadors"
  | "onboarding"
  | "syncRoster"
  | "meetups"
  | "meetupParticipants";

type AirtableFieldKeysByTable = {
  applications: ApplicationFieldKey;
  ambassadors: AmbassadorFieldKey;
  onboarding: OnboardingFieldKey;
  meetups: MeetupFieldKey;
  meetupParticipants: MeetupParticipantFieldKey;
};

type AirtableFieldTableKey = keyof AirtableFieldKeysByTable;

type AirtableViewKeysByTable = {
  meetups: "publicStardance";
};

type AirtableViewTableKey = keyof AirtableViewKeysByTable;

type AirtableTableSchema = {
  id: string;
  name: string;
  fields?: Record<string, AirtableIdRef & { choices?: Record<string, AirtableChoiceRef> }>;
  views?: Record<string, AirtableIdRef>;
};

type AirtableSchema = {
  base: {
    id: string;
  };
  tables: {
    applications: AirtableTableSchema;
    ambassadors: AirtableTableSchema;
    onboarding: AirtableTableSchema;
    syncRoster: AirtableTableSchema;
    meetups: AirtableTableSchema;
    meetupParticipants: AirtableTableSchema;
  };
};

const AIRTABLE_TABLE_ENV_KEYS: Record<AirtableTableKey, string> = {
  applications: "AIRTABLE_APPLICATIONS_TABLE_ID",
  ambassadors: "AIRTABLE_AMBASSADORS_TABLE_ID",
  onboarding: "AIRTABLE_ONBOARDING_TABLE_ID",
  syncRoster: "AIRTABLE_SYNC_ROSTER_TABLE_ID",
  meetups: "AIRTABLE_MEETUPS_TABLE_ID",
  meetupParticipants: "AIRTABLE_MEETUP_PARTICIPANTS_TABLE_ID",
};

function toRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null;
}

function readFields(value: unknown) {
  const fields = toRecord(value);

  if (fields === null) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(fields).map(([key, entry]) => {
      const field = toRecord(entry);

      if (field === null || typeof field.id !== "string" || typeof field.name !== "string") {
        throw new Error(`Invalid Airtable field in src/lib/airtable.yaml for ${key}`);
      }

      return [key, { id: field.id, name: field.name, choices: readChoices(field.choices, key) }];
    }),
  );
}

function readChoices(value: unknown, fieldKey: string) {
  const choices = toRecord(value);

  if (choices === null) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(choices).map(([key, entry]) => {
      const choice = toRecord(entry);

      if (choice === null || typeof choice.id !== "string" || typeof choice.name !== "string") {
        throw new Error(`Invalid Airtable choice in src/lib/airtable.yaml for ${fieldKey}.${key}`);
      }

      return [key, { id: choice.id, name: choice.name }];
    }),
  );
}

function readViews(value: unknown) {
  const views = toRecord(value);

  if (views === null) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(views).map(([key, entry]) => {
      const view = toRecord(entry);

      if (view === null || typeof view.id !== "string" || typeof view.name !== "string") {
        throw new Error(`Invalid Airtable view in src/lib/airtable.yaml for ${key}`);
      }

      return [key, { id: view.id, name: view.name }];
    }),
  );
}

const parsedSchema = toRecord(parse(readFileSync(path.join(process.cwd(), "src/lib/airtable.yaml"), "utf8")));
const base = toRecord(parsedSchema?.base);
const tables = toRecord(parsedSchema?.tables);
const applications = toRecord(tables?.applications);
const ambassadors = toRecord(tables?.ambassadors);
const onboarding = toRecord(tables?.onboarding);
const syncRoster = toRecord(tables?.syncRoster);
const meetups = toRecord(tables?.meetups);
const meetupParticipants = toRecord(tables?.meetupParticipants);

if (
  base === null ||
  typeof base.id !== "string" ||
  applications === null ||
  typeof applications.id !== "string" ||
  typeof applications.name !== "string" ||
  ambassadors === null ||
  typeof ambassadors.id !== "string" ||
  typeof ambassadors.name !== "string" ||
  onboarding === null ||
  typeof onboarding.id !== "string" ||
  typeof onboarding.name !== "string" ||
  syncRoster === null ||
  typeof syncRoster.id !== "string" ||
  typeof syncRoster.name !== "string" ||
  meetups === null ||
  typeof meetups.id !== "string" ||
  typeof meetups.name !== "string" ||
  meetupParticipants === null ||
  typeof meetupParticipants.id !== "string" ||
  typeof meetupParticipants.name !== "string"
) {
  throw new Error("src/lib/airtable.yaml has an invalid shape");
}

const airtableSchema: AirtableSchema = {
  base: {
    id: base.id,
  },
  tables: {
    applications: {
      id: applications.id,
      name: applications.name,
      fields: readFields(applications.fields),
    },
    ambassadors: {
      id: ambassadors.id,
      name: ambassadors.name,
      fields: readFields(ambassadors.fields),
    },
    onboarding: {
      id: onboarding.id,
      name: onboarding.name,
      fields: readFields(onboarding.fields),
    },
    syncRoster: {
      id: syncRoster.id,
      name: syncRoster.name,
    },
    meetups: {
      id: meetups.id,
      name: meetups.name,
      fields: readFields(meetups.fields),
      views: readViews(meetups.views),
    },
    meetupParticipants: {
      id: meetupParticipants.id,
      name: meetupParticipants.name,
      fields: readFields(meetupParticipants.fields),
    },
  },
};

function getAirtableTable<TTable extends AirtableTableKey>(
  tableKey: TTable,
) {
  return airtableSchema.tables[tableKey];
}

function getAirtableFieldRef<TTable extends AirtableFieldTableKey>(
  tableKey: TTable,
  fieldKey: AirtableFieldKeysByTable[TTable],
) {
  const fields = getAirtableTable(tableKey).fields;

  if (fields === undefined) {
    throw new Error(`Airtable table ${tableKey} does not define any fields`);
  }

  return fields[fieldKey];
}

export function getAirtableBaseId() {
  const baseId = process.env.AIRTABLE_BASE_ID?.trim();
  return baseId !== undefined && baseId !== "" ? baseId : airtableSchema.base.id;
}

export function getAirtableTableId<TTable extends AirtableTableKey>(tableKey: TTable) {
  const envKey = AIRTABLE_TABLE_ENV_KEYS[tableKey];
  const override = process.env[envKey]?.trim();
  return override !== undefined && override !== "" ? override : getAirtableTable(tableKey).id;
}

export function getAirtableViewId<TTable extends AirtableViewTableKey>(
  tableKey: TTable,
  viewKey: AirtableViewKeysByTable[TTable],
) {
  const view = getAirtableTable(tableKey).views?.[viewKey];

  if (view === undefined) {
    throw new Error(`Airtable view ${tableKey}.${viewKey} is not defined`);
  }

  return view.id;
}

export function getAirtableFieldId<TTable extends AirtableFieldTableKey>(
  tableKey: TTable,
  fieldKey: AirtableFieldKeysByTable[TTable],
) {
  return getAirtableFieldRef(tableKey, fieldKey).id;
}

export function getAirtableFieldName<TTable extends AirtableFieldTableKey>(
  tableKey: TTable,
  fieldKey: AirtableFieldKeysByTable[TTable],
) {
  return getAirtableFieldRef(tableKey, fieldKey).name;
}

export function getAirtableFieldChoiceNames<TTable extends AirtableFieldTableKey>(
  tableKey: TTable,
  fieldKey: AirtableFieldKeysByTable[TTable],
) {
  const choices = getAirtableFieldRef(tableKey, fieldKey).choices;

  if (choices === undefined) {
    throw new Error(`Airtable field ${tableKey}.${fieldKey} does not define any choices`);
  }

  return Object.fromEntries(
    Object.entries(choices).map(([key, choice]) => [key, choice.name]),
  );
}

export function getAirtableFieldValue<TTable extends AirtableFieldTableKey>(
  fields: Record<string, unknown>,
  tableKey: TTable,
  fieldKey: AirtableFieldKeysByTable[TTable],
) {
  const field = getAirtableFieldRef(tableKey, fieldKey);
  return fields[field.id] ?? fields[field.name];
}
