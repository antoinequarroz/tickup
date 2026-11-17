import { describe, expect, it } from "vitest";
import { addDays, arrowMiddle, arrowPath, barGeometry, dateOfDay, dayAtX, dayNumber, dragDates, ganttRange, isConflict, isoWeek, isWeekend, localDate, mondayOf, monthSegments, orderTree, spanOf, weekdayOf, weekSegments } from "./gantt";

// The clock changes of Europe/Zurich are part of what is tested here.
process.env.TZ = "Europe/Zurich";

describe("day numbers", () => {
  it("goes from a date to a day and back", () => {
    expect(dayNumber("1970-01-01")).toBe(0);
    expect(dayNumber("1970-01-02")).toBe(1);
    for (const d of ["2026-11-17", "2024-02-29", "2026-12-31", "2027-01-01", "1999-12-31"]) expect(dateOfDay(dayNumber(d))).toBe(d);
  });

  it("crosses months, years and leap days", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(dayNumber("2027-01-01") - dayNumber("2026-01-01")).toBe(365);
    expect(dayNumber("2025-01-01") - dayNumber("2024-01-01")).toBe(366);
  });

  it("is not shifted by the clock changes of Europe/Zurich", () => {
    // Last Sunday of March 2026 (23 hours long) and of October 2026 (25 hours long).
    expect(new Date(2026, 2, 29, 12).getTimezoneOffset()).not.toBe(new Date(2026, 2, 28, 12).getTimezoneOffset());
    for (const sunday of ["2026-03-29", "2026-10-25", "2027-03-28", "2027-10-31"]) {
      const n = dayNumber(sunday);
      expect(weekdayOf(n)).toBe(6);
      expect(dateOfDay(n - 1)).toBe(addDays(sunday, -1));
      expect(dayNumber(addDays(sunday, 1)) - dayNumber(addDays(sunday, -1))).toBe(2);
      expect(addDays(addDays(sunday, -1), 1)).toBe(sunday);
      expect(addDays(addDays(sunday, 1), -1)).toBe(sunday);
    }
    expect(addDays("2026-03-28", 1)).toBe("2026-03-29");
    expect(addDays("2026-03-29", 1)).toBe("2026-03-30");
    expect(addDays("2026-10-24", 2)).toBe("2026-10-26");
    // Every day of 2026 is exactly one step after the one before.
    let d = "2026-01-01";
    for (let i = 0; i < 365; i++) {
      const next = addDays(d, 1);
      expect(dayNumber(next)).toBe(dayNumber(d) + 1);
      expect(next > d).toBe(true);
      d = next;
    }
    expect(d).toBe("2027-01-01");
  });

  it("reads today from the local clock, also just after midnight and on the days the clock changes", () => {
    expect(localDate(new Date(2026, 10, 17, 0, 30))).toBe("2026-11-17");
    expect(localDate(new Date(2026, 10, 17, 23, 59))).toBe("2026-11-17");
    expect(localDate(new Date(2026, 2, 29, 0, 30))).toBe("2026-03-29");
    expect(localDate(new Date(2026, 2, 29, 3, 30))).toBe("2026-03-29");
    expect(localDate(new Date(2026, 9, 25, 2, 30))).toBe("2026-10-25");
    expect(localDate(new Date(2026, 11, 31, 23, 59))).toBe("2026-12-31");
    expect(localDate(new Date(2027, 0, 1, 0, 0))).toBe("2027-01-01");
  });
});

