import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth";
import { deleteComment, getComment, projectOf } from "@/server/db";
import { publish } from "@/server/events";
import { fail, unauthorized } from "@/server/http";

type Ctx = { params: Promise<{ id: string }> };

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
