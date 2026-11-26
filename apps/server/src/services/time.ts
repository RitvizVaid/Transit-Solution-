/** India has one time zone and no DST, so a fixed offset is exact. */
export const IST_OFFSET_SEC = 5.5 * 3600;
export const DAY_SECONDS = 86_400;

/** Index of the current Delhi calendar day, with 1970-01-01 as day zero. */
export function localDayIndex(date: Date): number {
  return Math.floor((date.getTime() / 1000 + IST_OFFSET_SEC) / DAY_SECONDS);
}

/** Seconds since local (IST) midnight for an instant. */
export function localSecondsOfDay(date: Date): number {
  const s = Math.floor(date.getTime() / 1000) + IST_OFFSET_SEC;
  return ((s % DAY_SECONDS) + DAY_SECONDS) % DAY_SECONDS;
}

/**
 * Clock for routing/simulation. With `timeOfDay` ("HH:MM") it starts at that IST time
 * today and runs in real time; otherwise it is the real clock.
 */
export function serviceClock(timeOfDay?: string, bootMs = Date.now()): () => Date {
  if (!timeOfDay) return () => new Date();
  const [h = 0, m = 0] = timeOfDay.split(':').map(Number);
  const offsetMs = (h * 3600 + m * 60 - localSecondsOfDay(new Date(bootMs))) * 1000;
  return () => new Date(Date.now() + offsetMs);
}

export function isWithin(secs: number, start: number, end: number): boolean {
  return end > 86400 ? secs >= start || secs + 86400 <= end : secs >= start && secs <= end;
}
