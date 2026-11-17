import { NextResponse } from "next/server";
import { TYPE_ICONS } from "@/lib/type-icons";
import { currentUser } from "@/server/auth";
import { addType, getProject } from "@/server/db";
import { body, fail, text, unauthorized } from "@/server/http";
import { publish } from "@/server/events";

type Ctx = { params: Promise<{ key: string }> };

export async function POST(req: Request, { params }: Ctx) {
  if (!(await currentUser())) return unauthorized();
  const project = getProject((await params).key);
  if (!project) return fail("Projet introuvable", 404);
  const data = await body(req);
  const name = text(data.name, 40);
  if (!name) return fail("Donne un nom au type");
  const icon = typeof data.icon === "string" && data.icon in TYPE_ICONS ? data.icon : "task";
  const id = addType(project.id, name, icon);
  publish({ type: "project", projectId: project.id }, "all");
  return NextResponse.json({ id });
}
