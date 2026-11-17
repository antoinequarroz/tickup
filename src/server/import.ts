import "server-only";
import { suggestKey, templateById, validKey } from "@/lib/templates";
import { addLink, db, listUsers, newId, wouldBlockLoop } from "./db";
import { categoryForState, cleanKey, dayOf, epicStateFor, type LinearClient, type LinearComment, type LinearCycle, LinearError, type LinearLabel, type LinearState, type LinearIssue, type LinearPerson, type LinearProject, type LinearTeam, type LinearTeamSummary, mapCycles, orderStates, priorityFor } from "./linear";

/**
 * Import from Linear: one team becomes one project. Everything imported remembers where it comes
 * from (external_ref "linear:<id>"), so importing again never duplicates, and tickets created in
 * TickUp are never touched. Importing again only ADDS what is new in Linear: what was already
 * imported keeps the changes made here, unless `overwrite` asks to take Linear's version again.
 */

export type ImportOptions = { comments?: boolean; archived?: boolean; overwrite?: boolean };

export type TeamSummary = {
  teamId: string;
  teamName: string;
  projectKey: string;
  projectName: string;
  /** False when the project existed from an earlier import. */
  created: boolean;
  statuses: number;
  labels: number;
  epics: number;
  sprints: number;
  issuesCreated: number;
  issuesUpdated: number;
  /** Already imported and left as they are here (import without `overwrite`). */
  issuesKept: number;
  comments: number;
  links: number;
  unmatched: { name: string; email: string | null }[];
  warnings: string[];
};
export type TeamResult = TeamSummary | { teamId: string; teamName: string; error: string };

export type PreviewTeam = { id: string; key: string; name: string; issueCount: number; projectKey: string; existing: boolean };

const ref = (id: string) => `linear:${id}`;
const MAX_TITLE = 300;

type ProjectRow = { id: string; key: string; name: string; next_number: number };

const importedProject = (teamId: string) => db().prepare("select id, key, name, next_number from projects where external_ref = ?").get(ref(teamId)) as ProjectRow | undefined;

