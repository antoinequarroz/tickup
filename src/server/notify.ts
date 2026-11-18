import "server-only";
import { notificationText } from "@/lib/notifications";
import type { Issue, Notification, NotificationKind, User } from "@/lib/types";
import { db, getIssue, getUser, listUsers, newId } from "./db";
import { publish } from "./events";
import { sendMail } from "./mail";

/**
 * Notifications: what concerns me, in the bell (and by e-mail for whoever asked for it).
 *
 *   assigned   someone gave me a ticket
 *   mentioned  someone wrote @my name in a comment
 *   status     a ticket I follow changed status
 *   due        a ticket assigned to me is due tomorrow
 *
 * Never for what I did myself, never to an AI agent's account.
 */

// ---- Who follows a ticket

/**
 * Following a ticket: its creator and its assignee follow it unless they unfollowed it,
 * the others once they comment or click "Suivre". An unfollow by hand sticks.
 */
export function watchers(issue: Pick<Issue, "id" | "assigneeId" | "createdBy">): string[] {
  const rows = db().prepare("select user_id, following from issue_watchers where issue_id = ?").all(issue.id) as { user_id: string; following: number }[];
  const out = new Set(rows.filter((r) => r.following).map((r) => r.user_id));
  const unfollowed = new Set(rows.filter((r) => !r.following).map((r) => r.user_id));
  for (const id of [issue.assigneeId, issue.createdBy]) if (id && !unfollowed.has(id)) out.add(id);
  return [...out];
}

export const isWatching = (issue: Pick<Issue, "id" | "assigneeId" | "createdBy">, userId: string) => watchers(issue).includes(userId);

/** Follows a ticket because of what I did (commented), unless I unfollowed it by hand. */
export const autoWatch = (issueId: string, userId: string) => db().prepare("insert or ignore into issue_watchers (issue_id, user_id, following) values (?, ?, 1)").run(issueId, userId);

/** "Suivre" / "Ne plus suivre". */
export const setWatching = (issueId: string, userId: string, on: boolean) =>
  db().prepare("insert into issue_watchers (issue_id, user_id, following) values (?, ?, ?) on conflict (issue_id, user_id) do update set following = excluded.following").run(issueId, userId, on ? 1 : 0);

// ---- @mentions

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The people a text names with @: "@Ana Rossi", or "@Ana" when only one person is called Ana. */
export function mentionedUsers(text: string, users: User[]): User[] {
  if (!text.includes("@")) return [];
  const firstNames = new Map<string, number>();
  for (const u of users) {
    const first = u.name.trim().split(/\s+/)[0]?.toLowerCase();
    if (first) firstNames.set(first, (firstNames.get(first) ?? 0) + 1);
  }
  const names = (u: User) => {
    const full = u.name.trim();
    const first = full.split(/\s+/)[0] ?? "";
    return firstNames.get(first.toLowerCase()) === 1 && first !== full ? [full, first] : [full];
  };
  // Not inside an e-mail address (ana@exemple.ch), and the whole name (not @Anabelle for Ana).
  return users.filter((u) => u.name.trim() && names(u).some((n) => new RegExp(`(^|[^\\p{L}\\p{N}_.])@${escape(n)}(?![\\p{L}\\p{N}_])`, "iu").test(text)));
}

// ---- Sending

type Row = { id: string; user_id: string; issue_id: string; kind: NotificationKind; actor_id: string | null; data: string; created_at: string; read_at: string | null };

