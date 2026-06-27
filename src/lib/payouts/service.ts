import "server-only";

import type { Sql, TransactionSql } from "postgres";

import sql from "@/lib/database/client";
import { ensureSchema } from "@/lib/database/ensure-schema";

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
type Executor = Sql<{}> | TransactionSql<{}>;

export const PAYOUT_STATUS_PENDING = "pending";
export const PAYOUT_STATUS_REJECTED = "rejected";
export const PAYOUT_STATUS_APPROVED = "approved";

export const PAYOUT_METHOD_WISE = "wise";
export const PAYOUT_METHOD_ACH = "ach";

export const MIN_AMBASSADOR_PAYOUT_CENTS = 2_000;
/** Per-item payout rates. The ledger triggers in 00034 use the same numbers. */
export const POSTER_PAYOUT_CENTS = 100;
export const REFERRAL_PAYOUT_CENTS = 50;

export type PayoutStatus =
  | typeof PAYOUT_STATUS_PENDING
  | typeof PAYOUT_STATUS_REJECTED
  | typeof PAYOUT_STATUS_APPROVED;

export type PayoutMethod = typeof PAYOUT_METHOD_WISE | typeof PAYOUT_METHOD_ACH;

export class PayoutRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "PayoutRequestError";
  }
}

type PayoutRow = {
  id: string;
  user_id: string;
  amount_cents: number;
  status: PayoutStatus;
  bank_transfer_method: PayoutMethod;
  banking_institution_name: string;
  iban: string | null;
  account_number: string | null;
  routing_number: string | null;
  ambassador_notes: string | null;
  admin_comment: string | null;
  public_comment: string | null;
  transfer_link: string | null;
  created_by_admin_id: string | null;
  bundle_frozen_at: string | null;
  submitted_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
  created_at: string;
  updated_at: string;
};

type AdminPayoutRow = PayoutRow & {
  user_email: string | null;
  user_display_name: string;
  user_balance_cents: number;
  hca_first_name: string | null;
  hca_last_name: string | null;
  address_line_1: string | null;
  address_line_2: string | null;
  address_city: string | null;
  address_state: string | null;
  address_postal_code: string | null;
  address_country: string | null;
  latest_application_name: string | null;
  latest_application_email: string | null;
};

type PayoutWithBalanceRow = PayoutRow & {
  user_balance_cents: number;
};

type BankInfo = {
  bankTransferMethod: PayoutMethod;
  bankingInstitutionName: string;
  iban: string | null;
  accountNumber: string | null;
  routingNumber: string | null;
};

