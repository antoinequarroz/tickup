import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth";
import { addComment, getIssue } from "@/server/db";
import { body, fail, MAX_COMMENT, text, unauthorized } from "@/server/http";
import { emit } from "@/server/suite";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const me = await currentUser();
  if (!me) return unauthorized();
  const issue = getIssue((await params).id);
  if (!issue) return fail("Ticket introuvable", 404);
  const text_ = text((await body(req)).body, MAX_COMMENT);
  if (!text_) return fail("Le commentaire est vide");
  const comment = addComment(issue.id, me.id, text_);
  emit({ type: "issue", projectId: issue.projectId, issueId: issue.id }, "issue.commented", { issue: { id: issue.id, ref: issue.ref, title: issue.title }, comment, author: { id: me.id, name: me.name } }, me.id);
  return NextResponse.json(comment);
}
