import { NextResponse } from "next/server";
import { createCode } from "@/server/agents";
import { sessionPerson } from "@/server/auth";
import { fail, MAX_NAME, text } from "@/server/http";
import { backTo, readAuthorize } from "@/server/oauth";

export const dynamic = "force-dynamic";

const go = (url: string) => new NextResponse(null, { status: 303, headers: { Location: url, "Cache-Control": "no-store" } });

/** The answer of the consent page: a one-time code for the connector, or a refusal. */
export async function POST(req: Request) {
  const me = await sessionPerson();
  if (!me) return fail("Connecte-toi d'abord à TickUp", 401);
  const form = await req.formData();
  const get = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" && v !== "" ? v : null;
  };
  const request = readAuthorize(get);
  if (typeof request === "string") return fail(request);
  if (get("decision") !== "allow") return go(backTo(request, { error: "access_denied" }));
  const agentName = text(get("agent_name"), MAX_NAME) ?? request.client.name;
  const code = createCode({ clientId: request.client.id, userId: me.id, redirectUri: request.redirectUri, codeChallenge: request.codeChallenge, agentName });
  return go(backTo(request, { code }));
}
