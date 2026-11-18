import "server-only";
import type { ServerEvent } from "@/lib/types";
import { publish } from "./events";
import { notifyFromEvent } from "./notify";

/**
 * How TickUp talks to the rest of the suite.
 *
 * In:  the other tools call the REST API with "Authorization: Bearer <API_TOKEN>" (see README).
 * Out: every change is pushed live to open TickUp tabs (Server-Sent Events) and, when
 *      SUITE_WEBHOOK_URL is set, posted as JSON to that address so Cordée, Hermes or a script
 *      can react (post in a channel, notify someone, sync a calendar…).
 */
export type SuiteEvent =
  | "project.created"
  | "project.updated"
  | "project.deleted"
  | "issue.created"
  | "issue.updated"
  | "issue.deleted"
  | "issue.commented"
  | "epic.created"
  | "epic.updated"
  | "epic.deleted";

const validUrl = (value: string | undefined) => (value && /^https?:\/\//.test(value) ? value : undefined);

/** `actorId`: who made the change (null: GitHub or unknown), so ticket events notify the right people. */
export function emit(live: ServerEvent, event: SuiteEvent, data: Record<string, unknown>, actorId: string | null = null) {
  publish(live, "all");
  if (event === "issue.created" || event === "issue.updated" || event === "issue.commented") notifyFromEvent(event, data, actorId);
  const url = validUrl(process.env.SUITE_WEBHOOK_URL);
  if (!url) return;
  const headers: Record<string, string> = { "Content-Type": "application/json", "User-Agent": "TickUp" };
  if (process.env.SUITE_WEBHOOK_TOKEN) headers.Authorization = `Bearer ${process.env.SUITE_WEBHOOK_TOKEN}`;
  const appUrl = validUrl(process.env.APP_URL);
  // Fire and forget: a tool that is down must never slow TickUp down or make a save fail.
  fetch(url, { method: "POST", headers, body: JSON.stringify({ source: "tickup", event, at: new Date().toISOString(), appUrl: appUrl ?? null, data }), signal: AbortSignal.timeout(5000) }).catch(() => {});
}