describe("weeks", () => {
  it("knows the weekday, Monday first", () => {
    expect(weekdayOf(dayNumber("2026-11-16"))).toBe(0); // Monday
    expect(weekdayOf(dayNumber("2026-11-17"))).toBe(1);
    expect(weekdayOf(dayNumber("2026-11-22"))).toBe(6);
    expect(weekdayOf(dayNumber("1969-12-28"))).toBe(6); // before 1970 too
    expect(isWeekend(dayNumber("2026-11-21"))).toBe(true);
    expect(isWeekend(dayNumber("2026-11-22"))).toBe(true);
    expect(isWeekend(dayNumber("2026-11-20"))).toBe(false);
    expect(dateOfDay(mondayOf(dayNumber("2026-11-22")))).toBe("2026-11-16");
    expect(dateOfDay(mondayOf(dayNumber("2026-11-16")))).toBe("2026-11-16");
  });

  it("numbers ISO weeks across the new year", () => {
    expect(isoWeek(dayNumber("2026-11-17"))).toBe(47);
    expect(isoWeek(dayNumber("2026-12-28"))).toBe(53);
    expect(isoWeek(dayNumber("2027-01-03"))).toBe(53);
    expect(isoWeek(dayNumber("2027-01-04"))).toBe(1);
    expect(isoWeek(dayNumber("2024-12-30"))).toBe(1);
    expect(isoWeek(dayNumber("2026-01-01"))).toBe(1);
    expect(isoWeek(dayNumber("2021-01-03"))).toBe(53);
  });
});

describe("ganttRange", () => {
  it("covers today and every date with padding, in whole weeks", () => {
    const r = ganttRange(["2026-11-02", null, "2026-12-20", undefined], "2026-11-17", { before: 14, after: 45 });
    expect(weekdayOf(r.start)).toBe(0);
    expect(weekdayOf(r.end)).toBe(6);
    expect(r.days % 7).toBe(0);
    expect(r.days).toBe(r.end - r.start + 1);
    expect(r.start).toBeLessThanOrEqual(dayNumber("2026-11-02") - 14);
    expect(r.start).toBeGreaterThan(dayNumber("2026-11-02") - 14 - 7);
    expect(r.end).toBeGreaterThanOrEqual(dayNumber("2026-12-20") + 45);
    expect(r.end).toBeLessThan(dayNumber("2026-12-20") + 45 + 7);
  });

  it("still gives a range around today when nothing has a date", () => {
    const r = ganttRange([], "2026-11-17");
    expect(dateOfDay(r.start)).toBe("2026-11-02");
    expect(r.end).toBeGreaterThanOrEqual(dayNumber("2026-11-17") + 45);
  });

  it("does not follow a stray date further than the limits", () => {
    const r = ganttRange(["1990-01-01", "2099-06-01"], "2026-11-17", { maxBefore: 370, maxAfter: 740 });
    expect(r.start).toBeGreaterThanOrEqual(dayNumber("2026-11-17") - 370 - 6);
    expect(r.end).toBeLessThanOrEqual(dayNumber("2026-11-17") + 740 + 6);
    expect(r.days % 7).toBe(0);
  });
});

describe("bars", () => {
  it("turns the dates of a ticket into a span", () => {
    expect(spanOf(null, null)).toBeNull();
    expect(spanOf("2026-11-17", "2026-11-19")).toEqual({ start: dayNumber("2026-11-17"), end: dayNumber("2026-11-19"), kind: "range" });
    expect(spanOf(null, "2026-11-19")).toEqual({ start: dayNumber("2026-11-19"), end: dayNumber("2026-11-19"), kind: "due" });
    expect(spanOf("2026-11-17", null)).toEqual({ start: dayNumber("2026-11-17"), end: dayNumber("2026-11-17"), kind: "start" });
    // A due date before the start never gives a negative bar.
    expect(spanOf("2026-11-17", "2026-11-10")).toEqual({ start: dayNumber("2026-11-17"), end: dayNumber("2026-11-17"), kind: "range" });
  });

  it("places a bar on the grid, end day included", () => {
    const start = dayNumber("2026-11-16");
    expect(barGeometry(spanOf("2026-11-17", "2026-11-19")!, start, 20)).toEqual({ x: 20, width: 60 });
    expect(barGeometry(spanOf(null, "2026-11-16")!, start, 20)).toEqual({ x: 0, width: 20 });
    // Over the end of the year and over a clock change: still one column per day.
    expect(barGeometry(spanOf("2026-12-30", "2027-01-02")!, dayNumber("2026-12-28"), 10)).toEqual({ x: 20, width: 40 });
    expect(barGeometry(spanOf("2026-03-27", "2026-03-30")!, dayNumber("2026-03-23"), 10)).toEqual({ x: 40, width: 40 });
    expect(barGeometry(spanOf("2026-10-24", "2026-10-26")!, dayNumber("2026-10-19"), 10)).toEqual({ x: 50, width: 30 });
  });

  it("finds the day under a position", () => {
    const start = dayNumber("2026-11-16");
    expect(dateOfDay(dayAtX(0, start, 20))).toBe("2026-11-16");
    expect(dateOfDay(dayAtX(19.9, start, 20))).toBe("2026-11-16");
    expect(dateOfDay(dayAtX(20, start, 20))).toBe("2026-11-17");
    expect(dateOfDay(dayAtX(-1, start, 20))).toBe("2026-11-15");
  });
});

