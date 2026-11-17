import { NextResponse } from "next/server";
import { startSession } from "@/server/auth";
import { createFirstUser } from "@/server/db";
import { body, email, fail, MAX_NAME, text } from "@/server/http";
import { hashPassword, MIN_PASSWORD, validPassword } from "@/server/password";

/** Creates the first account (admin). Works only while there is no account at all. */
export async function POST(req: Request) {
  const data = await body(req);
  const name = text(data.name, MAX_NAME);
  const mail = email(data.email);
  if (!name) return fail("Indique ton nom");
  if (!mail) return fail("Adresse e-mail invalide");
  if (!validPassword(data.password)) return fail(`Le mot de passe doit faire au moins ${MIN_PASSWORD} caractères`);
  const user = createFirstUser({ name, email: mail, ...(await hashPassword(data.password)) });
  if (!user) return fail("Un compte existe déjà. Connecte-toi.", 409);
  return startSession(NextResponse.json({ ok: true }), user.id);
}
