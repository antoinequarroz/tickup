import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth";
import { deleteEpic, listEpics, projectOf, updateEpic } from "@/server/db";
import { body, dateField, fail, MAX_DESCRIPTION, MAX_TITLE, text, unauthorized } from "@/server/http";
import { emit } from "@/server/suite";
import { validEpicState } from "@/server/validate";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  if (!(await currentUser())) return unauthorized();
  const { id } = await params;
  const projectId = projectOf("epics", id);
  if (!projectId) return fail("Epic introuvable", 404);
  const data = await body(req);
  const name = data.name !== undefined ? text(data.name, MAX_TITLE) : undefined;
  if (name === null) return fail("Donne un nom à l'epic");
  if (data.state !== undefined && !validEpicState(data.state)) return fail("État invalide");
  const startDate = data.startDate !== undefined ? dateField(data.startDate) : undefined;
  const targetDate = data.targetDate !== undefined ? dateField(data.targetDate) : undefined;
  if ((data.startDate !== undefined && startDate === undefined) || (data.targetDate !== undefined && targetDate === undefined)) return fail("Date invalide");
  const description = typeof data.description === "string" ? data.description.slice(0, MAX_DESCRIPTION) : undefined;
  updateEpic(id, { name, description, state: data.state as never, startDate, targetDate });
  const epic = listEpics(projectId).find((e) => e.id === id);
  emit({ type: "project", projectId }, "epic.updated", { epic });
  return NextResponse.json(epic);
}

/** Deletes an epic. Its tickets stay, without an epic. */
export async function DELETE(_req: Request, { params }: Ctx) {
  if (!(await currentUser())) return unauthorized();
  const { id } = await params;
  const projectId = projectOf("epics", id);
  if (!projectId) return fail("Epic introuvable", 404);
  deleteEpic(id);
  emit({ type: "project", projectId }, "epic.deleted", { epicId: id });
  return NextResponse.json({ ok: true });
}
