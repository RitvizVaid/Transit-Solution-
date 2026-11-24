# map/

Owner: **Contributor 2**. MapLibre GL JS with OpenFreeMap vector tiles (no API key).

| File                 | What                                                                                                                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MapView.tsx`        | Props contract (`MapViewProps`), lazy-loads the map, error boundary + placeholder when WebGL/tiles are unavailable                                                                                |
| `TransitMap.tsx`     | The map: itinerary lines, origin/destination/user markers, Nearby radius, live stands (coloured by queue, tap for status) and live vehicles, long-press / right-click to set start or destination |
| `geometry.ts`        | Polyline decoding, itinerary → GeoJSON, bounds, radius circle (tested)                                                                                                                            |
| `vehicleAnimator.ts` | Glides markers between 2-s pings; drops vehicles silent for 15 s (tested)                                                                                                                         |

- **Live data**: subscribes the map viewport over `/api/v1/live` (zoom ≥ 12) via `lib/live.ts`,
  re-subscribing on every pan/zoom and reconnect. Initial stands come from `GET /api/v1/stands`.
  Delhi buses use blue markers with amber outlines and a map key. Tap a marker to see its
  observation age and source; route numbers and destinations are not currently provided.
  The popup closes if the bus position expires or the feed becomes unavailable.
- **Performance**: the map chunk (~300 KB gz) loads after the planner UI. Vehicle layer updates at
  10 fps, 1 fps with `prefers-reduced-motion`.
- **Offline**: tiles/style/fonts are cached by the service worker (cache-first, 14 days), so
  places you've viewed render offline; routes and saved trips work without a map at all.
- **Framing**: fits the selected itinerary / Nearby circle using `insets` as padding so nothing
  hides under the bottom sheet or side panel.
- Style override: `VITE_MAP_STYLE`. For production traffic, self-host tiles (OpenFreeMap or
  Protomaps PMTiles) instead of the public instance.
