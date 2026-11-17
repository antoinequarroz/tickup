import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth";
import { addStatus, getProject, reorderStatuses } from "@/server/db";
import { body, fail, MAX_NAME, text, unauthorized } from "@/server/http";
import { publish } from "@/server/events";
import { validCategory } from "@/server/validate";

type Ctx = { params: Promise<{ key: string }> };

export async function POST(req: Request, { params }: Ctx) {
  if (!(await currentUser())) return unauthorized();
  const project = getProject((await params).key);
  if (!project) return fail("Projet introuvable", 404);
  const data = await body(req);
  const name = text(data.name, MAX_NAME);
  if (!name) return fail("Donne un nom au statut");
  if (!validCategory(data.category)) return fail("Catégorie invalide");
  const id = addStatus(project.id, name, data.category);
  publish({ type: "project", projectId: project.id }, "all");
  return NextResponse.json({ id });
}

/** Reorders the columns: { order: [statusId, …] } with every status of the project, once each. */
export async function PATCH(req: Request, { params }: Ctx) {
  if (!(await currentUser())) return unauthorized();
  const project = getProject((await params).key);
  if (!project) return fail("Projet introuvable", 404);
  const { order } = await body(req);
  if (!Array.isArray(order) || !order.every((id) => typeof id === "string") || !reorderStatuses(project.id, order as string[])) return fail("Ordre invalide");
  publish({ type: "project", projectId: project.id }, "all");
  return NextResponse.json({ ok: true });
}
