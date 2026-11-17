import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth";
import { publish } from "@/server/events";
import { fail, unauthorized } from "@/server/http";
import { teamDataFrom, writeTeam } from "@/server/import";
import { LinearError } from "@/server/linear";

export const dynamic = "force-dynamic";

/**
 * Under the 10 MB Next lets through behind the middleware (beyond, the body arrives cut).
 * Several thousand tickets with their comments fit; a larger workspace goes team by team.
 */
const MAX_BYTES = 8 * 1024 * 1024;

/**
 * Import of a Linear team from a file, for admins: the body is { team, issues, comments }, the data the
 * import by API key reads from Linear itself. Add "?overwrite=1" to replace what changed in TickUp.
 * Same rules as the other import: additive by default, all or nothing.
 */
export async function POST(req: Request) {
  const me = await currentUser();
  if (!me) return unauthorized();
  if (me.role !== "admin") return fail("Réservé aux administrateurs", 403);
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BYTES) return fail("Fichier trop lourd", 413);

  // Read as a stream: the announced length cannot be trusted.
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = req.body?.getReader();
  if (!reader) return fail("Fichier vide");
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel().catch(() => {});
      return fail("Fichier trop lourd", 413);
    }
    chunks.push(value);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8").replace(/^\uFEFF/, ""));
  } catch {
    return fail("Fichier illisible : ce n'est pas du JSON.");
  }
  const data = teamDataFrom(parsed);
  if (typeof data === "string") return fail(data);

  try {
    const overwrite = new URL(req.url).searchParams.get("overwrite") === "1";
    const team = writeTeam(data, me.id, undefined, overwrite);
    publish({ type: "refresh" }, "all");
    return NextResponse.json({ teams: [team] });
  } catch (e) {
    if (e instanceof LinearError) return fail(e.message);
    console.error("Import Linear (fichier) :", e);
    return fail("L'import a échoué. Rien n'a été modifié.", 500);
  }
}
