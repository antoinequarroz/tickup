import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth";
import { addLabel, getProject } from "@/server/db";
import { body, fail, text, unauthorized } from "@/server/http";
import { publish } from "@/server/events";
import { validTone } from "@/server/validate";

type Ctx = { params: Promise<{ key: string }> };

export async function POST(req: Request, { params }: Ctx) {
  if (!(await currentUser())) return unauthorized();
  const project = getProject((await params).key);
  if (!project) return fail("Projet introuvable", 404);
  const data = await body(req);
  const name = text(data.name, 40);
  if (!name) return fail("Donne un nom à l'étiquette");
  const id = addLabel(project.id, name, validTone(data.tone) ? data.tone : 2);
  publish({ type: "project", projectId: project.id }, "all");
  return NextResponse.json({ id });
}
