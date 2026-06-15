import sql from "@/lib/database/client";

export type TopAmbassadorRange = "7d" | "month" | "all";
/** "all" leaves every region in; any other value is matched against ambassador_region. */
export type TopAmbassadorRegion = string;

export type TopAmbassadorEntry = {
  userId: string;
  name: string;
  region: string | null;
  state: string | null;
  posters: number;
  verifiedPosters: number;
  referrals: number;
  verifiedReferrals: number;
  rsvps: number;
  balanceCents: number;
};

type TopAmbassadorRow = {
  user_id: string;
  display_name: string | null;
  ambassador_region: string | null;
  state: string | null;
  balance_cents: number;
  poster_count: number;
  verified_poster_count: number;
  referral_count: number;
  verified_referral_count: number;
  rsvp_count: number;
};

/**
 * Loads every ambassador with poster or referral activity within the selected
 * window, ordered by verified activity. Returns the full set so the client can
 * re-sort by the active metric filter and paginate without another round-trip.
 * "Completed" counts (verified posters/referrals) are scoped to the same window
 * as the totals, so a row's verified count is always a subset of its total.
 * The region filter narrows to a single ambassador_region; 'all' leaves every
 * region in, and 'non-us' is everything except the United States. Balance is
 * the ambassador's current balance, not window-scoped.
 */
export async function loadTopAmbassadors(
  range: TopAmbassadorRange,
  region: TopAmbassadorRegion = "all",
): Promise<TopAmbassadorEntry[]> {
  const days = range === "7d" ? 7 : range === "month" ? 30 : null;
  const posterDateFilter =
    days === null ? sql`` : sql`AND created_at >= NOW() - ${days} * INTERVAL '1 day'`;
  const referralDateFilter =
    days === null ? sql`` : sql`AND referred_at >= NOW() - ${days} * INTERVAL '1 day'`;
  const regionFilter =
    region === "all"
      ? sql``
      : region === "non-us"
        ? sql`WHERE u.ambassador_region <> 'United States'`
        : sql`WHERE u.ambassador_region = ${region}`;

  const rows = await sql<TopAmbassadorRow[]>`
    WITH poster_counts AS (
      SELECT
        user_id,
        COUNT(*)::int AS poster_count,
        COUNT(*) FILTER (WHERE verification_status = 'success')::int AS verified_poster_count
      FROM posters
      WHERE deleted_at IS NULL ${posterDateFilter}
      GROUP BY user_id
    ),
    referral_counts AS (
      SELECT
        user_id,
        COUNT(*)::int AS referral_count,
        COUNT(*) FILTER (WHERE verification_status = 'verified')::int AS verified_referral_count,
        COUNT(*) FILTER (WHERE verification_status = 'rsvp')::int AS rsvp_count
      FROM stardance_referrals
      WHERE TRUE ${referralDateFilter}
      GROUP BY user_id
    ),
    combined AS (
      SELECT user_id FROM poster_counts
      UNION
      SELECT user_id FROM referral_counts
    ),
    metrics AS (
      SELECT
        u.id AS user_id,
        u.display_name,
        u.ambassador_region,
        u.region AS state,
        COALESCE(u.balance_cents, 0)::int AS balance_cents,
        COALESCE(pc.poster_count, 0)::int AS poster_count,
        COALESCE(pc.verified_poster_count, 0)::int AS verified_poster_count,
        COALESCE(rc.referral_count, 0)::int AS referral_count,
        COALESCE(rc.verified_referral_count, 0)::int AS verified_referral_count,
        COALESCE(rc.rsvp_count, 0)::int AS rsvp_count
      FROM combined c
      JOIN users u ON u.id = c.user_id
      LEFT JOIN poster_counts pc ON pc.user_id = c.user_id
      LEFT JOIN referral_counts rc ON rc.user_id = c.user_id
      ${regionFilter}
    )
    SELECT
      user_id,
      display_name,
      ambassador_region,
      state,
      balance_cents,
      poster_count,
      verified_poster_count,
      referral_count,
      verified_referral_count,
      rsvp_count
    FROM metrics
    ORDER BY (verified_poster_count + verified_referral_count + rsvp_count) DESC, user_id
  `;

  return rows.map((row) => ({
    userId: row.user_id,
    name: row.display_name ?? row.user_id,
    region: row.ambassador_region,
    state: row.state,
    posters: row.poster_count,
    verifiedPosters: row.verified_poster_count,
    referrals: row.referral_count,
    verifiedReferrals: row.verified_referral_count,
    rsvps: row.rsvp_count,
    balanceCents: row.balance_cents,
  }));
}
