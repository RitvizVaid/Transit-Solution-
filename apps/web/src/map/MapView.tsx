import type { Itinerary, LatLng } from '@transit/shared-types';
import { Component, lazy, Suspense, type ReactNode } from 'react';
import type { Place } from '../types';

/**
 * Contract between the commuter UI (Contributor 1) and the map (Contributor 2).
 * The page owns state; the map renders it.
 */
export interface MapViewProps {
  origin: Place | null;
  destination: Place | null;
  /** Itinerary the user has selected; legs drawn WALK dashed, rides in routeColor. */
  itinerary: Itinerary | null;
  /** Blue dot, when the user has shared their location. */
  userLocation: LatLng | null;
  /** Centre + radius for the Nearby tab. */
  nearby: { center: LatLng; radiusMeters: number } | null;
  /** Space covered by UI on each edge (px), used as map padding when framing routes. */
  insets: { top: number; right: number; bottom: number; left: number };
  /** Long-press (touch) / right-click (mouse) on the map to set a point. */
  onPick?: (point: LatLng, as: 'origin' | 'destination') => void;
}

// MapLibre is ~270 KB gzipped: load it after the planner UI so the first paint stays fast.
const TransitMap = lazy(() => import('./TransitMap'));

function Placeholder({ note }: { note?: string }) {
  return (
    <div
      className="absolute inset-0 bg-[#e8eef0]"
      style={{
        backgroundImage:
          'linear-gradient(#d5dfe2 1px, transparent 1px), linear-gradient(90deg, #d5dfe2 1px, transparent 1px)',
        backgroundSize: '48px 48px',
      }}
      aria-hidden={!note}
    >
      {note && (
        <p className="absolute inset-x-0 top-20 text-center text-xs font-medium text-slate-500">
          {note}
        </p>
      )}
    </div>
  );
}

/** No WebGL, blocked tiles script, etc.: the planner must keep working without a map. */
class MapErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(err: unknown) {
    console.warn('map disabled', err);
  }
  override render() {
    return this.state.failed ? (
      <Placeholder note="Map unavailable on this device" />
    ) : (
      this.props.children
    );
  }
}

export function MapView(props: MapViewProps) {
  return (
    <MapErrorBoundary>
      <Suspense fallback={<Placeholder />}>
        <TransitMap {...props} />
      </Suspense>
    </MapErrorBoundary>
  );
}
