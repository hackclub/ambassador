import type { MapPoster } from "@/components/admin/poster-placement-map";
import type { PosterMapDatum } from "@/components/admin/poster-density-map";
import sql from "@/lib/database/client";

type PosterPointRow = {
  id: string;
  lat: number | string;
  lng: number | string;
  country_code: string;
  country_name: string;
  state: string;
  is_us: boolean | null;
  user_id: string | null;
  placed_by: string | null;
  poster_group_id: string | null;
  group_name: string | null;
};

export async function loadPosterMapPoints(
  { includePlacer = false }: { includePlacer?: boolean } = {},
): Promise<PosterMapDatum[]> {
  const rows = await sql<PosterPointRow[]>`
    SELECT
      p.id,
      p.latitude AS lat,
      p.longitude AS lng,
      COALESCE(NULLIF(p.geo_country_code, ''), NULLIF(u.country_code, ''), 'XX') AS country_code,
      COALESCE(NULLIF(p.geo_country_name, ''), NULLIF(u.country_name, ''), NULLIF(u.country_code, ''), 'Unknown') AS country_name,
      COALESCE(NULLIF(p.geo_state, ''), NULLIF(TRIM(u.region), ''), 'Unknown') AS state,
      (u.ambassador_region = 'United States') AS is_us,
      u.id AS user_id,
      u.display_name AS placed_by,
      p.poster_group_id,
      g.name AS group_name
    FROM posters p
    LEFT JOIN users u ON u.id = p.user_id
    LEFT JOIN poster_groups g ON g.id = p.poster_group_id
    WHERE p.verification_status = 'success'
      AND p.deleted_at IS NULL
      AND p.latitude IS NOT NULL
      AND p.longitude IS NOT NULL
  `;

  return rows.map((row) => ({
    id: row.id,
    lat: Number(row.lat),
    lng: Number(row.lng),
    country: row.country_code,
    countryName: row.country_name,
    state: row.state,
    isUS: row.is_us === true,
    ...(includePlacer && row.user_id !== null && row.placed_by !== null
      ? { placedBy: { id: row.user_id, name: row.placed_by } }
      : {}),
    ...(includePlacer && row.poster_group_id !== null
      ? { groupId: row.poster_group_id, groupName: row.group_name }
      : {}),
  }));
}

type OwnPlacementRow = {
  id: string;
  name: string | null;
  referral_code: string;
  group_name: string | null;
  status: string;
  lat: number | string;
  lng: number | string;
  location_description: string | null;
  geocoded_address: string | null;
  geo_state: string | null;
  geo_country_name: string | null;
};

export async function loadPosterPlacementsForUser(userId: string): Promise<MapPoster[]> {
  const rows = await sql<OwnPlacementRow[]>`
    SELECT
      p.id,
      p.name,
      p.referral_code,
      g.name AS group_name,
      p.verification_status AS status,
      p.latitude AS lat,
      p.longitude AS lng,
      p.location_description,
      NULLIF(TRIM(p.metadata->>'reverse_geocoded_address'), '') AS geocoded_address,
      NULLIF(TRIM(p.geo_state), '') AS geo_state,
      NULLIF(TRIM(p.geo_country_name), '') AS geo_country_name
    FROM posters p
    LEFT JOIN poster_groups g ON g.id = p.poster_group_id
    WHERE p.user_id = ${userId}
      AND p.deleted_at IS NULL
      AND p.latitude IS NOT NULL
      AND p.longitude IS NOT NULL
    ORDER BY p.created_at DESC
  `;

  return rows.map((row) => {
    const coarse = [row.geo_state, row.geo_country_name].filter(Boolean).join(", ");
    return {
      id: row.id,
      name: row.name,
      referralCode: row.referral_code,
      groupName: row.group_name,
      status: row.status,
      latitude: Number(row.lat),
      longitude: Number(row.lng),
      address: row.geocoded_address || (coarse !== "" ? coarse : null) || row.location_description?.trim() || null,
    };
  });
}
