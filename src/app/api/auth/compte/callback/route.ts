import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { startSession } from "@/server/auth";
import { finishSignIn, PENDING_COOKIE } from "@/server/compte";
import { userFromAccount } from "@/server/db";

export const dynamic = "force-dynamic";

// Relative addresses stay on this app whatever sits in front of it (Caddy, Portly).
const go = (location: string) => new NextResponse(null, { status: 302, headers: { Location: location, "Cache-Control": "no-store" } });

/** The Compte Postmelo sends the person back here: open their TickUp session. */
export async function GET(req: Request) {
  const pending = (await cookies()).get(PENDING_COOKIE)?.value;
  let res: NextResponse;
  try {
    const person = await finishSignIn(req.url, pending);
    const user = userFromAccount(person);
    res = startSession(go(person.next === "/" ? "/projects" : person.next), user.id, person.idToken);
  } catch (error) {
    res = go(`/login?erreur=${encodeURIComponent((error as Error).message)}`);
  }
  res.cookies.delete(PENDING_COOKIE);
  return res;
}
