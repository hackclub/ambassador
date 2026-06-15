import {
  AdminDashboardCharts,
  type DashboardActivityPoint,
  type DashboardBreakdownPoint,
  type DashboardFunnelPoint,
} from "@/components/admin/admin-dashboard-charts";
import Icon from "@hackclub/icons";
import { getLocale, getTranslations } from "next-intl/server";
import {
  APPLICATION_STATUS_ACCEPTED,
  APPLICATION_STATUS_PENDING_AUTOMATIC_CHECKS,
  APPLICATION_STATUS_PENDING_REVIEW,
  APPLICATION_STATUS_REJECTED,
  APPLICATION_STATUS_REJECTED_PERMANENT,
} from "@/lib/applications/status";
import sql from "@/lib/database/client";
import { loadTopAmbassadors } from "@/lib/admin/top-ambassadors";

type SummaryRow = {
  visitor_count: number;
  total_visit_count: number;
  signup_count: number;
  applicant_count: number;
  pending_count: number;
};

type ActivityRow = {
  day: Date | string;
  visits: number;
  signups: number;
  applications: number;
  posters: number;
  referrals: number;
};

type OutcomeSummaryRow = {
  pending_count: number;
  approved_count: number;
  rejected_count: number;
  banned_count: number;
};

type ReferralDropOffRow = {
  total_count: number;
  rsvp_count: number;
  unverified_count: number;
  pending_count: number;
  verified_count: number;
  rejected_count: number;
};

type PosterStatusRow = {
  total_count: number;
  pending_count: number;
  in_review_count: number;
  success_count: number;
  rejected_count: number;
  digital_count: number;
};

export const ACTIVITY_RANGE_DAYS = {
  "7d": 7,
  "14d": 14,
  "30d": 30,
  "90d": 90,
} as const;

export type ActivityRange = keyof typeof ACTIVITY_RANGE_DAYS;