export function formatUsdCents(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

function normalizeOptionalText(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function countWords(value: string) {
  const trimmed = value.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/).length;
}

function parseNotes(value: unknown, fieldName: string) {
  const notes = normalizeOptionalText(value);
  if (notes !== null && countWords(notes) > 2_000) {
    throw new PayoutRequestError(`${fieldName}_too_long`, 400);
  }
  return notes;
}

export function parseBalanceAdjustmentCents(value: unknown) {
  const amount =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^-?\d+$/.test(value.trim())
        ? Number(value.trim())
        : Number.NaN;

  if (!Number.isSafeInteger(amount) || amount === 0) {
    throw new PayoutRequestError("invalid_amount", 400);
  }

  return amount;
}

/** A dollar amount ("-5.50") from the admin UI, converted to cents. */
export function parseBalanceAdjustmentUsd(value: unknown) {
  const text =
    typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";

  if (!/^-?\d+(\.\d{1,2})?$/.test(text)) {
    throw new PayoutRequestError("invalid_amount", 400);
  }

  const negative = text.startsWith("-");
  const [whole, fraction = ""] = (negative ? text.slice(1) : text).split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0") || "0");
  const amount = negative ? -cents : cents;

  if (!Number.isSafeInteger(amount) || amount === 0) {
    throw new PayoutRequestError("invalid_amount", 400);
  }

  return amount;
}

export function parseBankInfo(payload: Record<string, unknown>): BankInfo {
  const methodValue = payload.bankTransferMethod ?? payload.method;
  const method = typeof methodValue === "string" ? methodValue.trim().toLowerCase() : "";
  const institution = normalizeOptionalText(payload.bankingInstitutionName);

  if (method !== PAYOUT_METHOD_WISE && method !== PAYOUT_METHOD_ACH) {
    throw new PayoutRequestError("invalid_bank_transfer_method", 400);
  }

  if (institution === null || institution.length > 200) {
    throw new PayoutRequestError("invalid_banking_institution_name", 400);
  }

  if (method === PAYOUT_METHOD_WISE) {
    const iban = normalizeOptionalText(payload.iban)?.replace(/\s+/g, "");
    if (iban === undefined || iban === null || iban.length < 8 || iban.length > 100) {
      throw new PayoutRequestError("invalid_iban", 400);
    }

    return {
      bankTransferMethod: method,
      bankingInstitutionName: institution,
      iban,
      accountNumber: null,
      routingNumber: null,
    };
  }

  const accountNumber = normalizeOptionalText(payload.accountNumber)?.replace(/\s+/g, "");
  const routingNumber = normalizeOptionalText(payload.routingNumber)?.replace(/\s+/g, "");

  if (
    accountNumber === undefined ||
    accountNumber === null ||
    !/^\d{4,17}$/.test(accountNumber)
  ) {
    throw new PayoutRequestError("invalid_account_number", 400);
  }

  if (
    routingNumber === undefined ||
    routingNumber === null ||
    !/^\d{9}$/.test(routingNumber)
  ) {
    throw new PayoutRequestError("invalid_routing_number", 400);
  }

  return {
    bankTransferMethod: method,
    bankingInstitutionName: institution,
    iban: null,
    accountNumber,
    routingNumber,
  };
}

/** Manual payouts are admin-created one-offs, independent of the balance. */
function isManualPayout(row: Pick<PayoutRow, "created_by_admin_id">) {
  return row.created_by_admin_id !== null;
}

/**
 * The amount shown for a payout. A pending *requested* payout whose bundle was
 * frozen at request shows that snapshot (`amount_cents`); a legacy pending one
 * still tracks the live balance. An approved payout is frozen at the amount
 * that was debited; a rejected one keeps the snapshot captured at request time.
 * Manual payouts always carry the fixed amount the admin chose.
 */
function effectiveAmountCents(row: PayoutRow, balanceCents: number) {
  if (row.status !== PAYOUT_STATUS_PENDING || isManualPayout(row)) {
    return row.amount_cents;
  }
  return row.bundle_frozen_at === null ? balanceCents : row.amount_cents;
}

function serializePayout(row: PayoutRow, balanceCents: number) {
  return {
    id: row.id,
    userId: row.user_id,
    amountCents: effectiveAmountCents(row, balanceCents),
    snapshotAmountCents: row.amount_cents,
    status: row.status,
    bankTransferMethod: row.bank_transfer_method,
    bankingInstitutionName: row.banking_institution_name,
    iban: row.iban,
    accountNumber: row.account_number,
    routingNumber: row.routing_number,
    ambassadorNotes: row.ambassador_notes,
    publicComment: row.public_comment,
    transferLink: row.transfer_link,
    submittedAt: row.submitted_at,
    reviewedAt: row.reviewed_at,
    reviewedBy: row.reviewed_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeAdminPayout(row: AdminPayoutRow) {
  const legalName = [row.hca_first_name, row.hca_last_name]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(" ");

  return {
    ...serializePayout(row, row.user_balance_cents),
    adminComment: row.admin_comment,
    createdByAdminId: row.created_by_admin_id,
    ambassador: {
      id: row.user_id,
      email: row.user_email ?? row.latest_application_email,
      displayName: row.user_display_name,
      balanceCents: row.user_balance_cents,
      legalName: legalName !== "" ? legalName : row.latest_application_name,
      address: {
        line1: row.address_line_1,
        line2: row.address_line_2,
        city: row.address_city,
        state: row.address_state,
        postalCode: row.address_postal_code,
        country: row.address_country,
      },
    },
  };
}

const PAYOUT_COLUMNS = sql`
  id, user_id, amount_cents, status, bank_transfer_method,
  banking_institution_name, iban, account_number, routing_number,
  ambassador_notes, admin_comment, public_comment, transfer_link,
  created_by_admin_id, bundle_frozen_at, submitted_at, reviewed_at, reviewed_by, created_at, updated_at
`;

async function getBalanceCents(executor: Executor, userId: string) {
  const row = (await executor<{ balance_cents: number }[]>`
    SELECT COALESCE(balance_cents, 0) AS balance_cents
    FROM users
    WHERE id = ${userId}
    LIMIT 1
  `).at(0);

  if (!row) {
    throw new PayoutRequestError("not_found", 404);
  }

  return row.balance_cents;
}

export async function getPayoutBalanceForUser(userId: string) {
  await ensureSchema();
  return { balanceCents: await getBalanceCents(sql, userId) };
}

export async function listPayoutsForUser(userId: string) {
  await ensureSchema();
  const row = (await sql<{ balance_cents: number; payouts: PayoutRow[] }[]>`
    SELECT
      COALESCE(u.balance_cents, 0) AS balance_cents,
      COALESCE(
        jsonb_agg(to_jsonb(p) ORDER BY p.created_at DESC, p.id DESC)
          FILTER (WHERE p.id IS NOT NULL),
        '[]'::jsonb
      ) AS payouts
    FROM users u
    LEFT JOIN payouts p ON p.user_id = u.id
    WHERE u.id = ${userId}
    GROUP BY u.id
  `).at(0);

  if (!row) {
    throw new PayoutRequestError("not_found", 404);
  }

  return {
    balance: { balanceCents: row.balance_cents },
    payouts: row.payouts.map((payout) => serializePayout(payout, row.balance_cents)),
  };
}

export type BalanceTransaction = {
  id: string;
  amountCents: number;
  reason: string;
  publicNote: string | null;
  balanceAfterCents: number;
  payoutId: string | null;
  createdAt: string;
};

/** The ambassador-facing transaction history. Internal notes are never exposed. */
export async function listBalanceTransactionsForUser(
  userId: string,
  { limit, offset }: { limit: number; offset: number },
): Promise<{ transactions: BalanceTransaction[]; total: number }> {
  await ensureSchema();
  const rows = await sql<
    {
      id: string;
      amount_cents: number;
      reason: string;
      public_note: string | null;
      balance_after_cents: number;
      payout_id: string | null;
      created_at: string;
      total: number;
    }[]
  >`
    SELECT id, amount_cents, reason, public_note, balance_after_cents, payout_id, created_at,
           COUNT(*) OVER()::int AS total
    FROM payout_balance_events
    WHERE user_id = ${userId}
    ORDER BY seq DESC
    LIMIT ${limit} OFFSET ${offset}
  `;

  return {
    transactions: rows.map((row) => ({
      id: row.id,
      amountCents: row.amount_cents,
      reason: row.reason,
      publicNote: row.public_note,
      balanceAfterCents: row.balance_after_cents,
      payoutId: row.payout_id,
      createdAt: row.created_at,
    })),
    total: rows.at(0)?.total ?? 0,
  };
}

export async function getPayoutForUser(userId: string, payoutId: string) {
  await ensureSchema();
  const row = (await sql<PayoutWithBalanceRow[]>`
    SELECT p.id, p.user_id, p.amount_cents, p.status, p.bank_transfer_method,
           p.banking_institution_name, p.iban, p.account_number, p.routing_number,
           p.ambassador_notes, p.admin_comment, p.public_comment, p.transfer_link,
           p.created_by_admin_id, p.bundle_frozen_at, p.submitted_at, p.reviewed_at, p.reviewed_by,
           p.created_at, p.updated_at,
           COALESCE(u.balance_cents, 0) AS user_balance_cents
    FROM payouts p
    JOIN users u ON u.id = p.user_id
    WHERE p.id = ${payoutId} AND p.user_id = ${userId}
    LIMIT 1
  `).at(0);

  if (!row) {
    throw new PayoutRequestError("not_found", 404);
  }

  return serializePayout(row, row.user_balance_cents);
}

/** An ambassador requesting a payout of their full balance. */
export async function createPayoutForUser(input: {
  userId: string;
  bankInfo: BankInfo;
  ambassadorNotes?: string | null;
  minimumAmountCents: number;
}) {
  await ensureSchema();

  return sql.begin(async (transaction) => {
    const user = (await transaction<{ balance_cents: number; has_pending_payout: boolean; ambassador_region: string | null }[]>`
      SELECT COALESCE(u.balance_cents, 0) AS balance_cents,
             u.ambassador_region,
             EXISTS (
               SELECT 1
               FROM payouts
               WHERE user_id = u.id
                 AND status = ${PAYOUT_STATUS_PENDING}
                 AND created_by_admin_id IS NULL
             ) AS has_pending_payout
      FROM users u
      WHERE u.id = ${input.userId}
      LIMIT 1
      FOR UPDATE
    `).at(0);

    if (!user) {
      throw new PayoutRequestError("not_found", 404);
    }

    // ACH is a US bank rail, so only US ambassadors may pick it; everyone else
    // pays out through Wise.
    if (
      input.bankInfo.bankTransferMethod === PAYOUT_METHOD_ACH &&
      user.ambassador_region !== "United States"
    ) {
      throw new PayoutRequestError("ach_not_available_for_region", 400);
    }

    const balanceCents = user.balance_cents;

    if (user.has_pending_payout) {
      throw new PayoutRequestError("payout_already_pending", 409);
    }

    if (balanceCents < input.minimumAmountCents) {
      throw new PayoutRequestError("minimum_payout_not_met", 409);
    }

    if (balanceCents <= 0) {
      throw new PayoutRequestError("insufficient_balance", 409);
    }

    const id = crypto.randomUUID();
    const row = (await transaction<PayoutRow[]>`
      INSERT INTO payouts (
        id, user_id, amount_cents, status, bank_transfer_method,
        banking_institution_name, iban, account_number, routing_number,
        ambassador_notes, bundle_frozen_at
      )
      VALUES (
        ${id}, ${input.userId}, ${balanceCents}, ${PAYOUT_STATUS_PENDING},
        ${input.bankInfo.bankTransferMethod}, ${input.bankInfo.bankingInstitutionName},
        ${input.bankInfo.iban}, ${input.bankInfo.accountNumber}, ${input.bankInfo.routingNumber},
        ${input.ambassadorNotes ?? null}, NOW()
      )
      RETURNING ${PAYOUT_COLUMNS}
    `.catch((error: unknown) => {
      // The idx_payouts_one_pending_per_user partial unique index is the
      // backstop for the pending check above.
      if ((error as { code?: string }).code === "23505") {
        throw new PayoutRequestError("payout_already_pending", 409);
      }
      throw error;
    })).at(0);

    if (!row) {
      throw new PayoutRequestError("create_failed", 500);
    }

    // Snapshot the verified posters/referrals into the payout now, so anything
    // verified while it sits pending rolls into the *next* payout instead.
    await freezePayoutLineItems(transaction, row);

    return serializePayout(row, balanceCents);
  });
}

/**
 * A manual payout: an admin pays an ambassador a fixed amount directly, like
 * a meetup stipend or a one-off bonus. It goes through the exact same review and
 * approval flow (including the required HCB transfer link) but has nothing to
 * do with the ambassador's balance: no poster/referral line items, no ledger
 * debit, and it doesn't occupy the one-pending-request slot.
 */
export async function createManualPayout(input: {
  userId: string;
  adminUserId: string;
  amountCents: number;
  bankInfo: BankInfo;
  internalNote?: string | null;
}) {
  await ensureSchema();

  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
    throw new PayoutRequestError("invalid_amount", 400);
  }

  return sql.begin(async (transaction) => {
    const user = (await transaction<{ balance_cents: number }[]>`
      SELECT COALESCE(balance_cents, 0) AS balance_cents
      FROM users
      WHERE id = ${input.userId}
      LIMIT 1
    `).at(0);

    if (!user) {
      throw new PayoutRequestError("not_found", 404);
    }

    const row = (await transaction<PayoutRow[]>`
      INSERT INTO payouts (
        id, user_id, amount_cents, status, bank_transfer_method,
        banking_institution_name, iban, account_number, routing_number,
        created_by_admin_id
      )
      VALUES (
        ${crypto.randomUUID()}, ${input.userId}, ${input.amountCents}, ${PAYOUT_STATUS_PENDING},
        ${input.bankInfo.bankTransferMethod}, ${input.bankInfo.bankingInstitutionName},
        ${input.bankInfo.iban}, ${input.bankInfo.accountNumber}, ${input.bankInfo.routingNumber},
        ${input.adminUserId}
      )
      RETURNING ${PAYOUT_COLUMNS}
    `).at(0);

    if (!row) {
      throw new PayoutRequestError("create_failed", 500);
    }

    if (input.internalNote) {
      await transaction`
        INSERT INTO payout_notes (id, payout_id, author_user_id, note)
        VALUES (${crypto.randomUUID()}, ${row.id}, ${input.adminUserId}, ${input.internalNote})
      `;
    }

    return serializePayout(row, user.balance_cents);
  });
}

/** Resolve an admin-typed identifier (a user id or an email) to a user id. */
export async function findUserIdByIdOrEmail(identifier: unknown) {
  await ensureSchema();

  const trimmed = typeof identifier === "string" ? identifier.trim() : "";
  if (trimmed === "") {
    return null;
  }

  const row = (await sql<{ id: string }[]>`
    SELECT id
    FROM users
    WHERE id = ${trimmed} OR LOWER(email) = ${trimmed.toLowerCase()}
    LIMIT 1
  `).at(0);

  return row?.id ?? null;
}

export type PayoutNote = {
  id: string;
  note: string;
  authorName: string | null;
  createdAt: string;
};

/** The internal notes log on a payout, newest first. Admins only. */
export async function listPayoutNotes(payoutId: string): Promise<PayoutNote[]> {
  await ensureSchema();

  const rows = await sql<
    { id: string; note: string; author_name: string | null; created_at: string }[]
  >`
    SELECT n.id, n.note, u.display_name AS author_name, n.created_at
    FROM payout_notes n
    LEFT JOIN users u ON u.id = n.author_user_id
    WHERE n.payout_id = ${payoutId}
    ORDER BY n.created_at DESC, n.id DESC
  `;

  return rows.map((row) => ({
    id: row.id,
    note: row.note,
    authorName: row.author_name,
    createdAt: row.created_at,
  }));
}

/** Append an internal note to a payout, whatever its status. */
export async function addPayoutNote(input: {
  payoutId: string;
  authorUserId: string;
  note: string;
}) {
  await ensureSchema();

  const note = parseRequiredReason(input.note, "note");

  const row = (await sql<{ id: string }[]>`
    INSERT INTO payout_notes (id, payout_id, author_user_id, note)
    SELECT ${crypto.randomUUID()}, p.id, ${input.authorUserId}, ${note}
    FROM payouts p
    WHERE p.id = ${input.payoutId}
    RETURNING id
  `).at(0);

  if (!row) {
    throw new PayoutRequestError("not_found", 404);
  }

  return { id: row.id };
}

/**
 * Items that are part of a payout are managed from the payout review screen,
 * not the user page. Two levels of lock:
 * - *consumed* (a line-item row exists, i.e. an approved or frozen
 *   retro-rejected payout paid for it): no status changes at all until the
 *   payout is reversed;
 * - *in the live bundle* of a pending requested payout (verified, unconsumed):
 *   changes must come from that payout's review screen (`viaPayoutId`).
 */
export async function assertPosterUnlockedForReview(
  posterId: string,
  viaPayoutId: string | null,
) {
  await ensureSchema();

  // A frozen payout's bundle is recorded in payout_posters from request time.
  // A finalized payout's membership locks the poster outright; a still-pending
  // payout's only lets it be edited from that payout's own review screen.
  const memberships = await sql<{ payout_id: string; status: PayoutStatus }[]>`
    SELECT pp.payout_id, pay.status
    FROM payout_posters pp
    JOIN payouts pay ON pay.id = pp.payout_id
    WHERE pp.poster_id = ${posterId}
  `;

  for (const membership of memberships) {
    if (membership.status !== PAYOUT_STATUS_PENDING || membership.payout_id !== viaPayoutId) {
      throw new PayoutRequestError("poster_locked_in_payout", 409);
    }
  }

  // Legacy pending payouts (requested before bundles were frozen) have no
  // line-item rows, so every verified poster of the user is still tied to them.
  const legacyBundle = (await sql<{ id: string }[]>`
    SELECT pay.id
    FROM payouts pay
    JOIN posters p ON p.user_id = pay.user_id
    WHERE p.id = ${posterId}
      AND p.verification_status = 'success'
      AND pay.status = ${PAYOUT_STATUS_PENDING}
      AND pay.created_by_admin_id IS NULL
      AND pay.bundle_frozen_at IS NULL
    LIMIT 1
  `).at(0);

  if (legacyBundle && legacyBundle.id !== viaPayoutId) {
    throw new PayoutRequestError("poster_locked_in_payout", 409);
  }
}

/** Same locking rules as posters; see assertPosterUnlockedForReview. */
export async function assertReferralUnlockedForReview(
  referralId: string,
  viaPayoutId: string | null,
) {
  await ensureSchema();

  const memberships = await sql<{ payout_id: string; status: PayoutStatus }[]>`
    SELECT pr.payout_id, pay.status
    FROM payout_referrals pr
    JOIN payouts pay ON pay.id = pr.payout_id
    WHERE pr.referral_id = ${referralId}
  `;

  for (const membership of memberships) {
    if (membership.status !== PAYOUT_STATUS_PENDING || membership.payout_id !== viaPayoutId) {
      throw new PayoutRequestError("referral_locked_in_payout", 409);
    }
  }

  const legacyBundle = (await sql<{ id: string }[]>`
    SELECT pay.id
    FROM payouts pay
    JOIN stardance_referrals r ON r.user_id = pay.user_id
    WHERE r.id = ${referralId}
      AND r.verification_status = 'verified'
      AND pay.status = ${PAYOUT_STATUS_PENDING}
      AND pay.created_by_admin_id IS NULL
      AND pay.bundle_frozen_at IS NULL
    LIMIT 1
  `).at(0);

  if (legacyBundle && legacyBundle.id !== viaPayoutId) {
    throw new PayoutRequestError("referral_locked_in_payout", 409);
  }
}

function adminPayoutSelect() {
  return sql`
    SELECT p.id, p.user_id, p.amount_cents, p.status, p.bank_transfer_method,
           p.banking_institution_name, p.iban, p.account_number, p.routing_number,
           p.ambassador_notes, p.admin_comment, p.public_comment, p.transfer_link,
           p.created_by_admin_id, p.bundle_frozen_at, p.submitted_at, p.reviewed_at, p.reviewed_by,
           p.created_at, p.updated_at,
           u.email AS user_email, u.display_name AS user_display_name,
           COALESCE(u.balance_cents, 0) AS user_balance_cents,
           u.hca_first_name, u.hca_last_name,
           COALESCE(u.hca_street_address, latest_application.address_line_1) AS address_line_1,
           latest_application.address_line_2 AS address_line_2,
           COALESCE(u.hca_locality, latest_application.address_city) AS address_city,
           COALESCE(u.hca_region, latest_application.address_state) AS address_state,
           COALESCE(u.hca_postal_code, latest_application.address_zip) AS address_postal_code,
           COALESCE(u.hca_country, latest_application.address_country) AS address_country,
           latest_application.name AS latest_application_name,
           latest_application.applicant_email AS latest_application_email
    FROM payouts p
    JOIN users u ON u.id = p.user_id
    LEFT JOIN LATERAL (
      SELECT name, applicant_email, address_line_1, address_line_2, address_city,
             address_state, address_zip, address_country
      FROM applications
      WHERE user_id = p.user_id
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    ) latest_application ON TRUE
  `;
}

export async function listAdminPayouts(status?: string | null) {
  await ensureSchema();
  const safeStatus =
    status === PAYOUT_STATUS_PENDING ||
    status === PAYOUT_STATUS_REJECTED ||
    status === PAYOUT_STATUS_APPROVED
      ? status
      : null;

  const rows = await sql<AdminPayoutRow[]>`
    ${adminPayoutSelect()}
    WHERE ${safeStatus}::text IS NULL OR p.status = ${safeStatus}
    ORDER BY p.created_at DESC, p.id DESC
  `;

  return { payouts: rows.map(serializeAdminPayout) };
}

/** The oldest pending payout, for the FIFO review queue. Skipped ids are excluded. */
export async function getNextPendingPayoutId(excludeIds: string[] = []): Promise<string | null> {
  await ensureSchema();
  const row = (await sql<{ id: string }[]>`
    SELECT id FROM payouts
    WHERE status = ${PAYOUT_STATUS_PENDING}
      AND NOT (id = ANY(${excludeIds}))
    ORDER BY created_at ASC, id ASC
    LIMIT 1
  `).at(0);
  return row?.id ?? null;
}

export async function getAdminPayout(payoutId: string) {
  await ensureSchema();
  const row = (await sql<AdminPayoutRow[]>`
    ${adminPayoutSelect()}
    WHERE p.id = ${payoutId}
    LIMIT 1
  `).at(0);

  if (!row) {
    throw new PayoutRequestError("not_found", 404);
  }

  return serializeAdminPayout(row);
}

export type PayoutPosterLineItem = {
  id: string;
  name: string | null;
  groupName: string | null;
  referralCode: string;
  verificationStatus: string;
  amountCents: number;
  counts: boolean;
  latitude: number | null;
  longitude: number | null;
  locationDescription: string | null;
  proofPath: string | null;
  proofContentType: string | null;
  submittedAt: string | null;
  verifiedAt: string | null;
  paid: boolean;
};

export type PayoutReferralLineItem = {
  id: string;
  name: string;
  email: string;
  slackId: string;
  verificationStatus: string;
  amountCents: number;
  counts: boolean;
  codeLabel: string | null;
  code: string | null;
  referredAt: string;
  paid: boolean;
};

export type PayoutLedgerEntry = {
  id: string;
  amountCents: number;
  reason: string;
  publicNote: string | null;
  note: string | null;
  createdAt: string;
};

/**
 * Everything that makes up a payout, for the admin review screen. Posters and
 * referrals are the *verified* items bundled in the payout (frozen line items
 * once finalized); `miscCents` is the remainder of the balance (meetup
 * adjustments, debt clawbacks) so the breakdown always sums to the live
 * balance. Manual payouts have no breakdown at all.
 */
export async function getPayoutBreakdown(payoutId: string) {
  await ensureSchema();

  const payout = (await sql<
    {
      id: string;
      user_id: string;
      status: PayoutStatus;
      created_by_admin_id: string | null;
      bundle_frozen_at: string | null;
      amount_cents: number;
      balance_cents: number;
    }[]
  >`
    SELECT p.id, p.user_id, p.status, p.created_by_admin_id,
           p.bundle_frozen_at, p.amount_cents,
           COALESCE(u.balance_cents, 0) AS balance_cents
    FROM payouts p
    JOIN users u ON u.id = p.user_id
    WHERE p.id = ${payoutId}
    LIMIT 1
  `).at(0);

  if (!payout) {
    throw new PayoutRequestError("not_found", 404);
  }

  // Manual payouts have no line items and nothing to reconcile; the amount
  // is whatever the admin set.
  if (isManualPayout(payout)) {
    return {
      balanceCents: payout.balance_cents,
      posterCountedCents: 0,
      referralCountedCents: 0,
      miscCents: 0,
      posters: [] as PayoutPosterLineItem[],
      referrals: [] as PayoutReferralLineItem[],
      ledger: [] as PayoutLedgerEntry[],
    };
  }

  const isPending = payout.status === PAYOUT_STATUS_PENDING;
  const frozen = payout.bundle_frozen_at !== null;
  // Frozen payouts (and every finalized payout) read their snapshotted bundle;
  // only a legacy pending payout still lists the live verified inventory.
  const readBundle = frozen || !isPending;

  const [posterRows, referralRows, ledgerRows] = await Promise.all([
    !readBundle
      ? sql<
          {
            id: string;
            name: string | null;
            group_name: string | null;
            referral_code: string;
            verification_status: string;
            latitude: number | null;
            longitude: number | null;
            location_description: string | null;
            proof_path: string | null;
            proof_content_type: string | null;
            submitted_at: string | null;
            verified_at: string | null;
          }[]
        >`
          SELECT p.id, p.name, g.name AS group_name, p.referral_code, p.verification_status,
                 p.latitude, p.longitude, p.location_description, p.proof_path,
                 p.proof_content_type, p.submitted_at, p.verified_at
          FROM posters p
          LEFT JOIN poster_groups g ON g.id = p.poster_group_id
          WHERE p.user_id = ${payout.user_id}
            AND p.deleted_at IS NULL
            AND p.verification_status = 'success'
            AND p.id NOT IN (SELECT pp.poster_id FROM payout_posters pp)
          ORDER BY p.verified_at DESC NULLS LAST, p.created_at DESC
        `
      : sql<
          {
            id: string;
            name: string | null;
            group_name: string | null;
            referral_code: string;
            verification_status: string;
            latitude: number | null;
            longitude: number | null;
            location_description: string | null;
            proof_path: string | null;
            proof_content_type: string | null;
            submitted_at: string | null;
            verified_at: string | null;
          }[]
        >`
          SELECT p.id, p.name, g.name AS group_name, p.referral_code, p.verification_status,
                 p.latitude, p.longitude, p.location_description, p.proof_path,
                 p.proof_content_type, p.submitted_at, p.verified_at
          FROM payout_posters pp
          JOIN posters p ON p.id = pp.poster_id
          LEFT JOIN poster_groups g ON g.id = p.poster_group_id
          WHERE pp.payout_id = ${payoutId}
          ORDER BY p.verified_at DESC NULLS LAST, p.created_at DESC
        `,
    !readBundle
      ? sql<
          {
            id: string;
            name: string;
            email: string;
            slack_id: string;
            verification_status: string;
            code_label: string | null;
            code: string | null;
            referred_at: string;
          }[]
        >`
          SELECT r.id, r.name, r.email, r.slack_id, r.verification_status,
                 c.label AS code_label, c.code AS code, r.referred_at
          FROM stardance_referrals r
          LEFT JOIN stardance_referral_codes c ON c.id = r.referral_code_id
          WHERE r.user_id = ${payout.user_id}
            AND r.verification_status = 'verified'
            AND r.id NOT IN (SELECT pr.referral_id FROM payout_referrals pr)
          ORDER BY r.referred_at DESC
        `
      : sql<
          {
            id: string;
            name: string;
            email: string;
            slack_id: string;
            verification_status: string;
            code_label: string | null;
            code: string | null;
            referred_at: string;
          }[]
        >`
          SELECT r.id, r.name, r.email, r.slack_id, r.verification_status,
                 c.label AS code_label, c.code AS code, r.referred_at
          FROM payout_referrals pr
          JOIN stardance_referrals r ON r.id = pr.referral_id
          LEFT JOIN stardance_referral_codes c ON c.id = r.referral_code_id
          WHERE pr.payout_id = ${payoutId}
          ORDER BY r.referred_at DESC
        `,
    sql<
      {
        id: string;
        amount_cents: number;
        reason: string;
        public_note: string | null;
        note: string | null;
        created_at: string;
      }[]
    >`
      SELECT id, amount_cents, reason, public_note, note, created_at
      FROM payout_balance_events
      WHERE user_id = ${payout.user_id}
        AND reason IN ('manual_adjustment', 'poster_unverified', 'referral_unverified')
      ORDER BY seq DESC
      LIMIT 50
    `,
  ]);

  const posters: PayoutPosterLineItem[] = posterRows.map((row) => ({
    id: row.id,
    name: row.name,
    groupName: row.group_name,
    referralCode: row.referral_code,
    verificationStatus: row.verification_status,
    amountCents: POSTER_PAYOUT_CENTS,
    counts: row.verification_status === "success",
    latitude: row.latitude,
    longitude: row.longitude,
    locationDescription: row.location_description,
    proofPath: row.proof_path,
    proofContentType: row.proof_content_type,
    submittedAt: row.submitted_at,
    verifiedAt: row.verified_at,
    paid: !isPending,
  }));

  const referrals: PayoutReferralLineItem[] = referralRows.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    slackId: row.slack_id,
    verificationStatus: row.verification_status,
    amountCents: REFERRAL_PAYOUT_CENTS,
    counts: row.verification_status === "verified",
    codeLabel: row.code_label,
    code: row.code,
    referredAt: row.referred_at,
    paid: !isPending,
  }));

  const posterCounted = posters.filter((p) => p.counts).length * POSTER_PAYOUT_CENTS;
  const referralCounted = referrals.filter((r) => r.counts).length * REFERRAL_PAYOUT_CENTS;
  // A frozen payout reconciles to its request-time snapshot (amount_cents): the
  // remainder is meetup adjustments and debt captured then, and the payable
  // total drops as bundled items are un-verified during review but never grows.
  // A legacy payout reconciles to the live balance instead.
  const miscCents = frozen
    ? payout.amount_cents - posters.length * POSTER_PAYOUT_CENTS - referrals.length * REFERRAL_PAYOUT_CENTS
    : payout.balance_cents - posterCounted - referralCounted;
  const balanceCents = frozen ? posterCounted + referralCounted + miscCents : payout.balance_cents;

  const ledger: PayoutLedgerEntry[] = ledgerRows.map((row) => ({
    id: row.id,
    amountCents: row.amount_cents,
    reason: row.reason,
    publicNote: row.public_note,
    note: row.note,
    createdAt: row.created_at,
  }));

  return {
    balanceCents,
    posterCountedCents: posterCounted,
    referralCountedCents: referralCounted,
    miscCents,
    posters,
    referrals,
    ledger,
  };
}

