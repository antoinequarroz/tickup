import "server-only";
import { CATEGORIES } from "@/lib/templates";
import type { EpicState, Priority, SprintState, StatusCategory } from "@/lib/types";
import { getIssue, getUser, projectOf, wouldLoop, type IssuePatch } from "./db";
import { dateField, MAX_DESCRIPTION, MAX_TITLE, text } from "./http";

const belongs = (table: Parameters<typeof projectOf>[0], id: unknown, projectId: string): id is string => typeof id === "string" && projectOf(table, id) === projectId;

/**
 * Reads the fields of a ticket from a request body. Every id must belong to the project.
 * Returns the fields to write, or an error message for the person.
 */
export function readIssue(data: Record<string, unknown>, projectId: string, opts: { creating: boolean; issueId?: string }): IssuePatch | string {
  const out: IssuePatch = {};
  if (opts.creating || data.title !== undefined) {
    const title = text(data.title, MAX_TITLE);
    if (!title) return "Donne un titre au ticket";
    out.title = title;
  }
  if (data.description !== undefined) {
    if (typeof data.description !== "string" || data.description.length > MAX_DESCRIPTION) return "Description trop longue";
    out.description = data.description;
  }
  if (data.statusId !== undefined) {
    if (!belongs("statuses", data.statusId, projectId)) return "Statut inconnu";
    out.statusId = data.statusId;
  }
  for (const [field, table, message] of [
    ["typeId", "issue_types", "Type inconnu"],
    ["epicId", "epics", "Epic inconnue"],
  ] as const) {
    const v = data[field];
    if (v === undefined) continue;
    if (v !== null && !belongs(table, v, projectId)) return message;
    out[field] = v as string | null;
  }
  if (data.parentId !== undefined) {
    const v = data.parentId;
    if (v !== null) {
      if (!belongs("issues", v, projectId)) return "Ticket parent inconnu";
      if (opts.issueId && wouldLoop(opts.issueId, v)) return "Un ticket ne peut pas être sous-ticket de lui-même";
      if (!getIssue(v)) return "Ticket parent inconnu";
    }
    out.parentId = v as string | null;
  }
  if (data.assigneeId !== undefined) {
    if (data.assigneeId !== null && (typeof data.assigneeId !== "string" || !getUser(data.assigneeId))) return "Personne inconnue";
    out.assigneeId = data.assigneeId as string | null;
  }
  if (data.priority !== undefined) {
    if (![0, 1, 2, 3, 4].includes(data.priority as number)) return "Priorité invalide";
    out.priority = data.priority as Priority;
  }
  if (data.estimate !== undefined) {
    if (data.estimate !== null && (typeof data.estimate !== "number" || data.estimate < 0 || data.estimate > 10_000)) return "Estimation invalide";
    out.estimate = data.estimate as number | null;
  }
  for (const field of ["dueDate", "startDate"] as const) {
    if (data[field] === undefined) continue;
    const d = dateField(data[field]);
    if (d === undefined) return "Date invalide";
    out[field] = d;
  }
  if (data.sprintId !== undefined) {
    if (data.sprintId !== null && !belongs("sprints", data.sprintId, projectId)) return "Sprint inconnu";
    out.sprintId = data.sprintId as string | null;
  }
  if (data.labelIds !== undefined) {
    if (!Array.isArray(data.labelIds) || data.labelIds.length > 30 || !data.labelIds.every((l) => belongs("labels", l, projectId))) return "Étiquette inconnue";
    out.labelIds = [...new Set(data.labelIds as string[])];
  }
  if (data.position !== undefined) {
    if (typeof data.position !== "number" || !Number.isFinite(data.position)) return "Position invalide";
    out.position = data.position;
  }
  return out;
}

export const validCategory = (v: unknown): v is StatusCategory => CATEGORIES.some((c) => c.value === v);
export const validEpicState = (v: unknown): v is EpicState => v === "planned" || v === "active" || v === "done" || v === "canceled";
export const validTone = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 4;
export const validSprintState = (v: unknown): v is SprintState => v === "planned" || v === "active" || v === "done";
