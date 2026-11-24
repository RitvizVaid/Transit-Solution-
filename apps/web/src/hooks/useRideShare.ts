import { useSyncExternalStore } from 'react';
import { endRide, postRidePosition } from '../api';
import { RideShare, type Fix, type FixError } from '../lib/rideShare';

function watchGps(onFix: (f: Fix) => void, onError: (e: FixError) => void): () => void {
  const id = navigator.geolocation.watchPosition(
    (pos) =>
      onFix({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracyM: pos.coords.accuracy,
        at: pos.timestamp,
      }),
    (err) => onError(err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable'),
    { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 },
  );
  return () => navigator.geolocation.clearWatch(id);
}

/** The app's one ride-sharing session (a phone is on one vehicle at a time). */
export const rideShare = new RideShare({
  watch: typeof navigator !== 'undefined' && 'geolocation' in navigator ? watchGps : null,
  send: postRidePosition,
  end: endRide,
  now: Date.now,
  newRideId: () => crypto.randomUUID(),
  every: (ms, fn) => {
    const id = setInterval(fn, ms);
    return () => clearInterval(id);
  },
});

// Closing the tab ends the ride, so the vehicle leaves the map at once.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => rideShare.stop('user'));
}

export function useRideShare() {
  return useSyncExternalStore(rideShare.subscribe, rideShare.getState, rideShare.getState);
}