function parseTransferLink(value: unknown) {
  const transferLink = normalizeOptionalText(value);
  if (transferLink === null) {
    throw new PayoutRequestError("transfer_link_required", 400);
  }

  try {
    const url = new URL(transferLink);
    if (url.protocol !== "https:") {
      throw new Error("invalid protocol");
    }
  } catch {
    throw new PayoutRequestError("invalid_transfer_link", 400);
  }

  return transferLink;
}

/**
 * Freeze which posters/referrals a payout consumed, so they don't show up
 * again in the next one. A line-item row existing at all means the item was
 * consumed by a payout — reversed retro-rejections delete their rows.
 */
async function freezePayoutLineItems(
  executor: Executor,
  payout: Pick<PayoutRow, "id" | "user_id">,
) {
  await executor`
    INSERT INTO payout_posters (payout_id, poster_id, amount_cents)
    SELECT ${payout.id}, p.id, ${POSTER_PAYOUT_CENTS}
    FROM posters p
    WHERE p.user_id = ${payout.user_id}
      AND p.deleted_at IS NULL
      AND p.verification_status = 'success'
      AND p.id NOT IN (SELECT pp.poster_id FROM payout_posters pp)
    ON CONFLICT (payout_id, poster_id) DO NOTHING
  `;

  await executor`
    INSERT INTO payout_referrals (payout_id, referral_id, amount_cents)
    SELECT ${payout.id}, r.id, ${REFERRAL_PAYOUT_CENTS}
    FROM stardance_referrals r
    WHERE r.user_id = ${payout.user_id}
      AND r.verification_status = 'verified'
      AND r.id NOT IN (SELECT pr.referral_id FROM payout_referrals pr)
    ON CONFLICT (payout_id, referral_id) DO NOTHING
  `;
}

