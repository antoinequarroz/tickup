import { describe, expect, it } from "vitest";
import { scrubEvent } from "@/lib/error-reporting";

describe("scrubEvent", () => {
  it("ne garde que le chemin de la requête", () => {
    const event = scrubEvent({
      request: {
        url: "https://tickup.postmelo.ch/api/auth/callback?code=secret&state=x#frag",
        cookies: { session: "s" },
        headers: { authorization: "Bearer t" },
        data: { password: "p" },
        query_string: "code=secret",
      },
      user: { email: "a@b.ch" },
    });
    expect(event).toEqual({ request: { url: "https://tickup.postmelo.ch/api/auth/callback" } });
  });

  it("laisse passer un événement sans requête", () => {
    expect(scrubEvent({})).toEqual({});
  });
});
