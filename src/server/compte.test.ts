import { describe, expect, it } from "vitest";
import { CALLBACK_PATH, settings } from "./compte";

const SECRET = "x".repeat(32);
const FULL = { COMPTE_URL: "https://compte.exemple.ch/", COMPTE_CLIENT_SECRET: SECRET, APP_URL: "https://tickup.exemple.ch/" };

describe("Compte Postmelo : réglages", () => {
  it("demande l'adresse du compte, un vrai secret et l'adresse de TickUp", () => {
    expect(settings({})).toBeNull();
    expect(settings({ ...FULL, COMPTE_URL: "" })).toBeNull();
    expect(settings({ ...FULL, COMPTE_CLIENT_SECRET: "court" })).toBeNull();
    expect(settings({ ...FULL, APP_URL: undefined })).toBeNull();
  });

  it("se présente comme « tickup » et revient sur sa propre adresse", () => {
    expect(settings(FULL)).toEqual({ issuer: "https://compte.exemple.ch/api/auth", clientId: "tickup", clientSecret: SECRET, redirectUri: `https://tickup.exemple.ch${CALLBACK_PATH}` });
    expect(settings({ ...FULL, COMPTE_CLIENT_ID: "tickup-test" })?.clientId).toBe("tickup-test");
  });
});