/**
 * Settle a payout whose bundle was frozen at request time: drop the bundled
 * posters/referrals that have since been un-verified, and return the amount
 * actually owed (the request snapshot minus those stale line items). The
 * remaining bundle is exactly what gets paid.
 */
async function settleFrozenBundle(
  executor: Executor,
  payout: Pick<PayoutRow, "id" | "amount_cents">,
) {
  const deducted =
    (await executor<{ cents: number }[]>`
      SELECT
        COALESCE((
          SELECT SUM(pp.amount_cents)::int
          FROM payout_posters pp
          JOIN posters p ON p.id = pp.poster_id
          WHERE pp.payout_id = ${payout.id} AND p.verification_status <> 'success'
        ), 0)
        + COALESCE((
          SELECT SUM(pr.amount_cents)::int
          FROM payout_referrals pr
          JOIN stardance_referrals r ON r.id = pr.referral_id
          WHERE pr.payout_id = ${payout.id} AND r.verification_status <> 'verified'
        ), 0) AS cents
    `).at(0)?.cents ?? 0;

  await executor`
    DELETE FROM payout_posters pp
    USING posters p
    WHERE pp.poster_id = p.id
      AND pp.payout_id = ${payout.id}
      AND p.verification_status <> 'success'
  `;
  await executor`
    DELETE FROM payout_referrals pr
    USING stardance_referrals r
    WHERE pr.referral_id = r.id
      AND pr.payout_id = ${payout.id}
      AND r.verification_status <> 'verified'
  `;

  return payout.amount_cents - deducted;
}

