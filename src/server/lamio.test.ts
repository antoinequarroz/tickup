import { describe, expect, it } from "vitest";
import { lamioAuthorizeUrl, lamioConfig } from "./lamio";

const SECRET = "x".repeat(32);

describe("connexion avec Lamio : réglages", () => {
  it("demande une adresse et un vrai secret", () => {
    expect(lamioConfig({})).toBeNull();
    expect(lamioConfig({ LAMIO_URL: "https://lamio.exemple.ch" })).toBeNull();
    expect(lamioConfig({ LAMIO_URL: "https://lamio.exemple.ch", LAMIO_SSO_SECRET: "court" })).toBeNull();
    expect(lamioConfig({ LAMIO_URL: "javascript:alert(1)", LAMIO_SSO_SECRET: SECRET })).toBeNull();
    expect(lamioConfig({ LAMIO_URL: "https://lamio.exemple.ch/", LAMIO_SSO_SECRET: SECRET })).toEqual({ url: "https://lamio.exemple.ch", secret: SECRET, client: "tickup" });
  });

  it("envoie vers Lamio avec le nom de l'outil et l'état", () => {
    expect(lamioAuthorizeUrl({ url: "https://lamio.exemple.ch", client: "tickup" }, "a b")).toBe("https://lamio.exemple.ch/sso/authorize?client=tickup&state=a%20b");
  });
});
