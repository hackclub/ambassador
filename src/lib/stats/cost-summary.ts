import sql from "@/lib/database/client";
import { getOfficeGrantCost } from "@/lib/hcb/office-grant-cost";
import { POSTER_PAYOUT_CENTS, REFERRAL_PAYOUT_CENTS } from "@/lib/payouts/service";
import { SUPPORTED_AMBASSADOR_REGIONS } from "@/lib/settings";
import { SHIRT_SIZES, shirtSku } from "@/lib/shop";
import { WarehouseApiClient } from "@/lib/warehouse";

/**
 * The campaign's full cost picture in cents, with a "United States" slice for
 * every bucket we can attribute to an ambassador's region. This is the single
 * source of truth for both the key-gated public stats endpoint and the
 * admin dashboard's cost display.
 */
export type CostSummary = {
  posterCents: number;
  posterCentsUS: number;
  referralCents: number;
  referralCentsUS: number;
  shirtCents: number;
  shirtCentsUS: number;
  adminCents: number;
  adminCentsUS: number;
  grantCents: number;
  grantCentsUS: number;
  reimbursementCents: number;
  totalCents: number;
  totalCentsUS: number;
  averageCostCents: number;
  averageCostCentsUS: number;
  totalCompletedReferrals: number;
  totalCompletedReferralsUS: number;
  totalReferrals: number;
  totalReferralsUS: number;
  totalApprovedAmbassadors: number;
  approvedAmbassadorsUS: number;
  regionCounts: Record<string, number>;
  warnings: string[];
  complete: boolean;
};

type CostRow = {
  poster_count: number;
  poster_count_us: number;
  referral_count: number;
  referral_count_us: number;
  referral_total_count: number;
  referral_total_count_us: number;
  admin_payout_cents: number;
  admin_payout_cents_us: number;
  positive_adjustment_cents: number;
  positive_adjustment_cents_us: number;
};

/**
 * Computes the full cost summary. The caller is responsible for ensuring the
 * database schema is migrated. Warehouse and HCB lookups can fail; failures are
 * surfaced as warnings rather than thrown, and the affected bucket reads zero.
 */