export async function reviewPayout(input: {
  payoutId: string;
  adminUserId: string;
  status?: PayoutStatus | null;
  transferLink?: unknown;
  adminComment?: string | null;
  publicComment?: string | null;
  /**
   * What rejecting does with the money (requested payouts only):
   * "reverse" (default) leaves the balance with the ambassador and keeps the
   * posters/referrals available; "freeze" *forfeits* — the balance is debited
   * and the bundled items are consumed so they can never be paid out.
   */
  rejectMode?: "reverse" | "freeze" | null;
}) {
  await ensureSchema();

  const status = input.status ?? null;
  if (
    status !== null &&
    status !== PAYOUT_STATUS_APPROVED &&
    status !== PAYOUT_STATUS_REJECTED
  ) {
    throw new PayoutRequestError("invalid_status", 400);
  }

  return sql.begin(async (transaction) => {
    const payout = (await transaction<PayoutRow[]>`
      SELECT ${PAYOUT_COLUMNS}
      FROM payouts
      WHERE id = ${input.payoutId}
      LIMIT 1
      FOR UPDATE
    `).at(0);

    if (!payout) {
      throw new PayoutRequestError("not_found", 404);
    }

    // Comment-only update (no status change): leave the payout where it is.
    if (status === null) {
      const row = (await transaction<PayoutWithBalanceRow[]>`
        WITH updated AS (
          UPDATE payouts
          SET admin_comment = ${input.adminComment ?? payout.admin_comment},
              public_comment = ${input.publicComment ?? payout.public_comment},
              updated_at = NOW()
          WHERE id = ${payout.id}
          RETURNING ${PAYOUT_COLUMNS}
        )
        SELECT updated.*, COALESCE(u.balance_cents, 0) AS user_balance_cents
        FROM updated
        JOIN users u ON u.id = updated.user_id
      `).at(0);

      if (!row) {
        throw new PayoutRequestError("review_failed", 500);
      }

      return serializePayout(row, row.user_balance_cents);
    }

    if (payout.status !== PAYOUT_STATUS_PENDING) {
      throw new PayoutRequestError("payout_already_finalized", 409);
    }

    if (status === PAYOUT_STATUS_REJECTED) {
      const isFrozen = payout.bundle_frozen_at !== null && !isManualPayout(payout);

      // "Don't return the money": forfeit the balance and consume the bundled
      // posters/referrals so none of it can be requested again. Only requested
      // payouts have money to forfeit — manual ones never touch the balance.
      const forfeit = input.rejectMode === "freeze" && !isManualPayout(payout);
      let forfeitedCents: number | null = null;

      if (forfeit) {
        const user = (await transaction<{ balance_cents: number }[]>`
          SELECT COALESCE(balance_cents, 0) AS balance_cents
          FROM users
          WHERE id = ${payout.user_id}
          LIMIT 1
          FOR UPDATE
        `).at(0);

        if (!user) {
          throw new PayoutRequestError("not_found", 404);
        }

        // A frozen payout forfeits only its snapshot (bundled items still
        // verified); a legacy one freezes whatever is verified now and forfeits
        // the entire live balance.
        let owedCents: number;
        if (isFrozen) {
          owedCents = Math.min(
            await settleFrozenBundle(transaction, payout),
            user.balance_cents,
          );
        } else {
          await freezePayoutLineItems(transaction, payout);
          owedCents = user.balance_cents;
        }

        if (owedCents > 0) {
          forfeitedCents = owedCents;
          await transaction`
            INSERT INTO payout_balance_events (id, user_id, payout_id, amount_cents, reason, note, public_note, created_by)
            VALUES (
              ${crypto.randomUUID()}, ${payout.user_id}, ${payout.id}, ${-forfeitedCents},
              ${"payout_forfeited"}, ${input.adminComment ?? null}, ${input.publicComment ?? null},
              ${input.adminUserId}
            )
          `;
        }
      } else if (isFrozen) {
        // Reverse-reject: release the frozen bundle so its posters/referrals
        // roll into the ambassador's next payout. The balance is left intact.
        await transaction`DELETE FROM payout_posters WHERE payout_id = ${payout.id}`;
        await transaction`DELETE FROM payout_referrals WHERE payout_id = ${payout.id}`;
      }

      const row = (await transaction<PayoutWithBalanceRow[]>`
        WITH updated AS (
          UPDATE payouts
          SET status = ${PAYOUT_STATUS_REJECTED},
              amount_cents = COALESCE(${forfeitedCents}, amount_cents),
              admin_comment = ${input.adminComment ?? payout.admin_comment},
              public_comment = ${input.publicComment ?? payout.public_comment},
              reviewed_at = NOW(),
              reviewed_by = ${input.adminUserId},
              updated_at = NOW()
          WHERE id = ${payout.id}
          RETURNING ${PAYOUT_COLUMNS}
        )
        SELECT updated.*, COALESCE(u.balance_cents, 0) AS user_balance_cents
        FROM updated
        JOIN users u ON u.id = updated.user_id
      `).at(0);

      if (!row) {
        throw new PayoutRequestError("review_failed", 500);
      }

      return serializePayout(row, row.user_balance_cents);
    }

    const transferLink = parseTransferLink(input.transferLink);

    // Approving a manual payout just attaches the transfer link; the amount
    // was fixed at creation and the balance/ledger were never involved.
    if (isManualPayout(payout)) {
      const row = (await transaction<PayoutWithBalanceRow[]>`
        WITH updated AS (
          UPDATE payouts
          SET status = ${PAYOUT_STATUS_APPROVED},
              transfer_link = ${transferLink},
              admin_comment = ${input.adminComment ?? payout.admin_comment},
              public_comment = ${input.publicComment ?? payout.public_comment},
              reviewed_at = NOW(),
              reviewed_by = ${input.adminUserId},
              updated_at = NOW()
          WHERE id = ${payout.id}
          RETURNING ${PAYOUT_COLUMNS}
        )
        SELECT updated.*, COALESCE(u.balance_cents, 0) AS user_balance_cents
        FROM updated
        JOIN users u ON u.id = updated.user_id
      `).at(0);

      if (!row) {
        throw new PayoutRequestError("review_failed", 500);
      }

      return serializePayout(row, row.user_balance_cents);
    }

    // Approval of a requested payout. A frozen payout pays its request-time
    // snapshot (minus any bundled item un-verified during review), leaving
    // anything verified since for the next payout; a legacy one pays out the
    // full live balance and snapshots its line items now.
    const user = (await transaction<{ balance_cents: number }[]>`
      SELECT COALESCE(balance_cents, 0) AS balance_cents
      FROM users
      WHERE id = ${payout.user_id}
      LIMIT 1
      FOR UPDATE
    `).at(0);

    if (!user) {
      throw new PayoutRequestError("not_found", 404);
    }

    let payoutCents: number;

    if (payout.bundle_frozen_at !== null) {
      payoutCents = await settleFrozenBundle(transaction, payout);

      if (payoutCents > user.balance_cents) {
        throw new PayoutRequestError("insufficient_balance", 409);
      }
    } else {
      payoutCents = user.balance_cents;
      await freezePayoutLineItems(transaction, payout);
    }

    if (payoutCents <= 0) {
      throw new PayoutRequestError("nothing_to_pay_out", 409);
    }

    // Debit the ledger. The BEFORE INSERT trigger applies it to balance_cents.
    const debit = (await transaction<{ balance_after_cents: number }[]>`
      INSERT INTO payout_balance_events (id, user_id, payout_id, amount_cents, reason, note, public_note, created_by)
      VALUES (
        ${crypto.randomUUID()}, ${payout.user_id}, ${payout.id}, ${-payoutCents},
        ${"payout_approved"}, ${input.adminComment ?? null}, ${input.publicComment ?? null},
        ${input.adminUserId}
      )
      RETURNING balance_after_cents
    `).at(0);

    if (!debit) {
      throw new PayoutRequestError("review_failed", 500);
    }

    const row = (await transaction<PayoutRow[]>`
      UPDATE payouts
      SET status = ${PAYOUT_STATUS_APPROVED},
          amount_cents = ${payoutCents},
          transfer_link = ${transferLink},
          admin_comment = ${input.adminComment ?? payout.admin_comment},
          public_comment = ${input.publicComment ?? payout.public_comment},
          reviewed_at = NOW(),
          reviewed_by = ${input.adminUserId},
          updated_at = NOW()
      WHERE id = ${payout.id}
      RETURNING ${PAYOUT_COLUMNS}
    `).at(0);

    if (!row) {
      throw new PayoutRequestError("review_failed", 500);
    }

    return serializePayout(row, debit.balance_after_cents);
  });
}

