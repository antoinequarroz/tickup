import { NextResponse } from "next/server";
import { redeemCode } from "@/server/agents";
import { publish } from "@/server/events";

export const dynamic = "force-dynamic";

const CORS = { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" };
const oauthError = (error: string, description: string, status = 400) => NextResponse.json({ error, error_description: description }, { status, headers: CORS });

/** Trades the one-time code (with its PKCE verifier) for the agent's key. Form or JSON body. */
export async function POST(req: Request) {
  let data: Record<string, unknown> = {};
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("application/json")) data = ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  else data = Object.fromEntries(new URLSearchParams(await req.text()));
  if (data.grant_type !== "authorization_code") return oauthError("unsupported_grant_type", "Seul authorization_code est accepté");
  const issued = redeemCode({ code: data.code, clientId: data.client_id, redirectUri: data.redirect_uri, codeVerifier: data.code_verifier });
  if (!issued) return oauthError("invalid_grant", "Code invalide, expiré ou déjà utilisé");
  // A new agent may have appeared: the team lists in open tabs follow.
  publish({ type: "refresh" }, "all");
  return NextResponse.json({ access_token: issued.token, token_type: "Bearer", scope: "tickup" }, { headers: CORS });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { ...CORS, "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "Content-Type" } });
}