describe("dragDates", () => {
  it("moves both dates together", () => {
    expect(dragDates("2026-11-17", "2026-11-19", "move", 3)).toEqual({ startDate: "2026-11-20", dueDate: "2026-11-22" });
    expect(dragDates("2026-12-30", "2027-01-02", "move", -30)).toEqual({ startDate: "2026-11-30", dueDate: "2026-12-03" });
    expect(dragDates(null, "2026-11-19", "move", -1)).toEqual({ startDate: null, dueDate: "2026-11-18" });
    expect(dragDates("2026-11-19", null, "move", 1)).toEqual({ startDate: "2026-11-20", dueDate: null });
    expect(dragDates("2026-11-17", "2026-11-19", "move", 0)).toEqual({ startDate: "2026-11-17", dueDate: "2026-11-19" });
  });

  it("changes one edge and never lets the due date pass before the start", () => {
    expect(dragDates("2026-11-17", "2026-11-19", "start", -2)).toEqual({ startDate: "2026-11-15", dueDate: "2026-11-19" });
    expect(dragDates("2026-11-17", "2026-11-19", "start", 10)).toEqual({ startDate: "2026-11-19", dueDate: "2026-11-19" });
    expect(dragDates("2026-11-17", "2026-11-19", "end", 4)).toEqual({ startDate: "2026-11-17", dueDate: "2026-11-23" });
    expect(dragDates("2026-11-17", "2026-11-19", "end", -10)).toEqual({ startDate: "2026-11-17", dueDate: "2026-11-17" });
    for (const mode of ["move", "start", "end"] as const)
      for (let delta = -40; delta <= 40; delta += 7) {
        const r = dragDates("2026-03-27", "2026-03-30", mode, delta);
        expect(r.dueDate! >= r.startDate!).toBe(true);
      }
  });

  it("gives the missing date to a one-day ticket", () => {
    expect(dragDates(null, "2026-11-19", "start", -3)).toEqual({ startDate: "2026-11-16", dueDate: "2026-11-19" });
    expect(dragDates(null, "2026-11-19", "start", 3)).toEqual({ startDate: null, dueDate: "2026-11-19" });
    expect(dragDates(null, "2026-11-19", "end", 3)).toEqual({ startDate: null, dueDate: "2026-11-22" });
    expect(dragDates("2026-11-19", null, "end", 3)).toEqual({ startDate: "2026-11-19", dueDate: "2026-11-22" });
    expect(dragDates("2026-11-19", null, "end", -3)).toEqual({ startDate: "2026-11-19", dueDate: null });
    expect(dragDates("2026-11-19", null, "start", -3)).toEqual({ startDate: "2026-11-16", dueDate: null });
    expect(dragDates(null, null, "move", 3)).toEqual({ startDate: null, dueDate: null });
  });
});

