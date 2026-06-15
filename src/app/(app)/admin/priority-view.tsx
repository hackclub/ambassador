import { getLocale } from "next-intl/server";

import { loadTopAmbassadors } from "@/lib/admin/top-ambassadors";
import type { Scope } from "@/components/admin/priority-scope";
import sql from "@/lib/database/client";
import { loadPosterMapPoints } from "@/lib/posters/map-points";
import { SUPPORTED_AMBASSADOR_REGIONS } from "@/lib/settings";
import {
  PriorityDashboard,
  type PriorityActivityPoint,
  type RegionCount,
} from "@/components/admin/priority-dashboard";

type AmbassadorCountRow = {
  approved_total: number;
  approved_us: number;
  active_total: number;
  active_us: number;
};

type SignupsRow = {
  total: number;
  us: number;
  completed_total: number;
  completed_us: number;
  logged_users: number;
  logged_users_us: number;
  approved_users: number;
  approved_users_us: number;
};

type RegionRow = { region: string; count: number };

type ActivityRow = {
  day: Date | string;
  referrals: number;
  referrals_us: number;
  posters: number;
  posters_us: number;
  completed: number;
  completed_us: number;
  hours_logged: number;
  hours_logged_us: number;
  hours_approved: number;
  hours_approved_us: number;
};

