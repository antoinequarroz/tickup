import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth";
import { addEpic, getProject, listEpics } from "@/server/db";
import { body, dateField, fail, MAX_DESCRIPTION, MAX_TITLE, text, unauthorized } from "@/server/http";
import { emit } from "@/server/suite";
import { validEpicState } from "@/server/validate";

type Ctx = { params: Promise<{ key: string }> };

export async function POST(req: Request, { params }: Ctx) {
  if (!(await currentUser())) return unauthorized();
  const project = getProject((await params).key);
  if (!project) return fail("Projet introuvable", 404);
  const data = await body(req);
  const name = text(data.name, MAX_TITLE);
  if (!name) return fail("Donne un nom à l'epic");
  if (data.state !== undefined && !validEpicState(data.state)) return fail("État invalide");
  const startDate = dateField(data.startDate);
  const targetDate = dateField(data.targetDate);
  const description = typeof data.description === "string" ? data.description.slice(0, MAX_DESCRIPTION) : "";
  const id = addEpic(project.id, { name, description, state: data.state as never, startDate, targetDate });
  const epic = listEpics(project.id).find((e) => e.id === id);
  emit({ type: "project", projectId: project.id }, "epic.created", { project: { id: project.id, key: project.key }, epic });
  return NextResponse.json(epic);
}
