import { NextResponse } from "next/server";
import { currentUser, startSession } from "@/server/auth";
import { getCredentialsById, setUserPassword } from "@/server/db";
import { body, fail, unauthorized } from "@/server/http";
import { hashPassword, MIN_PASSWORD, validPassword, verifyPassword } from "@/server/password";

/** Changes my password. Every other device is logged out. */
export async function POST(req: Request) {
  const me = await currentUser();
  if (!me) return unauthorized();
  const { current, next } = await body(req);
  if (!validPassword(next)) return fail(`Le nouveau mot de passe doit faire au moins ${MIN_PASSWORD} caractères`);
  if (!(await verifyPassword(current, getCredentialsById(me.id)))) {
    await new Promise((r) => setTimeout(r, 400));
    return fail("Mot de passe actuel incorrect", 403);
  }
  const { salt, hash } = await hashPassword(next);
  setUserPassword(me.id, salt, hash);
  return startSession(NextResponse.json({ ok: true }), me.id);
}