export async function PriorityView({
  lockScopeAll = false,
  initialScope,
}: { lockScopeAll?: boolean; initialScope?: Scope } = {}) {
  const locale = await getLocale();
  const activityLabelFormatter = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
  });

  const [
    ambassadorRows,
    signupsRows,
    regionRows,
    stateRows,
    activityRows,
    topAmbassadorsData,
    posterPoints,
  ] = await Promise.all([
      // Approved = manual 'approved' state or a latest application that is
      // Accepted (legacy 'approved' included). Active = approved AND has logged
      // a (non-rejected) referral or submitted a poster in the last 14 days.
      sql<AmbassadorCountRow[]>`
        WITH amb AS (
          SELECT
            u.ambassador_region,
            (
              u.manual_dashboard_state = 'approved'
              OR la.status IN ('Accepted', 'approved')
            ) AS approved,
            (
              EXISTS (
                SELECT 1 FROM stardance_referrals r
                WHERE r.user_id = u.id
                  AND r.verification_status <> 'rejected'
                  AND r.referred_at >= NOW() - INTERVAL '14 days'
              )
              OR EXISTS (
                SELECT 1 FROM posters p
                WHERE p.user_id = u.id
                  AND p.deleted_at IS NULL
                  AND p.created_at >= NOW() - INTERVAL '14 days'
              )
            ) AS active_recent
          FROM users u
          LEFT JOIN LATERAL (
            SELECT status
            FROM applications
            WHERE user_id = u.id
            ORDER BY created_at DESC, id DESC
            LIMIT 1
          ) la ON true
        )
        SELECT
          COUNT(*) FILTER (WHERE approved)::int AS approved_total,
          COUNT(*) FILTER (WHERE approved AND ambassador_region = 'United States')::int AS approved_us,
          COUNT(*) FILTER (WHERE approved AND active_recent)::int AS active_total,
          COUNT(*) FILTER (
            WHERE approved AND active_recent AND ambassador_region = 'United States'
          )::int AS active_us
        FROM amb
      `,
      // Signups driven by ambassadors: every non-rejected referral, with the
      // completed (verified) subset, plus the United States slice of each.
      // Rejected referrals (e.g. self-referrals) are not real signups.
      sql<SignupsRow[]>`
        SELECT
          COUNT(*) FILTER (WHERE r.verification_status <> 'rejected')::int AS total,
          COUNT(*) FILTER (
            WHERE r.verification_status <> 'rejected'
              AND u.ambassador_region = 'United States'
          )::int AS us,
          COUNT(*) FILTER (WHERE r.verification_status = 'verified')::int AS completed_total,
          COUNT(*) FILTER (
            WHERE r.verification_status = 'verified'
              AND u.ambassador_region = 'United States'
          )::int AS completed_us,
          COUNT(*) FILTER (
            WHERE r.verification_status <> 'rejected' AND r.hours_logged > 0
          )::int AS logged_users,
          COUNT(*) FILTER (
            WHERE r.verification_status <> 'rejected' AND r.hours_logged > 0
              AND u.ambassador_region = 'United States'
          )::int AS logged_users_us,
          COUNT(*) FILTER (
            WHERE r.verification_status <> 'rejected' AND r.hours_approved > 0
          )::int AS approved_users,
          COUNT(*) FILTER (
            WHERE r.verification_status <> 'rejected' AND r.hours_approved > 0
              AND u.ambassador_region = 'United States'
          )::int AS approved_users_us
        FROM stardance_referrals r
        JOIN users u ON u.id = r.user_id
      `,
      sql<RegionRow[]>`
        SELECT COALESCE(u.ambassador_region, 'Unknown') AS region, COUNT(*)::int AS count
        FROM stardance_referrals r
        JOIN users u ON u.id = r.user_id
        WHERE r.verification_status <> 'rejected'
        GROUP BY 1
      `,
      // US-only breakdown by state (the geocoded users.region), so the US view
      // drills into states instead of repeating other countries. Top states
      // only; a long tail of one-off states would crowd the chart.
      sql<RegionRow[]>`
        SELECT COALESCE(NULLIF(TRIM(u.region), ''), 'Unknown') AS region, COUNT(*)::int AS count
        FROM stardance_referrals r
        JOIN users u ON u.id = r.user_id
        WHERE r.verification_status <> 'rejected'
          AND u.ambassador_region = 'United States'
        GROUP BY 1
        ORDER BY count DESC, region ASC
        LIMIT 12
      `,
      // Daily series across the whole campaign history (earliest referral or
      // poster through today), so the client can slice any window including
      // "all time" without a round-trip. Includes hours logged/approved.
      sql<ActivityRow[]>`
        WITH bounds AS (
          SELECT COALESCE(
            LEAST(
              (SELECT MIN(DATE(referred_at)) FROM stardance_referrals),
              (SELECT MIN(DATE(created_at)) FROM posters WHERE deleted_at IS NULL)
            ),
            CURRENT_DATE
          ) AS start_date
        ),
        days AS (
          SELECT generate_series(
            (SELECT start_date FROM bounds),
            CURRENT_DATE,
            INTERVAL '1 day'
          )::date AS day
        ),
        poster_totals AS (
          SELECT
            DATE(p.created_at) AS day,
            COUNT(*)::int AS posters,
            COUNT(*) FILTER (WHERE u.ambassador_region = 'United States')::int AS posters_us
          FROM posters p
          JOIN users u ON u.id = p.user_id
          WHERE p.deleted_at IS NULL
          GROUP BY 1
        ),
        referral_totals AS (
          SELECT
            DATE(r.referred_at) AS day,
            COUNT(*) FILTER (WHERE r.verification_status <> 'rejected')::int AS referrals,
            COUNT(*) FILTER (
              WHERE r.verification_status <> 'rejected'
                AND u.ambassador_region = 'United States'
            )::int AS referrals_us,
            COUNT(*) FILTER (WHERE r.verification_status = 'verified')::int AS completed,
            COUNT(*) FILTER (
              WHERE r.verification_status = 'verified'
                AND u.ambassador_region = 'United States'
            )::int AS completed_us,
            COALESCE(SUM(r.hours_logged) FILTER (WHERE r.verification_status <> 'rejected'), 0)::float AS hours_logged,
            COALESCE(SUM(r.hours_logged) FILTER (
              WHERE r.verification_status <> 'rejected'
                AND u.ambassador_region = 'United States'
            ), 0)::float AS hours_logged_us,
            COALESCE(SUM(r.hours_approved) FILTER (WHERE r.verification_status <> 'rejected'), 0)::float AS hours_approved,
            COALESCE(SUM(r.hours_approved) FILTER (
              WHERE r.verification_status <> 'rejected'
                AND u.ambassador_region = 'United States'
            ), 0)::float AS hours_approved_us
          FROM stardance_referrals r
          JOIN users u ON u.id = r.user_id
          GROUP BY 1
        )
        SELECT
          days.day,
          COALESCE(rt.referrals, 0)::int AS referrals,
          COALESCE(rt.referrals_us, 0)::int AS referrals_us,
          COALESCE(pt.posters, 0)::int AS posters,
          COALESCE(pt.posters_us, 0)::int AS posters_us,
          COALESCE(rt.completed, 0)::int AS completed,
          COALESCE(rt.completed_us, 0)::int AS completed_us,
          COALESCE(rt.hours_logged, 0)::float AS hours_logged,
          COALESCE(rt.hours_logged_us, 0)::float AS hours_logged_us,
          COALESCE(rt.hours_approved, 0)::float AS hours_approved,
          COALESCE(rt.hours_approved_us, 0)::float AS hours_approved_us
        FROM days
        LEFT JOIN poster_totals pt ON pt.day = days.day
        LEFT JOIN referral_totals rt ON rt.day = days.day
        ORDER BY days.day ASC
      `,
      // The priority leaderboard defaults to United States, so seed that slice.
      loadTopAmbassadors("all", "United States"),
      // Every verified poster with coordinates, with the placer attached so the
      // admin map's dots can say who put each one up.
      loadPosterMapPoints({ includePlacer: true }),
    ]);

  const ambassadors = ambassadorRows[0] ?? {
    approved_total: 0,
    approved_us: 0,
    active_total: 0,
    active_us: 0,
  };
  const signups = signupsRows[0] ?? {
    total: 0,
    us: 0,
    completed_total: 0,
    completed_us: 0,
    logged_users: 0,
    logged_users_us: 0,
    approved_users: 0,
    approved_users_us: 0,
  };

  // Seed every supported region at zero so the chart shape is stable, fold in
  // any straggler regions ('Unknown'), then order by signups for the bar graph.
  const regionTotals = new Map<string, number>(
    SUPPORTED_AMBASSADOR_REGIONS.map((region) => [region, 0]),
  );
  for (const row of regionRows) {
    regionTotals.set(row.region, (regionTotals.get(row.region) ?? 0) + row.count);
  }
  const signupsByRegion: RegionCount[] = [...regionTotals.entries()]
    .map(([region, count]) => ({ region, count }))
    .sort((a, b) => b.count - a.count || a.region.localeCompare(b.region));

  // Already ordered and capped by the query; the label is the US state.
  const signupsByState: RegionCount[] = stateRows.map((row) => ({
    region: row.region,
    count: row.count,
  }));

  const activityData: PriorityActivityPoint[] = activityRows.map((row) => ({
    label: activityLabelFormatter.format(new Date(row.day)),
    referrals: row.referrals,
    referralsUS: row.referrals_us,
    posters: row.posters,
    postersUS: row.posters_us,
    completed: row.completed,
    completedUS: row.completed_us,
    hoursLogged: Math.round(row.hours_logged * 10) / 10,
    hoursLoggedUS: Math.round(row.hours_logged_us * 10) / 10,
    hoursApproved: Math.round(row.hours_approved * 10) / 10,
    hoursApprovedUS: Math.round(row.hours_approved_us * 10) / 10,
  }));

  return (
    <PriorityDashboard
      lockScopeAll={lockScopeAll}
      initialScope={initialScope}
      locale={locale}
      activeAmbassadors={{
        activeTotal: ambassadors.active_total,
        activeUs: ambassadors.active_us,
        approvedTotal: ambassadors.approved_total,
        approvedUs: ambassadors.approved_us,
      }}
      signupsDriven={{
        total: signups.total,
        us: signups.us,
        completedTotal: signups.completed_total,
        completedUS: signups.completed_us,
      }}
      hoursUsers={{
        loggedTotal: signups.logged_users,
        loggedUs: signups.logged_users_us,
        approvedTotal: signups.approved_users,
        approvedUs: signups.approved_users_us,
      }}
      signupsByRegion={signupsByRegion}
      signupsByState={signupsByState}
      activityData={activityData}
      topAmbassadorsData={topAmbassadorsData}
      posterPoints={posterPoints}
    />
  );
}
