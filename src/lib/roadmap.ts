import type { Epic, RoadmapProject } from "./types";

// Dates are "YYYY-MM-DD" strings; the maths is done on day numbers (days since 1970, in UTC),
// so a timezone can never shift a bar by one day.
const DAY_MS = 86_400_000;

export function toDay(iso: string) {
  return Math.round(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / DAY_MS);
}

export function fromDay(day: number) {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/** Today as the user's calendar shows it (local date, not UTC). */
export function todayIso(now = new Date()) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** The first day of the month `offset` months away from the month of `day`. */
export function monthStart(day: number, offset = 0) {
  const d = new Date(day * DAY_MS);
  return Math.round(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1) / DAY_MS);
}

export type Month = { start: number; days: number; month: number; year: number };

/** The months from `start` (a first of month) up to `end` (excluded). */
export function monthsBetween(start: number, end: number): Month[] {
  const months: Month[] = [];
  for (let s = monthStart(start); s < end; ) {
    const next = monthStart(s, 1);
    const d = new Date(s * DAY_MS);
    months.push({ start: s, days: next - s, month: d.getUTCMonth(), year: d.getUTCFullYear() });
    s = next;
  }
  return months;
}

/** Every date placed on the roadmap, as day numbers. */
function datedDays(projects: RoadmapProject[]) {
  const days: number[] = [];
  for (const { epics, sprints } of projects) {
    for (const e of epics) for (const d of [e.startDate, e.targetDate]) if (d) days.push(toDay(d));
    for (const s of sprints) for (const d of [s.startDate, s.endDate]) if (d) days.push(toDay(d));
  }
  return days;
}

/** Whether anything at all can be drawn on the timeline. */
export function hasDates(projects: RoadmapProject[]) {
  return datedDays(projects).length > 0;
}

/**
 * The window of the timeline, in whole months: everything dated plus today, with a month of margin
 * before and after, a year ahead at least, and never fewer than `minMonths` (to fill the screen).
 * `end` is excluded.
 */
export function roadmapRange(projects: RoadmapProject[], today: string, minMonths = 0) {
  const t = toDay(today);
  const days = [...datedDays(projects), t];
  const start = monthStart(Math.min(...days), -1);
  let end = Math.max(monthStart(Math.max(...days), 2), monthStart(t, 13));
  while (monthsBetween(start, end).length < minMonths) end = monthStart(end, 1);
  return { start, end };
}

export type Span = { start: string | null; target: string | null };
export type DragMode = "move" | "start" | "end";

/**
 * The dates of an epic after dragging it by `delta` days: the whole bar ("move") or one edge.
 * Stays inside [min, max] (day numbers, both included) and never lets the target pass before the start.
 */
export function shiftSpan(span: Span, mode: DragMode, delta: number, min: number, max: number): Span {
  const s = span.start ? toDay(span.start) : null;
  const t = span.target ? toDay(span.target) : null;
  if (mode === "move") {
    const first = s ?? t;
    const last = t ?? s;
    if (first === null || last === null) return span;
    // A bar already outside the window is not pulled back by a tiny drag.
    const d = Math.max(Math.min(min - Math.min(first, last), 0), Math.min(Math.max(max - Math.max(first, last), 0), delta));
    return { start: s === null ? null : fromDay(s + d), target: t === null ? null : fromDay(t + d) };
  }
  if (s === null || t === null) return span;
  if (mode === "start") return { start: fromDay(Math.min(Math.max(s + delta, Math.min(min, s)), Math.max(t, s))), target: span.target };
  return { start: span.start, target: fromDay(Math.max(Math.min(t + delta, Math.max(max, t)), Math.min(s, t))) };
}

/** Late: the target is past and the epic is neither finished nor canceled. */
export function epicOverdue(epic: Pick<Epic, "state" | "targetDate">, today: string) {
  return !!epic.targetDate && epic.targetDate < today && (epic.state === "planned" || epic.state === "active");
}
