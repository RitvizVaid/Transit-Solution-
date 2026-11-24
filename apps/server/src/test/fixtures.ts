import { fileURLToPath } from 'node:url';
import { TransitNetwork } from '../gtfs/network.js';

export const GTFS_DIR = fileURLToPath(
  new URL('../../../../data/gtfs/delhi-pilot', import.meta.url),
);

let cached: TransitNetwork | null = null;
export const pilotNetwork = () => (cached ??= TransitNetwork.load(GTFS_DIR));

/** 10:00 IST on a weekday: every pilot route is running. */
export const MORNING = new Date('2026-12-01T10:00:00+05:30');
/** 02:00 IST: nothing runs. */
export const NIGHT = new Date('2026-12-01T02:00:00+05:30');

export const PLACES = {
  kgMetro: { lat: 28.6675, lng: 77.2282 },
  ccMarket: { lat: 28.6555, lng: 77.23 },
  civilLines: { lat: 28.6768, lng: 77.2249 },
  redFort: { lat: 28.6563, lng: 77.2412 },
  ndls: { lat: 28.6432, lng: 77.2193 },
  cp: { lat: 28.6326, lng: 77.2196 },
  ito: { lat: 28.6284, lng: 77.2412 },
  gurugram: { lat: 28.4595, lng: 77.0266 },
};
