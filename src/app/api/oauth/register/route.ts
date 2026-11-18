import { NextResponse } from "next/server";
import { registerClient, validRedirectUri } from "@/server/agents";
import { body } from "@/server/http";

export const dynamic = "force-dynamic";

const oauthError = (error: string, description: string) => NextResponse.json({ error, error_description: description }, { status: 400, headers: { "Access-Control-Allow-Origin": "*" } });

// Registrations are open (the spec expects it) but cheap to abuse: a few per minute and per address.
const recent = new Map<string, number[]>();

/**
 * Dynamic client registration (RFC 7591): Claude registers itself before asking for access. It gives
 * no access by itself: a key is only issued once a signed-in person approves on /oauth/authorize.
 */
export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "?";
  const t = Date.now();
  const hits = (recent.get(ip) ?? []).filter((x) => t - x < 60_000);
  if (hits.length >= 10) return oauthError("invalid_request", "Trop d'inscriptions, réessaie dans une minute");
  recent.set(ip, [...hits, t]);
  if (recent.size > 1000) recent.clear();

  const data = await body(req);
  const uris = data.redirect_uris;
  if (!Array.isArray(uris) || !uris.length || uris.length > 10 || !uris.every(validRedirectUri)) return oauthError("invalid_redirect_uri", "redirect_uris : des adresses https (ou http sur localhost)");
  const client = registerClient(typeof data.client_name === "string" ? data.client_name : "Agent", uris as string[]);
  return NextResponse.json(
    {
      client_id: client.id,
      client_name: client.name,
      redirect_uris: client.redirectUris,
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      client_id_issued_at: Math.floor(t / 1000),
    },
    { status: 201, headers: { "Access-Control-Allow-Origin": "*" } },
  );
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "Content-Type" } });
}
