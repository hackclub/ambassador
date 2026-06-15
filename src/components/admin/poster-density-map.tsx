"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SectionHeading } from "@/components/admin/section-heading";
import type { PosterMapDetailsMessages } from "@/components/admin/poster-density-map-inner";
import { cn } from "@/lib/utils";

const PosterDensityMapInner = dynamic(() => import("./poster-density-map-inner"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-muted" />,
});

type PosterMapMode = "dots" | "heat";

export type PosterMapDatum = {
  id: string;
  lat: number;
  lng: number;
  country: string;
  countryName: string;
  state: string;
  isUS: boolean;
  groupId?: string;
  groupName?: string | null;
  placedBy?: { id: string; name: string };
};

type PosterDensityMapMessages = {
  title: string;
  allCountries: string;
  allStates: string;
  empty: string;
  dots: string;
  heatmap: string;
  myRegion?: string;
  allGroups?: string;
  untitledGroup?: string;
};

export function PosterDensityMap({
  points,
  scope,
  locale,
  messages,
  detailsMessages,
  interaction = "filter",
  myCountry,
}: {
  points: PosterMapDatum[];
  scope: "us" | "all" | "other";
  locale: string;
  messages: PosterDensityMapMessages;
  detailsMessages?: PosterMapDetailsMessages;
  interaction?: "filter" | "zoom";
  myCountry?: string;
}) {
  const zooming = interaction === "zoom";
  const supportsMyRegion = zooming && messages.myRegion !== undefined;
  const defaultSelected = supportsMyRegion ? "myregion" : "all";
  const [selected, setSelected] = useState(defaultSelected);
  const [selectedGroup, setSelectedGroup] = useState("all");
  const [mode, setMode] = useState<PosterMapMode>("dots");
  // Reset the fine filters during render whenever the scope flips, so a stale pick can't hide every point.
  const [prevScope, setPrevScope] = useState(scope);
  if (scope !== prevScope) {
    setPrevScope(scope);
    setSelected(defaultSelected);
    setSelectedGroup("all");
  }

  const usingStates = scope === "us";

  const scopedPoints = useMemo(() => {
    if (scope === "us") return points.filter((point) => point.isUS);
    if (scope === "other") return points.filter((point) => !point.isUS);
    return points;
  }, [points, scope]);

  const numberFormatter = new Intl.NumberFormat(locale);

  const countryLabel = useMemo(() => {
    let display: Intl.DisplayNames | null = null;
    try {
      display = new Intl.DisplayNames([locale], { type: "region" });
    } catch {
      display = null;
    }
    return (point: PosterMapDatum) => {
      const code = point.country.toUpperCase();
      if (display !== null && /^[A-Z]{2}$/.test(code)) {
        try {
          const name = display.of(code);
          if (name !== undefined && name !== code) return name;
        } catch {
          // not a recognised region code; fall through
        }
      }
      return point.countryName || point.country;
    };
  }, [locale]);

  const options = useMemo(() => {
    const counts = new Map<string, { key: string; label: string; count: number }>();
    for (const point of scopedPoints) {
      const key = usingStates ? point.state : point.country;
      const label = usingStates ? point.state : countryLabel(point);
      const existing = counts.get(key);
      if (existing) existing.count += 1;
      else counts.set(key, { key, label, count: 1 });
    }
    return [...counts.values()].sort((a, b) => b.count - a.count);
  }, [scopedPoints, usingStates, countryLabel]);

  const groupOptions = useMemo(() => {
    const counts = new Map<string, { key: string; label: string; count: number }>();
    for (const point of scopedPoints) {
      if (point.groupId === undefined) continue;
      const existing = counts.get(point.groupId);
      if (existing) existing.count += 1;
      else
        counts.set(point.groupId, {
          key: point.groupId,
          label: point.groupName?.trim() || (messages.untitledGroup ?? "Untitled group"),
          count: 1,
        });
    }
    return [...counts.values()].sort((a, b) => b.count - a.count);
  }, [scopedPoints, messages.untitledGroup]);

  const supportsGroups = messages.allGroups !== undefined && groupOptions.length > 0;

  const filtered = useMemo(() => {
    const byRegion =
      selected === "all"
        ? scopedPoints
        : scopedPoints.filter(
            (point) => (usingStates ? point.state : point.country) === selected,
          );
    return selectedGroup === "all"
      ? byRegion
      : byRegion.filter((point) => point.groupId === selectedGroup);
  }, [scopedPoints, selected, usingStates, selectedGroup]);

  // Empty subset (e.g. "My region" with no posters yet) falls back to framing everything.
  const focusPoints = useMemo(() => {
    if (!zooming) return undefined;
    if (selected === "all") return scopedPoints;
    const key = selected === "myregion" ? myCountry : selected;
    const subset = scopedPoints.filter((point) => point.country === key);
    return subset.length > 0 ? subset : scopedPoints;
  }, [zooming, selected, scopedPoints, myCountry]);

  const renderPoints = zooming ? scopedPoints : filtered;

  const allLabel = usingStates ? messages.allStates : messages.allCountries;

  return (
    <section className="ui-group">
      <SectionHeading title={messages.title}>
        {scopedPoints.length > 0 ? (
          <>
            <div className="inline-flex items-stretch overflow-hidden rounded-xl border border-foreground bg-background">
              {([
                { value: "dots", label: messages.dots },
                { value: "heat", label: messages.heatmap },
              ] as const).map((option, index) => {
                const active = option.value === mode;
                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setMode(option.value)}
                    className={cn(
                      "flex items-center px-4 py-1.5 font-body text-sm font-bold transition-colors",
                      index > 0 && "border-l border-foreground",
                      active ? "bg-foreground text-white" : "text-foreground hover:bg-foreground/5",
                    )}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
            <div className="w-full sm:w-64">
            <Select value={selected} onValueChange={setSelected}>
              <SelectTrigger
                size="sm"
                className="ui-input-surface !bg-muted w-full !rounded-none border-0 px-3 text-sm focus-visible:ring-foreground/15 aria-[invalid]:!border-transparent aria-[invalid]:!ring-0"
              >
                <SelectValue placeholder={allLabel} />
              </SelectTrigger>
              <SelectContent
                align="end"
                position="popper"
                className="w-(--radix-select-trigger-width) min-w-(--radix-select-trigger-width)"
              >
                {supportsMyRegion ? (
                  <SelectItem value="myregion">{messages.myRegion}</SelectItem>
                ) : null}
                <SelectItem value="all">{allLabel}</SelectItem>
                {options.map((option) => (
                  <SelectItem key={option.key} value={option.key}>
                    {option.label} ({numberFormatter.format(option.count)})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            </div>
            {supportsGroups ? (
              <div className="w-full sm:w-64">
                <Select value={selectedGroup} onValueChange={setSelectedGroup}>
                  <SelectTrigger
                    size="sm"
                    className="ui-input-surface !bg-muted w-full !rounded-none border-0 px-3 text-sm focus-visible:ring-foreground/15 aria-[invalid]:!border-transparent aria-[invalid]:!ring-0"
                  >
                    <SelectValue placeholder={messages.allGroups} />
                  </SelectTrigger>
                  <SelectContent
                    align="end"
                    position="popper"
                    className="w-(--radix-select-trigger-width) min-w-(--radix-select-trigger-width)"
                  >
                    <SelectItem value="all">{messages.allGroups}</SelectItem>
                    {groupOptions.map((option) => (
                      <SelectItem key={option.key} value={option.key}>
                        {option.label} ({numberFormatter.format(option.count)})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
          </>
        ) : null}
      </SectionHeading>

      {scopedPoints.length === 0 ? (
        <p className="font-body text-sm text-muted-foreground">{messages.empty}</p>
      ) : (
        <div className="isolate h-[28rem] w-full overflow-hidden rounded-xl">
          <PosterDensityMapInner
            points={renderPoints}
            focusPoints={focusPoints}
            mode={mode}
            detailsMessages={detailsMessages}
          />
        </div>
      )}
    </section>
  );
}
