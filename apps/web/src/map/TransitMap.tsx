import type { StandStatus } from '@transit/shared-types';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, LngLatLike, Map as MlMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre 6 locates its worker relative to its own module URL, which bundling breaks.
// Ship the (self-contained) worker as a hashed asset and point MapLibre at it.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { useEffect, useRef, useState } from 'react';
import { fetchRoutes } from '../api';
import { config } from '../config';
import { formatRelativeTime, QUEUE_META } from '../lib/format';
import { live } from '../lib/live';
import { boundsOf, circlePolygon, itineraryToGeoJSON, type LngLat } from './geometry';
import type { MapViewProps } from './MapView';
import { VehicleAnimator } from './vehicleAnimator';
import { isLiveReport } from '../lib/standFreshness';

maplibregl.setWorkerUrl(workerUrl);

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
const QUEUE_COLORS = { empty: '#10b981', normal: '#10b981', crowded: '#f59e0b', severe: '#e11d48' };
/** Below this zoom the viewport is too big for per-vehicle updates. */
const LIVE_MIN_ZOOM = 12;

function markerEl(className: string, label: string): HTMLElement {
  const el = document.createElement('div');
  el.className = className;
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', label);
  return el;
}

function standPopup(s: StandStatus): HTMLElement {
  const root = document.createElement('div');
  root.className = 'text-sm text-slate-800';
  const title = document.createElement('p');
  title.className = 'font-semibold';
  title.textContent = s.name;
  const body = document.createElement('p');
  const when = document.createElement('p');
  when.className = 'text-xs text-slate-500';
  if (isLiveReport(s, Date.now())) {
    const count =
      s.availableVehiclesEstimate === null ? '' : ` · ${s.availableVehiclesEstimate} waiting`;
    body.textContent = `~${s.averageWaitMinutes} min wait${count} · ${QUEUE_META[s.passengerQueueLevel].label.toLowerCase()}`;
    when.textContent = `Reported ${formatRelativeTime(s.lastReportedAt!)}`;
  } else {
    body.textContent = `Typical wait ~${s.averageWaitMinutes} min (from the schedule)`;
    when.textContent = s.lastReportedAt
      ? `Last report ${formatRelativeTime(s.lastReportedAt)}`
      : 'No reports from this stand yet';
  }
  root.append(title, body, when);
  return root;
}

