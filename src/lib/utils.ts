export { default as cn } from "clsx";

export const APP_NAME = "TickUp";

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/** "17 nov.", with the year when it is not this year. */
export function shortDate(iso: string) {
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  return d.toLocaleDateString("fr-CH", { day: "numeric", month: "short", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

/** "il y a 3 h", "hier", or the date. */
export function relative(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "à l'instant";
  if (diff < 3600) return `il y a ${Math.floor(diff / 60)} min`;
  if (diff < 86_400) return `il y a ${Math.floor(diff / 3600)} h`;
  if (diff < 172_800) return "hier";
  return shortDate(iso);
}

/** Whether a due date "2026-11-17" is past (the day itself is not late). */
export function isOverdue(date: string | null) {
  return !!date && date < new Date().toISOString().slice(0, 10);
}

/**
 * The position for an item dropped between two neighbours of a sorted list.
 * Positions are spaced by 1024, so a drop rarely needs to renumber anything.
 */
export function positionBetween(before: number | undefined, after: number | undefined) {
  if (before === undefined && after === undefined) return 1024;
  if (before === undefined) return after! - 1024;
  if (after === undefined) return before + 1024;
  return (before + after) / 2;
}

export async function api<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(url, init?.json !== undefined ? { ...init, headers: { "Content-Type": "application/json" }, body: JSON.stringify(init.json) } : init);
  if (res.status === 401 && !url.startsWith("/api/auth/")) window.location.href = "/login";
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "Une erreur est survenue");
  return data as T;
}
