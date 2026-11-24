const env = import.meta.env;

const trimSlash = (s: string) => s.replace(/\/+$/, '');

export const config = {
  /** API origin. Empty = same origin (Vite proxy in dev, nginx in Docker). */
  apiBase: trimSlash(env.VITE_API_BASE ?? ''),
  /** Photon-compatible geocoder. Self-host or proxy it for production traffic. */
  geocoderUrl: trimSlash(env.VITE_GEOCODER_URL ?? 'https://photon.komoot.io'),
  /** Biases place search towards the pilot city (New Delhi). */
  searchBias: { lat: 28.6139, lng: 77.209 },
  /** Hard limit for place search: Delhi NCR as [west, south, east, north]. */
  searchBounds: [76.84, 28.4, 77.35, 28.88] as [number, number, number, number],
  /** Used for "Nearby lines" before the user shares their location. */
  demoLocation: { name: 'Kashmere Gate', lat: 28.6662, lng: 77.2296 },
  /** MapLibre style. OpenFreeMap needs no API key; self-host tiles for production scale. */
  mapStyle: env.VITE_MAP_STYLE ?? 'https://tiles.openfreemap.org/styles/liberty',
  /** Initial map view: the Old Delhi pilot area. */
  mapCenter: { lat: 28.656, lng: 77.2296, zoom: 13.6 },
  /** How often live stand status is refreshed while visible. */
  standPollMs: 30_000,
  /** A stand report older than this is shown as stale, not live. */
  standStaleAfterMs: 15 * 60_000,
} as const;
