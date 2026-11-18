import { NextResponse } from "next/server";
import { getToken, revokeToken, tokenCreator } from "@/server/agents";
import { sessionPerson } from "@/server/auth";
import { fail, unauthorized } from "@/server/http";

type Ctx = { params: Promise<{ id: string }> };

/** Revokes a key: the agent is cut off at once. Its account stays, with its comments and tickets. */
export async function DELETE(_req: Request, { params }: Ctx) {
  const me = await sessionPerson();
  if (!me) return unauthorized();
  const { id } = await params;
  if (!getToken(id)) return fail("Clé introuvable", 404);
  if (me.role !== "admin" && tokenCreator(id) !== me.id) return fail("Seul un administrateur ou la personne qui l'a créée peut révoquer cette clé", 403);
  revokeToken(id);
  return NextResponse.json({ ok: true });
}
