import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth";
import { body, fail, unauthorized } from "@/server/http";
import { markRead, unreadCount } from "@/server/notify";

/** Marks notifications read: { ids: [...] }, or { all: true }. */
export async function POST(req: Request) {
  const me = await currentUser();
  if (!me) return unauthorized();
  const input = await body(req);
  if (input.all === true) markRead(me.id, "all");
  else if (Array.isArray(input.ids) && input.ids.every((id) => typeof id === "string")) markRead(me.id, (input.ids as string[]).slice(0, 500));
  else return fail("Indique ids ou all");
  return NextResponse.json({ unread: unreadCount(me.id) });
}
