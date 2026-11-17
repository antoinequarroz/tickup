import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth";
import { addSprint, getProject, listSprints } from "@/server/db";
import { publish } from "@/server/events";
import { body, dateField, fail, MAX_NAME, text, unauthorized } from "@/server/http";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ key: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  if (!(await currentUser())) return unauthorized();
  const project = getProject((await params).key);
  return project ? NextResponse.json(listSprints(project.id)) : fail("Projet introuvable", 404);
}

export async function POST(req: Request, { params }: Ctx) {
  if (!(await currentUser())) return unauthorized();
  const project = getProject((await params).key);
  if (!project) return fail("Projet introuvable", 404);
  const data = await body(req);
  const name = text(data.name, MAX_NAME);
  if (!name) return fail("Donne un nom au sprint");
  const startDate = dateField(data.startDate);
  const endDate = dateField(data.endDate);
  if ((data.startDate !== undefined && startDate === undefined) || (data.endDate !== undefined && endDate === undefined)) return fail("Date invalide");
  if (startDate && endDate && endDate < startDate) return fail("La fin du sprint est avant son début");
  const sprint = addSprint(project.id, { name, goal: typeof data.goal === "string" ? data.goal.slice(0, 2000) : "", startDate, endDate });
  publish({ type: "project", projectId: project.id }, "all");
  return NextResponse.json(sprint);
}
