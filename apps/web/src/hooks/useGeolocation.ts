import type { LatLng } from '@transit/shared-types';
import { useCallback, useState } from 'react';

export type GeoError = 'denied' | 'unavailable' | 'timeout' | 'unsupported';

export const GEO_ERROR_TEXT: Record<GeoError, string> = {
  denied: 'Location is blocked. Allow it in your browser settings, or type where you are.',
  unavailable: "Couldn't find your location. Try again outdoors, or type where you are.",
  timeout: 'Finding your location took too long. Try again.',
  unsupported: "This browser can't share location. Type where you are instead.",
};

interface GeoState {
  status: 'idle' | 'locating' | 'ok' | 'error';
  position: LatLng | null;
  error: GeoError | null;
}

export function useGeolocation() {
  const [state, setState] = useState<GeoState>({ status: 'idle', position: null, error: null });

  const locate = useCallback(
    () =>
      new Promise<LatLng | null>((resolve) => {
        if (!('geolocation' in navigator)) {
          setState((s) => ({ ...s, status: 'error', error: 'unsupported' }));
          resolve(null);
          return;
        }
        setState((s) => ({ ...s, status: 'locating', error: null }));
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const position = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            setState({ status: 'ok', position, error: null });
            resolve(position);
          },
          (err) => {
            const error: GeoError =
              err.code === err.PERMISSION_DENIED
                ? 'denied'
                : err.code === err.TIMEOUT
                  ? 'timeout'
                  : 'unavailable';
            setState((s) => ({ ...s, status: 'error', error }));
            resolve(null);
          },
          { enableHighAccuracy: true, timeout: 12_000, maximumAge: 30_000 },
        );
      }),
    [],
  );

  const clearError = useCallback(() => setState((s) => ({ ...s, error: null })), []);

  return { ...state, locate, clearError };
}
