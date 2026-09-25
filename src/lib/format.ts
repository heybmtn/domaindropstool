const integer = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat("en-GB", { notation: "compact", maximumFractionDigits: 1 });
const currency = new Intl.NumberFormat("en-GB", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function formatNumber(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : integer.format(value);
}

export function formatCompact(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return value < 10_000 ? integer.format(value) : compact.format(value);
}

export function formatMoney(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : currency.format(value);
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
    timeZoneName: "short",
  });
}

export function relativeDays(value: string | null | undefined, now = new Date()): string {
  if (!value) return "never";
  const days = Math.floor((now.getTime() - new Date(value).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

const ukDateTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
  timeZoneName: "short",
});
const ukTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
  timeZoneName: "short",
});
const ukDay = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "2-digit", month: "short", year: "numeric" });

/** Full UK drop time, e.g. "26 Sept 2026, 00:30:15 BST". */
export function formatDropTime(iso: string | null | undefined): string {
  return iso ? ukDateTime.format(new Date(iso)) : "—";
}

/** UK time of day with zone, e.g. "00:30:15 BST". */
export function formatDropClock(iso: string | null | undefined): string {
  return iso ? ukTime.format(new Date(iso)) : "—";
}

/** UK calendar date of an instant, e.g. "26 Sept 2026". */
export function formatDropDay(iso: string | null | undefined): string {
  return iso ? ukDay.format(new Date(iso)) : "—";
}

/** The exact UTC instant, for tooltips: "2026-09-25 23:30:15 UTC". */
export function formatUtc(iso: string | null | undefined): string {
  return iso ? `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC` : "";
}

/** Countdown to a drop within the next 24h: "in 2h 14m", "in 45s"; "dropped" once passed; "" if further out. */
export function timeUntil(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "";
  const seconds = Math.round((new Date(iso).getTime() - now.getTime()) / 1000);
  if (seconds <= 0) return "dropped";
  if (seconds > 86_400) return "";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `in ${hours}h ${minutes}m`;
  if (minutes > 0) return `in ${minutes}m ${seconds % 60}s`;
  return `in ${seconds}s`;
}