/** The key a team's project gets: its own when valid and free, otherwise a close free one. */
function freeKey(team: { key: string; name: string }, taken: (key: string) => boolean): string {
  const base = cleanKey(team.key) || cleanKey(suggestKey(team.name)) || "LIN";
  if (!taken(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const suffix = String(n);
    const candidate = base.slice(0, 6 - suffix.length) + suffix;
    if (validKey(candidate) && !taken(candidate)) return candidate;
  }
  throw new Error("Aucune clé de projet libre");
}

const keyTaken = (key: string) => !!db().prepare("select 1 from projects where key = ?").get(key);

/** The teams of the workspace, each with the project key it would get. */
export async function previewLinear(client: LinearClient): Promise<PreviewTeam[]> {
  const teams = await client.teams();
  const reserved = new Set<string>();
  return teams.map((t: LinearTeamSummary) => {
    const existing = importedProject(t.id);
    const projectKey = existing?.key ?? freeKey(t, (k) => reserved.has(k) || keyTaken(k));
    reserved.add(projectKey);
    return { id: t.id, key: t.key, name: t.name, issueCount: t.issueCount, projectKey, existing: !!existing };
  });
}

export type TeamData = { team: LinearTeam; issues: LinearIssue[]; comments: LinearComment[] };

/** Everything about one team, read from Linear before anything is written. */
export async function fetchTeam(client: LinearClient, teamId: string, options: ImportOptions = {}): Promise<TeamData> {
  const team = await client.team(teamId);
  const issues = await client.issues(teamId, !!options.archived);
  let comments: LinearComment[] = [];
  if (options.comments !== false) {
    // Comments only come with a ticket's first import: no need to read them when every ticket is known.
    const project = importedProject(teamId);
    const known = new Set(project ? (db().prepare("select external_ref from issues where project_id = ? and external_ref is not null").all(project.id) as { external_ref: string }[]).map((r) => r.external_ref) : []);
    if (issues.some((i) => !known.has(ref(i.id)))) comments = await client.comments(teamId, !!options.archived);
  }
  return { team, issues, comments };
}

/**
 * Writes one team into the database, in one transaction: all or nothing.
 * `userId` becomes the lead of a newly created project. `today` is "YYYY-MM-DD".
 */
export function writeTeam(data: TeamData, userId: string | null, today = new Date().toISOString().slice(0, 10), overwrite = false): TeamSummary {
  const { team, issues } = data;
  const conn = db();
  return conn.transaction((): TeamSummary => {
    const warnings: string[] = [];
    const now = new Date().toISOString();

    // People are matched to TickUp accounts by e-mail.
    const userByEmail = new Map(listUsers().map((u) => [u.email.toLowerCase(), u.id]));
    const unmatched = new Map<string, { name: string; email: string | null }>();
    const match = (p: LinearPerson | null): string | null => {
      if (!p) return null;
      const id = p.email ? userByEmail.get(p.email.trim().toLowerCase()) : undefined;
      if (!id) unmatched.set((p.email ?? p.name).toLowerCase(), { name: p.name, email: p.email });
      return id ?? null;
    };

    // ---- Project
    let project = importedProject(team.id);
    const created = !project;
    const name = team.name.trim().slice(0, 80) || team.key;
    if (!project) {
      const key = freeKey(team, keyTaken);
      const template = templateById("software");
      const id = newId();
      conn.prepare("insert into projects (id, key, name, description, template, lead_id, created_at, external_ref) values (?, ?, ?, ?, ?, ?, ?, ?)").run(id, key, name, team.description, template.id, userId, now, ref(team.id));
      // Linear has no ticket types: the project starts with the usual ones, none assigned.
      template.types.forEach((ty, i) => conn.prepare("insert into issue_types (id, project_id, name, icon, position) values (?, ?, ?, ?, ?)").run(newId(), id, ty.name, ty.icon, i));
      project = { id, key, name, next_number: 1 };
      if (key !== team.key) warnings.push(`La clé ${team.key} n'était pas disponible : le projet s'appelle ${key}, et ${team.key}-12 devient ${key}-12.`);
    } else if (overwrite) {
      conn.prepare("update projects set name = ?, description = ? where id = ?").run(name, team.description, project.id);
    }
    const projectId = project.id;

    // ---- Statuses, matched by name, in Linear's order
    const existingStatuses = conn.prepare("select id, name from statuses where project_id = ? order by position").all(projectId) as { id: string; name: string }[];
    const statusByName = new Map(existingStatuses.map((s) => [s.name.toLowerCase(), s.id]));
    const statusOf = new Map<string, string>();
    const categoryOf = new Map<string, string>();
    const fromLinear = new Set<string>();
    orderStates(team.states).forEach((s, i) => {
      let category = categoryForState(s.type, s.name);
      if (!category) {
        category = "backlog";
        warnings.push(`Statut « ${s.name} » d'un genre inconnu (${s.type}) : rangé dans le backlog.`);
      }
      const label = s.name.trim().slice(0, 80) || s.type;
      let id = statusByName.get(label.toLowerCase());
      if (id) {
        if (overwrite) conn.prepare("update statuses set category = ?, position = ? where id = ?").run(category, i, id);
      } else {
        id = newId();
        conn.prepare("insert into statuses (id, project_id, name, category, position) values (?, ?, ?, ?, ?)").run(id, projectId, label, category, created || overwrite ? i : existingStatuses.length + i);
        statusByName.set(label.toLowerCase(), id);
      }
      statusOf.set(s.id, id);
      fromLinear.add(id);
    });
    // Statuses added in TickUp stay, after Linear's.
    if (overwrite) existingStatuses.filter((s) => !fromLinear.has(s.id)).forEach((s, i) => conn.prepare("update statuses set position = ? where id = ?").run(fromLinear.size + i, s.id));
    for (const r of conn.prepare("select id, category from statuses where project_id = ?").all(projectId) as { id: string; category: string }[]) categoryOf.set(r.id, r.category);
    if (!fromLinear.size) throw new LinearError("graphql", `L'équipe ${team.name} n'a aucun statut dans Linear.`);
    const fallbackStatus = statusOf.values().next().value as string;

    // ---- Labels, matched by name: the team's, plus the workspace ones its tickets carry
    const labelByName = new Map((conn.prepare("select id, name from labels where project_id = ?").all(projectId) as { id: string; name: string }[]).map((l) => [l.name.toLowerCase(), l.id]));
    const labelOf = new Map<string, string>();
    const seenLabels = new Set<string>();
    for (const l of [...team.labels, ...issues.flatMap((i) => i.labels)]) {
      const label = l.name.trim().slice(0, 80);
      if (!label || labelOf.has(l.id)) continue;
      let id = labelByName.get(label.toLowerCase());
      if (!id) {
        id = newId();
        conn.prepare("insert into labels (id, project_id, name, tone) values (?, ?, ?, ?)").run(id, projectId, label, labelByName.size % 5);
        labelByName.set(label.toLowerCase(), id);
      }
      labelOf.set(l.id, id);
      seenLabels.add(id);
    }

    // ---- Linear projects → epics
    const epicOf = new Map<string, string>();
    const projects = new Map<string, LinearProject>();
    for (const i of issues) if (i.project) projects.set(i.project.id, i.project);
    for (const p of projects.values()) {
      const values = [p.name.trim().slice(0, 80) || "Projet", p.description, epicStateFor(p.state), dayOf(p.startDate), dayOf(p.targetDate)];
      let id = (conn.prepare("select id from epics where project_id = ? and external_ref = ?").get(projectId, ref(p.id)) as { id: string } | undefined)?.id;
      if (id) {
        if (overwrite) conn.prepare("update epics set name = ?, description = ?, state = ?, start_date = ?, target_date = ? where id = ?").run(...values, id);
      } else {
        id = newId();
        conn.prepare("insert into epics (name, description, state, start_date, target_date, id, project_id, created_at, external_ref) values (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(...values, id, projectId, now, ref(p.id));
      }
      epicOf.set(p.id, id);
    }

    // ---- Cycles → sprints
    const sprintOf = new Map<string, string>();
    // A sprint already in progress here keeps the "active" seat, and a sprint that exists keeps its state:
    // starting and finishing sprints happens in TickUp once the team works here.
    let activeTaken = !!conn.prepare("select 1 from sprints where project_id = ? and state = 'active'").get(projectId);
    for (const s of mapCycles(team.cycles, team.timezone, today)) {
      let id = (conn.prepare("select id from sprints where project_id = ? and external_ref = ?").get(projectId, ref(s.cycle.id)) as { id: string } | undefined)?.id;
      let state = s.state;
      if (state === "active" && !id) {
        if (activeTaken) {
          state = "planned";
          warnings.push(`Le sprint « ${s.name} » est en cours dans Linear, mais un autre sprint est déjà en cours ici : il arrive comme prévu.`);
        }
        activeTaken = true;
      }
      const values = [s.name.slice(0, 80), s.cycle.description ?? "", s.startDate, s.endDate];
      if (id) {
        if (overwrite) conn.prepare("update sprints set name = ?, goal = ?, start_date = ?, end_date = ? where id = ?").run(...values, id);
      } else {
        id = newId();
        conn.prepare("insert into sprints (name, goal, start_date, end_date, state, id, project_id, created_at, external_ref) values (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(...values, state, id, projectId, now, ref(s.cycle.id));
      }
      sprintOf.set(s.cycle.id, id);
    }

    // ---- Tickets
    type Existing = { id: string; number: number; status_id: string; assignee_id: string | null; external_ref: string | null };
    const rows = conn.prepare("select id, number, status_id, assignee_id, external_ref from issues where project_id = ?").all(projectId) as Existing[];
    const known = new Map(rows.filter((r) => r.external_ref).map((r) => [r.external_ref!, r]));
    const usedNumbers = new Set(rows.map((r) => r.number));
    let nextNumber = Math.max(project.next_number, ...rows.map((r) => r.number + 1));
    const bottom = new Map<string, number>();
    const nextPosition = (statusId: string) => {
      const at = (bottom.get(statusId) ?? (conn.prepare("select coalesce(max(position), 0) as m from issues where status_id = ?").get(statusId) as { m: number }).m) + 1024;
      bottom.set(statusId, at);
      return at;
    };

    const issueOf = new Map<string, string>();
    const createdIds = new Set<string>();
    const renumbered: LinearIssue[] = [];
    let issuesCreated = 0;
    let issuesUpdated = 0;
    let issuesKept = 0;
    let truncated = 0;
    const insert = conn.prepare(
      `insert into issues (id, project_id, number, title, description, status_id, priority, assignee_id, epic_id, estimate, due_date, sprint_id, position, created_by, created_at, updated_at, completed_at, external_ref)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, null, ?, ?, ?, ?)`,
    );
    const update = conn.prepare("update issues set title = ?, description = ?, status_id = ?, priority = ?, assignee_id = ?, epic_id = ?, estimate = ?, due_date = ?, sprint_id = ?, position = coalesce(?, position), updated_at = ?, completed_at = ? where id = ?");
    const sorted = [...issues].sort((a, b) => a.number - b.number);

    const write = (i: LinearIssue, number: number | null) => {
      const statusId = statusOf.get(i.stateId) ?? fallbackStatus;
      const closed = categoryOf.get(statusId) === "done" || categoryOf.get(statusId) === "canceled";
      const completedAt = closed ? (i.completedAt ?? i.canceledAt ?? i.updatedAt) : null;
      const assigneeId = match(i.assignee);
      const common = [i.title.trim().slice(0, MAX_TITLE) || i.identifier, i.description, statusId, priorityFor(i.priority)];
      const rest = [i.project ? (epicOf.get(i.project.id) ?? null) : null, typeof i.estimate === "number" ? i.estimate : null, dayOf(i.dueDate), i.cycleId ? (sprintOf.get(i.cycleId) ?? null) : null];
      const old = known.get(ref(i.id));
      let id: string;
      if (old && !overwrite) {
        // Already here: it keeps what was done to it in TickUp.
        id = old.id;
        issuesKept++;
      } else if (old) {
        id = old.id;
        // Someone Linear knows but TickUp does not: keep whoever was assigned here.
        const assignee = i.assignee && !assigneeId ? old.assignee_id : assigneeId;
        update.run(...common, assignee, ...rest, old.status_id === statusId ? null : nextPosition(statusId), now, completedAt, id);
        issuesUpdated++;
      } else {
        id = newId();
        insert.run(id, projectId, number, ...common, assigneeId, ...rest, nextPosition(statusId), i.createdAt, i.updatedAt, completedAt, ref(i.id));
        usedNumbers.add(number!);
        createdIds.add(id);
        issuesCreated++;
      }
      issueOf.set(i.id, id);
      if (i.truncated) truncated++;
    };

    for (const i of sorted) {
      // A number already used by a ticket created in TickUp: this one gets a new number, at the end.
      if (!known.has(ref(i.id)) && (!Number.isInteger(i.number) || i.number < 1 || usedNumbers.has(i.number))) renumbered.push(i);
      else write(i, i.number);
    }
    nextNumber = Math.max(nextNumber, ...sorted.filter((i) => !renumbered.includes(i)).map((i) => i.number + 1));
    for (const i of renumbered) {
      while (usedNumbers.has(nextNumber)) nextNumber++;
      warnings.push(`${i.identifier} devient ${project.key}-${nextNumber} : son numéro était déjà pris par un ticket créé ici.`);
      write(i, nextNumber++);
    }
    // New tickets created in TickUp continue above the highest imported number.
    conn.prepare("update projects set next_number = ? where id = ?").run(nextNumber, projectId);

    // Parents and labels, once every ticket exists.
    const setParent = conn.prepare("update issues set parent_id = ? where id = ?");
    const clearLabels = conn.prepare("delete from issue_labels where issue_id = ?");
    const addIssueLabel = conn.prepare("insert or ignore into issue_labels (issue_id, label_id) values (?, ?)");
    for (const i of issues) {
      const id = issueOf.get(i.id)!;
      if (!overwrite && !createdIds.has(id)) continue;
      const parent = i.parentId ? issueOf.get(i.parentId) : undefined;
      setParent.run(parent && parent !== id ? parent : null, id);
      clearLabels.run(id);
      for (const l of i.labels) if (labelOf.has(l.id)) addIssueLabel.run(id, labelOf.get(l.id));
    }
    if (truncated) warnings.push(`${truncated} ticket(s) ont plus de 10 étiquettes ou relations dans Linear : seules les 10 premières sont importées.`);

    // ---- "blocks" relations
    let links = 0;
    let loops = 0;
    const hasLink = conn.prepare("select 1 from issue_links where blocker_id = ? and blocked_id = ?");
    for (const i of issues) {
      const blocker = issueOf.get(i.id)!;
      for (const other of i.blocks) {
        const blocked = issueOf.get(other);
        if (!blocked || hasLink.get(blocker, blocked)) continue;
        if (wouldBlockLoop(blocker, blocked)) {
          loops++;
          continue;
        }
        addLink(blocker, blocked);
        links++;
      }
    }
    if (loops) warnings.push(`${loops} dépendance(s) ignorée(s) : elles formaient une boucle.`);

    // ---- Comments, only for tickets created by this import
    let comments = 0;
    const addComment = conn.prepare("insert into comments (id, issue_id, user_id, body, created_at) values (?, ?, ?, ?, ?)");
    for (const c of data.comments) {
      const issueId = issueOf.get(c.issueId);
      if (!issueId || !createdIds.has(issueId)) continue;
      const author = match(c.author);
      // Nobody to attach it to: the author's name goes in the text.
      const body = author ? c.body : `**${c.author?.name ?? "Linear"}** (dans Linear) :\n\n${c.body}`;
      addComment.run(newId(), issueId, author, body, c.createdAt);
      comments++;
    }

    return {
      teamId: team.id,
      teamName: team.name,
      projectKey: project.key,
      projectName: name,
      created,
      statuses: fromLinear.size,
      labels: seenLabels.size,
      epics: epicOf.size,
      sprints: sprintOf.size,
      issuesCreated,
      issuesUpdated,
      issuesKept,
      comments,
      links,
      unmatched: [...unmatched.values()].sort((a, b) => a.name.localeCompare(b.name)),
      warnings,
    };
  })();
}

/** Imports the chosen teams one after the other. A team that fails leaves nothing behind. */
export async function importLinear(client: LinearClient, teamIds: string[], options: ImportOptions, userId: string | null): Promise<TeamResult[]> {
  const results: TeamResult[] = [];
  let stopped: string | null = null;
  for (const teamId of teamIds) {
    if (stopped) {
      results.push({ teamId, teamName: "", error: stopped });
      continue;
    }
    let teamName = "";
    try {
      const data = await fetchTeam(client, teamId, options);
      teamName = data.team.name;
      results.push(writeTeam(data, userId, undefined, options.overwrite === true));
    } catch (e) {
      const known = e instanceof LinearError;
      // The detail of an unexpected error stays in the server log (it never holds the key).
      if (!known) console.error("Import Linear :", e);
      const error = known ? e.message : "L'import de cette équipe a échoué. Rien n'a été modifié pour elle.";
      results.push({ teamId, teamName, error });
      // A refused key or the rate limit will fail the next teams too.
      if (known && (e.code === "auth" || e.code === "rate")) stopped = error;
    }
  }
  return results;
}

// ---- Import from a file: the same data, read from Linear by another route than the API key

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");
const strOrNull = (v: unknown, max: number): string | null => (typeof v === "string" && v ? v.slice(0, max) : null);
const idOf = (v: unknown): string | null => (typeof v === "string" && /^[A-Za-z0-9-]{1,64}$/.test(v) ? v : null);
/** A day "2026-11-17" stays a day; a moment is rewritten in UTC, the way TickUp stores them. */
function isoOrNull(v: unknown): string | null {
  if (typeof v !== "string" || v.length > 40) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return Number.isNaN(Date.parse(`${v}T00:00:00Z`)) || new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) !== v ? null : v;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})$/.test(v)) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}
