import { NextResponse } from "next/server";
import { countUsers } from "@/server/db";
import { lamioConfig } from "@/server/lamio";

export const dynamic = "force-dynamic";

/** Tells the login page whether the first account still has to be created, and whether Lamio can sign people in. */
export function GET() {
  return NextResponse.json({ needsSetup: countUsers() === 0, lamio: !!lamioConfig() });
}
