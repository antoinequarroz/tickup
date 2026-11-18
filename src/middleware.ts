import { NextResponse, type NextRequest } from "next/server";

/**
 * Cross-site request guard for the API. The session cookie is SameSite=Lax, which already stops other
 * sites; this also stops a sibling subdomain (the other tools of the suite live on the same domain)
 * from writing to TickUp with the cookie of whoever is signed in. Scripts using API_TOKEN carry no
 * cookie and are not concerned.
 */
export function middleware(req: NextRequest) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return NextResponse.next();
  if (req.headers.get("authorization")?.startsWith("Bearer ")) return NextResponse.next();
  // Called by AI agents and their servers, never with the cookie: the MCP server and the OAuth exchange.
  if (/^\/api\/(mcp|oauth\/(register|token))$/.test(req.nextUrl.pathname)) return NextResponse.next();
  const site = req.headers.get("sec-fetch-site");
  const origin = req.headers.get("origin");
  let foreign = !!site && site !== "same-origin" && site !== "none";
  if (!foreign && origin) {
    try {
      foreign = new URL(origin).host !== (req.headers.get("x-forwarded-host") ?? req.headers.get("host"));
    } catch {
      foreign = true;
    }
  }
  return foreign ? NextResponse.json({ error: "Requête refusée : elle vient d'un autre site" }, { status: 403 }) : NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
