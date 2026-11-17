import { NextResponse } from "next/server";
import { secureCookies } from "@/server/auth";
import { PENDING_COOKIE, PENDING_MAX_AGE, settings, startSignIn } from "@/server/compte";

export const dynamic = "force-dynamic";

const back = (message: string) => new NextResponse(null, { status: 302, headers: { Location: `/login?erreur=${encodeURIComponent(message)}`, "Cache-Control": "no-store" } });

/** Sends the browser to the Compte Postmelo. It comes back on /api/auth/compte/callback. */
export async function GET(req: Request) {
  if (!settings()) return back("La connexion par Compte Postmelo n'est pas configurée");
  try {
    const { url, cookie } = await startSignIn({ next: new URL(req.url).searchParams.get("next") ?? "" });
    const res = new NextResponse(null, { status: 302, headers: { Location: url, "Cache-Control": "no-store" } });
    res.cookies.set(PENDING_COOKIE, cookie, { httpOnly: true, sameSite: "lax", secure: secureCookies(), path: "/", maxAge: PENDING_MAX_AGE });
    return res;
  } catch {
    return back("Le Compte Postmelo ne répond pas. Réessaie, ou utilise ton mot de passe TickUp.");
  }
}
