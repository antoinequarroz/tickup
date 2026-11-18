import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth";
import { unauthorized } from "@/server/http";
import { listNotifications, unreadCount } from "@/server/notify";

export const dynamic = "force-dynamic";

/** My notifications, newest first, and how many are unread. */
export async function GET() {
  const me = await currentUser();
  if (!me) return unauthorized();
  return NextResponse.json({ notifications: listNotifications(me.id), unread: unreadCount(me.id) });
}