export async function DetailedView({ activeRange }: { activeRange: ActivityRange }) {
  const [t, locale] = await Promise.all([getTranslations(), getLocale()]);
  const rangeDays = ACTIVITY_RANGE_DAYS[activeRange];
  const numberFormatter = new Intl.NumberFormat(locale);
  const activityLabelFormatter = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
  });

  const [
    summaryRows,
    activityRows,
    outcomeRows,
    referralDropOffRows,
    posterStatusRows,
    topAmbassadorsData,
  ] = await Promise.all([
    sql<SummaryRow[]>`
      SELECT
        (
          SELECT COUNT(DISTINCT COALESCE(user_id, ip))::int
          FROM ip_visits
        ) AS visitor_count,
        (
          SELECT COUNT(*)::int
          FROM ip_visits
        ) AS total_visit_count,
        (
          SELECT COUNT(*)::int
          FROM users
        ) AS signup_count,
        (
          SELECT COUNT(*)::int
          FROM applications
        ) AS applicant_count,
        (
          SELECT COUNT(*)::int
          FROM applications
          WHERE status IN (
            ${APPLICATION_STATUS_PENDING_AUTOMATIC_CHECKS},
            ${APPLICATION_STATUS_PENDING_REVIEW}
          )
        ) AS pending_count
    `,
    sql<ActivityRow[]>`
      WITH days AS (
        SELECT generate_series(
          CURRENT_DATE - ${rangeDays - 1} * INTERVAL '1 day',
          CURRENT_DATE,
          INTERVAL '1 day'
        )::date AS day
      ),
      visit_totals AS (
        SELECT DATE(created_at) AS day, COUNT(*)::int AS visits
        FROM ip_visits
        WHERE created_at >= CURRENT_DATE - ${rangeDays - 1} * INTERVAL '1 day'
        GROUP BY 1
      ),
      signup_totals AS (
        SELECT DATE(created_at) AS day, COUNT(*)::int AS signups
        FROM users
        WHERE created_at >= CURRENT_DATE - ${rangeDays - 1} * INTERVAL '1 day'
        GROUP BY 1
      ),
      application_totals AS (
        SELECT DATE(created_at) AS day, COUNT(*)::int AS applications
        FROM applications
        WHERE created_at >= CURRENT_DATE - ${rangeDays - 1} * INTERVAL '1 day'
        GROUP BY 1
      ),
      poster_totals AS (
        SELECT DATE(created_at) AS day, COUNT(*)::int AS posters
        FROM posters
        WHERE deleted_at IS NULL
          AND created_at >= CURRENT_DATE - ${rangeDays - 1} * INTERVAL '1 day'
        GROUP BY 1
      ),
      referral_totals AS (
        SELECT DATE(referred_at) AS day, COUNT(*)::int AS referrals
        FROM stardance_referrals
        WHERE referred_at >= CURRENT_DATE - ${rangeDays - 1} * INTERVAL '1 day'
        GROUP BY 1
      )
      SELECT
        days.day,
        COALESCE(visit_totals.visits, 0)::int AS visits,
        COALESCE(signup_totals.signups, 0)::int AS signups,
        COALESCE(application_totals.applications, 0)::int AS applications,
        COALESCE(poster_totals.posters, 0)::int AS posters,
        COALESCE(referral_totals.referrals, 0)::int AS referrals
      FROM days
      LEFT JOIN visit_totals ON visit_totals.day = days.day
      LEFT JOIN signup_totals ON signup_totals.day = days.day
      LEFT JOIN application_totals ON application_totals.day = days.day
      LEFT JOIN poster_totals ON poster_totals.day = days.day
      LEFT JOIN referral_totals ON referral_totals.day = days.day
      ORDER BY days.day ASC
    `,
    sql<OutcomeSummaryRow[]>`
      SELECT
        COUNT(*) FILTER (
          WHERE status IN (
            ${APPLICATION_STATUS_PENDING_AUTOMATIC_CHECKS},
            ${APPLICATION_STATUS_PENDING_REVIEW}
          )
        )::int AS pending_count,
        COUNT(*) FILTER (
          WHERE LOWER(status) = LOWER(${APPLICATION_STATUS_ACCEPTED}::text)
        )::int AS approved_count,
        COUNT(*) FILTER (
          WHERE LOWER(status) = LOWER(${APPLICATION_STATUS_REJECTED}::text)
        )::int AS rejected_count,
        COUNT(*) FILTER (
          WHERE LOWER(status) IN (
            LOWER(${APPLICATION_STATUS_REJECTED_PERMANENT}::text),
            LOWER('Rejected Permanent')
          )
        )::int AS banned_count
      FROM applications
    `,
    sql<ReferralDropOffRow[]>`
      SELECT
        COUNT(*) FILTER (WHERE verification_status <> 'rejected')::int AS total_count,
        COUNT(*) FILTER (WHERE verification_status = 'rsvp')::int AS rsvp_count,
        COUNT(*) FILTER (WHERE verification_status = 'unverified')::int AS unverified_count,
        COUNT(*) FILTER (WHERE verification_status = 'pending')::int AS pending_count,
        COUNT(*) FILTER (WHERE verification_status = 'verified')::int AS verified_count,
        COUNT(*) FILTER (WHERE verification_status = 'rejected')::int AS rejected_count
      FROM stardance_referrals
    `,
    sql<PosterStatusRow[]>`
      SELECT
        COUNT(*)::int AS total_count,
        COUNT(*) FILTER (WHERE verification_status = 'pending')::int AS pending_count,
        COUNT(*) FILTER (WHERE verification_status = 'in_review')::int AS in_review_count,
        COUNT(*) FILTER (WHERE verification_status = 'success')::int AS success_count,
        COUNT(*) FILTER (WHERE verification_status = 'rejected')::int AS rejected_count,
        COUNT(*) FILTER (WHERE verification_status = 'digital')::int AS digital_count
      FROM posters
      WHERE deleted_at IS NULL
    `,
    loadTopAmbassadors("all"),
  ]);

  const summary = summaryRows[0];
  const outcomeSummary = outcomeRows[0];
  const referralDropOff = referralDropOffRows[0] ?? {
    total_count: 0,
    rsvp_count: 0,
    unverified_count: 0,
    pending_count: 0,
    verified_count: 0,
    rejected_count: 0,
  };
  const posterStatus = posterStatusRows[0] ?? {
    total_count: 0,
    pending_count: 0,
    in_review_count: 0,
    success_count: 0,
    rejected_count: 0,
    digital_count: 0,
  };

  const activityData: DashboardActivityPoint[] = activityRows.map((row) => ({
    label: activityLabelFormatter.format(new Date(row.day)),
    visits: row.visits,
    signups: row.signups,
    applications: row.applications,
    posters: row.posters,
    referrals: row.referrals,
  }));

  const decisionData: DashboardBreakdownPoint[] = [
    {
      label: t("admin.overview.charts.series.pending"),
      value: outcomeSummary.pending_count,
      fill: "var(--chart-pending)",
    },
    {
      label: t("admin.overview.charts.series.approved"),
      value: outcomeSummary.approved_count,
      fill: "var(--chart-approved)",
    },
    {
      label: t("admin.overview.charts.series.rejected"),
      value: outcomeSummary.rejected_count,
      fill: "var(--chart-rejected)",
    },
    {
      label: t("admin.overview.charts.series.banned"),
      value: outcomeSummary.banned_count,
      fill: "var(--chart-banned)",
    },
  ];

  const posterStatusData: DashboardBreakdownPoint[] = [
    {
      label: t("admin.overview.charts.posters.pending"),
      value: posterStatus.pending_count,
      fill: "var(--chart-pending)",
    },
    {
      label: t("admin.overview.charts.posters.in-review"),
      value: posterStatus.in_review_count,
      fill: "var(--chart-applications)",
    },
    {
      label: t("admin.overview.charts.posters.success"),
      value: posterStatus.success_count,
      fill: "var(--chart-approved)",
    },
    {
      label: t("admin.overview.charts.posters.rejected"),
      value: posterStatus.rejected_count,
      fill: "var(--chart-rejected)",
    },
    {
      label: t("admin.overview.charts.posters.digital"),
      value: posterStatus.digital_count,
      fill: "var(--chart-signups)",
    },
  ];

  const referralDropOffData: DashboardBreakdownPoint[] = [
    {
      label: t("admin.overview.charts.referrals.total"),
      value: referralDropOff.total_count,
      fill: "var(--chart-visits)",
    },
    {
      label: t("admin.overview.charts.referrals.rsvp"),
      value: referralDropOff.rsvp_count,
      fill: "var(--chart-signups)",
    },
    {
      label: t("admin.overview.charts.referrals.unverified"),
      value: referralDropOff.unverified_count,
      fill: "var(--chart-pending)",
    },
    {
      label: t("admin.overview.charts.referrals.pending"),
      value: referralDropOff.pending_count,
      fill: "var(--chart-applications)",
    },
    {
      label: t("admin.overview.charts.referrals.verified"),
      value: referralDropOff.verified_count,
      fill: "var(--chart-approved)",
    },
  ];

  const funnelData: DashboardFunnelPoint[] = [
    {
      name: t("admin.overview.charts.series.visited-website"),
      value: summary.visitor_count,
      fill: "var(--chart-visits)",
    },
    {
      name: t("admin.overview.charts.series.signed-up"),
      value: summary.signup_count,
      fill: "var(--chart-signups)",
    },
    {
      name: t("admin.overview.charts.series.filled-form"),
      value: summary.applicant_count,
      fill: "var(--chart-applications)",
    },
    {
      name: t("admin.overview.charts.series.approved"),
      value: outcomeSummary.approved_count,
      fill: "var(--chart-approved)",
    },
    {
      name: t("admin.overview.charts.series.rejected"),
      value: outcomeSummary.rejected_count,
      fill: "var(--chart-rejected)",
    },
    {
      name: t("admin.overview.charts.series.banned"),
      value: outcomeSummary.banned_count,
      fill: "var(--chart-banned)",
    },
  ];

  return (
    <div className="space-y-8">
      <header>
        <div className="grid grid-cols-1 gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                icon: "view" as const,
                label: t("admin.overview.stats.visitors"),
                value: numberFormatter.format(summary.total_visit_count),
                detail: undefined,
              },
              {
                icon: "person" as const,
                label: t("admin.overview.stats.signups"),
                value: numberFormatter.format(summary.signup_count),
                detail: undefined,
              },
              {
                icon: "send" as const,
                label: t("admin.overview.stats.applicants"),
                value: numberFormatter.format(summary.applicant_count),
                detail: undefined,
              },
              {
                icon: "clock" as const,
                label: t("admin.overview.stats.pending-review"),
                value: numberFormatter.format(summary.pending_count),
                detail: undefined,
              },
              {
                icon: "friend" as const,
                label: t("admin.overview.stats.total-referrals"),
                value: numberFormatter.format(referralDropOff.total_count),
                detail: t("admin.overview.stats.total-referrals-detail", {
                  count: referralDropOff.verified_count,
                }),
              },
              {
                icon: "photo" as const,
                label: t("admin.overview.stats.total-posters"),
                value: numberFormatter.format(posterStatus.total_count),
                detail: t("admin.overview.stats.total-posters-detail", {
                  count: posterStatus.success_count,
                }),
              },
            ].map((stat) => (
              <div key={stat.label} className="flex flex-col gap-1.5">
                <div className="flex items-baseline gap-2.5 whitespace-nowrap">
                  <Icon glyph={stat.icon} size={24} className="shrink-0 self-center text-foreground" />
                  <span className="text-2xl font-bold leading-8 text-foreground tabular-nums">
                    {stat.value}
                  </span>
                  <span className="font-body text-base text-foreground">{stat.label}</span>
                </div>
                {stat.detail !== undefined ? (
                  <span className="ps-[2.125rem] font-body text-xs text-muted-foreground">
                    {stat.detail}
                  </span>
                ) : null}
              </div>
            ))}
        </div>
      </header>

      <AdminDashboardCharts
        activityData={activityData}
        decisionData={decisionData}
        funnelData={funnelData}
        referralDropOffData={referralDropOffData}
        posterStatusData={posterStatusData}
        topAmbassadorsData={topAmbassadorsData}
        pendingCount={outcomeSummary.pending_count}
        locale={locale}
        activeRange={activeRange}
        rangeOptions={[
          { value: "7d", label: t("admin.overview.charts.ranges.seven-days") },
          { value: "14d", label: t("admin.overview.charts.ranges.fourteen-days") },
          { value: "30d", label: t("admin.overview.charts.ranges.thirty-days") },
          { value: "90d", label: t("admin.overview.charts.ranges.ninety-days") },
        ]}
        messages={{
          recentActivityEyebrow: t("admin.overview.charts.recent-activity-eyebrow"),
          recentActivityTitle: t("admin.overview.charts.recent-activity-title"),
          decisionSplitEyebrow: t("admin.overview.charts.decision-split-eyebrow"),
          decisionSplitTitle: t("admin.overview.charts.decision-split-title"),
          applicationFlowEyebrow: t("admin.overview.charts.application-flow-eyebrow"),
          applicationFlowTitle: t("admin.overview.charts.application-flow-title"),
          referralDropOffTitle: t("admin.overview.charts.referral-drop-off-title"),
          posterStatusTitle: t("admin.overview.charts.poster-status-title"),
          topAmbassadorsTitle: t("admin.overview.charts.top-ambassadors-title"),
          topAmbassadorsEmpty: t("admin.overview.charts.top-ambassadors-empty"),
          topAmbassadorsAllMetrics: t("admin.overview.charts.top-ambassadors-all-metrics"),
          topAmbassadorsMetricsNoun: t("admin.overview.charts.top-ambassadors-metrics-noun"),
          topAmbassadorsBalance: t("admin.overview.charts.top-ambassadors-balance"),
          stillPending: t("admin.overview.charts.still-pending"),
          visitsSeries: t("admin.overview.charts.series.visits"),
          signupsSeries: t("admin.overview.charts.series.signups"),
          applicationsSeries: t("admin.overview.charts.series.applications"),
          postersSeries: t("admin.overview.charts.series.posters"),
          referralsSeries: t("admin.overview.charts.series.referrals"),
          rsvpsSeries: t("admin.overview.charts.series.rsvps"),
        }}
      />
    </div>
  );
}
