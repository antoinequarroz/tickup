import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth";
import { getIssue } from "@/server/db";
import { body, fail, unauthorized } from "@/server/http";
import { isWatching, setWatching } from "@/server/notify";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/** Whether I follow this ticket (notified when its status changes). */
export async function GET(_req: Request, { params }: Ctx) {
  const me = await currentUser();
  if (!me) return unauthorized();
  const issue = getIssue((await params).id);
  if (!issue) return fail("Ticket introuvable", 404);
  return NextResponse.json({ watching: isWatching(issue, me.id) });
}

/** { watching: true } follows the ticket, false stops following it. */
export async function PUT(req: Request, { params }: Ctx) {
  const me = await currentUser();
  if (!me) return unauthorized();
  const issue = getIssue((await params).id);
  if (!issue) return fail("Ticket introuvable", 404);
  const watching = (await body(req)).watching;
  if (typeof watching !== "boolean") return fail("Indique watching: true ou false");
  setWatching(issue.id, me.id, watching);
  return NextResponse.json({ watching });
}
