import { NextResponse } from "next/server";
import { startSession } from "@/server/auth";
import { getCredentials } from "@/server/db";
import { body, fail } from "@/server/http";
import { verifyPassword } from "@/server/password";

// Brute force guard, per email: after 8 wrong passwords, that account is refused for 15 minutes.
const MAX_FAILS = 8;
const LOCK_MS = 15 * 60_000;
const attempts = new Map<string, { fails: number; lockedUntil: number }>();

export async function POST(req: Request) {
  const data = await body(req);
  const mail = typeof data.email === "string" ? data.email.trim().toLowerCase().slice(0, 200) : "";
  const state = attempts.get(mail);
  if (state && Date.now() < state.lockedUntil) return fail("Trop d'essais. Réessaie dans quelques minutes.", 429);

  const account = getCredentials(mail);
  if (!(await verifyPassword(data.password, account))) {
    if (attempts.size > 5000) attempts.clear();
    const next = { fails: (state?.fails ?? 0) + 1, lockedUntil: 0 };
    if (next.fails >= MAX_FAILS) Object.assign(next, { fails: 0, lockedUntil: Date.now() + LOCK_MS });
    attempts.set(mail, next);
    await new Promise((r) => setTimeout(r, 400));
    return fail("E-mail ou mot de passe incorrect", 401);
  }
  attempts.delete(mail);
  return startSession(NextResponse.json({ ok: true }), account!.user.id);
}
