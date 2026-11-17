/**
 * Pure date and layout helpers of the Gantt chart.
 * A day is a whole number (days since 1970-01-01, counted in UTC), so no timezone or
 * daylight-saving change can shift a bar: "2026-03-29" is always one day after "2026-03-28".
 */

const DAY_MS = 86_400_000;

/** "2026-11-17" → its day number. */
export function dayNumber(date: string): number {
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

/** A day number → "2026-11-17". */
export function dateOfDay(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  return dateOfDay(dayNumber(date) + days);
}

/** Today as the user's clock shows it (not the UTC day, which is still yesterday at 00:30 in Zurich). */
export function localDate(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayOf(day: number): number {
  // 1970-01-01 was a Thursday.
  return (((day + 3) % 7) + 7) % 7;
}

export function isWeekend(day: number): boolean {
  return weekdayOf(day) >= 5;
}

/** The Monday of the week of a day. */
export function mondayOf(day: number): number {
  return day - weekdayOf(day);
}

/** ISO week number (1 to 53): the week that holds the Thursday. */
export function isoWeek(day: number): number {
  const thursday = mondayOf(day) + 3;
  const year = new Date(thursday * DAY_MS).getUTCFullYear();
  const jan1 = Math.round(Date.UTC(year, 0, 1) / DAY_MS);
  return Math.floor((thursday - jan1) / 7) + 1;
}

/** The days the grid shows: from `start` to `end` inclusive, always whole weeks (Monday to Sunday). */
export type GanttRange = { start: number; end: number; days: number };

export type RangeOptions = { before?: number; after?: number; maxBefore?: number; maxAfter?: number };

/**
 * The range that covers today and every dated item, with some air on both sides.
 * It never goes further than maxBefore/maxAfter days from today, so one stray date
 * (a ticket due in 2099) cannot make the grid endless: such a bar is simply cut.
 */
export function ganttRange(dates: (string | null | undefined)[], today: string, { before = 14, after = 45, maxBefore = 370, maxAfter = 740 }: RangeOptions = {}): GanttRange {
  const t = dayNumber(today);
  let min = t;
  let max = t;
  for (const d of dates) {
    if (!d) continue;
    const n = dayNumber(d);
    if (Number.isNaN(n)) continue;
    if (n < min) min = n;
    if (n > max) max = n;
  }
  const start = mondayOf(Math.max(min - before, t - maxBefore));
  const end = mondayOf(Math.min(max + after, t + maxAfter)) + 6;
  return { start, end, days: end - start + 1 };
}

/** What a ticket draws: a range (both dates), or one day at its due date or at its start. */
export type Span = { start: number; end: number; kind: "range" | "due" | "start" };

/** The bar of an item from its two dates, or null when it has none. A due date before the start is read as a one-day bar at the start. */
export function spanOf(startDate: string | null | undefined, dueDate: string | null | undefined): Span | null {
  if (startDate && dueDate) {
    const start = dayNumber(startDate);
    return { start, end: Math.max(start, dayNumber(dueDate)), kind: "range" };
  }
  if (dueDate) return { start: dayNumber(dueDate), end: dayNumber(dueDate), kind: "due" };
  if (startDate) return { start: dayNumber(startDate), end: dayNumber(startDate), kind: "start" };
  return null;
}

/** Where a span sits on the grid, in pixels: the end day is included. */
export function barGeometry(span: { start: number; end: number }, rangeStart: number, dayWidth: number): { x: number; width: number } {
  return { x: (span.start - rangeStart) * dayWidth, width: (span.end - span.start + 1) * dayWidth };
}

/** The day under a horizontal position of the grid. */
export function dayAtX(x: number, rangeStart: number, dayWidth: number): number {
  return rangeStart + Math.floor(x / dayWidth);
}

export type DragMode = "move" | "start" | "end";

/**
 * The dates of a ticket after dragging its bar by `delta` days.
 * move shifts the dates it has; the edges change one date and never cross the other.
 * On a one-day item, the edge on the side of the missing date gives it that date.
 */
export function dragDates(startDate: string | null, dueDate: string | null, mode: DragMode, delta: number): { startDate: string | null; dueDate: string | null } {
  if (!delta || (!startDate && !dueDate)) return { startDate, dueDate };
  if (mode === "move") return { startDate: startDate && addDays(startDate, delta), dueDate: dueDate && addDays(dueDate, delta) };
  if (startDate && dueDate) {
    const s = dayNumber(startDate);
    const e = Math.max(s, dayNumber(dueDate));
    // The date that is not dragged stays as stored.
    return mode === "start" ? { startDate: dateOfDay(Math.min(s + delta, e)), dueDate } : { startDate, dueDate: dateOfDay(Math.max(e + delta, s)) };
  }
  if (dueDate) {
    // Only a due date: pulling the left edge to the left gives a start, the right edge moves the due date.
    if (mode === "end") return { startDate: null, dueDate: addDays(dueDate, delta) };
    return delta < 0 ? { startDate: addDays(dueDate, delta), dueDate } : { startDate: null, dueDate };
  }
  // Only a start: pulling the right edge to the right gives a due date, the left edge moves the start.
  if (mode === "start") return { startDate: addDays(startDate!, delta), dueDate: null };
  return delta > 0 ? { startDate, dueDate: addDays(startDate!, delta) } : { startDate, dueDate: null };
}

/** One month of the header: where it starts in the range and how many of its days are shown. */
export type MonthSegment = { key: string; year: number; month: number; offset: number; days: number };

export function monthSegments(range: { start: number; end: number }): MonthSegment[] {
  const out: MonthSegment[] = [];
  let day = range.start;
  while (day <= range.end) {
    const d = new Date(day * DAY_MS);
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth();
    const next = Math.round(Date.UTC(year, month + 1, 1) / DAY_MS);
    const last = Math.min(next - 1, range.end);
    out.push({ key: `${year}-${String(month + 1).padStart(2, "0")}`, year, month: month + 1, offset: day - range.start, days: last - day + 1 });
    day = last + 1;
  }
  return out;
}

/** One week of the header (cut at the edges of the range), with its ISO number. */
export type WeekSegment = { monday: number; week: number; offset: number; days: number };

export function weekSegments(range: { start: number; end: number }): WeekSegment[] {
  const out: WeekSegment[] = [];
  let day = range.start;
  while (day <= range.end) {
    const monday = mondayOf(day);
    const last = Math.min(monday + 6, range.end);
    out.push({ monday, week: isoWeek(day), offset: day - range.start, days: last - day + 1 });
    day = last + 1;
  }
  return out;
}

/**
 * A dependency is in conflict when the blocked ticket starts before the last day of its blocker.
 * Starting on the very day the blocker ends is accepted (a hand-over on the same day).
 */
export function isConflict(blocker: { end: number } | null, blocked: { start: number } | null): boolean {
  return !!blocker && !!blocked && blocked.start < blocker.end;
}

/**
 * The right-angled path of a dependency arrow, from the end of the blocker (x1, y1) to the start of
 * the blocked bar (x2, y2). When the target starts too far left, the path goes around through the
 * line between two rows (`rowHeight` apart) and comes back from the left.
 */
export function arrowPath(x1: number, y1: number, x2: number, y2: number, rowHeight: number, gap = 8): string {
  if (x2 >= x1 + 2 * gap) return y1 === y2 ? `M${x1} ${y1}H${x2}` : `M${x1} ${y1}H${x1 + gap}V${y2}H${x2}`;
  const mid = y1 + (y2 >= y1 ? rowHeight / 2 : -rowHeight / 2);
  return `M${x1} ${y1}H${x1 + gap}V${mid}H${x2 - gap}V${y2}H${x2}`;
}

/** Where to put the "remove" button of an arrow: on its vertical run, or on its way back. */
export function arrowMiddle(x1: number, y1: number, x2: number, y2: number, rowHeight: number, gap = 8): { x: number; y: number } {
  if (x2 >= x1 + 2 * gap) return { x: x1 + gap, y: (y1 + y2) / 2 };
  return { x: (x1 + x2) / 2, y: y1 + (y2 >= y1 ? rowHeight / 2 : -rowHeight / 2) };
}

/** Tickets in display order: each top-level ticket (by number) followed by its sub-tickets, one level deeper. */
export function orderTree<T extends { id: string; parentId: string | null; number: number }>(issues: T[]): { issue: T; depth: number }[] {
  const ids = new Set(issues.map((i) => i.id));
  const children = new Map<string, T[]>();
  const roots: T[] = [];
  for (const i of issues) {
    // A sub-ticket whose parent is not in this list (other epic, hidden) is shown as a top-level row.
    if (i.parentId && ids.has(i.parentId) && i.parentId !== i.id) children.set(i.parentId, [...(children.get(i.parentId) ?? []), i]);
    else roots.push(i);
  }
  const byNumber = (a: T, b: T) => a.number - b.number;
  const out: { issue: T; depth: number }[] = [];
  const seen = new Set<string>();
  const walk = (issue: T, depth: number) => {
    if (seen.has(issue.id)) return;
    seen.add(issue.id);
    out.push({ issue, depth });
    (children.get(issue.id) ?? []).sort(byNumber).forEach((c) => walk(c, depth + 1));
  };
  roots.sort(byNumber).forEach((r) => walk(r, 0));
  // Whatever a parent loop left out still gets a row.
  issues.filter((i) => !seen.has(i.id)).sort(byNumber).forEach((i) => walk(i, 0));
  return out;
}
