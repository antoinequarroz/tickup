import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth";
import { createUser } from "@/server/db";
import { publish } from "@/server/events";
import { body, email, fail, MAX_NAME, text, unauthorized } from "@/server/http";
import { hashPassword, MIN_PASSWORD, validPassword } from "@/server/password";

/** An admin adds a member, with a first password to pass on (the member changes it in Réglages). */
export async function POST(req: Request) {
  const me = await currentUser();
  if (!me) return unauthorized();
  if (me.role !== "admin") return fail("Réservé aux administrateurs", 403);
  const data = await body(req);
  const name = text(data.name, MAX_NAME);
  const mail = email(data.email);
  if (!name) return fail("Indique un nom");
  if (!mail) return fail("Adresse e-mail invalide");
  if (!validPassword(data.password)) return fail(`Le mot de passe doit faire au moins ${MIN_PASSWORD} caractères`);
  const user = createUser({ name, email: mail, role: "member", ...(await hashPassword(data.password)) });
  if (!user) return fail("Cette adresse a déjà un compte", 409);
  publish({ type: "refresh" }, "all");
  return NextResponse.json(user);
}
