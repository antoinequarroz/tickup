import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth";
import { publish } from "@/server/events";
import { body, fail, unauthorized } from "@/server/http";
import { mailConfigured } from "@/server/mail";
import { setNotifyEmail } from "@/server/notify";

/** My notification preference: { email: true } to get them by e-mail too. */
export async function PATCH(req: Request) {
  const me = await currentUser();
  if (!me) return unauthorized();
  if (me.agent) return fail("Un agent IA ne reçoit pas de notifications");
  const email = (await body(req)).email;
  if (typeof email !== "boolean") return fail("Indique email: true ou false");
  if (email && !mailConfigured()) return fail("L'envoi d'e-mails n'est pas configuré sur ce serveur");
  setNotifyEmail(me.id, email);
  publish({ type: "refresh" }, [me.id]);
  return NextResponse.json({ email });
}
