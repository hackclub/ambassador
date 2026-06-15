"use client";

import dynamic from "next/dynamic";

export type MapPoster = {
  id: string;
  name: string | null;
  referralCode: string;
  groupName: string | null;
  latitude: number;
  longitude: number;
  status: string;
  address?: string | null;
};

const PosterPlacementMapInner = dynamic(() => import("./poster-placement-map-inner"), {
  ssr: false,
  loading: () => (
    <div className="h-80 w-full animate-pulse border border-foreground/15 bg-muted" />
  ),
});

export function PosterPlacementMap({ posters }: { posters: MapPoster[] }) {
  return <PosterPlacementMapInner posters={posters} />;
}