/** MapLibre implementation of the MapView contract. Loaded lazily (see MapView.tsx). */
export default function TransitMap(props: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const markers = useRef<Record<'origin' | 'destination' | 'user', maplibregl.Marker | null>>({
    origin: null,
    destination: null,
    user: null,
  });

  // --- Create the map once ---------------------------------------------------------
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const map = new maplibregl.Map({
      container,
      style: config.mapStyle,
      center: [config.mapCenter.lng, config.mapCenter.lat],
      zoom: config.mapCenter.zoom,
      minZoom: 9,
      maxZoom: 18,
      dragRotate: false,
      pitchWithRotate: false,
      attributionControl: { compact: true },
    });
    map.touchZoomRotate.disableRotation();
    if (window.matchMedia('(min-width: 768px)').matches) {
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    }
    mapRef.current = map;
    // Diagnostics: `?debug=map` exposes the instance (used by the e2e tests to inspect layers).
    if (new URLSearchParams(window.location.search).get('debug') === 'map') {
      (window as unknown as { __transitMap?: MlMap }).__transitMap = map;
    }

    map.on('error', (e) => {
      // Style/tiles unreachable (offline first visit): keep the UI usable without a map.
      if (!map.isStyleLoaded()) setFailed(true);
      console.warn('map error', e.error);
    });

    map.on('load', () => {
      map.addSource('nearby', { type: 'geojson', data: EMPTY });
      map.addSource('route', { type: 'geojson', data: EMPTY });
      map.addSource('stands', { type: 'geojson', data: EMPTY });
      map.addSource('vehicles', { type: 'geojson', data: EMPTY });

      map.addLayer({
        id: 'nearby-fill',
        type: 'fill',
        source: 'nearby',
        paint: { 'fill-color': '#0f766e', 'fill-opacity': 0.08 },
      });
      map.addLayer({
        id: 'nearby-line',
        type: 'line',
        source: 'nearby',
        paint: { 'line-color': '#0f766e', 'line-width': 1.5, 'line-dasharray': [2, 2] },
      });
      map.addLayer({
        id: 'route-casing',
        type: 'line',
        source: 'route',
        filter: ['==', ['get', 'walk'], false],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#ffffff', 'line-width': 9 },
      });
      map.addLayer({
        id: 'route-ride',
        type: 'line',
        source: 'route',
        filter: ['==', ['get', 'walk'], false],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ['get', 'color'], 'line-width': 5 },
      });
      map.addLayer({
        id: 'route-walk',
        type: 'line',
        source: 'route',
        filter: ['==', ['get', 'walk'], true],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#475569', 'line-width': 4, 'line-dasharray': [0.1, 1.8] },
      });
      map.addLayer({
        id: 'stands',
        type: 'circle',
        source: 'stands',
        paint: {
          // Stands: bigger, dark ring (fixed places). Vehicles below: small, white ring (moving).
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 5, 16, 10],
          'circle-color': ['get', 'color'],
          'circle-stroke-color': '#0f172a',
          'circle-stroke-width': 2.5,
        },
      });
      map.addLayer({
        id: 'vehicles',
        type: 'circle',
        source: 'vehicles',
        paint: {
          // Crowd-shared (real) vehicles are larger with a dark ring; demo traffic stays small.
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            12,
            ['case', ['get', 'crowd'], 5, 3.5],
            16,
            ['case', ['get', 'crowd'], 9, 7],
          ],
          'circle-color': ['get', 'color'],
          'circle-stroke-color': ['case', ['get', 'crowd'], '#0f172a', '#ffffff'],
          'circle-stroke-width': ['case', ['get', 'crowd'], 2.5, 1.5],
        },
      });

      map.on('click', 'stands', (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const s = JSON.parse(String(f.properties.json)) as StandStatus;
        new maplibregl.Popup({ offset: 10, closeButton: false })
          .setLngLat(s.coordinates)
          .setDOMContent(standPopup(s))
          .addTo(map);
      });
      map.on('mouseenter', 'stands', () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', 'stands', () => (map.getCanvas().style.cursor = ''));
      setReady(true);
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // --- Tap-and-hold / right-click to drop a start or destination ----------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let popup: maplibregl.Popup | null = null;
    let offeredAt = 0;

    const offer = (lngLat: maplibregl.LngLat) => {
      const onPick = propsRef.current.onPick;
      if (!onPick) return;
      // A touch long-press triggers both our timer and the browser's own contextmenu.
      if (Date.now() - offeredAt < 700) return;
      offeredAt = Date.now();
      popup?.remove();
      const box = document.createElement('div');
      box.className = 'flex gap-2';
      for (const [as, label] of [
        ['origin', 'Start here'],
        ['destination', 'Go here'],
      ] as const) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        b.className = 'rounded-lg bg-teal-700 px-3 py-2 text-sm font-semibold text-white';
        b.onclick = () => {
          onPick({ lat: lngLat.lat, lng: lngLat.lng }, as);
          popup?.remove();
        };
        box.append(b);
      }
      // closeOnClick is off: lifting the finger after a long-press fires a map `click`,
      // which would close the picker instantly on phones. Later taps close it (onClick).
      popup = new maplibregl.Popup({ closeButton: true, closeOnClick: false, offset: 6 })
        .setLngLat(lngLat)
        .setDOMContent(box)
        .addTo(map);
    };

    const onContext = (e: maplibregl.MapMouseEvent) => offer(e.lngLat);
    const onTouchStart = (e: maplibregl.MapTouchEvent) => {
      clearTimeout(timer);
      if (e.points.length === 1) timer = setTimeout(() => offer(e.lngLat), 550);
    };
    const cancel = () => clearTimeout(timer);
    const onClick = () => {
      if (popup && Date.now() - offeredAt > 600) popup.remove();
    };
    map.on('contextmenu', onContext);
    map.on('click', onClick);
    map.on('touchstart', onTouchStart);
    map.on('touchend', cancel);
    map.on('touchmove', cancel);
    map.on('movestart', cancel);
    return () => {
      cancel();
      popup?.remove();
      map.off('contextmenu', onContext);
      map.off('click', onClick);
      map.off('touchstart', onTouchStart);
      map.off('touchend', cancel);
      map.off('touchmove', cancel);
      map.off('movestart', cancel);
    };
  }, [ready]);

  // --- Live stands + vehicles ---------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const release = live.retain();
    const stands = new Map<string, StandStatus>();
    const colors = new Map<string, string>();
    const animator = new VehicleAnimator();
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const drawStands = () =>
      (map.getSource('stands') as GeoJSONSource | undefined)?.setData({
        type: 'FeatureCollection',
        features: [...stands.values()].map((s) => ({
          type: 'Feature',
          properties: {
            // Grey until a report is in effect: colour means someone observed the queue.
            color: isLiveReport(s, Date.now()) ? QUEUE_COLORS[s.passengerQueueLevel] : '#94a3b8',
            json: JSON.stringify(s),
          },
          geometry: { type: 'Point', coordinates: s.coordinates },
        })),
      });

    const sendBbox = () => {
      if (map.getZoom() < LIVE_MIN_ZOOM) return;
      const b = map.getBounds();
      live.setBbox([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
    };

    fetch(`${config.apiBase}/api/v1/stands`)
      .then((r) => (r.ok ? (r.json() as Promise<StandStatus[]>) : []))
      .then((list) => {
        for (const s of list) if (!stands.has(s.standId)) stands.set(s.standId, s);
        drawStands();
      })
      .catch(() => {});
    fetchRoutes()
      .then((routes) => routes.forEach((r) => r.color && colors.set(r.id, r.color)))
      .catch(() => {});

    const offStand = live.onStand((s) => {
      stands.set(s.standId, s);
      drawStands();
    });
    const offVehicle = live.onVehicle((v) => animator.update(v, performance.now()));
    const offRemoved = live.onVehicleRemoved((id) => animator.remove(id));
    const offOpen = live.onOpenChange((open) => open && sendBbox());
    map.on('moveend', sendBbox);
    sendBbox();

    const timer = setInterval(
      () => {
        const frame = animator.frame(performance.now(), !reduceMotion);
        (map.getSource('vehicles') as GeoJSONSource | undefined)?.setData({
          type: 'FeatureCollection',
          features: frame.map(({ vehicle, at }) => ({
            type: 'Feature',
            properties: {
              color: colors.get(vehicle.routeId ?? '') ?? '#334155',
              crowd: vehicle.source === 'crowd',
            },
            geometry: { type: 'Point', coordinates: at },
          })),
        });
      },
      reduceMotion ? 1000 : 100,
    );

    return () => {
      clearInterval(timer);
      map.off('moveend', sendBbox);
      offStand();
      offVehicle();
      offRemoved();
      offOpen();
      live.setBbox(null);
      release();
    };
  }, [ready]);

  // --- Origin / destination / user markers --------------------------------------------
  const { origin, destination, userLocation } = props;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const place = (
      key: 'origin' | 'destination' | 'user',
      at: { lat: number; lng: number } | null,
      cls: string,
      label: string,
    ) => {
      markers.current[key]?.remove();
      markers.current[key] = at
        ? new maplibregl.Marker({ element: markerEl(cls, label) })
            .setLngLat([at.lng, at.lat])
            .addTo(map)
        : null;
    };
    place(
      'origin',
      origin,
      'size-4 rounded-full border-4 border-teal-700 bg-white shadow',
      `Start: ${origin?.name ?? ''}`,
    );
    place(
      'destination',
      destination,
      'size-4 rounded-[4px] border-2 border-white bg-amber-500 shadow',
      `Destination: ${destination?.name ?? ''}`,
    );
    place(
      'user',
      userLocation,
      'size-4 rounded-full border-2 border-white bg-blue-600 shadow-[0_0_0_6px_rgba(37,99,235,0.2)]',
      'Your location',
    );
  }, [ready, origin, destination, userLocation]);

  // --- Selected itinerary + framing ---------------------------------------------------
  const { itinerary, nearby, insets } = props;
  const nearbyKey = nearby
    ? `${nearby.center.lat},${nearby.center.lng},${nearby.radiusMeters}`
    : '';
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const routeSrc = map.getSource('route') as GeoJSONSource;
    const nearbySrc = map.getSource('nearby') as GeoJSONSource;
    const padding = {
      top: insets.top + 56,
      right: insets.right + 32,
      bottom: insets.bottom + 32,
      left: insets.left + 32,
    };

    const points: LngLat[] = [];
    if (itinerary) {
      const fc = itineraryToGeoJSON(itinerary);
      routeSrc.setData(fc);
      fc.features.forEach((f) => points.push(...(f.geometry.coordinates as LngLat[])));
    } else {
      routeSrc.setData(EMPTY);
    }

    if (nearby) {
      const poly = circlePolygon(nearby.center, nearby.radiusMeters);
      nearbySrc.setData({ type: 'Feature', properties: {}, geometry: poly });
      points.push(...(poly.coordinates[0] as LngLat[]));
    } else {
      nearbySrc.setData(EMPTY);
    }

    if (!points.length) {
      for (const p of [origin, destination]) if (p) points.push([p.lng, p.lat]);
    }
    const bounds = boundsOf(points);
    if (!bounds) return;
    const [[w, s], [e, n]] = bounds;
    if (w === e && s === n) map.easeTo({ center: [w, s] as LngLatLike, zoom: 15, padding });
    else map.fitBounds(bounds, { padding, maxZoom: 16.5, duration: 600 });
    // Re-frame only when what is shown changes, not on every inset change mid-drag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    ready,
    itinerary?.id,
    nearbyKey,
    origin?.lat,
    origin?.lng,
    destination?.lat,
    destination?.lng,
  ]);

  return (
    <section className="absolute inset-0" aria-label="Map">
      {/* Sized with h/w, not `absolute inset-0`: MapLibre's CSS forces position: relative. */}
      <div ref={containerRef} className="h-full w-full" />
      {failed && (
        <p className="absolute inset-x-0 top-20 text-center text-xs font-medium text-slate-500">
          Map unavailable offline. Routes still work.
        </p>
      )}
    </section>
  );
}
