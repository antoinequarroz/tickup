import "server-only";
import crypto from "node:crypto";
import { cookies, headers } from "next/headers";
import type { NextResponse } from "next/server";
import type { User } from "@/lib/types";
import { addSession, firstAdmin, removeSession, sessionUser } from "./db";

export const SESSION_COOKIE = "tickup_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

const sha256 = (value: string) => crypto.createHash("sha256").update(value).digest("hex");

export const secureCookies = () => process.env.NODE_ENV === "production" && process.env.INSECURE_COOKIE !== "true";

/** Opens a session for this person and puts its cookie on the response. `idToken`: the sign-in came from the Compte Postmelo. */
export function startSession<T extends NextResponse>(res: T, userId: string, idToken: string | null = null) {
  const token = crypto.randomBytes(32).toString("base64url");
  addSession(sha256(token), userId, new Date(Date.now() + SESSION_MAX_AGE * 1000).toISOString(), idToken);
  res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: secureCookies(), path: "/", maxAge: SESSION_MAX_AGE });
  return res;
}

/** Closes the session of this browser. Returns the ID token of the Compte Postmelo sign-in, if any. */
export async function endSession(): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  jar.delete(SESSION_COOKIE);
  return token ? removeSession(sha256(token)) : null;
}

/**
 * True when the request carries "Authorization: Bearer <API_TOKEN>": the other tools of the suite
 * (Cordée, Hermes, Claude Code, a script) talk to TickUp this way. Compared in constant time.
 */
export function validApiToken(authorization: string | null | undefined) {
  const expected = process.env.API_TOKEN;
  if (!expected || expected.length < 24 || !authorization?.startsWith("Bearer ")) return false;
  const a = Buffer.from(sha256(authorization.slice(7).trim()));
  const b = Buffer.from(sha256(expected));
  return crypto.timingSafeEqual(a, b);
}

/** The signed-in person, or null. Every page and every API route starts here. With API_TOKEN, the first admin. */
export async function currentUser(): Promise<User | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) {
    const user = sessionUser(sha256(token));
    if (user) return user;
  }
  if (validApiToken((await headers()).get("authorization"))) return firstAdmin();
  return null;
}