describe("header segments", () => {
  it("cuts the range into months, over the end of the year", () => {
    const range = { start: dayNumber("2026-11-16"), end: dayNumber("2027-02-07") };
    const months = monthSegments(range);
    expect(months.map((m) => m.key)).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
    expect(months.map((m) => m.days)).toEqual([15, 31, 31, 7]);
    expect(months.map((m) => m.offset)).toEqual([0, 15, 46, 77]);
    expect(months[2]).toMatchObject({ year: 2027, month: 1 });
    expect(months.reduce((n, m) => n + m.days, 0)).toBe(range.end - range.start + 1);
  });

  it("gives February its 28 or 29 days and keeps March whole despite the clock change", () => {
    const of = (a: string, b: string) => monthSegments({ start: dayNumber(a), end: dayNumber(b) }).map((m) => m.days);
    expect(of("2024-02-01", "2024-03-31")).toEqual([29, 31]);
    expect(of("2026-02-01", "2026-04-30")).toEqual([28, 31, 30]);
    expect(of("2026-10-01", "2026-11-30")).toEqual([31, 30]);
    expect(of("2026-11-17", "2026-11-17")).toEqual([1]);
  });

  it("cuts the range into weeks with their ISO number", () => {
    const weeks = weekSegments({ start: dayNumber("2026-12-21"), end: dayNumber("2027-01-10") });
    expect(weeks.map((w) => w.week)).toEqual([52, 53, 1]);
    expect(weeks.map((w) => w.offset)).toEqual([0, 7, 14]);
    expect(weeks.every((w) => w.days === 7)).toBe(true);
    // A range that does not start on a Monday gets a shorter first week.
    const cut = weekSegments({ start: dayNumber("2026-03-26"), end: dayNumber("2026-04-01") });
    expect(cut.map((w) => [w.week, w.offset, w.days])).toEqual([
      [13, 0, 4],
      [14, 4, 3],
    ]);
    expect(dateOfDay(cut[0].monday)).toBe("2026-03-23");
  });
});

describe("dependencies", () => {
  it("flags a blocked ticket that starts before its blocker ends", () => {
    const blocker = spanOf("2026-11-10", "2026-11-17");
    expect(isConflict(blocker, spanOf("2026-11-16", "2026-11-20"))).toBe(true);
    expect(isConflict(blocker, spanOf("2026-11-01", null))).toBe(true);
    // The same day as the end, or later, is fine.
    expect(isConflict(blocker, spanOf("2026-11-17", "2026-11-20"))).toBe(false);
    expect(isConflict(blocker, spanOf("2026-11-18", "2026-11-20"))).toBe(false);
    expect(isConflict(blocker, spanOf(null, "2026-11-12"))).toBe(true);
    // Nothing to compare when one of them has no date.
    expect(isConflict(null, spanOf("2026-11-01", null))).toBe(false);
    expect(isConflict(blocker, null)).toBe(false);
  });

  it("draws a right-angled arrow, around the rows when the target is to the left", () => {
    expect(arrowPath(100, 17, 200, 51, 34)).toBe("M100 17H108V51H200");
    expect(arrowPath(100, 17, 200, 17, 34)).toBe("M100 17H200");
    expect(arrowPath(100, 17, 60, 51, 34)).toBe("M100 17H108V34H52V51H60");
    expect(arrowPath(100, 51, 60, 17, 34)).toBe("M100 51H108V34H52V17H60");
    expect(arrowMiddle(100, 17, 200, 51, 34)).toEqual({ x: 108, y: 34 });
    expect(arrowMiddle(100, 17, 60, 51, 34)).toEqual({ x: 80, y: 34 });
  });
});

describe("orderTree", () => {
  const t = (id: string, number: number, parentId: string | null = null) => ({ id, number, parentId });

  it("puts sub-tickets under their parent, by number", () => {
    const rows = orderTree([t("c", 3, "a"), t("b", 2), t("a", 1), t("d", 4, "c"), t("e", 5, "a")]);
    expect(rows.map((r) => `${r.issue.id}${r.depth}`)).toEqual(["a0", "c1", "d2", "e1", "b0"]);
  });

  it("keeps a sub-ticket whose parent is elsewhere, and survives a loop", () => {
    expect(orderTree([t("x", 7, "gone"), t("y", 2)]).map((r) => `${r.issue.id}${r.depth}`)).toEqual(["y0", "x0"]);
    expect(
      orderTree([t("a", 1, "b"), t("b", 2, "a")])
        .map((r) => r.issue.id)
        .sort(),
    ).toEqual(["a", "b"]);
  });
});