const list = (v: unknown, max: number): unknown[] | null => (Array.isArray(v) && v.length <= max ? v : null);
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

function personFrom(v: unknown): LinearPerson | null {
  const p = obj(v);
  const email = p ? strOrNull(p.email, 200) : null;
  // People are matched by e-mail: a person without a name still counts.
  const name = p ? str(p.name, 120).trim() || (email ?? "") : "";
  return p && name ? { name, email } : null;
}

export const MAX_FILE_ISSUES = 20_000;
const MAX_TEXT = 200_000;
/** Ticket numbers stay far from the point where adding one changes nothing. */
const MAX_NUMBER = 10_000_000;
/** Each dependency costs a walk through the graph when it is written. */
const MAX_FILE_LINKS = 20_000;

/**
 * Checks a team export ({ team, issues, comments }, the shape `fetchTeam` returns) coming from outside.
 * Returns the cleaned data, or a sentence saying what is wrong. Nothing is written here.
 */
export function teamDataFrom(input: unknown): TeamData | string {
  const root = obj(input);
  const t = root && obj(root.team);
  if (!root || !t) return "Fichier illisible : il manque l'équipe.";
  const teamId = idOf(t.id);
  const key = str(t.key, 20).trim();
  const teamName = str(t.name, 200).trim();
  if (!teamId || !key || !teamName) return "Fichier illisible : l'équipe n'a pas d'identifiant, de clé ou de nom.";

  const states: LinearState[] = [];
  if ([t.states, t.labels ?? [], t.cycles ?? []].some((v, k) => !list(v, k ? 2000 : 200))) return "Fichier illisible : la liste des statuts, des étiquettes ou des cycles manque ou est trop longue.";
  for (const raw of list(t.states, 200) ?? []) {
    const s = obj(raw);
    const id = s && idOf(s.id);
    const name = s ? str(s.name, 80).trim() : "";
    if (!s || !id || !name) return "Fichier illisible : un statut n'a pas d'identifiant ou de nom.";
    states.push({ id, name, type: str(s.type, 40), position: typeof s.position === "number" && Number.isFinite(s.position) ? s.position : states.length });
  }
  if (!states.length) return "Fichier illisible : l'équipe n'a aucun statut.";
  const stateIds = new Set(states.map((s) => s.id));

  const labelFrom = (raw: unknown): LinearLabel | null => {
    const l = obj(raw);
    const id = l && idOf(l.id);
    const name = l ? str(l.name, 80).trim() : "";
    return id && name ? { id, name } : null;
  };
  const labels = (list(t.labels ?? [], 2000) ?? []).map(labelFrom).filter((l): l is LinearLabel => !!l);

  const cycles: LinearCycle[] = [];
  for (const raw of list(t.cycles ?? [], 2000) ?? []) {
    const c = obj(raw);
    const id = c && idOf(c.id);
    const startsAt = c && isoOrNull(c.startsAt);
    const endsAt = c && isoOrNull(c.endsAt);
    if (!c || !id || !startsAt || !endsAt) return "Fichier illisible : un cycle n'a pas d'identifiant ou de dates.";
    cycles.push({ id, number: typeof c.number === "number" ? c.number : cycles.length + 1, name: strOrNull(c.name, 80), description: strOrNull(c.description, MAX_TEXT), startsAt, endsAt, completedAt: isoOrNull(c.completedAt) });
  }
  const cycleIds = new Set(cycles.map((c) => c.id));

  const rawIssues = list(root.issues, MAX_FILE_ISSUES);
  if (!rawIssues) return `Fichier illisible : la liste des tickets manque ou dépasse ${MAX_FILE_ISSUES} tickets.`;
  const issues: LinearIssue[] = [];
  const seen = new Set<string>();
  for (const raw of rawIssues) {
    const i = obj(raw);
    const id = i && idOf(i.id);
    const title = i ? str(i.title, 1000) : "";
    const createdAt = i && isoOrNull(i.createdAt);
    const stateId = i && idOf(i.stateId);
    const label = i ? str(i.identifier, 40) || id || "?" : "?";
    if (!i || !id || !createdAt || !stateId) return `Fichier illisible : le ticket ${label} n'a pas d'identifiant, de date de création ou de statut.`;
    if (!stateIds.has(stateId)) return `Fichier illisible : le ticket ${label} a un statut inconnu de l'équipe.`;
    if (seen.has(id)) return `Fichier illisible : le ticket ${label} apparaît deux fois.`;
    if (!Number.isInteger(i.number) || (i.number as number) < 1 || (i.number as number) > MAX_NUMBER) return `Fichier illisible : le ticket ${label} n'a pas de numéro valide.`;
    const itsLabels = list(i.labels ?? [], 200);
    const itsBlocks = list(i.blocks ?? [], 2000);
    if (!itsLabels || !itsBlocks) return `Fichier illisible : le ticket ${label} a trop d'étiquettes ou de dépendances.`;
    seen.add(id);
    const p = obj(i.project);
    const projectId = p && idOf(p.id);
    const cycleId = idOf(i.cycleId);
    issues.push({
      id,
      identifier: label,
      number: i.number as number,
      title,
      description: str(i.description, MAX_TEXT),
      priority: typeof i.priority === "number" ? i.priority : 0,
      estimate: typeof i.estimate === "number" && Number.isFinite(i.estimate) ? i.estimate : null,
      dueDate: isoOrNull(i.dueDate),
      createdAt,
      updatedAt: isoOrNull(i.updatedAt) ?? createdAt,
      completedAt: isoOrNull(i.completedAt),
      canceledAt: isoOrNull(i.canceledAt),
      stateId,
      assignee: personFrom(i.assignee),
      parentId: idOf(i.parentId),
      project: p && projectId ? { id: projectId, name: str(p.name, 200), description: str(p.description, MAX_TEXT), state: str(p.state, 40), startDate: isoOrNull(p.startDate), targetDate: isoOrNull(p.targetDate) } : null,
      cycleId: cycleId && cycleIds.has(cycleId) ? cycleId : null,
      labels: itsLabels.map(labelFrom).filter((l): l is LinearLabel => !!l),
      blocks: [...new Set(itsBlocks.map(idOf).filter((b): b is string => !!b && b !== id))],
      truncated: i.truncated === true,
    });
  }

  if (issues.reduce((n, i) => n + i.blocks.length, 0) > MAX_FILE_LINKS) return `Fichier illisible : plus de ${MAX_FILE_LINKS} dépendances entre tickets.`;

  // A parent chain that comes back to its start (Linear never has one) is cut where it closes.
  const byId = new Map(issues.map((i) => [i.id, i]));
  for (const i of issues) if (i.parentId && !byId.has(i.parentId)) i.parentId = null;
  for (const i of issues) {
    const walked = new Set([i.id]);
    for (let at = i; at.parentId; at = byId.get(at.parentId)!) {
      if (walked.has(at.parentId)) {
        at.parentId = null;
        break;
      }
      walked.add(at.parentId);
    }
  }

  const rawComments = list(root.comments ?? [], 200_000);
  if (!rawComments) return "Fichier illisible : la liste des commentaires est trop longue.";
  const comments: LinearComment[] = [];
  for (const raw of rawComments) {
    const c = obj(raw);
    const issueId = c && idOf(c.issueId);
    const createdAt = c && isoOrNull(c.createdAt);
    const text = c ? str(c.body, MAX_TEXT) : "";
    // A comment on a ticket left out of the file, or an empty one, is skipped.
    if (!c || !issueId || !createdAt || !text.trim() || !seen.has(issueId)) continue;
    comments.push({ issueId, body: text, createdAt, author: personFrom(c.author) });
  }
  comments.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return { team: { id: teamId, key, name: teamName, description: str(t.description, MAX_TEXT), timezone: str(t.timezone, 60) || "UTC", states, labels, cycles }, issues, comments };
}
