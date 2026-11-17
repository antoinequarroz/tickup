import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth";
import { deleteStatus, projectOf, updateStatus } from "@/server/db";
import { body, fail, MAX_NAME, text, unauthorized } from "@/server/http";
import { publish } from "@/server/events";
import { validCategory } from "@/server/validate";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  if (!(await currentUser())) return unauthorized();
  const { id } = await params;
  const projectId = projectOf("statuses", id);
  if (!projectId) return fail("Statut introuvable", 404);
  const data = await body(req);
  const name = data.name !== undefined ? text(data.name, MAX_NAME) : undefined;
  if (name === null) return fail("Donne un nom au statut");
  if (data.category !== undefined && !validCategory(data.category)) return fail("Catégorie invalide");
  updateStatus(id, { name, category: data.category as never });
  publish({ type: "project", projectId }, "all");
  return NextResponse.json({ ok: true });
}

/** Deletes a status. Its tickets move to the status given in ?moveTo=. */
export async function DELETE(req: Request, { params }: Ctx) {
  if (!(await currentUser())) return unauthorized();
  const { id } = await params;
  const projectId = projectOf("statuses", id);
  if (!projectId) return fail("Statut introuvable", 404);
  const moveTo = new URL(req.url).searchParams.get("moveTo") ?? "";
  if (!deleteStatus(id, moveTo)) return fail("Choisis un autre statut où déplacer les tickets");
  publish({ type: "project", projectId }, "all");
  return NextResponse.json({ ok: true });
}
