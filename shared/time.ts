/**
 * UK-time helpers. Nominet publishes drop times in UTC; the app presents them
 * in Europe/London time (BST in summer, GMT in winter), and "today" means the
 * current UK calendar day. Uses Intl, so it works in Workers and browsers.
 */

export const UK_TIME_ZONE = "Europe/London";

const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: UK_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const dateTimeParts = new Intl.DateTimeFormat("en-GB", {
  timeZone: UK_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
  timeZoneName: "short",
});

/** UK offsets are whole hours, so the UK date is constant within a UTC hour. */
const dateCache = new Map<string, string>();

/** YYYY-MM-DD of the given instant in UK time. */
export function londonDate(value: string | Date): string {
  const iso = typeof value === "string" ? value : value.toISOString();
  const hourKey = iso.slice(0, 13);
  const cached = dateCache.get(hourKey);
  if (cached) return cached;
  const result = dateFormatter.format(new Date(iso));
  if (dateCache.size > 10_000) dateCache.clear();
  dateCache.set(hourKey, result);
  return result;
}

/** Today's date in the UK. */
export function londonToday(now: Date = new Date()): string {
  return londonDate(now);
}

/** Adds whole days to a YYYY-MM-DD calendar date. */
export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** "2026-09-26 00:30:15 BST": sortable UK date-time for exports. */
export function formatLondonDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const parts = Object.fromEntries(dateTimeParts.formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second} ${parts.timeZoneName}`;
}
