import { selectCity } from './city';

const env = import.meta.env;
const city = selectCity(env.VITE_CITY);

const trimSlash = (s: string) => s.replace(/\/+$/, '');

export const config = {
  /** API origin. Empty = same origin (Vite proxy in dev, nginx in Docker). */
  apiBase: trimSlash(env.VITE_API_BASE ?? ''),
  /** Photon-compatible geocoder. Self-host or proxy it for production traffic. */
  geocoderUrl: trimSlash(env.VITE_GEOCODER_URL ?? 'https://photon.komoot.io'),
  /** The city this build serves (VITE_CITY, see city.ts). */
  city,
  searchBias: city.searchBias,
  searchBounds: city.searchBounds,
  demoLocation: city.demoLocation,
  /** MapLibre style. OpenFreeMap needs no API key; self-host tiles for production scale. */
  mapStyle: env.VITE_MAP_STYLE ?? 'https://tiles.openfreemap.org/styles/liberty',
  mapCenter: city.mapCenter,
  /** How often live stand status is refreshed while visible. */
  standPollMs: 30_000,
} as const;
