import { NextResponse } from "next/server";
import { createToken, listTokens } from "@/server/agents";
import { sessionPerson } from "@/server/auth";
import { publish } from "@/server/events";
import { body, fail, MAX_NAME, publicOrigin, text, unauthorized } from "@/server/http";

export const dynamic = "force-dynamic";

/**
 * The keys of the AI agents. Only a signed-in person manages them, never an agent with its key.
 * An admin sees every key, a member the ones they made.
 */
export async function GET(req: Request) {
  const me = await sessionPerson();
  if (!me) return unauthorized();
  return NextResponse.json({ tokens: listTokens(me.role === "admin" ? undefined : me.id), mcpUrl: `${publicOrigin(req)}/mcp` });
}

/** Creates an agent (if new) and its key. The key is in this answer only. */
export async function POST(req: Request) {
  const me = await sessionPerson();
  if (!me) return unauthorized();
  const name = text((await body(req)).name, MAX_NAME);
  if (!name) return fail("Donne un nom à l'agent (Claude, Alfred…)");
  const created = createToken({ name, createdBy: me.id });
  publish({ type: "refresh" }, "all");
  return NextResponse.json(created);
}
