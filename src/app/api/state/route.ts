import { githubConfigured } from "@/server/github";
import { NextResponse } from "next/server";
import type { AppState } from "@/lib/types";
import { listModules } from "@/modules/registry";
import { currentUser } from "@/server/auth";
import { listProjects, listUsers } from "@/server/db";
import { unauthorized } from "@/server/http";

export const dynamic = "force-dynamic";

/** Everything the shell needs at once: who I am, the team, the projects, the suite. */
export async function GET() {
  const me = await currentUser();
  if (!me) return unauthorized();
  const state: AppState = { me, users: listUsers(), projects: listProjects(), modules: listModules(), integrations: { apiToken: (process.env.API_TOKEN?.length ?? 0) >= 24, webhook: /^https?:\/\//.test(process.env.SUITE_WEBHOOK_URL ?? ""), github: githubConfigured() } };
  return NextResponse.json(state);
}