/**
 * Retroactively reject an *approved* payout. With `reverse`, the money comes
 * back: the debit is undone via a `payout_reverted` ledger credit, the frozen
 * line items are released so the posters/referrals count toward the next
 * payout, and the transfer link is cleared (for transfers that were canceled
 * or never sent). Without it the payout is only marked rejected: the balance
 * stays debited and the line items stay consumed.
 */
export async function retroRejectPayout(input: {
  payoutId: string;
  adminUserId: string;
  reverse: boolean;
  adminComment?: string | null;
  publicComment?: string | null;
}) {
  await ensureSchema();

  return sql.begin(async (transaction) => {
    const payout = (await transaction<PayoutRow[]>`
      SELECT ${PAYOUT_COLUMNS}
      FROM payouts
      WHERE id = ${input.payoutId}
      LIMIT 1
      FOR UPDATE
    `).at(0);

    if (!payout) {
      throw new PayoutRequestError("not_found", 404);
    }

    if (payout.status !== PAYOUT_STATUS_APPROVED) {
      throw new PayoutRequestError("payout_not_approved", 409);
    }

    if (input.reverse) {
      await transaction`DELETE FROM payout_posters WHERE payout_id = ${payout.id}`;
      await transaction`DELETE FROM payout_referrals WHERE payout_id = ${payout.id}`;

      // Credit back exactly what approval debited; manual payouts never
      // touched the ledger, so there is nothing to return for them. The
      // BEFORE INSERT trigger applies the credit to the cached balance.
      const debitedCents =
        (await transaction<{ cents: number }[]>`
          SELECT COALESCE(-SUM(amount_cents), 0)::int AS cents
          FROM payout_balance_events
          WHERE payout_id = ${payout.id} AND reason = 'payout_approved'
        `).at(0)?.cents ?? 0;

      if (debitedCents > 0) {
        await transaction`
          INSERT INTO payout_balance_events (id, user_id, payout_id, amount_cents, reason, note, public_note, created_by)
          VALUES (
            ${crypto.randomUUID()}, ${payout.user_id}, ${payout.id}, ${debitedCents},
            ${"payout_reverted"}, ${input.adminComment ?? null}, ${input.publicComment ?? null},
            ${input.adminUserId}
          )
        `;
      }
    }

    const row = (await transaction<PayoutWithBalanceRow[]>`
      WITH updated AS (
        UPDATE payouts
        SET status = ${PAYOUT_STATUS_REJECTED},
            transfer_link = ${input.reverse ? null : payout.transfer_link},
            admin_comment = ${input.adminComment ?? payout.admin_comment},
            public_comment = ${input.publicComment ?? payout.public_comment},
            reviewed_at = NOW(),
            reviewed_by = ${input.adminUserId},
            updated_at = NOW()
        WHERE id = ${payout.id}
        RETURNING ${PAYOUT_COLUMNS}
      )
      SELECT updated.*, COALESCE(u.balance_cents, 0) AS user_balance_cents
      FROM updated
      JOIN users u ON u.id = updated.user_id
    `).at(0);

    if (!row) {
      throw new PayoutRequestError("review_failed", 500);
    }

    return serializePayout(row, row.user_balance_cents);
  });
}