export async function computeCostSummary({
  forceRefresh = false,
}: { forceRefresh?: boolean } = {}): Promise<CostSummary> {
  const shirtSkus = SHIRT_SIZES.map((size) => shirtSku(size));
  const warnings: string[] = [];

  const [costRows, ambassadorRows, warehouseOrders, linkedRows, grantResult] = await Promise.all([
    sql<CostRow[]>`
      SELECT
        (SELECT COUNT(*) FROM posters
          WHERE verification_status = 'success' AND deleted_at IS NULL)::int AS poster_count,
        (SELECT COUNT(*) FROM posters
          JOIN users ON users.id = posters.user_id
          WHERE posters.verification_status = 'success'
            AND posters.deleted_at IS NULL
            AND users.ambassador_region = 'United States')::int AS poster_count_us,
        (SELECT COUNT(*) FROM stardance_referrals
          WHERE verification_status = 'verified')::int AS referral_count,
        (SELECT COUNT(*) FROM stardance_referrals
          JOIN users ON users.id = stardance_referrals.user_id
          WHERE stardance_referrals.verification_status = 'verified'
            AND users.ambassador_region = 'United States')::int AS referral_count_us,
        (SELECT COUNT(*) FROM stardance_referrals)::int AS referral_total_count,
        (SELECT COUNT(*) FROM stardance_referrals
          JOIN users ON users.id = stardance_referrals.user_id
          WHERE users.ambassador_region = 'United States')::int AS referral_total_count_us,
        (SELECT COALESCE(SUM(amount_cents), 0) FROM payouts
          WHERE created_by_admin_id IS NOT NULL
            AND status = 'approved')::int AS admin_payout_cents,
        (SELECT COALESCE(SUM(payouts.amount_cents), 0) FROM payouts
          JOIN users ON users.id = payouts.user_id
          WHERE payouts.created_by_admin_id IS NOT NULL
            AND payouts.status = 'approved'
            AND users.ambassador_region = 'United States')::int AS admin_payout_cents_us,
        (SELECT COALESCE(SUM(amount_cents), 0) FROM payout_balance_events
          WHERE reason = 'manual_adjustment'
            AND amount_cents > 0)::int AS positive_adjustment_cents,
        (SELECT COALESCE(SUM(payout_balance_events.amount_cents), 0) FROM payout_balance_events
          JOIN users ON users.id = payout_balance_events.user_id
          WHERE payout_balance_events.reason = 'manual_adjustment'
            AND payout_balance_events.amount_cents > 0
            AND users.ambassador_region = 'United States')::int AS positive_adjustment_cents_us
    `,
    // Approved ambassadors per region. "Approved" mirrors
    // hasApprovedAmbassadorStatus: a manual 'approved' state, or a latest
    // application that is Accepted (legacy 'approved' included).
    sql<{ region: string; count: number }[]>`
      SELECT
        COALESCE(users.ambassador_region, 'Unknown') AS region,
        COUNT(*)::int AS count
      FROM users
      LEFT JOIN LATERAL (
        SELECT status
        FROM applications
        WHERE user_id = users.id
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      ) latest_application ON true
      WHERE users.manual_dashboard_state = 'approved'
        OR latest_application.status IN ('Accepted', 'approved')
      GROUP BY COALESCE(users.ambassador_region, 'Unknown')
    `,
    new WarehouseApiClient().listOrders().catch(() => null),
    sql<{ warehouse_order_id: string; ambassador_region: string | null }[]>`
      SELECT orders.warehouse_order_id, users.ambassador_region
      FROM orders
      JOIN users ON users.id = orders.user_id
      WHERE orders.warehouse_order_id IS NOT NULL
        AND orders.sku = ANY(${shirtSkus}::text[])
    `,
    getOfficeGrantCost({ forceRefresh }).then(
      (data) => ({ ok: true as const, data }),
      (error: unknown) => ({ ok: false as const, error }),
    ),
  ]);

  const costs = costRows.at(0) ?? {
    poster_count: 0,
    poster_count_us: 0,
    referral_count: 0,
    referral_count_us: 0,
    referral_total_count: 0,
    referral_total_count_us: 0,
    admin_payout_cents: 0,
    admin_payout_cents_us: 0,
    positive_adjustment_cents: 0,
    positive_adjustment_cents_us: 0,
  };

  // 1. Posters and 2. referrals: each verified item is worth a fixed rate. The
  // US slice counts only items from United States ambassadors.
  const posterCents = costs.poster_count * POSTER_PAYOUT_CENTS;
  const posterCentsUS = costs.poster_count_us * POSTER_PAYOUT_CENTS;
  const referralCents = costs.referral_count * REFERRAL_PAYOUT_CENTS;
  const referralCentsUS = costs.referral_count_us * REFERRAL_PAYOUT_CENTS;

  // 3. Shirts: what we paid to fulfil ambassador shirt orders that actually
  // shipped. The warehouse doesn't report a contents cost, so use our known
  // per-shirt spend of $11.31 (each order is a single shirt); labor and postage
  // come from the warehouse. Costs are in dollars, so round to cents.
  let shirtCents = 0;
  let shirtCentsUS = 0;
  if (warehouseOrders === null) {
    warnings.push("shirt_cost_unavailable: warehouse API request failed");
  } else {
    const ambassadorOrderIds = new Set(linkedRows.map((r) => r.warehouse_order_id));
    const usOrderIds = new Set(
      linkedRows
        .filter((r) => r.ambassador_region === "United States")
        .map((r) => r.warehouse_order_id),
    );
    let shirtDollars = 0;
    let shirtDollarsUS = 0;
    for (const order of warehouseOrders) {
      if (
        (order.status === "dispatched" || order.status === "mailed") &&
        ambassadorOrderIds.has(order.id)
      ) {
        const orderDollars =
          11.31 +
          Number(order.labor_cost ?? 0) +
          Number(order.postage_cost ?? 0);
        shirtDollars += orderDollars;
        if (usOrderIds.has(order.id)) {
          shirtDollarsUS += orderDollars;
        }
      }
    }
    shirtCents = Math.round(shirtDollars * 100);
    shirtCentsUS = Math.round(shirtDollarsUS * 100);
  }

  // 4. Admin spend: admin-created payouts that were paid out, plus positive
  // manual balance adjustments.
  const adminCents = costs.admin_payout_cents + costs.positive_adjustment_cents;
  const adminCentsUS = costs.admin_payout_cents_us + costs.positive_adjustment_cents_us;

  // 5. Office grants and 6. reimbursements, both out of the campaign's HCB org.
  // Office-grant cost is the actual spend drawn down from active grants (not the
  // full amount granted); reimbursements are expense payouts.
  let grantCents = 0;
  let grantCentsUS = 0;
  let reimbursementCents = 0;
  if (grantResult.ok) {
    grantCents = grantResult.data.grantCents;
    grantCentsUS = grantResult.data.grantCentsUS;
    reimbursementCents = grantResult.data.reimbursementCents;
    if (grantResult.data.stale) {
      warnings.push("office_grant_cost_stale: served a cached value; HCB was unreachable");
    }
  } else {
    const message =
      grantResult.error instanceof Error
        ? grantResult.error.message
        : "office grant lookup failed";
    warnings.push(`office_grant_cost_unavailable: ${message}`);
  }

  // 7. Total of all buckets. The US total covers every bucket we can attribute
  // to an ambassador's region (posters, referrals, shirts, admin, office
  // grants); only reimbursements stay unattributed.
  const totalCents =
    posterCents + referralCents + shirtCents + adminCents + grantCents + reimbursementCents;
  const totalCentsUS =
    posterCentsUS + referralCentsUS + shirtCentsUS + adminCentsUS + grantCentsUS;

  // Region breakdown, seeded so every supported region (plus 'Unknown' for
  // ambassadors without one) is always present even at zero.
  const regionCounts: Record<string, number> = Object.fromEntries(
    [...SUPPORTED_AMBASSADOR_REGIONS, "Unknown"].map((region) => [region, 0]),
  );
  let totalApprovedAmbassadors = 0;
  for (const row of ambassadorRows) {
    regionCounts[row.region] = (regionCounts[row.region] ?? 0) + row.count;
    totalApprovedAmbassadors += row.count;
  }
  const approvedAmbassadorsUS = regionCounts["United States"] ?? 0;
  const averageCostCents =
    totalApprovedAmbassadors > 0 ? totalCents / totalApprovedAmbassadors : 0;
  const averageCostCentsUS =
    approvedAmbassadorsUS > 0 ? totalCentsUS / approvedAmbassadorsUS : 0;

  return {
    posterCents,
    posterCentsUS,
    referralCents,
    referralCentsUS,
    shirtCents,
    shirtCentsUS,
    adminCents,
    adminCentsUS,
    grantCents,
    grantCentsUS,
    reimbursementCents,
    totalCents,
    totalCentsUS,
    averageCostCents,
    averageCostCentsUS,
    totalCompletedReferrals: costs.referral_count,
    totalCompletedReferralsUS: costs.referral_count_us,
    totalReferrals: costs.referral_total_count,
    totalReferralsUS: costs.referral_total_count_us,
    totalApprovedAmbassadors,
    approvedAmbassadorsUS,
    regionCounts,
    warnings,
    complete: warnings.length === 0,
  };
}
