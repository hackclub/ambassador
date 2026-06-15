import type { Metadata } from "next";
import { forbidden, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";

import { PosterDensityMap } from "@/components/admin/poster-density-map";
import { PosterPlacementMap } from "@/components/admin/poster-placement-map";
import { getTranslatedPageMetadata } from "@/i18n/metadata";
import { ensureSchema } from "@/lib/database/ensure-schema";
import { canAccessPosters, getPosterAccessState } from "@/lib/posters/access";
import { listPosterCampaigns } from "@/lib/posters/config";
import { loadOwnPosterPlacements, loadPosterMapPoints } from "@/lib/posters/map-points";
import { getDefaultPaperSize, normalizeRegionCode } from "@/lib/posters/paper-size";
import { listClientPosterDataForUser } from "@/lib/posters/service";
import { getEffectiveSafeguards } from "@/lib/safeguards";
import { getSession } from "@/lib/session";

import { PostersClient } from "./PostersClient";

export async function generateMetadata(): Promise<Metadata> {
  return getTranslatedPageMetadata("posters.metadata.title");
}

export default async function PostersPage() {
  const session = await getSession();
  if (!session) redirect("/");
  const [, t, locale] = await Promise.all([ensureSchema(), getTranslations(), getLocale()]);

  const [user, safeguards] = await Promise.all([
    getPosterAccessState(session.sub),
    getEffectiveSafeguards(session.sub),
  ]);
  const canAccessAdmin = Boolean(session.impersonator) || user?.is_admin === true;
  const canUsePosters = canAccessPosters({
    latestApplicationStatus: user?.latest_application_status ?? null,
    manualDashboardState: user?.manual_dashboard_state ?? null,
    isOnboardingComplete: user?.is_onboarding_complete ?? false,
    isAdmin: canAccessAdmin,
  });

  if (!canUsePosters || !safeguards.postersEnabled || user === null) {
    forbidden();
  }

  const [data, posterMapPoints, ownPlacements] = await Promise.all([
    listClientPosterDataForUser(session.sub),
    loadPosterMapPoints(),
    loadOwnPosterPlacements(session.sub),
  ]);

  const campaigns = listPosterCampaigns();

  const allPosters = [
    ...data.standalonePosters,
    ...data.groups.flatMap((g) => g.posters),
  ];
  const totalPosters = allPosters.length;
  const verifiedCount = allPosters.filter((p) => p.verification_status === "success").length;
  const pendingCount = allPosters.filter((p) => p.verification_status === "pending").length;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8">
        <header className="mb-8">
          <div className="flex flex-wrap items-baseline gap-x-8 gap-y-4">
            <h1 className="font-sub text-4xl font-bold leading-[3rem] text-foreground">{t("posters.heading")}</h1>
            {totalPosters > 0 && (
              <div className="flex flex-wrap items-baseline gap-x-8 gap-y-1">
                <span className="flex items-baseline gap-1.5">
                  <span className="text-2xl leading-none font-bold text-foreground tabular-nums">{totalPosters}</span>
                  <span className="font-body text-sm leading-none text-muted-foreground">{t("posters.stats.total")}</span>
                </span>
                <span className="flex items-baseline gap-1.5">
                  <span className="text-2xl leading-none font-bold text-acceptance tabular-nums">{verifiedCount}</span>
                  <span className="font-body text-sm leading-none text-muted-foreground">{t("posters.stats.verified")}</span>
                </span>
                <span className="flex items-baseline gap-1.5">
                  <span className="text-2xl leading-none font-bold text-accent tabular-nums">{pendingCount}</span>
                  <span className="font-body text-sm leading-none text-muted-foreground">{t("posters.stats.pending")}</span>
                </span>
              </div>
            )}
          </div>
        </header>
        <PostersClient
          initialCampaignSlug={campaigns[0]?.slug ?? null}
          campaigns={campaigns}
          initialData={data}
          defaultPaperSize={getDefaultPaperSize(user.country_code, user.ambassador_region)}
          defaultRegionCode={normalizeRegionCode(user.country_code)}
          ownPosterMap={
            ownPlacements.length > 0 ? (
              <section key="own-poster-map">
                <h2 className="font-sub text-2xl font-bold leading-8 text-foreground">
                  {t("posters.your-locations.title")}
                </h2>
                <p className="mt-1 font-body text-sm text-muted-foreground">
                  {t("posters.your-locations.description")}
                </p>
                <div className="mt-4">
                  <PosterPlacementMap posters={ownPlacements} />
                </div>
              </section>
            ) : null
          }
          densityMap={
            <PosterDensityMap
              key="poster-density-map"
              points={posterMapPoints}
              scope="all"
              interaction="zoom"
              myCountry={
                // Prefer the declared HCA country; IP-geolocated country_code is often wrong.
                ((user.hca_country ?? user.country_code) ?? "").trim().toUpperCase() || undefined
              }
              locale={locale}
              messages={{
                title: t("posters.map.title"),
                allCountries: t("posters.map.all-countries"),
                allStates: t("posters.map.all-states"),
                empty: t("posters.map.empty"),
                dots: t("posters.map.dots"),
                heatmap: t("posters.map.heatmap"),
                myRegion: t("posters.map.my-region"),
              }}
            />
          }
        />
    </div>
  );
}
