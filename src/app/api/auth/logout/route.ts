import { NextResponse } from "next/server";
import { endSession } from "@/server/auth";

export async function POST() {
  return endSession(NextResponse.json({ ok: true }));
}
