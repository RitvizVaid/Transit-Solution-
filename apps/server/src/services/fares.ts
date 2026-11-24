import type { Money } from '@transit/shared-types';
import type { FareModel } from '../gtfs/network.js';

/** Shared autos and e-rickshaws charge round amounts; fares are rounded up to this step. */
export const FARE_STEP = 5;

/**
 * Fare for one ride. Same rule as the data pipeline (data/pipelines/gtfs_pipeline/corridors.py
 * `fare_for`), cross-checked against data/gtfs/…/fare_matrix.csv in tests:
 *   1. Zonal (stage) fare when the route has one for the boarding/alighting zones.
 *   2. Otherwise distance: max(minFare, minFare + (km − baseKm) × perKm), rounded up to ₹5.
 */
export function legFare(
  model: FareModel,
  distanceMeters: number,
  fromZone?: string,
  toZone?: string,
): number {
  const zonal = fromZone && toZone ? model.zoneFares?.[`${fromZone}>${toZone}`] : undefined;
  if (zonal !== undefined) return zonal;
  const km = distanceMeters / 1000;
  const raw = model.minFare + Math.max(0, km - model.baseKm) * model.perKm;
  return Math.ceil(Math.max(model.minFare, raw) / FARE_STEP) * FARE_STEP;
}

export interface RideFare {
  model: FareModel;
  distanceMeters: number;
  fromZone?: string;
  toZone?: string;
}

/** Informal modes don't share tickets: every ride is paid separately. */
export function itineraryFare(rides: RideFare[]): Money {
  const currency = rides[0]?.model.currency ?? 'INR';
  return {
    currency,
    amount: rides.reduce((sum, r) => sum + legFare(r.model, r.distanceMeters, r.fromZone, r.toZone), 0),
  };
}
