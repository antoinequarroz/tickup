import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth";
import { renameUser } from "@/server/db";
import { publish } from "@/server/events";
import { body, fail, MAX_NAME, text, unauthorized } from "@/server/http";

/** Changes my display name. */
export async function PATCH(req: Request) {
  const me = await currentUser();
  if (!me) return unauthorized();
  const name = text((await body(req)).name, MAX_NAME);
  if (!name) return fail("Indique ton nom");
  renameUser(me.id, name);
  publish({ type: "refresh" }, "all");
  return NextResponse.json({ ok: true });
}
