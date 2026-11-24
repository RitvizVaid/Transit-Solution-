/**
 * Everything the commuter app needs to know about the city it serves. To pilot a new city:
 * add an entry here, point the API's GTFS_DIR at that city's feed, and build the web app
 * with VITE_CITY=<id>. Nothing else in the app is city-specific.
 */
export interface CityConfig {
  id: string;
  /** Shown in the header, e.g. "Delhi pilot". */
  label: string;
  /** Biases place search towards the city centre. */
  searchBias: { lat: number; lng: number };
  /** Hard limit for place search: [west, south, east, north]. */
  searchBounds: [west: number, south: number, east: number, north: number];
  /**
   * Used for "Nearby lines" before the user shares their location. Labelled as an example
   * place in the UI, never as the user's own location.
   */
  demoLocation: { name: string; lat: number; lng: number };
  /** Initial map view over the network. */
  mapCenter: { lat: number; lng: number; zoom: number };
}

export const CITIES = {
  delhi: {
    id: 'delhi',
    label: 'Delhi pilot',
    searchBias: { lat: 28.6139, lng: 77.209 },
    searchBounds: [76.84, 28.4, 77.35, 28.88],
    demoLocation: { name: 'Kashmere Gate', lat: 28.6662, lng: 77.2296 },
    mapCenter: { lat: 28.656, lng: 77.2296, zoom: 13.6 },
  },
} as const satisfies Record<string, CityConfig>;

/** The configured city. An unknown id fails the build/start instead of silently using Delhi. */
export function selectCity(id: string | undefined): CityConfig {
  const key = (id ?? 'delhi').trim().toLowerCase() || 'delhi';
  const city = (CITIES as Record<string, CityConfig>)[key];
  if (!city) {
    throw new Error(
      `Unknown VITE_CITY "${id}". Known cities: ${Object.keys(CITIES).join(', ')} (see src/city.ts)`,
    );
  }
  const [w, s, e, n] = city.searchBounds;
  const inside = (p: { lat: number; lng: number }) =>
    p.lng >= w && p.lng <= e && p.lat >= s && p.lat <= n;
  if (!(w < e && s < n) || !inside(city.searchBias) || !inside(city.mapCenter)) {
    throw new Error(`City "${key}" has inconsistent bounds, bias or map centre`);
  }
  return city;
}
