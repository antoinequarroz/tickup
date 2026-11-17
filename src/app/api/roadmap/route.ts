import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth";
import { listRoadmap } from "@/server/db";
import { unauthorized } from "@/server/http";

export const dynamic = "force-dynamic";

/** The roadmap: every active project with its epics and sprints (what has dates). */
export async function GET() {
  if (!(await currentUser())) return unauthorized();
  return NextResponse.json(listRoadmap());
}
