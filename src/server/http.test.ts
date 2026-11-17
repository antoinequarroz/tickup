import { describe, expect, it } from "vitest";
import { dateField } from "./http";

describe("dateField", () => {
  it("garde une vraie date, efface avec null, refuse le reste", () => {
    expect(dateField("2026-11-17")).toBe("2026-11-17");
    expect(dateField(null)).toBeNull();
    expect(dateField("")).toBeNull();
    expect(dateField("2026-02-31")).toBeUndefined();
    expect(dateField("17/11/2026")).toBeUndefined();
    expect(dateField("2026-11-17T10:00:00Z")).toBeUndefined();
    expect(dateField(20261117)).toBeUndefined();
  });
});
