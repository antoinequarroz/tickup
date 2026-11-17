import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth";
import { deleteSprint, getSprint, projectOf, updateSprint } from "@/server/db";
import { publish } from "@/server/events";
import { body, dateField, fail, MAX_NAME, text, unauthorized } from "@/server/http";
import { validSprintState } from "@/server/validate";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Changes a sprint: name, goal, dates, state ("planned" | "active" | "done").
 * With state "done", moveOpenTo sends its unfinished tickets to another sprint (its id) or to the backlog (null).
 */
export async function PATCH(req: Request, { params }: Ctx) {
  if (!(await currentUser())) return unauthorized();
  const { id } = await params;
  const current = getSprint(id);
  if (!current) return fail("Sprint introuvable", 404);
  const data = await body(req);
  const name = data.name !== undefined ? text(data.name, MAX_NAME) : undefined;
  if (name === null) return fail("Donne un nom au sprint");
  if (data.state !== undefined && !validSprintState(data.state)) return fail("État invalide");
  const startDate = data.startDate !== undefined ? dateField(data.startDate) : undefined;
  const endDate = data.endDate !== undefined ? dateField(data.endDate) : undefined;
  if ((data.startDate !== undefined && startDate === undefined) || (data.endDate !== undefined && endDate === undefined)) return fail("Date invalide");
  const start = startDate !== undefined ? startDate : current.startDate;
  const end = endDate !== undefined ? endDate : current.endDate;
  if (start && end && end < start) return fail("La fin du sprint est avant son début");
  let moveOpenTo: string | null | undefined;
  if (data.moveOpenTo !== undefined) {
    if (data.moveOpenTo !== null && (typeof data.moveOpenTo !== "string" || data.moveOpenTo === id || projectOf("sprints", data.moveOpenTo) !== current.projectId)) return fail("Sprint de destination inconnu");
    if (data.moveOpenTo !== null && getSprint(data.moveOpenTo as string)?.state === "done") return fail("Le sprint de destination est déjà terminé");
    moveOpenTo = data.moveOpenTo as string | null;
  }
  const sprint = updateSprint(id, { name, goal: typeof data.goal === "string" ? data.goal.slice(0, 2000) : undefined, startDate, endDate, state: data.state as never, moveOpenTo });
  if (sprint === "busy") return fail("Un autre sprint est déjà en cours dans ce projet. Termine-le d'abord.", 409);
  publish({ type: "project", projectId: current.projectId }, "all");
  return NextResponse.json(sprint);
}

/** Deletes a sprint. Its tickets go back to the backlog. */
export async function DELETE(_req: Request, { params }: Ctx) {
  if (!(await currentUser())) return unauthorized();
  const { id } = await params;
  const projectId = projectOf("sprints", id);
  if (!projectId) return fail("Sprint introuvable", 404);
  deleteSprint(id);
  publish({ type: "project", projectId }, "all");
  return NextResponse.json({ ok: true });
}
