import "server-only";
import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { templateById } from "@/lib/templates";
import type { Comment, Epic, EpicState, Issue, IssueType, Label, Priority, Project, ProjectData, RoadmapProject, Role, Sprint, SprintState, Status, StatusCategory, TemplateId, User } from "@/lib/types";

export const dataDir = () => path.resolve(process.env.DATA_DIR ?? "./data");

const globalForDb = globalThis as unknown as { __tickupDb?: { dir: string; conn: Database.Database } };

export function db() {
  const dir = dataDir();
  if (globalForDb.__tickupDb?.dir === dir) return globalForDb.__tickupDb.conn;
  fs.mkdirSync(dir, { recursive: true });
  const conn = new Database(path.join(dir, "tickup.db"));
  conn.pragma("journal_mode = WAL");
  conn.pragma("foreign_keys = ON");
  conn.exec(`
    create table if not exists users (
      id text primary key,
      email text not null unique,
      name text not null,
      role text not null default 'member',
      salt text not null,
      password_hash text not null,
      created_at text not null
    );
    -- The cookie holds a random token, the table only its SHA-256.
    create table if not exists sessions (
      token_hash text primary key,
      user_id text not null references users (id) on delete cascade,
      expires_at text not null
    );
    create table if not exists projects (
      id text primary key,
      key text not null unique,
      name text not null,
      description text not null default '',
      template text not null default 'general',
      lead_id text references users (id) on delete set null,
      archived integer not null default 0,
      -- Next ticket number: WEB-1, WEB-2… never reused, even after a delete.
      next_number integer not null default 1,
      created_at text not null
    );
    create table if not exists statuses (
      id text primary key,
      project_id text not null references projects (id) on delete cascade,
      name text not null,
      category text not null,
      position real not null
    );
    create table if not exists labels (
      id text primary key,
      project_id text not null references projects (id) on delete cascade,
      name text not null,
      tone integer not null default 2
    );
    create table if not exists issue_types (
      id text primary key,
      project_id text not null references projects (id) on delete cascade,
      name text not null,
      icon text not null default 'task',
      position real not null
    );
    create table if not exists epics (
      id text primary key,
      project_id text not null references projects (id) on delete cascade,
      name text not null,
      description text not null default '',
      state text not null default 'planned',
      start_date text,
      target_date text,
      created_at text not null
    );
    create table if not exists issues (
      id text primary key,
      project_id text not null references projects (id) on delete cascade,
      number integer not null,
      title text not null,
      description text not null default '',
      status_id text not null references statuses (id),
      type_id text references issue_types (id) on delete set null,
      priority integer not null default 0,
      assignee_id text references users (id) on delete set null,
      epic_id text references epics (id) on delete set null,
      parent_id text references issues (id) on delete cascade,
      estimate real,
      due_date text,
      position real not null,
      created_by text references users (id) on delete set null,
      created_at text not null,
      updated_at text not null,
      completed_at text,
      unique (project_id, number)
    );
    create index if not exists issues_project on issues (project_id, status_id, position);
    create index if not exists issues_parent on issues (parent_id);
    create index if not exists issues_assignee on issues (assignee_id);
    create table if not exists issue_labels (
      issue_id text not null references issues (id) on delete cascade,
      label_id text not null references labels (id) on delete cascade,
      primary key (issue_id, label_id)
    );
    create table if not exists comments (
      id text primary key,
      issue_id text not null references issues (id) on delete cascade,
      user_id text references users (id) on delete set null,
      body text not null,
      created_at text not null
    );
    create index if not exists comments_issue on comments (issue_id, created_at);
    create table if not exists sprints (
      id text primary key,
      project_id text not null references projects (id) on delete cascade,
      name text not null,
      goal text not null default '',
      start_date text,
      end_date text,
      state text not null default 'planned',
      created_at text not null
    );
    -- "blocker must be finished before blocked can start": the arrows of the Gantt.
    create table if not exists issue_links (
      blocker_id text not null references issues (id) on delete cascade,
      blocked_id text not null references issues (id) on delete cascade,
      primary key (blocker_id, blocked_id)
    );
    create index if not exists issue_links_blocked on issue_links (blocked_id);
  `);
  // Columns added after the first release: an existing database gets them here, once.
  const addColumn = (table: string, column: string, definition: string) => {
    if (!(conn.pragma(`table_info(${table})`) as { name: string }[]).some((c) => c.name === column)) conn.exec(`alter table ${table} add column ${column} ${definition}`);
  };
  addColumn("issues", "start_date", "text");
  addColumn("issues", "sprint_id", "text references sprints (id) on delete set null");
  // Where an imported item comes from ("linear:<id>"): importing twice updates instead of duplicating.
  addColumn("issues", "external_ref", "text");
  addColumn("epics", "external_ref", "text");
  addColumn("projects", "external_ref", "text");
  addColumn("sprints", "external_ref", "text");
  conn.exec("create index if not exists issues_sprint on issues (sprint_id); create index if not exists issues_external on issues (external_ref)");
  globalForDb.__tickupDb = { dir, conn };
  return conn;
}

