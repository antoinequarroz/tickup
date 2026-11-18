import "server-only";
import { CATEGORIES, EPIC_STATES, PRIORITIES, TEMPLATES, validKey } from "@/lib/templates";
import type { Epic, Issue, IssueType, Label, Project, Sprint, Status, TemplateId, User } from "@/lib/types";
import {
  addComment,
  addEpic,
  addLink,
  createIssue,
  createProject,
  getIssue,
  getProject,
  getUser,
  listAssigned,
  listComments,
  listEpics,
  listGithubLinks,
  listIssues,
  listLabels,
  listProjects,
  listSprints,
  listStatuses,
  listSubIssues,
  listTypes,
  listUsers,
  updateEpic,
  updateIssue,
  wouldBlockLoop,
  type IssueInput,
} from "../db";
import { dateField, MAX_COMMENT, MAX_DESCRIPTION, MAX_NAME, MAX_TITLE } from "../http";
import { emit } from "../suite";
import { readIssue, validEpicState } from "../validate";

/**
 * The tools TickUp offers AI agents over MCP. They speak the agent's language: a project by its key
 * (WEB), a ticket by its reference (WEB-12), a status, a type, an epic or a label by its name, a
 * person by name or e-mail ("me" for the agent itself). Every change goes through the same checks
 * and events as the app: open tabs update live and the suite webhook hears about it.
 */

/** A mistake the agent can fix (unknown status, missing title…): returned as a tool error, not a protocol error. */
export class ToolError extends Error {}

type Args = Record<string, unknown>;
export type Tool = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
  run: (args: Args, me: User) => unknown;
};

// ---- Reading the agent's words

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const same = (a: string, b: string) => a.localeCompare(b, "fr", { sensitivity: "base" }) === 0;

function project(ref: unknown): Project {
  const key = str(ref);
  if (!key) throw new ToolError("Indique le projet (sa clé, par exemple WEB). list_projects les donne.");
  const p = getProject(key) ?? getProject(key.toUpperCase()) ?? listProjects().find((x) => same(x.name, key));
  if (!p) throw new ToolError(`Projet « ${key} » introuvable. list_projects donne les clés.`);
  return p;
}

function issue(ref: unknown): Issue {
  const r = str(ref);
  if (!r) throw new ToolError("Indique le ticket (sa référence, par exemple WEB-12).");
  const i = getIssue(r);
  if (!i) throw new ToolError(`Ticket ${r} introuvable.`);
  return i;
}

/** Everything a ticket's fields can point at, for one project: built once per call. */
class Ctx {
  statuses: Status[];
  types: IssueType[];
  labels: Label[];
  epics: Epic[];
  sprints: Sprint[];
  users: User[];
  constructor(readonly p: Project) {
    this.statuses = listStatuses(p.id);
    this.types = listTypes(p.id);
    this.labels = listLabels(p.id);
    this.epics = listEpics(p.id);
    this.sprints = listSprints(p.id);
    this.users = listUsers();
  }

