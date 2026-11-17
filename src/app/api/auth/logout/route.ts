import { NextResponse } from "next/server";
import { endSession } from "@/server/auth";
import { signOutUrl } from "@/server/compte";

/**
 * Closes the TickUp session. When it was opened with the Compte Postmelo, `signOut` is where
 * to send the browser to close that session too: otherwise "Se connecter" would let the person
 * straight back in.
 */
export async function POST() {
  const idToken = await endSession();
  const signOut = idToken ? await signOutUrl(idToken).catch(() => null) : null;
  return NextResponse.json({ ok: true, signOut });
}
