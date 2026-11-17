import { NextResponse } from "next/server";

export const fail = (error: string, status = 400) => NextResponse.json({ error }, { status });
export const unauthorized = () => fail("Non autorisé", 401);

export async function body(req: Request): Promise<Record<string, unknown>> {
  const data = await req.json().catch(() => null);
  return data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
}

/** A trimmed string field within a size limit, or null when missing or invalid. */
export function text(value: unknown, max: number, min = 1): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  return v.length >= min && v.length <= max ? v : null;
}

export const email = (value: unknown) => {
  const v = text(value, 200)?.toLowerCase();
  return v && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : null;
};

export const MAX_NAME = 80;
export const MAX_MESSAGE = 8000;
export const MAX_FILES_PER_MESSAGE = 10;
export const MAX_TITLE = 300;
export const MAX_DESCRIPTION = 50_000;
export const MAX_COMMENT = 10_000;

/** A date "2026-11-17", null to clear, undefined when the field is absent. Throws nothing: invalid becomes undefined. */
export function dateField(value: unknown): string | null | undefined {
  if (value === null || value === "") return null;
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) ? value : undefined;
}
