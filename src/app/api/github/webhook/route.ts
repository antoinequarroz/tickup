import { NextResponse } from "next/server";
import { githubSecret, handleGithub, validSignature } from "@/server/github";
import { fail } from "@/server/http";

export const dynamic = "force-dynamic";

const MAX_BODY = 5_000_000;

/**
 * Where a GitHub repository posts its events (Settings → Webhooks, content type application/json,
 * the secret of GITHUB_WEBHOOK_SECRET, events "Pull requests" and "Pushes"). No session here:
 * the signature of the body is the proof that GitHub sent it.
 */
export async function POST(req: Request) {
  const secret = githubSecret();
  if (!secret) return fail("L'intégration GitHub n'est pas configurée (GITHUB_WEBHOOK_SECRET)", 503);
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) return fail("Corps trop volumineux", 413);
  // Read as bytes, with a ceiling even when no length is announced: the signature is over the exact bytes.
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = req.body?.getReader();
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) {
      void reader.cancel().catch(() => {});
      return fail("Corps trop volumineux", 413);
    }
    chunks.push(value);
  }
  const raw = Buffer.concat(chunks);
  if (!validSignature(secret, raw, req.headers.get("x-hub-signature-256"))) return fail("Signature invalide", 401);
  let payload: unknown;
  try {
    payload = JSON.parse(raw.toString("utf8"));
  } catch {
    return fail("JSON invalide");
  }
  return NextResponse.json(handleGithub(req.headers.get("x-github-event") ?? "", payload));
}