/** Replace the HCB transfer link on an approved payout (e.g. a wrong paste). */
export async function updatePayoutTransferLink(input: {
  payoutId: string;
  transferLink: unknown;
}) {
  await ensureSchema();

  const transferLink = parseTransferLink(input.transferLink);

  return sql.begin(async (transaction) => {
    const payout = (await transaction<PayoutRow[]>`
      SELECT ${PAYOUT_COLUMNS}
      FROM payouts
      WHERE id = ${input.payoutId}
      LIMIT 1
      FOR UPDATE
    `).at(0);

    if (!payout) {
      throw new PayoutRequestError("not_found", 404);
    }

    if (payout.status !== PAYOUT_STATUS_APPROVED) {
      throw new PayoutRequestError("payout_not_approved", 409);
    }

    const row = (await transaction<PayoutWithBalanceRow[]>`
      WITH updated AS (
        UPDATE payouts
        SET transfer_link = ${transferLink},
            updated_at = NOW()
        WHERE id = ${payout.id}
        RETURNING ${PAYOUT_COLUMNS}
      )
      SELECT updated.*, COALESCE(u.balance_cents, 0) AS user_balance_cents
      FROM updated
      JOIN users u ON u.id = updated.user_id
    `).at(0);

    if (!row) {
      throw new PayoutRequestError("review_failed", 500);
    }

    return {
      payout: serializePayout(row, row.user_balance_cents),
      previousTransferLink: payout.transfer_link,
    };
  });
}

