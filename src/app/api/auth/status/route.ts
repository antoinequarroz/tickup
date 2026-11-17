import { NextResponse } from "next/server";
import { settings } from "@/server/compte";
import { countUsers } from "@/server/db";

export const dynamic = "force-dynamic";

/** Tells the login page whether the first account still has to be created, and whether the Compte Postmelo is plugged in. */
export function GET() {
  return NextResponse.json({ needsSetup: countUsers() === 0, compte: !!settings() });
}
