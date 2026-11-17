import crypto from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { startSession } from "@/server/auth";
import { lamioAccount } from "@/server/db";
import { email, MAX_NAME, text } from "@/server/http";
import { LAMIO_STATE_COOKIE, lamioConfig, lamioUser } from "@/server/lamio";

export const dynamic = "force-dynamic";

// Relative addresses stay on this app whatever sits in front of it.
function go(location: string) {
  const res = new NextResponse(null, { status: 302, headers: { Location: location, "Cache-Control": "no-store" } });
  res.cookies.set(LAMIO_STATE_COOKIE, "", { path: "/api/auth/lamio", httpOnly: true, sameSite: "lax", maxAge: 0 });
  return res;
}

const same = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Steps 2 and 3 of "Se connecter avec Lamio": see src/server/lamio.ts. */
export async function GET(req: Request) {
  const config = lamioConfig();
  if (!config) return go("/login");
  const params = new URL(req.url).searchParams;
  const state = params.get("state");
  const code = params.get("code");
  const expected = (await cookies()).get(LAMIO_STATE_COOKIE)?.value;
  // The state proves this browser started the sign-in: a link forged elsewhere has no matching cookie.
  if (!state || !code || !expected || !same(state, expected)) return go("/login?lamio=refus");

  const person = await lamioUser(config, code);
  const mail = email(person?.email);
  if (!person || !mail) return go("/login?lamio=refus");
  const user = lamioAccount({ email: mail, name: text(person.name, MAX_NAME) ?? mail, admin: person.role === "admin" });
  console.log(`[lamio] connexion de ${user.email}`);
  return startSession(go("/projects"), user.id);
}
