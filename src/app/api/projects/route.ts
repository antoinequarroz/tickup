import { NextResponse } from "next/server";
import { TEMPLATES, validKey } from "@/lib/templates";
import type { TemplateId } from "@/lib/types";
import { currentUser } from "@/server/auth";
import { createProject, listProjects } from "@/server/db";
import { body, fail, MAX_NAME, text, unauthorized } from "@/server/http";
import { emit } from "@/server/suite";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await currentUser())) return unauthorized();
  return NextResponse.json(listProjects());
}

/** Creates a project from one of the templates: general, multimedia creation, software development. */
export async function POST(req: Request) {
  const me = await currentUser();
  if (!me) return unauthorized();
  const data = await body(req);
  const name = text(data.name, MAX_NAME);
  const key = typeof data.key === "string" ? data.key.trim().toUpperCase() : "";
  const template = TEMPLATES.find((t) => t.id === data.template)?.id as TemplateId | undefined;
  if (!name) return fail("Donne un nom au projet");
  if (!validKey(key)) return fail("La clé fait 2 à 6 lettres ou chiffres, et commence par une lettre");
  if (!template) return fail("Choisis un style de projet");
  const description = typeof data.description === "string" ? data.description.slice(0, 2000) : "";
  const project = createProject({ name, key, template, description, leadId: me.id });
  if (!project) return fail(`La clé ${key} est déjà prise`, 409);
  emit({ type: "refresh" }, "project.created", { project });
  return NextResponse.json(project);
}