export const newId = () => crypto.randomBytes(9).toString("base64url");
const now = () => new Date().toISOString();
const tx = <T>(fn: () => T) => db().transaction(fn)();

// ---- Users

type UserRow = { id: string; email: string; name: string; role: Role; salt: string; password_hash: string; created_at: string };
const toUser = (r: UserRow): User => ({ id: r.id, email: r.email, name: r.name, role: r.role, createdAt: r.created_at });

export const countUsers = () => (db().prepare("select count(*) as n from users").get() as { n: number }).n;

export const listUsers = () => (db().prepare("select * from users order by name collate nocase").all() as UserRow[]).map(toUser);

export function getUser(id: string): User | null {
  const r = db().prepare("select * from users where id = ?").get(id) as UserRow | undefined;
  return r ? toUser(r) : null;
}

/** The first administrator: the account scripts act as when they use API_TOKEN. */
export function firstAdmin(): User | null {
  const r = db().prepare("select * from users where role = 'admin' order by created_at limit 1").get() as UserRow | undefined;
  return r ? toUser(r) : null;
}

export function getCredentials(email: string) {
  const r = db().prepare("select * from users where email = ?").get(email.trim().toLowerCase()) as UserRow | undefined;
  return r ? { user: toUser(r), salt: r.salt, hash: r.password_hash } : null;
}

export function getCredentialsById(id: string) {
  const r = db().prepare("select * from users where id = ?").get(id) as UserRow | undefined;
  return r ? { user: toUser(r), salt: r.salt, hash: r.password_hash } : null;
}

