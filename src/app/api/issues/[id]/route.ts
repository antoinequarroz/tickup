import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth";
import { deleteIssue, getIssue, listComments, listGithubLinks, listSubIssues, updateIssue } from "@/server/db";
import { publish } from "@/server/events";
import { body, fail, unauthorized } from "@/server/http";
import { emit } from "@/server/suite";
import { readIssue } from "@/server/validate";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/** A ticket by id or reference (WEB-12), with its sub-tickets, its comments and what GitHub says about it. */
export async function GET(_req: Request, { params }: Ctx) {
  if (!(await currentUser())) return unauthorized();
  const issue = getIssue((await params).id);
  if (!issue) return fail("Ticket introuvable", 404);
  return NextResponse.json({ issue, subIssues: listSubIssues(issue.id), comments: listComments(issue.id), github: listGithubLinks(issue.id) });
}

export async function PATCH(req: Request, { params }: Ctx) {
  if (!(await currentUser())) return unauthorized();
  const cur = getIssue((await params).id);
  if (!cur) return fail("Ticket introuvable", 404);
  const patch = readIssue(await body(req), cur.projectId, { creating: false, issueId: cur.id });
  if (typeof patch === "string") return fail(patch);
  const start = patch.startDate !== undefined ? patch.startDate : cur.startDate;
  const due = patch.dueDate !== undefined ? patch.dueDate : cur.dueDate;
  if ((patch.startDate !== undefined || patch.dueDate !== undefined) && start && due && due < start) return fail("L'échéance est avant le début");
  const issue = updateIssue(cur.id, patch)!;
  const changed = Object.keys(patch).filter((k) => k !== "position");
  const live = { type: "issue", projectId: issue.projectId, issueId: issue.id } as const;
  // A drag inside a column only changes the order: open tabs follow, the rest of the suite is not told.
  if (!changed.length) publish(live, "all");
  else emit(live, "issue.updated", { issue, changed, previous: Object.fromEntries(changed.map((k) => [k, cur[k as keyof typeof cur]])) });
  return NextResponse.json(issue);
}

export async function DELETE(_req: Request, { params }: Ctx) {
  if (!(await currentUser())) return unauthorized();
  const issue = getIssue((await params).id);
  if (!issue) return fail("Ticket introuvable", 404);
  deleteIssue(issue.id);
  emit({ type: "project", projectId: issue.projectId }, "issue.deleted", { issue });
  return NextResponse.json({ ok: true });
}
