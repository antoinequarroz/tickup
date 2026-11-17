import { describe, expect, it } from "vitest";
import { epicOverdue, fromDay, hasDates, monthsBetween, monthStart, roadmapRange, shiftSpan, toDay, todayIso } from "./roadmap";
import type { Epic, RoadmapProject, Sprint } from "./types";

const epic = (startDate: string | null, targetDate: string | null) => ({ startDate, targetDate }) as Epic;
const sprint = (startDate: string | null, endDate: string | null) => ({ startDate, endDate }) as Sprint;
const project = (epics: Epic[], sprints: Sprint[] = []) => ({ project: {}, epics, sprints }) as RoadmapProject;

describe("day numbers", () => {
  it("round-trips dates, across leap days and year ends", () => {
    for (const iso of ["1970-01-01", "2024-02-29", "2026-11-17", "2026-12-31", "2027-01-01"]) expect(fromDay(toDay(iso))).toBe(iso);
    expect(toDay("2024-03-01") - toDay("2024-02-28")).toBe(2);
    expect(toDay("2027-01-01") - toDay("2026-12-31")).toBe(1);
  });

  it("gives the local calendar date for today", () => {
    expect(todayIso(new Date(2026, 0, 5, 23, 30))).toBe("2026-01-05");
    expect(todayIso(new Date(2026, 10, 17, 0, 10))).toBe("2026-11-17");
  });
});

describe("months", () => {
  it("finds the first day of a month, with an offset", () => {
    expect(fromDay(monthStart(toDay("2026-11-17")))).toBe("2026-11-01");
    expect(fromDay(monthStart(toDay("2026-11-17"), 2))).toBe("2027-01-01");
    expect(fromDay(monthStart(toDay("2026-01-31"), -1))).toBe("2025-12-01");
  });

  it("lists months with their length", () => {
    const months = monthsBetween(toDay("2023-12-01"), toDay("2024-03-01"));
    expect(months.map((m) => [m.year, m.month, m.days])).toEqual([
      [2023, 11, 31],
      [2024, 0, 31],
      [2024, 1, 29],
    ]);
    expect(months[1].start).toBe(toDay("2024-01-01"));
  });
});

describe("roadmapRange", () => {
  it("covers every date and today, with a month of margin", () => {
    const r = roadmapRange([project([epic("2026-03-10", "2026-05-02")], [sprint("2028-01-05", "2028-02-20")])], "2026-11-17");
    expect(fromDay(r.start)).toBe("2026-02-01");
    expect(fromDay(r.end)).toBe("2028-04-01");
  });

  it("shows a year ahead when nothing is planned that far", () => {
    const r = roadmapRange([project([epic("2026-11-01", null)])], "2026-11-17");
    expect(fromDay(r.start)).toBe("2026-10-01");
    expect(fromDay(r.end)).toBe("2027-12-01");
  });

  it("grows to a minimum number of months", () => {
    const r = roadmapRange([], "2026-11-17", 30);
    expect(monthsBetween(r.start, r.end)).toHaveLength(30);
    expect(fromDay(r.start)).toBe("2026-10-01");
  });
});

describe("hasDates", () => {
  it("is true as soon as one epic or sprint has a date", () => {
    expect(hasDates([project([epic(null, null)], [sprint(null, null)])])).toBe(false);
    expect(hasDates([project([epic(null, "2026-01-01")])])).toBe(true);
    expect(hasDates([project([], [sprint("2026-01-01", null)])])).toBe(true);
  });
});

describe("shiftSpan", () => {
  const min = toDay("2026-01-01");
  const max = toDay("2026-12-31");
  const span = { start: "2026-03-10", target: "2026-03-20" };

  it("moves both dates together", () => {
    expect(shiftSpan(span, "move", 5, min, max)).toEqual({ start: "2026-03-15", target: "2026-03-25" });
    expect(shiftSpan(span, "move", -12, min, max)).toEqual({ start: "2026-02-26", target: "2026-03-08" });
  });

  it("keeps the length when a move hits the edge of the window", () => {
    expect(shiftSpan(span, "move", 1000, min, max)).toEqual({ start: "2026-12-21", target: "2026-12-31" });
    expect(shiftSpan(span, "move", -1000, min, max)).toEqual({ start: "2026-01-01", target: "2026-01-11" });
  });

  it("moves a milestone, whichever date it has", () => {
    expect(shiftSpan({ start: null, target: "2026-03-20" }, "move", 2, min, max)).toEqual({ start: null, target: "2026-03-22" });
    expect(shiftSpan({ start: "2026-03-20", target: null }, "move", -2, min, max)).toEqual({ start: "2026-03-18", target: null });
    expect(shiftSpan({ start: null, target: null }, "move", 3, min, max)).toEqual({ start: null, target: null });
  });

  it("resizes one edge and never crosses the other", () => {
    expect(shiftSpan(span, "start", 4, min, max)).toEqual({ start: "2026-03-14", target: "2026-03-20" });
    expect(shiftSpan(span, "start", 40, min, max)).toEqual({ start: "2026-03-20", target: "2026-03-20" });
    expect(shiftSpan(span, "end", -3, min, max)).toEqual({ start: "2026-03-10", target: "2026-03-17" });
    expect(shiftSpan(span, "end", -40, min, max)).toEqual({ start: "2026-03-10", target: "2026-03-10" });
    expect(shiftSpan(span, "end", 1000, min, max)).toEqual({ start: "2026-03-10", target: "2026-12-31" });
    expect(shiftSpan(span, "start", -1000, min, max)).toEqual({ start: "2026-01-01", target: "2026-03-20" });
  });

  it("does not resize a milestone", () => {
    const one = { start: null, target: "2026-03-20" };
    expect(shiftSpan(one, "end", 3, min, max)).toEqual(one);
  });

  it("leaves dates alone when nothing moved", () => {
    expect(shiftSpan(span, "move", 0, min, max)).toEqual(span);
    const outside = { start: "2025-06-01", target: "2025-06-10" };
    expect(shiftSpan(outside, "move", 0, min, max)).toEqual(outside);
  });
});

describe("epicOverdue", () => {
  it("is late only when open and past its target", () => {
    expect(epicOverdue({ state: "active", targetDate: "2026-11-16" }, "2026-11-17")).toBe(true);
    expect(epicOverdue({ state: "planned", targetDate: "2026-11-17" }, "2026-11-17")).toBe(false);
    expect(epicOverdue({ state: "done", targetDate: "2026-01-01" }, "2026-11-17")).toBe(false);
    expect(epicOverdue({ state: "canceled", targetDate: "2026-01-01" }, "2026-11-17")).toBe(false);
    expect(epicOverdue({ state: "active", targetDate: null }, "2026-11-17")).toBe(false);
  });
});