/** Creates an account. Returns null when the email is already taken. */
export function createUser(input: { email: string; name: string; role: Role; salt: string; hash: string }): User | null {
  const id = newId();
  try {
    db().prepare("insert into users (id, email, name, role, salt, password_hash, created_at) values (?, ?, ?, ?, ?, ?, ?)").run(id, input.email.trim().toLowerCase(), input.name.trim(), input.role, input.salt, input.hash, now());
  } catch (e) {
    if ((e as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE") return null;
    throw e;
  }
  return getUser(id);
}

/** The very first account becomes admin. Returns null if an account already exists. */
export function createFirstUser(input: { email: string; name: string; salt: string; hash: string }): User | null {
  return tx(() => (countUsers() > 0 ? null : createUser({ ...input, role: "admin" })));
}

/**
 * The TickUp account of someone Lamio vouches for, matched by e-mail. The first time, the account
 * is created: administrator if they are one in Lamio, or if TickUp has no account yet. Its password
 * is random and unknown: they come in through Lamio, until they set one in Réglages.
 * An account that already exists keeps its role.
 */
export function lamioAccount(input: { email: string; name: string; admin: boolean }): User {
  return tx(() => {
    const existing = getCredentials(input.email);
    if (existing) return existing.user;
    const unknown = () => crypto.randomBytes(32).toString("hex");
    return createUser({ email: input.email, name: input.name, role: input.admin || countUsers() === 0 ? "admin" : "member", salt: unknown(), hash: unknown() })!;
  });
}

export const renameUser = (id: string, name: string) => db().prepare("update users set name = ? where id = ?").run(name.trim(), id);

export function setUserPassword(id: string, salt: string, hash: string) {
  tx(() => {
    db().prepare("update users set salt = ?, password_hash = ? where id = ?").run(salt, hash, id);
    db().prepare("delete from sessions where user_id = ?").run(id);
  });
}

// ---- Sessions

export function addSession(tokenHash: string, userId: string, expiresAt: string) {
  db().prepare("delete from sessions where expires_at < ?").run(now());
  db().prepare("insert into sessions (token_hash, user_id, expires_at) values (?, ?, ?)").run(tokenHash, userId, expiresAt);
}

export function sessionUser(tokenHash: string): User | null {
  const r = db().prepare("select u.* from sessions s join users u on u.id = s.user_id where s.token_hash = ? and s.expires_at > ?").get(tokenHash, now()) as UserRow | undefined;
  return r ? toUser(r) : null;
}

export const removeSession = (tokenHash: string) => db().prepare("delete from sessions where token_hash = ?").run(tokenHash);

// ---- Projects

type ProjectRow = { id: string; key: string; name: string; description: string; template: TemplateId; lead_id: string | null; archived: number; created_at: string; issue_count: number; done_count: number };

const PROJECT_SELECT = `select p.*,
  (select count(*) from issues i where i.project_id = p.id and i.parent_id is null) as issue_count,
  (select count(*) from issues i join statuses s on s.id = i.status_id where i.project_id = p.id and i.parent_id is null and s.category in ('done', 'canceled')) as done_count
  from projects p`;

const toProject = (r: ProjectRow): Project => ({
  id: r.id,
  key: r.key,
  name: r.name,
  description: r.description,
  template: r.template,
  leadId: r.lead_id,
  archived: !!r.archived,
  createdAt: r.created_at,
  issueCount: r.issue_count,
  doneCount: r.done_count,
});

export const listProjects = () => (db().prepare(`${PROJECT_SELECT} order by p.archived, p.name collate nocase`).all() as ProjectRow[]).map(toProject);

export function getProject(idOrKey: string): Project | null {
  const r = db().prepare(`${PROJECT_SELECT} where p.id = ? or p.key = ?`).get(idOrKey, idOrKey.toUpperCase()) as ProjectRow | undefined;
  return r ? toProject(r) : null;
}

/** Creates a project from a template (statuses, types, labels, first epics). Null when the key is taken. */
export function createProject(input: { key: string; name: string; description?: string; template: TemplateId; leadId: string | null }): Project | null {
  const t = templateById(input.template);
  return tx(() => {
    if (db().prepare("select 1 from projects where key = ?").get(input.key)) return null;
    const id = newId();
    db().prepare("insert into projects (id, key, name, description, template, lead_id, created_at) values (?, ?, ?, ?, ?, ?, ?)").run(id, input.key, input.name, input.description ?? "", t.id, input.leadId, now());
    t.statuses.forEach((s, i) => db().prepare("insert into statuses (id, project_id, name, category, position) values (?, ?, ?, ?, ?)").run(newId(), id, s.name, s.category, i));
    t.types.forEach((ty, i) => db().prepare("insert into issue_types (id, project_id, name, icon, position) values (?, ?, ?, ?, ?)").run(newId(), id, ty.name, ty.icon, i));
    t.labels.forEach((l) => db().prepare("insert into labels (id, project_id, name, tone) values (?, ?, ?, ?)").run(newId(), id, l.name, l.tone));
    t.epics.forEach((name) => db().prepare("insert into epics (id, project_id, name, created_at) values (?, ?, ?, ?)").run(newId(), id, name, now()));
    return getProject(id);
  });
}

export function updateProject(id: string, patch: { name?: string; description?: string; leadId?: string | null; archived?: boolean }) {
  const p = db().prepare("select * from projects where id = ?").get(id) as ProjectRow | undefined;
  if (!p) return;
  db()
    .prepare("update projects set name = ?, description = ?, lead_id = ?, archived = ? where id = ?")
    .run(patch.name ?? p.name, patch.description ?? p.description, patch.leadId !== undefined ? patch.leadId : p.lead_id, patch.archived !== undefined ? Number(patch.archived) : p.archived, id);
}

export const deleteProject = (id: string) => db().prepare("delete from projects where id = ?").run(id);

// ---- Statuses, labels, types

type StatusRow = { id: string; project_id: string; name: string; category: StatusCategory; position: number };
const toStatus = (r: StatusRow): Status => ({ id: r.id, projectId: r.project_id, name: r.name, category: r.category, position: r.position });
export const listStatuses = (projectId: string) => (db().prepare("select * from statuses where project_id = ? order by position").all(projectId) as StatusRow[]).map(toStatus);

export function addStatus(projectId: string, name: string, category: StatusCategory): string {
  const id = newId();
  const max = (db().prepare("select coalesce(max(position), -1) as m from statuses where project_id = ?").get(projectId) as { m: number }).m;
  db().prepare("insert into statuses (id, project_id, name, category, position) values (?, ?, ?, ?, ?)").run(id, projectId, name, category, max + 1);
  return id;
}

const closedCategory = (c: string) => c === "done" || c === "canceled";

/** Keeps completed_at true when tickets become closed or open without being edited one by one. */
function syncCompleted(where: string, param: string, wasClosed: boolean, closed: boolean) {
  if (wasClosed === closed) return;
  const t = new Date().toISOString();
  if (closed) db().prepare(`update issues set completed_at = ?, updated_at = ? where ${where} and completed_at is null`).run(t, t, param);
  else db().prepare(`update issues set completed_at = null, updated_at = ? where ${where}`).run(t, param);
}

export function updateStatus(id: string, patch: { name?: string; category?: StatusCategory }) {
  db().transaction(() => {
    const s = db().prepare("select * from statuses where id = ?").get(id) as StatusRow | undefined;
    if (!s) return;
    const category = patch.category ?? s.category;
    db().prepare("update statuses set name = ?, category = ? where id = ?").run(patch.name ?? s.name, category, id);
    syncCompleted("status_id = ?", id, closedCategory(s.category), closedCategory(category));
  })();
}

/** Sets the order of the columns. `ids` must be exactly the statuses of the project. */
export function reorderStatuses(projectId: string, ids: string[]): boolean {
  return db().transaction(() => {
    const current = (db().prepare("select id from statuses where project_id = ?").all(projectId) as { id: string }[]).map((r) => r.id);
    if (ids.length !== current.length || new Set(ids).size !== ids.length || !ids.every((id) => current.includes(id))) return false;
    ids.forEach((id, i) => db().prepare("update statuses set position = ? where id = ?").run(i, id));
    return true;
  })();
}

/** Deletes a status, moving its tickets to another one. False if it is the last status of the project. */
export function deleteStatus(id: string, moveTo: string): boolean {
  return tx(() => {
    const s = db().prepare("select * from statuses where id = ?").get(id) as StatusRow | undefined;
    const target = db().prepare("select * from statuses where id = ? and project_id = ?").get(moveTo, s?.project_id) as StatusRow | undefined;
    if (!s || !target || target.id === s.id) return false;
    // Moved tickets go below the ones already there, in their own order.
    const max = (db().prepare("select coalesce(max(position), 0) as m from issues where status_id = ?").get(target.id) as { m: number }).m;
    const moved = db().prepare("select id from issues where status_id = ? order by position, number").all(s.id) as { id: string }[];
    syncCompleted("status_id = ?", s.id, closedCategory(s.category), closedCategory(target.category));
    moved.forEach((row, i) => db().prepare("update issues set status_id = ?, position = ? where id = ?").run(target.id, max + (i + 1) * 1024, row.id));
    db().prepare("delete from statuses where id = ?").run(id);
    return true;
  });
}

type LabelRow = { id: string; project_id: string; name: string; tone: number };
const toLabel = (r: LabelRow): Label => ({ id: r.id, projectId: r.project_id, name: r.name, tone: r.tone });
export const listLabels = (projectId: string) => (db().prepare("select * from labels where project_id = ? order by name collate nocase").all(projectId) as LabelRow[]).map(toLabel);

export function addLabel(projectId: string, name: string, tone: number): string {
  const id = newId();
  db().prepare("insert into labels (id, project_id, name, tone) values (?, ?, ?, ?)").run(id, projectId, name, tone);
  return id;
}
export function updateLabel(id: string, patch: { name?: string; tone?: number }) {
  const l = db().prepare("select * from labels where id = ?").get(id) as LabelRow | undefined;
  if (l) db().prepare("update labels set name = ?, tone = ? where id = ?").run(patch.name ?? l.name, patch.tone ?? l.tone, id);
}
export const deleteLabel = (id: string) => db().prepare("delete from labels where id = ?").run(id);

type TypeRow = { id: string; project_id: string; name: string; icon: string; position: number };
const toType = (r: TypeRow): IssueType => ({ id: r.id, projectId: r.project_id, name: r.name, icon: r.icon, position: r.position });
export const listTypes = (projectId: string) => (db().prepare("select * from issue_types where project_id = ? order by position").all(projectId) as TypeRow[]).map(toType);

export function addType(projectId: string, name: string, icon: string): string {
  const id = newId();
  const max = (db().prepare("select coalesce(max(position), -1) as m from issue_types where project_id = ?").get(projectId) as { m: number }).m;
  db().prepare("insert into issue_types (id, project_id, name, icon, position) values (?, ?, ?, ?, ?)").run(id, projectId, name, icon, max + 1);
  return id;
}
export function updateType(id: string, patch: { name?: string; icon?: string }) {
  const t = db().prepare("select * from issue_types where id = ?").get(id) as TypeRow | undefined;
  if (t) db().prepare("update issue_types set name = ?, icon = ? where id = ?").run(patch.name ?? t.name, patch.icon ?? t.icon, id);
}
export const deleteType = (id: string) => db().prepare("delete from issue_types where id = ?").run(id);

/** Which project a status, label, type, epic or ticket belongs to: every route checks it. */
export function projectOf(table: "statuses" | "labels" | "issue_types" | "epics" | "issues" | "sprints", id: string): string | null {
  const r = db().prepare(`select project_id from ${table} where id = ?`).get(id) as { project_id: string } | undefined;
  return r?.project_id ?? null;
}

// ---- Epics

type EpicRow = { id: string; project_id: string; name: string; description: string; state: EpicState; start_date: string | null; target_date: string | null; created_at: string; issue_count: number; done_count: number };
const toEpic = (r: EpicRow): Epic => ({
  id: r.id,
  projectId: r.project_id,
  name: r.name,
  description: r.description,
  state: r.state,
  startDate: r.start_date,
  targetDate: r.target_date,
  createdAt: r.created_at,
  issueCount: r.issue_count,
  doneCount: r.done_count,
});

export const listEpics = (projectId: string) =>
  (
    db()
      .prepare(
        `select e.*,
          (select count(*) from issues i where i.epic_id = e.id and i.parent_id is null) as issue_count,
          (select count(*) from issues i join statuses s on s.id = i.status_id where i.epic_id = e.id and i.parent_id is null and s.category in ('done', 'canceled')) as done_count
         from epics e where e.project_id = ? order by case e.state when 'active' then 0 when 'planned' then 1 when 'done' then 2 else 3 end, coalesce(e.target_date, '9999'), e.created_at`,
      )
      .all(projectId) as EpicRow[]
  ).map(toEpic);

export function addEpic(projectId: string, input: { name: string; description?: string; state?: EpicState; startDate?: string | null; targetDate?: string | null }): string {
  const id = newId();
  db()
    .prepare("insert into epics (id, project_id, name, description, state, start_date, target_date, created_at) values (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(id, projectId, input.name, input.description ?? "", input.state ?? "planned", input.startDate ?? null, input.targetDate ?? null, now());
  return id;
}

export function updateEpic(id: string, patch: { name?: string; description?: string; state?: EpicState; startDate?: string | null; targetDate?: string | null }) {
  const e = db().prepare("select * from epics where id = ?").get(id) as EpicRow | undefined;
  if (!e) return;
  db()
    .prepare("update epics set name = ?, description = ?, state = ?, start_date = ?, target_date = ? where id = ?")
    .run(patch.name ?? e.name, patch.description ?? e.description, patch.state ?? e.state, patch.startDate !== undefined ? patch.startDate : e.start_date, patch.targetDate !== undefined ? patch.targetDate : e.target_date, id);
}

export const deleteEpic = (id: string) => db().prepare("delete from epics where id = ?").run(id);

// ---- Issues

type IssueRow = {
  id: string;
  project_id: string;
  key: string;
  number: number;
  title: string;
  description: string;
  status_id: string;
  type_id: string | null;
  priority: Priority;
  assignee_id: string | null;
  epic_id: string | null;
  parent_id: string | null;
  estimate: number | null;
  due_date: string | null;
  start_date: string | null;
  sprint_id: string | null;
  blocked_by: string | null;
  blocks: string | null;
  position: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  label_ids: string | null;
  sub_count: number;
  sub_done: number;
};

const ISSUE_SELECT = `select i.*, p.key,
  (select group_concat(label_id) from issue_labels l where l.issue_id = i.id) as label_ids,
  (select group_concat(blocker_id) from issue_links k where k.blocked_id = i.id) as blocked_by,
  (select group_concat(blocked_id) from issue_links k where k.blocker_id = i.id) as blocks,
  (select count(*) from issues c where c.parent_id = i.id) as sub_count,
  (select count(*) from issues c join statuses s on s.id = c.status_id where c.parent_id = i.id and s.category in ('done', 'canceled')) as sub_done
  from issues i join projects p on p.id = i.project_id`;

const toIssue = (r: IssueRow): Issue => ({
  id: r.id,
  projectId: r.project_id,
  number: r.number,
  ref: `${r.key}-${r.number}`,
  title: r.title,
  description: r.description,
  statusId: r.status_id,
  typeId: r.type_id,
  priority: r.priority,
  assigneeId: r.assignee_id,
  epicId: r.epic_id,
  parentId: r.parent_id,
  estimate: r.estimate,
  dueDate: r.due_date,
  startDate: r.start_date,
  sprintId: r.sprint_id,
  blockedBy: r.blocked_by ? r.blocked_by.split(",") : [],
  blocks: r.blocks ? r.blocks.split(",") : [],
  position: r.position,
  labelIds: r.label_ids ? r.label_ids.split(",") : [],
  createdBy: r.created_by,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  completedAt: r.completed_at,
  subCount: r.sub_count,
  subDone: r.sub_done,
});

export const listIssues = (projectId: string) => (db().prepare(`${ISSUE_SELECT} where i.project_id = ? order by i.position, i.number`).all(projectId) as IssueRow[]).map(toIssue);

/** Tickets assigned to someone, across every project that is not archived. */
export const listAssigned = (userId: string) =>
  (
    db()
      .prepare(`${ISSUE_SELECT} join statuses s on s.id = i.status_id where i.assignee_id = ? and p.archived = 0 and s.category not in ('done', 'canceled') order by i.priority = 0, i.priority, i.updated_at desc`)
      .all(userId) as IssueRow[]
  ).map(toIssue);

/** A ticket by id or by reference ("WEB-12"). */
export function getIssue(idOrRef: string): Issue | null {
  // The id first: a random id can look like a reference.
  let r = db().prepare(`${ISSUE_SELECT} where i.id = ?`).get(idOrRef) as IssueRow | undefined;
  const m = r ? null : /^([A-Za-z][A-Za-z0-9]{1,5})-(\d+)$/.exec(idOrRef);
  if (m) r = db().prepare(`${ISSUE_SELECT} where p.key = ? and i.number = ?`).get(m[1].toUpperCase(), Number(m[2])) as IssueRow | undefined;
  return r ? toIssue(r) : null;
}

export const listSubIssues = (parentId: string) => (db().prepare(`${ISSUE_SELECT} where i.parent_id = ? order by i.number`).all(parentId) as IssueRow[]).map(toIssue);

export function getProjectData(idOrKey: string): ProjectData | null {
  const project = getProject(idOrKey);
  if (!project) return null;
  return { project, statuses: listStatuses(project.id), labels: listLabels(project.id), types: listTypes(project.id), epics: listEpics(project.id), sprints: listSprints(project.id), issues: listIssues(project.id) };
}

const categoryOf = (statusId: string) => (db().prepare("select category from statuses where id = ?").get(statusId) as { category: StatusCategory } | undefined)?.category;
const isClosed = (c: StatusCategory | undefined) => c === "done" || c === "canceled";

export type IssueInput = {
  title: string;
  description?: string;
  statusId?: string;
  typeId?: string | null;
  priority?: Priority;
  assigneeId?: string | null;
  epicId?: string | null;
  parentId?: string | null;
  estimate?: number | null;
  dueDate?: string | null;
  startDate?: string | null;
  sprintId?: string | null;
  labelIds?: string[];
};

/** Creates a ticket at the bottom of its column. The caller has checked every id belongs to the project. */
export function createIssue(projectId: string, input: IssueInput, userId: string | null): Issue {
  return tx(() => {
    const { next_number } = db().prepare("update projects set next_number = next_number + 1 where id = ? returning next_number - 1 as next_number").get(projectId) as { next_number: number };
    const statusId = input.statusId ?? (db().prepare("select id from statuses where project_id = ? and category not in ('done', 'canceled') order by category != 'todo', position limit 1").get(projectId) as { id: string } | undefined)?.id ?? listStatuses(projectId)[0].id;
    // A sub-ticket follows its parent's epic unless told otherwise.
    const parent = input.parentId ? getIssue(input.parentId) : null;
    const epicId = input.epicId !== undefined ? input.epicId : (parent?.epicId ?? null);
    const max = (db().prepare("select coalesce(max(position), 0) as m from issues where status_id = ?").get(statusId) as { m: number }).m;
    const id = newId();
    const t = now();
    db()
      .prepare(
        `insert into issues (id, project_id, number, title, description, status_id, type_id, priority, assignee_id, epic_id, parent_id, estimate, due_date, position, created_by, created_at, updated_at, completed_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, projectId, next_number, input.title, input.description ?? "", statusId, input.typeId ?? null, input.priority ?? 0, input.assigneeId ?? null, epicId, input.parentId ?? null, input.estimate ?? null, input.dueDate ?? null, max + 1024, userId, t, t, isClosed(categoryOf(statusId)) ? t : null);
    if (input.startDate || input.sprintId) db().prepare("update issues set start_date = ?, sprint_id = ? where id = ?").run(input.startDate ?? null, input.sprintId ?? null, id);
    for (const l of input.labelIds ?? []) db().prepare("insert or ignore into issue_labels (issue_id, label_id) values (?, ?)").run(id, l);
    return getIssue(id)!;
  });
}

export type IssuePatch = Partial<IssueInput> & { position?: number };

export function updateIssue(id: string, patch: IssuePatch): Issue | null {
  return tx(() => {
    const cur = getIssue(id);
    if (!cur) return null;
    const statusId = patch.statusId ?? cur.statusId;
    const wasClosed = isClosed(categoryOf(cur.statusId));
    const closed = isClosed(categoryOf(statusId));
    const completedAt = closed ? (wasClosed ? cur.completedAt : now()) : null;
    const pick = <K extends keyof IssuePatch>(k: K, fallback: Issue[keyof Issue]) => (patch[k] !== undefined ? patch[k] : fallback);
    db()
      .prepare(
        `update issues set title = ?, description = ?, status_id = ?, type_id = ?, priority = ?, assignee_id = ?, epic_id = ?, parent_id = ?, estimate = ?, due_date = ?, start_date = ?, sprint_id = ?, position = ?, updated_at = ?, completed_at = ? where id = ?`,
      )
      .run(
        pick("title", cur.title),
        pick("description", cur.description),
        statusId,
        pick("typeId", cur.typeId),
        pick("priority", cur.priority),
        pick("assigneeId", cur.assigneeId),
        pick("epicId", cur.epicId),
        pick("parentId", cur.parentId),
        pick("estimate", cur.estimate),
        pick("dueDate", cur.dueDate),
        pick("startDate", cur.startDate),
        pick("sprintId", cur.sprintId),
        // Moved to another column without a place: at the bottom.
        patch.position ?? (patch.statusId && patch.statusId !== cur.statusId ? (db().prepare("select coalesce(max(position), 0) as m from issues where status_id = ?").get(statusId) as { m: number }).m + 1024 : cur.position),
        now(),
        completedAt,
        id,
      );
    if (patch.labelIds) {
      db().prepare("delete from issue_labels where issue_id = ?").run(id);
      for (const l of patch.labelIds) db().prepare("insert or ignore into issue_labels (issue_id, label_id) values (?, ?)").run(id, l);
    }
    return getIssue(id);
  });
}

/** True if making `parentId` the parent of `id` would loop (a ticket inside its own sub-tickets). */
export function wouldLoop(id: string, parentId: string): boolean {
  let at: string | null = parentId;
  for (let depth = 0; at && depth < 50; depth++) {
    if (at === id) return true;
    at = (db().prepare("select parent_id from issues where id = ?").get(at) as { parent_id: string | null } | undefined)?.parent_id ?? null;
  }
  return false;
}

export const deleteIssue = (id: string) => db().prepare("delete from issues where id = ?").run(id);

// ---- Comments

type CommentRow = { id: string; issue_id: string; user_id: string | null; body: string; created_at: string };
const toComment = (r: CommentRow): Comment => ({ id: r.id, issueId: r.issue_id, userId: r.user_id, body: r.body, createdAt: r.created_at });

export const listComments = (issueId: string) => (db().prepare("select * from comments where issue_id = ? order by created_at").all(issueId) as CommentRow[]).map(toComment);

export function addComment(issueId: string, userId: string, body: string): Comment {
  const id = newId();
  db().prepare("insert into comments (id, issue_id, user_id, body, created_at) values (?, ?, ?, ?, ?)").run(id, issueId, userId, body, now());
  return toComment(db().prepare("select * from comments where id = ?").get(id) as CommentRow);
}

export function getComment(id: string) {
  const r = db().prepare("select * from comments where id = ?").get(id) as CommentRow | undefined;
  return r ? toComment(r) : null;
}
export const deleteComment = (id: string) => db().prepare("delete from comments where id = ?").run(id);

// ---- Dependencies between tickets

/** True if "blocker blocks blocked" would close a loop (A blocks B blocks A), directly or through others. */
export function wouldBlockLoop(blockerId: string, blockedId: string): boolean {
  if (blockerId === blockedId) return true;
  // Loop if the blocker is already (indirectly) waiting on the blocked ticket.
  const seen = new Set<string>();
  const queue = [blockerId];
  const next = db().prepare("select blocker_id from issue_links where blocked_id = ?");
  while (queue.length) {
    const at = queue.pop()!;
    if (at === blockedId) return true;
    if (seen.has(at)) continue;
    seen.add(at);
    for (const r of next.all(at) as { blocker_id: string }[]) queue.push(r.blocker_id);
  }
  return false;
}

export function addLink(blockerId: string, blockedId: string) {
  db().prepare("insert or ignore into issue_links (blocker_id, blocked_id) values (?, ?)").run(blockerId, blockedId);
}

export function removeLink(blockerId: string, blockedId: string) {
  db().prepare("delete from issue_links where blocker_id = ? and blocked_id = ?").run(blockerId, blockedId);
}

// ---- Sprints

type SprintRow = { id: string; project_id: string; name: string; goal: string; start_date: string | null; end_date: string | null; state: SprintState; created_at: string; issue_count: number; done_count: number; points: number; points_done: number };
const toSprint = (r: SprintRow): Sprint => ({
  id: r.id,
  projectId: r.project_id,
  name: r.name,
  goal: r.goal,
  startDate: r.start_date,
  endDate: r.end_date,
  state: r.state,
  createdAt: r.created_at,
  issueCount: r.issue_count,
  doneCount: r.done_count,
  points: r.points,
  pointsDone: r.points_done,
});

const SPRINT_SELECT = `select sp.*,
  (select count(*) from issues i where i.sprint_id = sp.id) as issue_count,
  (select count(*) from issues i join statuses s on s.id = i.status_id where i.sprint_id = sp.id and s.category in ('done', 'canceled')) as done_count,
  (select coalesce(sum(i.estimate), 0) from issues i where i.sprint_id = sp.id) as points,
  (select coalesce(sum(i.estimate), 0) from issues i join statuses s on s.id = i.status_id where i.sprint_id = sp.id and s.category = 'done') as points_done
  from sprints sp`;

/** Active first, then planned by start date, then finished (most recent first). */
export const listSprints = (projectId: string) =>
  (
    db()
      .prepare(`${SPRINT_SELECT} where sp.project_id = ? order by case sp.state when 'active' then 0 when 'planned' then 1 else 2 end, case when sp.state = 'done' then '' else coalesce(sp.start_date, '9999') end, sp.end_date desc, sp.created_at`)
      .all(projectId) as SprintRow[]
  ).map(toSprint);

export function getSprint(id: string): Sprint | null {
  const r = db().prepare(`${SPRINT_SELECT} where sp.id = ?`).get(id) as SprintRow | undefined;
  return r ? toSprint(r) : null;
}

export function addSprint(projectId: string, input: { name: string; goal?: string; startDate?: string | null; endDate?: string | null }): Sprint {
  const id = newId();
  db().prepare("insert into sprints (id, project_id, name, goal, start_date, end_date, created_at) values (?, ?, ?, ?, ?, ?, ?)").run(id, projectId, input.name, input.goal ?? "", input.startDate ?? null, input.endDate ?? null, now());
  return getSprint(id)!;
}

/**
 * Changes a sprint. Starting one ("active") is refused while another sprint of the project is active:
 * returns "busy". Finishing one ("done") with `moveOpenTo` sends its unfinished tickets to another
 * sprint, or back to the backlog with null.
 */
export function updateSprint(id: string, patch: { name?: string; goal?: string; startDate?: string | null; endDate?: string | null; state?: SprintState; moveOpenTo?: string | null }): Sprint | "busy" | null {
  return tx(() => {
    const s = db().prepare("select * from sprints where id = ?").get(id) as SprintRow | undefined;
    if (!s) return null;
    const state = patch.state ?? s.state;
    if (state === "active" && s.state !== "active" && db().prepare("select 1 from sprints where project_id = ? and state = 'active' and id != ?").get(s.project_id, id)) return "busy";
    db()
      .prepare("update sprints set name = ?, goal = ?, start_date = ?, end_date = ?, state = ? where id = ?")
      .run(patch.name ?? s.name, patch.goal ?? s.goal, patch.startDate !== undefined ? patch.startDate : s.start_date, patch.endDate !== undefined ? patch.endDate : s.end_date, state, id);
    if (state === "done" && s.state !== "done" && patch.moveOpenTo !== undefined) {
      db()
        .prepare("update issues set sprint_id = ?, updated_at = ? where sprint_id = ? and status_id in (select id from statuses where category not in ('done', 'canceled'))")
        .run(patch.moveOpenTo, now(), id);
    }
    return getSprint(id);
  });
}

/** Deletes a sprint. Its tickets go back to the backlog. */
export const deleteSprint = (id: string) => db().prepare("delete from sprints where id = ?").run(id);

// ---- Roadmap

/** Every epic of every project that is not archived, with its project: the roadmap across projects. */
export function listRoadmap(): RoadmapProject[] {
  return listProjects()
    .filter((p) => !p.archived)
    .map((project) => ({ project, epics: listEpics(project.id), sprints: listSprints(project.id) }));
}
