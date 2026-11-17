import { NextResponse } from "next/server";
import { TYPE_ICONS } from "@/lib/type-icons";
import { currentUser } from "@/server/auth";
import { deleteType, projectOf, updateType } from "@/server/db";
import { body, fail, text, unauthorized } from "@/server/http";
import { publish } from "@/server/events";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  if (!(await currentUser())) return unauthorized();
  const { id } = await params;
  const projectId = projectOf("issue_types", id);
  if (!projectId) return fail("Type introuvable", 404);
  const data = await body(req);
  const name = data.name !== undefined ? text(data.name, 40) : undefined;
  if (name === null) return fail("Donne un nom au type");
  if (data.icon !== undefined && !(typeof data.icon === "string" && Object.hasOwn(TYPE_ICONS, data.icon))) return fail("Icône inconnue");
  updateType(id, { name, icon: data.icon as string | undefined });
  publish({ type: "project", projectId }, "all");
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  if (!(await currentUser())) return unauthorized();
  const { id } = await params;
  const projectId = projectOf("issue_types", id);
  if (!projectId) return fail("Type introuvable", 404);
  deleteType(id);
  publish({ type: "project", projectId }, "all");
  return NextResponse.json({ ok: true });
}
