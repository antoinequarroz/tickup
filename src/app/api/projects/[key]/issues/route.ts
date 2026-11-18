import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth";
import { createIssue, getProject, listIssues, type IssueInput } from "@/server/db";
import { body, fail, unauthorized } from "@/server/http";
import { emit } from "@/server/suite";
import { readIssue } from "@/server/validate";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ key: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  if (!(await currentUser())) return unauthorized();
  const project = getProject((await params).key);
  return project ? NextResponse.json(listIssues(project.id)) : fail("Projet introuvable", 404);
}

/** Creates a ticket (or a sub-ticket, with parentId). */
export async function POST(req: Request, { params }: Ctx) {
  const me = await currentUser();
  if (!me) return unauthorized();
  const project = getProject((await params).key);
  if (!project) return fail("Projet introuvable", 404);
  const input = readIssue(await body(req), project.id, { creating: true });
  if (typeof input === "string") return fail(input);
  if (input.startDate && input.dueDate && input.dueDate < input.startDate) return fail("L'échéance est avant le début");
  const issue = createIssue(project.id, input as IssueInput, me.id);
  emit({ type: "issue", projectId: project.id, issueId: issue.id }, "issue.created", { project: { id: project.id, key: project.key, name: project.name }, issue }, me.id);
  return NextResponse.json(issue);
}
