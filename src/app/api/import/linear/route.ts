import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth";
import { publish } from "@/server/events";
import { body, fail, unauthorized } from "@/server/http";
import { importLinear, previewLinear } from "@/server/import";
import { LinearError, linearClient } from "@/server/linear";

// A large workspace takes minutes to read.
export const maxDuration = 900;
export const dynamic = "force-dynamic";

const MAX_TEAMS = 50;

/** A wrong key is the caller's mistake, not a lost session: never 401 here (the app would sign out). */
const linearFail = (e: LinearError) => fail(e.message, e.code === "auth" ? 400 : e.code === "rate" ? 429 : 502);

/**
 * Import from Linear, for admins. { apiKey, action: "preview" } lists the teams;
 * { apiKey, action: "import", teamIds, options: { comments, archived, overwrite } } imports them. The key serves this request only:
 * it is not stored, not logged, not sent back. Linear's address is fixed in server/linear.ts.
 */
export async function POST(req: Request) {
  const me = await currentUser();
  if (!me) return unauthorized();
  if (me.role !== "admin") return fail("Réservé aux administrateurs", 403);
  const data = await body(req);
  const apiKey = typeof data.apiKey === "string" ? data.apiKey.trim() : "";
  // Printable ASCII only: the key goes into a header.
  if (apiKey.length < 10 || apiKey.length > 300 || !/^[\x21-\x7e]+$/.test(apiKey)) return fail("Colle ta clé d'API Linear (elle commence par lin_api_)");
  const client = linearClient(apiKey);

  try {
    if (data.action === "preview") return NextResponse.json({ teams: await previewLinear(client) });

    if (data.action === "import") {
      const teamIds = Array.isArray(data.teamIds) ? [...new Set(data.teamIds.filter((t): t is string => typeof t === "string" && /^[A-Za-z0-9-]{1,64}$/.test(t)))] : [];
      if (!teamIds.length) return fail("Choisis au moins une équipe");
      if (teamIds.length > MAX_TEAMS) return fail(`Pas plus de ${MAX_TEAMS} équipes à la fois`);
      const o = data.options && typeof data.options === "object" ? (data.options as Record<string, unknown>) : {};
      const teams = await importLinear(client, teamIds, { comments: o.comments !== false, archived: o.archived === true, overwrite: o.overwrite === true }, me.id);
      if (teams.some((t) => !("error" in t))) publish({ type: "refresh" }, "all");
      return NextResponse.json({ teams });
    }
    return fail("Action inconnue");
  } catch (e) {
    if (e instanceof LinearError) return linearFail(e);
    console.error("Import Linear :", e);
    return fail("L'import a échoué", 500);
  }
}
