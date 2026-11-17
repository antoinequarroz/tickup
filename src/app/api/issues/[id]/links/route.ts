import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth";
import { addLink, getIssue, removeLink, wouldBlockLoop } from "@/server/db";
import { body, fail, unauthorized } from "@/server/http";
import { emit } from "@/server/suite";

type Ctx = { params: Promise<{ id: string }> };

/** Reads the other ticket of a dependency: { blockedBy: id|ref } or { blocks: id|ref }. Same project only. */
async function read(req: Request, id: string) {
  const issue = getIssue(id);
  if (!issue) return fail("Ticket introuvable", 404);
  const data = await body(req);
  const ref = typeof data.blockedBy === "string" ? data.blockedBy : typeof data.blocks === "string" ? data.blocks : null;
  const other = ref ? getIssue(ref) : null;
  if (!other || other.projectId !== issue.projectId) return fail("Ticket lié introuvable dans ce projet");
  return typeof data.blockedBy === "string" ? { issue, blocker: other, blocked: issue } : { issue, blocker: issue, blocked: other };
}

/** Adds a dependency: this ticket is blocked by another ({ blockedBy }) or blocks another ({ blocks }). */
export async function POST(req: Request, { params }: Ctx) {
  if (!(await currentUser())) return unauthorized();
  const link = await read(req, (await params).id);
  if (link instanceof NextResponse) return link;
  if (wouldBlockLoop(link.blocker.id, link.blocked.id)) return fail("Cette dépendance ferait une boucle");
  addLink(link.blocker.id, link.blocked.id);
  const issue = getIssue(link.issue.id)!;
  emit({ type: "project", projectId: issue.projectId }, "issue.updated", { issue, changed: ["blockedBy", "blocks"], previous: {} });
  return NextResponse.json(issue);
}

/** Removes a dependency (same body as POST). */
export async function DELETE(req: Request, { params }: Ctx) {
  if (!(await currentUser())) return unauthorized();
  const link = await read(req, (await params).id);
  if (link instanceof NextResponse) return link;
  removeLink(link.blocker.id, link.blocked.id);
  const issue = getIssue(link.issue.id)!;
  emit({ type: "project", projectId: issue.projectId }, "issue.updated", { issue, changed: ["blockedBy", "blocks"], previous: {} });
  return NextResponse.json(issue);
}