  status(v: unknown): string {
    const s = str(v);
    const hit = s && (this.statuses.find((x) => x.id === s || same(x.name, s)) ?? this.statuses.find((x) => x.category === s || CATEGORIES.some((c) => c.value === x.category && same(c.label, s))));
    if (!hit) throw new ToolError(`Statut « ${s ?? ""} » inconnu dans ${this.p.key}. Statuts : ${this.statuses.map((x) => `${x.name} (${x.category})`).join(", ")}.`);
    return hit.id;
  }
  type(v: unknown): string | null {
    if (v === null) return null;
    const s = str(v);
    const hit = s && this.types.find((x) => x.id === s || same(x.name, s));
    if (!hit) throw new ToolError(`Type « ${s ?? ""} » inconnu dans ${this.p.key}. Types : ${this.types.map((x) => x.name).join(", ") || "aucun"}.`);
    return hit.id;
  }
  epic(v: unknown): string | null {
    if (v === null) return null;
    const s = str(v);
    const hit = s && this.epics.find((x) => x.id === s || same(x.name, s));
    if (!hit) throw new ToolError(`Epic « ${s ?? ""} » inconnue dans ${this.p.key}. Epics : ${this.epics.map((x) => x.name).join(", ") || "aucune"}.`);
    return hit.id;
  }
  sprint(v: unknown): string | null {
    if (v === null) return null;
    const s = str(v);
    const hit = s && (s === "active" ? this.sprints.find((x) => x.state === "active") : this.sprints.find((x) => x.id === s || same(x.name, s)));
    if (!hit) throw new ToolError(`Sprint « ${s ?? ""} » introuvable dans ${this.p.key}. Sprints : ${this.sprints.map((x) => `${x.name} (${x.state})`).join(", ") || "aucun"}.`);
    return hit.id;
  }
  label(v: unknown): string {
    const s = str(v);
    const hit = s && this.labels.find((x) => x.id === s || same(x.name, s));
    if (!hit) throw new ToolError(`Étiquette « ${s ?? ""} » inconnue dans ${this.p.key}. Étiquettes : ${this.labels.map((x) => x.name).join(", ") || "aucune"}.`);
    return hit.id;
  }
  person(v: unknown, me: User): string | null {
    if (v === null) return null;
    const s = str(v);
    if (s === "me" || s === "moi") return me.id;
    const hit = s && this.users.find((u) => u.id === s || same(u.name, s) || same(u.email, s));
    if (!hit) throw new ToolError(`Personne « ${s ?? ""} » inconnue. list_users donne l'équipe.`);
    return hit.id;
  }

  /** A ticket as the agent reads it: names instead of ids. */
  show(i: Issue, full = false) {
    const name = <T extends { id: string; name: string }>(list: T[], id: string | null) => (id ? (list.find((x) => x.id === id)?.name ?? null) : null);
    const status = this.statuses.find((s) => s.id === i.statusId);
    const ref = (id: string) => getIssue(id)?.ref ?? id;
    return {
      ref: i.ref,
      title: i.title,
      status: status?.name ?? null,
      category: status?.category ?? null,
      type: name(this.types, i.typeId),
      priority: PRIORITIES.find((p) => p.value === i.priority)?.label ?? "Aucune",
      assignee: name(this.users, i.assigneeId),
      epic: name(this.epics, i.epicId),
      parent: i.parentId ? ref(i.parentId) : null,
      sprint: name(this.sprints, i.sprintId),
      labels: i.labelIds.map((l) => name(this.labels, l)).filter(Boolean),
      estimate: i.estimate,
      startDate: i.startDate,
      dueDate: i.dueDate,
      ...(i.subCount ? { subTickets: `${i.subDone}/${i.subCount} terminés` } : {}),
      ...(i.blockedBy.length ? { blockedBy: i.blockedBy.map(ref) } : {}),
      ...(i.blocks.length ? { blocks: i.blocks.map(ref) } : {}),
      ...(full ? { description: i.description, createdBy: name(this.users, i.createdBy), createdAt: i.createdAt, updatedAt: i.updatedAt, completedAt: i.completedAt } : { updatedAt: i.updatedAt }),
      url: issueUrl(this.p, i),
    };
  }
}

