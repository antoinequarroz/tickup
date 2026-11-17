import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth";
import { deleteProject, getProject, getProjectData, getUser, updateProject } from "@/server/db";
import { body, fail, MAX_NAME, text, unauthorized } from "@/server/http";
import { emit } from "@/server/suite";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ key: string }> };

/** The whole project: statuses, labels, types, epics and tickets. A project is small enough to load at once. */
export async function GET(_req: Request, { params }: Ctx) {
  if (!(await currentUser())) return unauthorized();
  const data = getProjectData((await params).key);
  return data ? NextResponse.json(data) : fail("Projet introuvable", 404);
}

export async function PATCH(req: Request, { params }: Ctx) {
  if (!(await currentUser())) return unauthorized();
  const project = getProject((await params).key);
  if (!project) return fail("Projet introuvable", 404);
  const data = await body(req);
  const patch: Parameters<typeof updateProject>[1] = {};
  if (data.name !== undefined) {
    const name = text(data.name, MAX_NAME);
    if (!name) return fail("Donne un nom au projet");
    patch.name = name;
  }
  if (typeof data.description === "string") patch.description = data.description.slice(0, 2000);
  if (typeof data.archived === "boolean") patch.archived = data.archived;
  if (data.leadId !== undefined) {
    if (data.leadId !== null && (typeof data.leadId !== "string" || !getUser(data.leadId))) return fail("Personne inconnue");
    patch.leadId = data.leadId as string | null;
  }
  updateProject(project.id, patch);
  const updated = getProject(project.id)!;
  emit({ type: "refresh" }, "project.updated", { project: updated });
  return NextResponse.json(updated);
}

/** Deletes a project and everything in it. Admins only. */
export async function DELETE(_req: Request, { params }: Ctx) {
  const me = await currentUser();
  if (!me) return unauthorized();
  if (me.role !== "admin") return fail("Réservé aux administrateurs", 403);
  const project = getProject((await params).key);
  if (!project) return fail("Projet introuvable", 404);
  deleteProject(project.id);
  emit({ type: "refresh" }, "project.deleted", { project });
  return NextResponse.json({ ok: true });
}