export async function adjustUserBalance(input: {
  userId: string;
  adminUserId: string;
  amountCents: number;
  note: string;
  publicNote?: string | null;
  payoutId?: string | null;
}) {
  await ensureSchema();

  return sql.begin(async (transaction) => {
    const user = (await transaction<{ id: string }[]>`
      SELECT id FROM users WHERE id = ${input.userId} LIMIT 1 FOR UPDATE
    `).at(0);

    if (!user) {
      throw new PayoutRequestError("not_found", 404);
    }

    // A cross-linked payout must belong to the same user we're adjusting, so an
    // adjustment can't reference another user's payout id.
    if (input.payoutId != null) {
      const payout = (await transaction<{ user_id: string }[]>`
        SELECT user_id FROM payouts WHERE id = ${input.payoutId} LIMIT 1
      `).at(0);
      if (!payout || payout.user_id !== input.userId) {
        throw new PayoutRequestError("invalid_payout", 400);
      }
    }

    const row = (await transaction<{ balance_after_cents: number }[]>`
      INSERT INTO payout_balance_events (
        id, user_id, payout_id, amount_cents, reason, note, public_note, created_by
      )
      VALUES (
        ${crypto.randomUUID()}, ${input.userId}, ${input.payoutId ?? null}, ${input.amountCents},
        ${"manual_adjustment"}, ${input.note}, ${input.publicNote ?? null}, ${input.adminUserId}
      )
      RETURNING balance_after_cents
    `).at(0);

    return {
      userId: input.userId,
      amountCents: input.amountCents,
      balanceCents: row?.balance_after_cents ?? 0,
    };
  });
}

export function parseCreatePayoutPayload(payload: Record<string, unknown>) {
  return {
    bankInfo: parseBankInfo(payload),
    ambassadorNotes: parseNotes(payload.ambassadorNotes ?? payload.notes, "ambassador_notes"),
  };
}

export function parseAdminComment(value: unknown) {
  return parseNotes(value, "admin_comment");
}

/** A required reason (used for manual balance adjustments). */
export function parseRequiredReason(value: unknown, fieldName = "reason") {
  const reason = parseNotes(value, fieldName);
  if (reason === null) {
    throw new PayoutRequestError(`${fieldName}_required`, 400);
  }
  return reason;
}
