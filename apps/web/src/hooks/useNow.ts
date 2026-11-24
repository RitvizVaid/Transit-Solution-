import { useEffect, useState } from 'react';

/**
 * Current time that re-renders every `intervalMs`. Keeps render pure (no Date.now()
 * in JSX) and lets time-based UI age on its own, e.g. a live badge turning stale.
 */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
