import { GST_DIVISOR, PRINT_LEAD_TIME } from "./config";

const currency = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
});

/** Cents → "$12.00". */
export function money(cents: number): string {
  return currency.format(cents / 100);
}

/** The GST component already inside a GST-inclusive total. */
export function gstComponent(cents: number): number {
  return Math.round(cents / GST_DIVISOR);
}

const dateFmt = new Intl.DateTimeFormat("en-AU", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

const dayMonthFmt = new Intl.DateTimeFormat("en-AU", {
  day: "numeric",
  month: "short",
});

export function formatDate(value: string | Date): string {
  return dateFmt.format(new Date(value));
}

function addBusinessDays(from: Date, days: number): Date {
  const date = new Date(from);
  let added = 0;
  while (added < days) {
    date.setDate(date.getDate() + 1);
    const day = date.getDay();
    if (day !== 0 && day !== 6) added += 1;
  }
  return date;
}

/**
 * Delivery window = printing lead time + the carrier's transit range.
 * Returned as a display string like "2–9 Sep".
 */
export function deliveryWindow(
  transitMin: number,
  transitMax: number,
  from: Date = new Date(),
): string {
  const earliest = addBusinessDays(from, PRINT_LEAD_TIME.minDays + transitMin);
  const latest = addBusinessDays(from, PRINT_LEAD_TIME.maxDays + transitMax);
  const sameMonth = earliest.getMonth() === latest.getMonth();
  return sameMonth
    ? `${earliest.getDate()}–${dayMonthFmt.format(latest)}`
    : `${dayMonthFmt.format(earliest)} – ${dayMonthFmt.format(latest)}`;
}

/** "2 weeks ago" / "3 months ago" for review timestamps. */
export function relativeTime(value: string | Date): string {
  const then = new Date(value).getTime();
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days < 1) return "today";
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  if (days < 31) {
    const weeks = Math.floor(days / 7);
    return `${weeks} week${weeks === 1 ? "" : "s"} ago`;
  }
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.floor(months / 12);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}

export function pluralise(count: number, singular: string, plural?: string) {
  return `${count} ${count === 1 ? singular : (plural ?? `${singular}s`)}`;
}
