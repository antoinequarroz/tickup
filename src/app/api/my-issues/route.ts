import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth";
import { listAssigned } from "@/server/db";
import { unauthorized } from "@/server/http";

export const dynamic = "force-dynamic";

/** My open tickets, across projects. */
export async function GET() {
  const me = await currentUser();
  if (!me) return unauthorized();
  return NextResponse.json(listAssigned(me.id));
}
