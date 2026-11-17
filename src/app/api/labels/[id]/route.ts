import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth";
import { deleteLabel, projectOf, updateLabel } from "@/server/db";
import { body, fail, text, unauthorized } from "@/server/http";
import { publish } from "@/server/events";
import { validTone } from "@/server/validate";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  if (!(await currentUser())) return unauthorized();
  const { id } = await params;
  const projectId = projectOf("labels", id);
  if (!projectId) return fail("Étiquette introuvable", 404);
  const data = await body(req);
  const name = data.name !== undefined ? text(data.name, 40) : undefined;
  if (name === null) return fail("Donne un nom à l'étiquette");
  if (data.tone !== undefined && !validTone(data.tone)) return fail("Teinte invalide");
  updateLabel(id, { name, tone: data.tone as number | undefined });
  publish({ type: "project", projectId }, "all");
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  if (!(await currentUser())) return unauthorized();
  const { id } = await params;
  const projectId = projectOf("labels", id);
  if (!projectId) return fail("Étiquette introuvable", 404);
  deleteLabel(id);
  publish({ type: "project", projectId }, "all");
  return NextResponse.json({ ok: true });
}