function deliver(userId: string, issue: Issue, kind: NotificationKind, actorId: string | null, data: Record<string, string>, dedupe: string | null = null): boolean {
  const user = getUser(userId);
  if (!user || user.agent || userId === actorId) return false;
  const id = newId();
  const inserted = db()
    .prepare("insert or ignore into notifications (id, user_id, issue_id, kind, actor_id, data, dedupe, created_at) values (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(id, userId, issue.id, kind, actorId, JSON.stringify(data), dedupe, new Date().toISOString());
  if (!inserted.changes) return false;
  publish({ type: "notifications" }, [userId]);
  if (user.notifyEmail) {
    const actor = actorId ? getUser(actorId) : null;
    const line = notificationText({ kind, actor: actor ? { id: actor.id, name: actor.name } : null, data });
    const base = (process.env.APP_URL ?? "").replace(/\/+$/, "");
    const link = /^https?:\/\//.test(base) ? `\n\n${base}/p/${issue.ref.split("-")[0]}?issue=${issue.ref}` : "";
    const excerpt = data.excerpt ? `\n\n« ${data.excerpt} »` : "";
    sendMail(user.email, `${issue.ref} · ${issue.title}`, `${line}.\n\n${issue.ref} · ${issue.title}${excerpt}${link}\n\n—\nTu reçois cet e-mail parce que tu l'as demandé dans Réglages › Notifications.`);
  }
  return true;
}

const statusName = (id: unknown) => (typeof id === "string" ? ((db().prepare("select name from statuses where id = ?").get(id) as { name: string } | undefined)?.name ?? "") : "");

const excerptOf = (body: string) => {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length > 160 ? `${flat.slice(0, 159)}…` : flat;
};

/** Called for every ticket event, with who did it (null: GitHub, or unknown). */
export function notifyFromEvent(event: string, data: Record<string, unknown>, actorId: string | null) {
  try {
    if (event === "issue.created") {
      const issue = data.issue as Issue;
      if (issue.assigneeId) deliver(issue.assigneeId, issue, "assigned", actorId, {});
    } else if (event === "issue.updated") {
      const issue = data.issue as Issue;
      const changed = (data.changed as string[] | undefined) ?? [];
      const previous = (data.previous as Record<string, unknown> | undefined) ?? {};
      if (changed.includes("assigneeId") && issue.assigneeId) deliver(issue.assigneeId, issue, "assigned", actorId, {});
      if (changed.includes("statusId") && previous.statusId !== issue.statusId) {
        const from = statusName(previous.statusId);
        const to = statusName(issue.statusId);
        const extra: Record<string, string> = data.via === "github" ? { via: "github" } : {};
        // The new assignee already got "assigned" for this change: one notification is enough.
        for (const userId of watchers(issue)) if (!(changed.includes("assigneeId") && userId === issue.assigneeId)) deliver(userId, issue, "status", actorId, { from, to, ...extra });
      }
    } else if (event === "issue.commented") {
      const issue = getIssue((data.issue as { id: string }).id);
      const comment = data.comment as { body: string };
      if (!issue) return;
      if (actorId) autoWatch(issue.id, actorId);
      for (const u of mentionedUsers(comment.body, listUsers())) deliver(u.id, issue, "mentioned", actorId, { excerpt: excerptOf(comment.body) });
    }
  } catch (e) {
    // A notification that fails never makes the change itself fail.
    console.error(`[notify] ${event}: ${(e as Error).message}`);
  }
}

// ---- Due dates

const zurichDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const zurichHour = (d: Date) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Zurich", hour: "2-digit", hourCycle: "h23" }).format(d));

/**
 * The day before a due date, from 8:00 (Swiss time), reminds the assignee once.
 * Also forgets the notifications read more than 60 days ago.
 */
export function remindDueDates(at = new Date()) {
  const cutoff = new Date(at.getTime() - 60 * 86_400_000).toISOString();
  db().prepare("delete from notifications where read_at is not null and read_at < ?").run(cutoff);
  if (zurichHour(at) < 8) return 0;
  const today = zurichDay(at);
  const tomorrow = new Date(`${today}T12:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const due = tomorrow.toISOString().slice(0, 10);
  const rows = db()
    .prepare("select i.id, i.assignee_id from issues i join statuses s on s.id = i.status_id where i.due_date = ? and i.assignee_id is not null and s.category not in ('done', 'canceled')")
    .all(due) as { id: string; assignee_id: string }[];
  let sent = 0;
  for (const r of rows) {
    const issue = getIssue(r.id);
    if (!issue) continue;
    if (deliver(r.assignee_id, issue, "due", null, { dueDate: due }, `due:${r.id}:${due}:${r.assignee_id}`)) sent++;
  }
  return sent;
}

// ---- Reading

export const unreadCount = (userId: string) => (db().prepare("select count(*) as n from notifications where user_id = ? and read_at is null").get(userId) as { n: number }).n;

export function listNotifications(userId: string, limit = 100): Notification[] {
  const rows = db()
    .prepare(
      `select n.*, i.number, i.title, p.key as project_key, u.name as actor_name
       from notifications n join issues i on i.id = n.issue_id join projects p on p.id = i.project_id left join users u on u.id = n.actor_id
       where n.user_id = ? order by n.created_at desc limit ?`,
    )
    .all(userId, limit) as (Row & { number: number; title: string; project_key: string; actor_name: string | null })[];
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    issue: { id: r.issue_id, ref: `${r.project_key}-${r.number}`, title: r.title, projectKey: r.project_key },
    actor: r.actor_id && r.actor_name ? { id: r.actor_id, name: r.actor_name } : null,
    data: JSON.parse(r.data) as Record<string, string>,
    createdAt: r.created_at,
    readAt: r.read_at,
  }));
}

/** Marks some of my notifications read, or all of them. A read notification stays read. */
export function markRead(userId: string, ids: string[] | "all") {
  const at = new Date().toISOString();
  if (ids === "all") db().prepare("update notifications set read_at = ? where user_id = ? and read_at is null").run(at, userId);
  else {
    const stmt = db().prepare("update notifications set read_at = ? where id = ? and user_id = ? and read_at is null");
    db().transaction(() => ids.forEach((id) => stmt.run(at, id, userId)))();
  }
  publish({ type: "notifications" }, [userId]);
}

export const setNotifyEmail = (userId: string, on: boolean) => db().prepare("update users set notify_email = ? where id = ?").run(on ? 1 : 0, userId);
