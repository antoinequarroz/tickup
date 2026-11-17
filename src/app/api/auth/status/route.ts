import { NextResponse } from "next/server";
import { countUsers } from "@/server/db";

export const dynamic = "force-dynamic";

/** Tells the login page whether the first account still has to be created. */
export function GET() {
  return NextResponse.json({ needsSetup: countUsers() === 0 });
}
