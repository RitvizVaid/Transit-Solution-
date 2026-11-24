/** A WGS84 point. Objects use `lat`/`lng`; GeoJSON tuples use `[lng, lat]`. */
export interface LatLng {
  lat: number;
  lng: number;
}

export interface NamedPlace extends LatLng {
  name: string;
}

/** GeoJSON position order: longitude first. */
export type LngLatTuple = [lng: number, lat: number];
