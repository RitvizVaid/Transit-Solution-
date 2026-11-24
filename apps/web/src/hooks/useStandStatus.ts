import { useCallback, useSyncExternalStore } from 'react';
import { getStandSnapshot, subscribeStand, type StandSnapshot } from '../lib/standStore';

const NONE = () => () => {};
const NULL_SNAPSHOT = () => null;

/** Live status for a stand, shared across components. `null` when there is no stand. */
export function useStandStatus(standId: string | undefined): StandSnapshot | null {
  const subscribe = useCallback(
    (listener: () => void) => (standId ? subscribeStand(standId, listener) : () => {}),
    [standId],
  );
  const getSnapshot = useCallback(() => (standId ? getStandSnapshot(standId) : null), [standId]);
  return useSyncExternalStore(standId ? subscribe : NONE, standId ? getSnapshot : NULL_SNAPSHOT);
}
