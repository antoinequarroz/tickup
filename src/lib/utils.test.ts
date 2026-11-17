import { describe, expect, it } from "vitest";
import { suggestKey, validKey } from "./templates";
import { initials, positionBetween } from "./utils";

describe("positionBetween", () => {
  it("places an item between, before or after its neighbours", () => {
    expect(positionBetween(undefined, undefined)).toBe(1024);
    expect(positionBetween(1024, 2048)).toBe(1536);
    expect(positionBetween(undefined, 1024)).toBe(0);
    expect(positionBetween(2048, undefined)).toBe(3072);
  });
});

describe("project keys", () => {
  it("suggests a short key from the name", () => {
    expect(suggestKey("Site web Saint-Martin")).toBe("SWSM");
    expect(suggestKey("Podcast")).toBe("PODC");
    expect(suggestKey("Émission télé")).toBe("ET");
    expect(suggestKey("!!!")).toBe("");
  });
  it("accepts 2 to 6 uppercase letters or digits, starting with a letter", () => {
    expect(validKey("WEB")).toBe(true);
    expect(validKey("W")).toBe(false);
    expect(validKey("1AB")).toBe(false);
    expect(validKey("web")).toBe(false);
    expect(validKey("ABCDEFG")).toBe(false);
  });
});

describe("initials", () => {
  it("takes the first and last names", () => {
    expect(initials("Antoine Quarroz")).toBe("AQ");
    expect(initials("  ")).toBe("?");
  });
});
