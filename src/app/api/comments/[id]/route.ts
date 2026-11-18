import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth";
import { deleteComment, getComment, getIssue, projectOf, updateComment } from "@/server/db";
import { publish } from "@/server/events";
import { body, fail, MAX_COMMENT, text, unauthorized } from "@/server/http";
import { emit } from "@/server/suite";

type Ctx = { params: Promise<{ id: string }> };

/** Corrects a comment: { body }. Only its author can. */
export async function PATCH(req: Request, { params }: Ctx) {
  const me = await currentUser();
  if (!me) return unauthorized();
  const cur = getComment((await params).id);
  if (!cur) return fail("Commentaire introuvable", 404);
  if (cur.userId !== me.id) return fail("Seul son auteur peut modifier un commentaire", 403);
  const next = text((await body(req)).body, MAX_COMMENT);
  if (!next) return fail("Le commentaire est vide");
  if (next === cur.body) return NextResponse.json(cur);
  const comment = updateComment(cur.id, next)!;
  const issue = getIssue(cur.issueId);
  if (issue) emit({ type: "issue", projectId: issue.projectId, issueId: issue.id }, "comment.updated", { issue: { id: issue.id, ref: issue.ref, title: issue.title }, comment, previousBody: cur.body, author: { id: me.id, name: me.name } }, me.id);
  return NextResponse.json(comment);
}

/** Deletes a comment: its author, or an admin. */
export async function DELETE(_req: Request, { params }: Ctx) {
  const me = await currentUser();
  if (!me) return unauthorized();
  const comment = getComment((await params).id);
  if (!comment) return fail("Commentaire introuvable", 404);
  if (comment.userId !== me.id && me.role !== "admin") return fail("Ce n'est pas ton commentaire", 403);
  deleteComment(comment.id);
  const projectId = projectOf("issues", comment.issueId);
  if (projectId) publish({ type: "issue", projectId, issueId: comment.issueId }, "all");
  return NextResponse.json({ ok: true });
}
