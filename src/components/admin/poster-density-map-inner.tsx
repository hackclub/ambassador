"use client";

import "leaflet/dist/leaflet.css";
// Registers L.heatLayer and pins window.L for the plugin.
import "./leaflet-heat";

import L from "leaflet";
import { useEffect, useMemo, useState } from "react";
import { CircleMarker, MapContainer, Popup, TileLayer, useMap } from "react-leaflet";

export type PosterMapPoint = {
  id: string;
  lat: number;
  lng: number;
  country: string;
  placedBy?: { id: string; name: string };
};

export type PosterMapMode = "dots" | "heat";

export type PosterMapDetailsMessages = {
  addressLoading: string;
  addressUnavailable: string;
};

// Read --primary off the live token; Leaflet writes SVG colours, which can't resolve CSS vars.
function brandColor() {
  if (typeof window === "undefined") return "#ec3750";
  const value = getComputedStyle(document.documentElement).getPropertyValue("--primary").trim();
  return value || "#ec3750";
}

function FitBounds({ points }: { points: PosterMapPoint[] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    const bounds = L.latLngBounds(points.map((point) => [point.lat, point.lng]));
    // Wait a frame and re-measure before fitting; on first paint the lazy-loaded container is still zero-size.
    const frame = requestAnimationFrame(() => {
      map.invalidateSize();
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 11 });
    });
    return () => cancelAnimationFrame(frame);
  }, [map, points]);
  return null;
}

function HeatLayer({ points, color }: { points: PosterMapPoint[]; color: string }) {
  const map = useMap();
  useEffect(() => {
    const layer = L.heatLayer(
      points.map((point) => [point.lat, point.lng, 1] as [number, number, number]),
      {
        radius: 22,
        blur: 18,
        maxZoom: 11,
        minOpacity: 0.25,
        gradient: { 0.2: color, 0.55: color, 1: color },
      },
    ).addTo(map);
    return () => {
      layer.remove();
    };
  }, [map, points, color]);
  return null;
}

function DotDetails({
  point,
  messages,
}: {
  point: PosterMapPoint;
  messages: PosterMapDetailsMessages;
}) {
  const [address, setAddress] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`/api/admin/posters/${point.id}/address`);
        const data: unknown = response.ok ? await response.json() : null;
        const value =
          typeof data === "object" && data !== null && "address" in data && typeof data.address === "string"
            ? data.address
            : null;
        if (cancelled) return;
        if (value !== null) setAddress(value);
        else setFailed(true);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [point.id]);

  // Overrides carry !important; Leaflet's popup stylesheet outranks plain utility classes.
  return (
    <div className="font-body text-sm">
      {point.placedBy !== undefined ? (
        <a
          href={`/admin/users/${point.placedBy.id}`}
          className="font-bold !text-foreground underline"
        >
          {point.placedBy.name}
        </a>
      ) : null}
      <div className={failed ? "text-muted-foreground" : undefined}>
        {failed ? messages.addressUnavailable : address ?? messages.addressLoading}
      </div>
    </div>
  );
}

export default function PosterDensityMapInner({
  points,
  focusPoints,
  mode = "dots",
  detailsMessages,
}: {
  points: PosterMapPoint[];
  focusPoints?: PosterMapPoint[];
  mode?: PosterMapMode;
  detailsMessages?: PosterMapDetailsMessages;
}) {
  const dotColor = useMemo(() => brandColor(), []);

  return (
    <MapContainer
      center={[20, 0]}
      zoom={2}
      minZoom={2}
      scrollWheelZoom
      worldCopyJump
      className="h-full w-full"
    >
      <TileLayer
        attribution="&copy; OpenStreetMap contributors &copy; CARTO"
        url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
      />
      <FitBounds points={focusPoints ?? points} />
      {mode === "heat" ? (
        <HeatLayer points={points} color={dotColor} />
      ) : (
        points.map((point) => (
          <CircleMarker
            key={point.id}
            center={[point.lat, point.lng]}
            radius={5}
            pathOptions={{
              color: dotColor,
              fillColor: dotColor,
              fillOpacity: 0.45,
              opacity: 0.6,
              weight: 1,
            }}
          >
            {detailsMessages !== undefined ? (
              <Popup>
                <DotDetails point={point} messages={detailsMessages} />
              </Popup>
            ) : null}
          </CircleMarker>
        ))
      )}
    </MapContainer>
  );
}
