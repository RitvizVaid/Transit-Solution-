const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const DAY_MS = 86_400_000;

export interface ServiceCalendar {
  weekly?: { start: number; end: number; days: boolean[] };
  exceptions: Map<number, boolean>;
}

function dayIndex(value: string | undefined): number {
  if (!value || !/^\d{8}$/.test(value)) throw new Error('Invalid GTFS service date');
  const date = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== date) {
    throw new Error('Invalid GTFS service date');
  }
  return ms / DAY_MS;
}

export function readServiceCalendars(
  weekly: Record<string, string>[],
  exceptions: Record<string, string>[],
): Map<string, ServiceCalendar> {
  const calendars = new Map<string, ServiceCalendar>();
  for (const row of weekly) {
    const id = row.service_id;
    const start = dayIndex(row.start_date);
    const end = dayIndex(row.end_date);
    if (
      !id ||
      calendars.has(id) ||
      end < start ||
      WEEKDAYS.some((key) => !['0', '1'].includes(row[key] ?? ''))
    ) {
      throw new Error('Invalid GTFS weekly service calendar');
    }
    const days = WEEKDAYS.map((key) => row[key] === '1');
    calendars.set(id, { weekly: { start, end, days }, exceptions: new Map() });
  }
  for (const row of exceptions) {
    const id = row.service_id;
    const type = row.exception_type;
    if (!id || (type !== '1' && type !== '2')) throw new Error('Invalid GTFS service exception');
    const calendar = calendars.get(id) ?? { exceptions: new Map<number, boolean>() };
    const day = dayIndex(row.date);
    if (calendar.exceptions.has(day)) throw new Error('Duplicate GTFS service exception');
    calendar.exceptions.set(day, type === '1');
    calendars.set(id, calendar);
  }
  return calendars;
}

export function serviceRuns(calendar: ServiceCalendar | undefined, day: number): boolean {
  if (!calendar) return true;
  const exception = calendar.exceptions.get(day);
  if (exception !== undefined) return exception;
  const weekly = calendar.weekly;
  // Unix day zero was Thursday. Normalize the remainder for pre-1970 dates.
  const weekday = (((day + 3) % 7) + 7) % 7;
  return !!weekly && day >= weekly.start && day <= weekly.end && weekly.days[weekday] === true;
}