const appUrl = () => (/^https?:\/\//.test(process.env.APP_URL ?? "") ? process.env.APP_URL!.replace(/\/+$/, "") : "");
const issueUrl = (p: Project, i: Issue) => `${appUrl()}/p/${p.key}?issue=${i.ref}`;

/** Turns the agent's fields (names) into the app's fields (ids), then through the app's own checks. */
function issueFields(a: Args, c: Ctx, me: User, opts: { creating: boolean; issueId?: string }) {
  const data: Args = {};
  if (a.title !== undefined) data.title = a.title;
  if (a.description !== undefined) data.description = a.description;
  if (a.status !== undefined) data.statusId = c.status(a.status);
  if (a.type !== undefined) data.typeId = c.type(a.type);
  if (a.epic !== undefined) data.epicId = c.epic(a.epic);
  if (a.sprint !== undefined) data.sprintId = c.sprint(a.sprint);
  if (a.assignee !== undefined) data.assigneeId = c.person(a.assignee, me);
  if (a.parent !== undefined) {
    if (a.parent === null) data.parentId = null;
    else {
      const parent = issue(a.parent);
      if (parent.projectId !== c.p.id) throw new ToolError("Le ticket parent doit être dans le même projet.");
      data.parentId = parent.id;
    }
  }
  if (a.priority !== undefined) {
    const p = typeof a.priority === "number" ? a.priority : PRIORITIES.find((x) => typeof a.priority === "string" && (same(x.label, a.priority) || same(String(x.value), a.priority) || PRIORITY_EN[a.priority.toLowerCase()] === x.value))?.value;
    if (p === undefined) throw new ToolError("Priorité : 0 aucune, 1 urgente, 2 haute, 3 moyenne, 4 basse.");
    data.priority = p;
  }
  if (a.estimate !== undefined) data.estimate = a.estimate;
  if (a.startDate !== undefined) data.startDate = a.startDate;
  if (a.dueDate !== undefined) data.dueDate = a.dueDate;
  if (a.labels !== undefined) {
    if (!Array.isArray(a.labels)) throw new ToolError("labels est une liste de noms d'étiquettes.");
    data.labelIds = a.labels.map((l) => c.label(l));
  }
  const out = readIssue(data, c.p.id, opts);
  if (typeof out === "string") throw new ToolError(out);
  return out;
}

const PRIORITY_EN: Record<string, number> = { none: 0, urgent: 1, high: 2, medium: 3, low: 4 };

// ---- JSON Schema pieces

const S = {
  project: { type: "string", description: "Clé du projet, par exemple WEB (ou son nom)." },
  issue: { type: "string", description: "Référence du ticket, par exemple WEB-12." },
  title: { type: "string", maxLength: MAX_TITLE },
  description: { type: "string", description: "Markdown." },
  status: { type: "string", description: "Nom du statut du projet (« En cours ») ou sa catégorie : backlog, todo, active, review, done, canceled." },
  type: { type: ["string", "null"], description: "Nom du type de ticket (Bug, Tâche, Montage…)." },
  priority: { type: ["integer", "string"], description: "0 aucune, 1 urgente, 2 haute, 3 moyenne, 4 basse (ou le mot)." },
  assignee: { type: ["string", "null"], description: "Nom ou e-mail de la personne, « me » pour toi-même, null pour personne." },
  epic: { type: ["string", "null"], description: "Nom de l'epic, null pour aucune." },
  parent: { type: ["string", "null"], description: "Référence du ticket parent : le ticket devient un sous-ticket." },
  sprint: { type: ["string", "null"], description: "Nom du sprint, « active » pour le sprint en cours, null pour aucun." },
  labels: { type: "array", items: { type: "string" }, description: "Noms des étiquettes (remplace la liste)." },
  estimate: { type: ["number", "null"], minimum: 0 },
  date: { type: ["string", "null"], description: "AAAA-MM-JJ, null pour effacer." },
};

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
const RO = { readOnlyHint: true, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

// ---- The tools

export const TOOLS: Tool[] = [
  {
    name: "whoami",
    title: "Qui suis-je",
    description: "Ton identité dans TickUp (le compte de l'agent) : les tickets qui te sont assignés sont ceux où assignee vaut ton nom.",
    inputSchema: obj({}),
    annotations: RO,
    run: (_a, me) => ({ id: me.id, name: me.name, agent: me.agent, role: me.role, app: appUrl() || null }),
  },
  {
    name: "list_projects",
    title: "Lister les projets",
    description: "Les projets de TickUp avec leur clé, leur style (general, media, software) et leur avancement.",
    inputSchema: obj({ includeArchived: { type: "boolean", default: false } }),
    annotations: RO,
    run: (a) =>
      listProjects()
        .filter((p) => a.includeArchived || !p.archived)
        .map((p) => ({ key: p.key, name: p.name, style: p.template, description: p.description, archived: p.archived, tickets: p.issueCount, done: p.doneCount, lead: p.leadId ? (getUser(p.leadId)?.name ?? null) : null })),
  },
  {
    name: "get_project",
    title: "Détails d'un projet",
    description: "Un projet et tout ce qu'un ticket peut utiliser : statuts (colonnes du kanban), types, étiquettes, epics et sprints. À lire avant de créer ou modifier des tickets.",
    inputSchema: obj({ project: S.project }, ["project"]),
    annotations: RO,
    run: (a) => {
      const c = new Ctx(project(a.project));
      return {
        key: c.p.key,
        name: c.p.name,
        style: c.p.template,
        description: c.p.description,
        url: `${appUrl()}/p/${c.p.key}`,
        statuses: c.statuses.map((s) => ({ name: s.name, category: s.category })),
        types: c.types.map((t) => t.name),
        labels: c.labels.map((l) => l.name),
        epics: c.epics.map((e) => ({ name: e.name, state: e.state, startDate: e.startDate, targetDate: e.targetDate, tickets: e.issueCount, done: e.doneCount })),
        sprints: c.sprints.map((s) => ({ name: s.name, state: s.state, goal: s.goal, startDate: s.startDate, endDate: s.endDate, tickets: s.issueCount, done: s.doneCount })),
      };
    },
  },
  {
    name: "list_issues",
    title: "Chercher des tickets",
    description:
      "Les tickets d'un projet, filtrés. Sans filtre de statut, les tickets terminés et annulés sont exclus (includeClosed pour les voir). Les sous-tickets sont inclus ; parent les limite aux sous-tickets d'un ticket.",
    inputSchema: obj(
      {
        project: S.project,
        query: { type: "string", description: "Texte cherché dans le titre et la description." },
        status: S.status,
        assignee: { type: "string", description: "Nom, e-mail, « me », ou « none » pour les tickets sans personne." },
        epic: { type: "string" },
        sprint: { type: "string", description: "Nom du sprint ou « active »." },
        label: { type: "string" },
        type: { type: "string" },
        parent: S.parent,
        includeClosed: { type: "boolean", default: false },
        limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
      },
      ["project"],
    ),
    annotations: RO,
    run: (a, me) => {
      const c = new Ctx(project(a.project));
      let list = listIssues(c.p.id);
      if (a.status !== undefined) {
        const statusId = c.status(a.status);
        const cat = c.statuses.find((s) => s.id === statusId)!.category;
        // A category ("done") matches every status of that category; a name matches that status.
        list = list.filter((i) => (a.status === cat ? c.statuses.find((s) => s.id === i.statusId)?.category === cat : i.statusId === statusId));
      } else if (!a.includeClosed) list = list.filter((i) => !["done", "canceled"].includes(c.statuses.find((s) => s.id === i.statusId)?.category ?? ""));
      if (a.assignee !== undefined) {
        const who = a.assignee === "none" ? null : c.person(a.assignee, me);
        list = list.filter((i) => i.assigneeId === who);
      }
      if (a.epic !== undefined) list = list.filter((i) => i.epicId === c.epic(a.epic));
      if (a.sprint !== undefined) list = list.filter((i) => i.sprintId === c.sprint(a.sprint));
      if (a.type !== undefined) list = list.filter((i) => i.typeId === c.type(a.type));
      if (a.label !== undefined) {
        const l = c.label(a.label);
        list = list.filter((i) => i.labelIds.includes(l));
      }
      if (a.parent !== undefined && a.parent !== null) {
        const parent = issue(a.parent);
        list = list.filter((i) => i.parentId === parent.id);
      }
      const q = str(a.query)?.toLowerCase();
      if (q) list = list.filter((i) => i.ref.toLowerCase() === q || i.title.toLowerCase().includes(q) || i.description.toLowerCase().includes(q));
      const limit = typeof a.limit === "number" ? Math.min(Math.max(1, Math.floor(a.limit)), 200) : 50;
      return { total: list.length, issues: list.slice(0, limit).map((i) => c.show(i)) };
    },
  },
  {
    name: "list_my_issues",
    title: "Mes tickets",
    description: "Les tickets ouverts assignés à toi (ou à quelqu'un d'autre avec assignee), dans tous les projets actifs, les plus prioritaires d'abord.",
    inputSchema: obj({ assignee: { type: "string", description: "Nom ou e-mail ; par défaut toi-même." } }),
    annotations: RO,
    run: (a, me) => {
      const who = a.assignee === undefined ? me.id : (listUsers().find((u) => same(u.name, String(a.assignee)) || same(u.email, String(a.assignee)))?.id ?? (a.assignee === "me" ? me.id : null));
      if (!who) throw new ToolError(`Personne « ${String(a.assignee)} » inconnue. list_users donne l'équipe.`);
      const ctxs = new Map<string, Ctx>();
      return listAssigned(who).map((i) => {
        if (!ctxs.has(i.projectId)) ctxs.set(i.projectId, new Ctx(getProject(i.projectId)!));
        return ctxs.get(i.projectId)!.show(i);
      });
    },
  },
  {
    name: "get_issue",
    title: "Lire un ticket",
    description: "Un ticket en entier : description, sous-tickets, dépendances, commentaires et ce que GitHub en dit (PR, branches, commits).",
    inputSchema: obj({ issue: S.issue }, ["issue"]),
    annotations: RO,
    run: (a) => {
      const i = issue(a.issue);
      const c = new Ctx(getProject(i.projectId)!);
      const who = (id: string | null) => (id ? (c.users.find((u) => u.id === id)?.name ?? null) : null);
      return {
        ...c.show(i, true),
        subIssues: listSubIssues(i.id).map((s) => ({ ref: s.ref, title: s.title, status: c.statuses.find((x) => x.id === s.statusId)?.name ?? null, assignee: who(s.assigneeId) })),
        comments: listComments(i.id).map((m) => ({ id: m.id, author: who(m.userId), body: m.body, createdAt: m.createdAt })),
        github: listGithubLinks(i.id).map((g) => ({ kind: g.kind, repo: g.repo, ref: g.ref, title: g.title, state: g.state, url: g.url })),
      };
    },
  },
  {
    name: "create_issue",
    title: "Créer un ticket",
    description: "Crée un ticket dans un projet, ou un sous-ticket avec parent. Sans statut, il va dans la première colonne « à faire ». Les noms (statut, type, epic, étiquettes) sont ceux de get_project.",
    inputSchema: obj(
      {
        project: S.project,
        title: S.title,
        description: S.description,
        status: S.status,
        type: S.type,
        priority: S.priority,
        assignee: S.assignee,
        epic: S.epic,
        parent: S.parent,
        sprint: S.sprint,
        labels: S.labels,
        estimate: S.estimate,
        startDate: S.date,
        dueDate: S.date,
      },
      ["project", "title"],
    ),
    annotations: WRITE,
    run: (a, me) => {
      const c = new Ctx(project(a.project));
      const input = issueFields(a, c, me, { creating: true });
      if (input.startDate && input.dueDate && input.dueDate < input.startDate) throw new ToolError("L'échéance est avant le début.");
      const created = createIssue(c.p.id, input as IssueInput, me.id);
      emit({ type: "issue", projectId: c.p.id, issueId: created.id }, "issue.created", { project: { id: c.p.id, key: c.p.key, name: c.p.name }, issue: created });
      return c.show(created, true);
    },
  },
  {
    name: "update_issue",
    title: "Modifier un ticket",
    description:
      "Change les champs donnés d'un ticket, les autres restent. Pour le déplacer sur le kanban, change status (« done » pour le terminer). null efface un champ (assignee, epic, sprint, parent, dates…).",
    inputSchema: obj(
      {
        issue: S.issue,
        title: S.title,
        description: S.description,
        status: S.status,
        type: S.type,
        priority: S.priority,
        assignee: S.assignee,
        epic: S.epic,
        parent: S.parent,
        sprint: S.sprint,
        labels: S.labels,
        estimate: S.estimate,
        startDate: S.date,
        dueDate: S.date,
      },
      ["issue"],
    ),
    annotations: { ...WRITE, idempotentHint: true },
    run: (a, me) => {
      const cur = issue(a.issue);
      const c = new Ctx(getProject(cur.projectId)!);
      const patch = issueFields(a, c, me, { creating: false, issueId: cur.id });
      const start = patch.startDate !== undefined ? patch.startDate : cur.startDate;
      const due = patch.dueDate !== undefined ? patch.dueDate : cur.dueDate;
      if (start && due && due < start) throw new ToolError("L'échéance est avant le début.");
      const changed = Object.keys(patch);
      if (!changed.length) throw new ToolError("Rien à changer : donne au moins un champ.");
      const updated = updateIssue(cur.id, patch)!;
      emit({ type: "issue", projectId: updated.projectId, issueId: updated.id }, "issue.updated", { issue: updated, changed, previous: Object.fromEntries(changed.map((k) => [k, cur[k as keyof Issue]])) });
      return c.show(updated, true);
    },
  },
  {
    name: "add_comment",
    title: "Commenter un ticket",
    description: "Ajoute un commentaire (Markdown) à un ticket, signé de ton nom d'agent. Utile pour rendre compte de ton travail.",
    inputSchema: obj({ issue: S.issue, body: { type: "string", maxLength: MAX_COMMENT } }, ["issue", "body"]),
    annotations: WRITE,
    run: (a, me) => {
      const i = issue(a.issue);
      const text = str(a.body);
      if (!text) throw new ToolError("Le commentaire est vide.");
      if (text.length > MAX_COMMENT) throw new ToolError(`Commentaire trop long (${MAX_COMMENT} caractères au plus).`);
      const comment = addComment(i.id, me.id, text);
      emit({ type: "issue", projectId: i.projectId, issueId: i.id }, "issue.commented", { issue: { id: i.id, ref: i.ref, title: i.title }, comment, author: { id: me.id, name: me.name } });
      return { ok: true, issue: i.ref, commentId: comment.id };
    },
  },
  {
    name: "link_issues",
    title: "Ajouter une dépendance",
    description: "Indique qu'un ticket en bloque un autre (même projet) : blocked ne peut pas avancer avant que blocker soit terminé. Visible sur le Gantt.",
    inputSchema: obj({ blocker: S.issue, blocked: S.issue }, ["blocker", "blocked"]),
    annotations: { ...WRITE, idempotentHint: true },
    run: (a) => {
      const blocker = issue(a.blocker);
      const blocked = issue(a.blocked);
      if (blocker.projectId !== blocked.projectId) throw new ToolError("Les deux tickets doivent être dans le même projet.");
      if (blocker.id === blocked.id || wouldBlockLoop(blocker.id, blocked.id)) throw new ToolError("Cette dépendance ferait une boucle.");
      addLink(blocker.id, blocked.id);
      const updated = getIssue(blocked.id)!;
      emit({ type: "project", projectId: updated.projectId }, "issue.updated", { issue: updated, changed: ["blockedBy", "blocks"], previous: {} });
      return { ok: true, blocker: blocker.ref, blocked: blocked.ref };
    },
  },
  {
    name: "create_epic",
    title: "Créer une epic",
    description: "Crée une epic (un grand objectif qui regroupe des tickets) dans un projet.",
    inputSchema: obj(
      { project: S.project, name: S.title, description: S.description, state: { type: "string", enum: EPIC_STATES.map((s) => s.value) }, startDate: S.date, targetDate: S.date },
      ["project", "name"],
    ),
    annotations: WRITE,
    run: (a) => {
      const p = project(a.project);
      const fields = epicFields(a, true);
      const id = addEpic(p.id, fields as Parameters<typeof addEpic>[1]);
      const epic = listEpics(p.id).find((e) => e.id === id);
      emit({ type: "project", projectId: p.id }, "epic.created", { project: { id: p.id, key: p.key }, epic });
      return epic;
    },
  },
  {
    name: "update_epic",
    title: "Modifier une epic",
    description: "Change le nom, la description, l'état ou les dates d'une epic.",
    inputSchema: obj(
      { project: S.project, epic: { type: "string", description: "Nom actuel de l'epic." }, name: S.title, description: S.description, state: { type: "string", enum: EPIC_STATES.map((s) => s.value) }, startDate: S.date, targetDate: S.date },
      ["project", "epic"],
    ),
    annotations: { ...WRITE, idempotentHint: true },
    run: (a) => {
      const c = new Ctx(project(a.project));
      const id = c.epic(a.epic)!;
      updateEpic(id, epicFields(a, false));
      const epic = listEpics(c.p.id).find((e) => e.id === id);
      emit({ type: "project", projectId: c.p.id }, "epic.updated", { epic });
      return epic;
    },
  },
  {
    name: "create_project",
    title: "Créer un projet",
    description: "Crée un projet. style : general (projet général), media (création multimédia) ou software (développement) ; il fixe les statuts, types et étiquettes de départ.",
    inputSchema: obj(
      {
        key: { type: "string", description: "2 à 6 lettres ou chiffres, commence par une lettre (WEB)." },
        name: { type: "string", maxLength: MAX_NAME },
        style: { type: "string", enum: TEMPLATES.map((t) => t.id) },
        description: { type: "string" },
      },
      ["key", "name", "style"],
    ),
    annotations: WRITE,
    run: (a, me) => {
      const key = String(a.key ?? "").trim().toUpperCase();
      const name = str(a.name);
      const template = TEMPLATES.find((t) => t.id === a.style)?.id as TemplateId | undefined;
      if (!name || name.length > MAX_NAME) throw new ToolError("Donne un nom au projet.");
      if (!validKey(key)) throw new ToolError("La clé fait 2 à 6 lettres ou chiffres, et commence par une lettre.");
      if (!template) throw new ToolError("style : general, media ou software.");
      const created = createProject({ name, key, template, description: typeof a.description === "string" ? a.description.slice(0, 2000) : "", leadId: me.agent ? null : me.id });
      if (!created) throw new ToolError(`La clé ${key} est déjà prise.`);
      emit({ type: "refresh" }, "project.created", { project: created });
      return { key: created.key, name: created.name, style: created.template, url: `${appUrl()}/p/${created.key}` };
    },
  },
  {
    name: "list_users",
    title: "L'équipe",
    description: "Les personnes et les agents de TickUp, à qui un ticket peut être assigné.",
    inputSchema: obj({}),
    annotations: RO,
    run: () => listUsers().map((u) => ({ name: u.name, ...(u.agent ? { agent: true } : { email: u.email }), role: u.role })),
  },
];

function epicFields(a: Args, creating: boolean) {
  const out: { name?: string; description?: string; state?: never; startDate?: string | null; targetDate?: string | null } = {};
  if (creating || a.name !== undefined) {
    const name = str(a.name);
    if (!name || name.length > MAX_TITLE) throw new ToolError("Donne un nom à l'epic.");
    out.name = name;
  }
  if (a.description !== undefined) out.description = String(a.description).slice(0, MAX_DESCRIPTION);
  if (a.state !== undefined) {
    if (!validEpicState(a.state)) throw new ToolError("État : planned, active, done ou canceled.");
    out.state = a.state as never;
  }
  for (const f of ["startDate", "targetDate"] as const) {
    if (a[f] === undefined) continue;
    const d = dateField(a[f]);
    if (d === undefined) throw new ToolError("Date invalide (AAAA-MM-JJ).");
    out[f] = d;
  }
  return out;
}

export const toolByName = (name: unknown) => TOOLS.find((t) => t.name === name);
