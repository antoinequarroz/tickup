import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as store from "./db";
import { fetchTeam, importLinear, previewLinear, teamDataFrom, type TeamSummary, writeTeam } from "./import";
import { categoryForState, cleanKey, type LinearCycle, LinearError, linearClient, mapCycles, orderStates } from "./linear";

const KEY = "lin_api_SECRET123456";
const account = (n: string) => ({ email: `${n.toLowerCase()}@exemple.ch`, name: n, salt: "s", hash: "h" });

// ---- A pretend Linear: answers the importer's queries from a fixture, page by page.

type Json = Record<string, unknown>;
type Fixture = { teams: Json[]; issues: Record<string, Json[]>; comments: Record<string, Json[]> };

const states = [
  { id: "s-done", name: "Done", type: "completed", position: 0 },
  { id: "s-review", name: "In Review", type: "started", position: 2 },
  { id: "s-progress", name: "In Progress", type: "started", position: 1 },
  { id: "s-todo", name: "Todo", type: "unstarted", position: 0 },
  { id: "s-backlog", name: "Backlog", type: "backlog", position: 0 },
  { id: "s-triage", name: "Triage", type: "triage", position: 0 },
  { id: "s-canceled", name: "Canceled", type: "canceled", position: 0 },
  { id: "s-dup", name: "Duplicate", type: "canceled", position: 1 },
];

const cycles = [
  { id: "c1", number: 1, name: null, description: null, startsAt: "2026-11-01T23:00:00.000Z", endsAt: "2026-11-15T23:00:00.000Z", completedAt: "2026-11-15T23:00:00.000Z" },
  { id: "c2", number: 2, name: "Lancement", description: "Mettre en ligne", startsAt: "2026-11-15T23:00:00.000Z", endsAt: "2026-11-29T23:00:00.000Z", completedAt: null },
  { id: "c3", number: 3, name: null, description: null, startsAt: "2026-11-29T23:00:00.000Z", endsAt: "2026-12-13T23:00:00.000Z", completedAt: null },
];

const linearProject = { id: "p1", name: "Refonte", description: "Le nouveau site", startDate: "2026-10-01", targetDate: "2026-12-20", status: { type: "started" } };

function issue(number: number, extra: Json = {}): Json {
  return {
    id: `i${number}`,
    identifier: `ENG-${number}`,
    number,
    title: `Ticket ${number}`,
    description: "",
    priority: 0,
    estimate: null,
    dueDate: null,
    createdAt: "2026-01-05T09:00:00.000Z",
    updatedAt: "2026-02-01T09:00:00.000Z",
    completedAt: null,
    canceledAt: null,
    trashed: null,
    state: { id: "s-todo" },
    assignee: null,
    parent: null,
    project: null,
    cycle: null,
    labels: { nodes: [], pageInfo: { hasNextPage: false } },
    relations: { nodes: [], pageInfo: { hasNextPage: false } },
    ...extra,
  };
}

const blocks = (...ids: string[]) => ({ nodes: ids.map((id) => ({ type: "blocks", relatedIssue: { id } })), pageInfo: { hasNextPage: false } });
const labels = (...l: [string, string][]) => ({ nodes: l.map(([id, name]) => ({ id, name })), pageInfo: { hasNextPage: false } });

function fixture(): Fixture {
  return {
    teams: [{ id: "t1", key: "ENG", name: "Engineering", description: "L'équipe produit", issueCount: 7, timezone: "Europe/Zurich", states, cycles, labels: [{ id: "l-bug", name: "Bug" }] }],
    issues: {
      t1: [
        issue(1, { title: "Parent", description: "## Titre\n\n- **gras**", priority: 1, estimate: 3, dueDate: "2026-12-01", state: { id: "s-progress" }, assignee: { name: "Ana", email: "ANA@exemple.ch" }, project: linearProject, cycle: { id: "c2" }, labels: labels(["l-bug", "Bug"], ["l-ws", "Client"]), relations: blocks("i2") }),
        issue(2, { title: "Enfant", priority: 2, parent: { id: "i1" }, state: { id: "s-review" }, assignee: { name: "Zoé Dehors", email: "zoe@ailleurs.ch" }, relations: blocks("i1", "i-autre-equipe") }),
        issue(3, { priority: 3, state: { id: "s-done" }, completedAt: "2026-03-03T10:00:00.000Z", cycle: { id: "c1" } }),
        issue(7, { priority: 4, state: { id: "s-canceled" }, canceledAt: "2026-04-04T10:00:00.000Z" }),
        issue(42, { state: { id: "s-triage" }, relations: { nodes: [{ type: "related", relatedIssue: { id: "i1" } }], pageInfo: { hasNextPage: false } } }),
        issue(43, { state: { id: "s-backlog" }, trashed: true }),
        issue(44, { state: { id: "s-dup" }, parent: { id: "i-autre-equipe" } }),
      ],
    },
    comments: {
      t1: [
        { body: "Premier", createdAt: "2026-01-06T09:00:00.000Z", issue: { id: "i1" }, user: { name: "Ana", email: "ana@exemple.ch" }, externalUser: null, botActor: null },
        { body: "Vu de dehors", createdAt: "2026-01-07T09:00:00.000Z", issue: { id: "i1" }, user: { name: "Zoé Dehors", email: "zoe@ailleurs.ch" }, externalUser: null, botActor: null },
        { body: "Automatique", createdAt: "2026-01-08T09:00:00.000Z", issue: { id: "i3" }, user: null, externalUser: null, botActor: { name: "GitHub" } },
      ],
    },
  };
}

type Call = { query: string; variables: Json; headers: Record<string, string>; url: string };

function linear(fx: Fixture) {
  const calls: Call[] = [];
  const page = (items: Json[], first: number, after: unknown) => {
    const from = typeof after === "string" ? Number(after) : 0;
    const to = from + first;
    return { nodes: items.slice(from, to), pageInfo: { hasNextPage: to < items.length, endCursor: to < items.length ? String(to) : null } };
  };
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    const { query, variables } = JSON.parse(init.body as string) as { query: string; variables: Json };
    calls.push({ query, variables, headers: init.headers as Record<string, string>, url });
    const first = Number(/first: (\d+)/.exec(query)?.[1] ?? 50);
    const op = /^query (\w+)/.exec(query)?.[1];
    const team = fx.teams.find((t) => t.id === (variables.id ?? variables.teamId));
    let data: Json;
    if (op === "Teams") data = { teams: page(fx.teams.map(({ id, key, name, description, issueCount }) => ({ id, key, name, description, issueCount })), first, variables.after) };
    else if (op === "Team") data = { team: { ...team, states: { nodes: team!.states }, cycles: { nodes: team!.cycles }, labels: undefined } };
    else if (op === "TeamLabels") data = { team: { labels: page(team!.labels as Json[], first, variables.after) } };
    else if (op === "Issues") data = { issues: page(fx.issues[variables.teamId as string] ?? [], first, variables.after) };
    else if (op === "Comments") data = { comments: page(fx.comments[variables.teamId as string] ?? [], first, variables.after) };
    else throw new Error(`Requête inattendue : ${op}`);
    return new Response(JSON.stringify({ data }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, count: (op: string) => calls.filter((c) => c.query.startsWith(`query ${op}`)).length };
}

const answer = (status: number, payload: unknown) => vi.stubGlobal("fetch", vi.fn(async () => new Response(typeof payload === "string" ? payload : JSON.stringify(payload), { status })));

async function run(fx: Fixture, options = {}) {
  const [result] = await importLinear(linearClient(KEY), ["t1"], options, store.firstAdmin()?.id ?? null);
  if ("error" in result) throw new Error(result.error);
  return result;
}

let ana: ReturnType<typeof store.createFirstUser>;

beforeEach(() => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tickup-"));
  ana = store.createFirstUser(account("Ana"));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("client Linear", () => {
  it("envoie la clé telle quelle, à l'adresse de Linear uniquement", async () => {
    const { calls } = linear(fixture());
    await linearClient(KEY).teams();
    expect(calls[0].url).toBe("https://api.linear.app/graphql");
    expect(calls[0].headers.Authorization).toBe(KEY);
  });

  it("suit la pagination jusqu'au bout", async () => {
    const fx = fixture();
    fx.issues.t1 = Array.from({ length: 120 }, (_, i) => issue(i + 1));
    const { calls, count } = linear(fx);
    const issues = await linearClient(KEY).issues("t1");
    expect(issues).toHaveLength(120);
    expect(issues.map((i) => i.number)).toEqual(Array.from({ length: 120 }, (_, i) => i + 1));
    expect(count("Issues")).toBe(3);
    expect(calls.map((c) => c.variables.after)).toEqual([null, "50", "100"]);
  });

  it("clé refusée : message clair, en HTTP 401 comme en erreur GraphQL", async () => {
    answer(401, { errors: [{ message: "Authentication required, not authenticated", extensions: { code: "AUTHENTICATION_ERROR" } }] });
    await expect(linearClient(KEY).teams()).rejects.toMatchObject({ code: "auth", message: expect.stringContaining("Clé Linear refusée") });
    answer(400, { errors: [{ message: "nope", extensions: { type: "authentication error", code: "AUTHENTICATION_ERROR" } }] });
    await expect(linearClient(KEY).teams()).rejects.toMatchObject({ code: "auth" });
  });

  it("limite de requêtes : en HTTP 429 comme avec le code RATELIMITED", async () => {
    answer(429, "Too many requests");
    await expect(linearClient(KEY).teams()).rejects.toMatchObject({ code: "rate" });
    answer(400, { errors: [{ message: "Rate limit exceeded", extensions: { code: "RATELIMITED" } }] });
    await expect(linearClient(KEY).teams()).rejects.toMatchObject({ code: "rate", message: expect.stringContaining("limite") });
  });

  it("erreur GraphQL : rapportée en français, sans jamais montrer la clé", async () => {
    answer(200, { errors: [{ message: `Cannot query field "foo" with key ${KEY}` }] });
    const err = await linearClient(KEY).teams().catch((e) => e);
    expect(err).toBeInstanceOf(LinearError);
    expect(err.code).toBe("graphql");
    expect(err.message).toContain("Linear a renvoyé une erreur");
    expect(err.message).toContain('Cannot query field "foo"');
    expect(err.message).not.toContain(KEY);
  });

  it("requête jugée trop lourde : recommence avec des pages plus petites", async () => {
    const fx = fixture();
    const { calls } = linear(fx);
    const real = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => ((init.body as string).includes("first: 50, after") && (init.body as string).includes("query Issues") ? new Response(JSON.stringify({ errors: [{ message: "Query too complex" }] }), { status: 400 }) : real(url, init))),
    );
    expect(await linearClient(KEY).issues("t1")).toHaveLength(6);
    expect(calls.at(-1)!.query).toContain("first: 25");
  });

  it("panne passagère : un nouvel essai, puis une erreur claire", async () => {
    vi.useFakeTimers();
    const down = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    vi.stubGlobal("fetch", down);
    const pending = linearClient(KEY).teams().catch((e) => e);
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({ code: "network" });
    expect(down).toHaveBeenCalledTimes(2);
  });
});

describe("correspondances", () => {
  it("statuts : par genre, « review » reconnu, dans l'ordre de Linear", () => {
    expect(orderStates(states).map((s) => [s.name, categoryForState(s.type, s.name)])).toEqual([
      ["Triage", "backlog"],
      ["Backlog", "backlog"],
      ["Todo", "todo"],
      ["In Progress", "active"],
      ["In Review", "review"],
      ["Done", "done"],
      ["Canceled", "canceled"],
      ["Duplicate", "canceled"],
    ]);
    expect(categoryForState("started", "QA")).toBe("review");
    expect(categoryForState("started", "En revue")).toBe("review");
    expect(categoryForState("mystère", "?")).toBeNull();
  });

  it("cycles : passé terminé, celui du jour en cours (un seul), le reste prévu, dates dans le fuseau de l'équipe", () => {
    const sprints = mapCycles(cycles as LinearCycle[], "Europe/Zurich", "2026-11-17");
    expect(sprints.map((s) => [s.name, s.startDate, s.endDate, s.state])).toEqual([
      ["Cycle 1", "2026-11-02", "2026-11-15", "done"],
      ["Lancement", "2026-11-16", "2026-11-29", "active"],
      ["Cycle 3", "2026-11-30", "2026-12-13", "planned"],
    ]);
    // Two overlapping cycles running today: only the first is active.
    const overlap = mapCycles([cycles[1], { ...cycles[1], id: "c9", number: 9 }] as LinearCycle[], "Europe/Zurich", "2026-11-17");
    expect(overlap.map((s) => s.state)).toEqual(["active", "planned"]);
    expect(mapCycles(cycles as LinearCycle[], "Europe/Zurich", "2027-01-01").map((s) => s.state)).toEqual(["done", "done", "done"]);
  });

  it("clé d'équipe rendue valide", () => {
    expect(cleanKey("ENG")).toBe("ENG");
    expect(cleanKey("eng-web")).toBe("ENGWEB");
    expect(cleanKey("1A")).toBe("");
    expect(cleanKey("LONGUECLE")).toBe("LONGUE");
  });
});

describe("import d'une équipe", () => {
  it("crée le projet avec statuts, étiquettes, epic, sprints et tickets", async () => {
    linear(fixture());
    vi.useFakeTimers({ now: new Date("2026-11-17T12:00:00Z"), toFake: ["Date"] });
    const r = await run(fixture());
    expect(r).toMatchObject({ projectKey: "ENG", projectName: "Engineering", created: true, statuses: 8, labels: 2, epics: 1, sprints: 3, issuesCreated: 6, issuesUpdated: 0, comments: 3, links: 1 });

    const data = store.getProjectData("ENG")!;
    expect(data.project.description).toBe("L'équipe produit");
    expect(data.project.leadId).toBe(ana!.id);
    expect(data.statuses.map((s) => [s.name, s.category])).toEqual([
      ["Triage", "backlog"],
      ["Backlog", "backlog"],
      ["Todo", "todo"],
      ["In Progress", "active"],
      ["In Review", "review"],
      ["Done", "done"],
      ["Canceled", "canceled"],
      ["Duplicate", "canceled"],
    ]);
    expect(data.labels.map((l) => [l.name, l.tone])).toEqual([
      ["Bug", 0],
      ["Client", 1],
    ]);
    expect(data.types.length).toBeGreaterThan(0);
    expect(data.epics).toMatchObject([{ name: "Refonte", description: "Le nouveau site", state: "active", startDate: "2026-10-01", targetDate: "2026-12-20" }]);
    expect(data.sprints.map((s) => [s.name, s.state, s.goal])).toEqual([
      ["Lancement", "active", "Mettre en ligne"],
      ["Cycle 3", "planned", ""],
      ["Cycle 1", "done", ""],
    ]);

    const byRef = (ref: string) => store.getIssue(ref)!;
    const status = (id: string) => data.statuses.find((s) => s.id === id)!.name;
    const parent = byRef("ENG-1");
    expect(parent).toMatchObject({ title: "Parent", description: "## Titre\n\n- **gras**", priority: 1, estimate: 3, dueDate: "2026-12-01", assigneeId: ana!.id, createdAt: "2026-01-05T09:00:00.000Z", completedAt: null, parentId: null });
    expect(status(parent.statusId)).toBe("In Progress");
    expect(parent.epicId).toBe(data.epics[0].id);
    expect(parent.sprintId).toBe(data.sprints.find((s) => s.name === "Lancement")!.id);
    expect(parent.labelIds).toHaveLength(2);

    const child = byRef("ENG-2");
    expect(child).toMatchObject({ priority: 2, parentId: parent.id, assigneeId: null });
    expect(status(child.statusId)).toBe("In Review");
    // ENG-1 blocks ENG-2; the reverse would loop and the other team's ticket is unknown: both skipped.
    expect(child.blockedBy).toEqual([parent.id]);
    expect(parent.blockedBy).toEqual([]);
    expect(r.warnings.some((w) => w.includes("boucle"))).toBe(true);

    expect(byRef("ENG-3")).toMatchObject({ priority: 3, completedAt: "2026-03-03T10:00:00.000Z" });
    expect(byRef("ENG-7")).toMatchObject({ priority: 4, completedAt: "2026-04-04T10:00:00.000Z" });
    expect(status(byRef("ENG-42").statusId)).toBe("Triage");
    expect(byRef("ENG-42").blocks).toEqual([]);
    // In Linear's trash: not imported. Parent in another team: imported without parent.
    expect(store.getIssue("ENG-43")).toBeNull();
    expect(byRef("ENG-44").parentId).toBeNull();

    // Numbers kept, and the next ticket created here continues above.
    expect(store.createIssue(data.project.id, { title: "Créé ici" }, ana!.id).ref).toBe("ENG-45");

    expect(r.unmatched).toEqual([
      { name: "GitHub", email: null },
      { name: "Zoé Dehors", email: "zoe@ailleurs.ch" },
    ]);
    const comments = store.listComments(parent.id);
    expect(comments.map((c) => [c.userId, c.body, c.createdAt])).toEqual([
      [ana!.id, "Premier", "2026-01-06T09:00:00.000Z"],
      [null, "**Zoé Dehors** (dans Linear) :\n\nVu de dehors", "2026-01-07T09:00:00.000Z"],
    ]);
  });

  it("réimporter met à jour sans rien dupliquer, et ne touche pas aux tickets créés ici", async () => {
    const fx = fixture();
    linear(fx);
    await run(fx);
    const projectId = store.getProject("ENG")!.id;
    const local = store.createIssue(projectId, { title: "Créé ici" }, ana!.id);
    expect(local.ref).toBe("ENG-45");
    const zoe = store.createUser({ ...account("Zoe"), email: "zoe@ailleurs.ch", role: "member" })!;

    // Meanwhile in Linear: a title changes, a ticket is done, a new one takes number 45.
    fx.issues.t1[0] = { ...fx.issues.t1[0], title: "Parent renommé", assignee: null };
    fx.issues.t1[1] = { ...fx.issues.t1[1], state: { id: "s-done" }, completedAt: "2026-11-10T08:00:00.000Z" };
    fx.issues.t1.push(issue(45, { title: "Nouveau dans Linear" }), issue(46));
    fx.teams[0].name = "Engineering 2";
    const { count } = linear(fx);
    const r = await run(fx, { overwrite: true });

    expect(r).toMatchObject({ projectKey: "ENG", created: false, issuesCreated: 2, issuesUpdated: 6, issuesKept: 0, comments: 0, links: 0 });
    expect(store.listProjects()).toHaveLength(1);
    const data = store.getProjectData("ENG")!;
    expect(data.project.name).toBe("Engineering 2");
    expect(data.statuses).toHaveLength(8);
    expect(data.labels).toHaveLength(2);
    expect(data.epics).toHaveLength(1);
    expect(data.sprints).toHaveLength(3);
    expect(data.issues).toHaveLength(9);
    expect(store.getIssue("ENG-1")).toMatchObject({ title: "Parent renommé", assigneeId: null });
    // Zoé has an account now: her ticket finds her.
    expect(store.getIssue("ENG-2")).toMatchObject({ assigneeId: zoe.id, completedAt: "2026-11-10T08:00:00.000Z" });
    expect(store.listComments(store.getIssue("ENG-1")!.id)).toHaveLength(2);
    // Comments were read again only because new tickets appeared.
    expect(count("Comments")).toBe(1);

    // The ticket created here kept its number; Linear's ENG-45 moved to a free one.
    expect(store.getIssue("ENG-45")).toMatchObject({ id: local.id, title: "Créé ici" });
    expect(store.getIssue("ENG-46")!.title).toBe("Ticket 46");
    expect(store.getIssue("ENG-47")!.title).toBe("Nouveau dans Linear");
    expect(r.warnings.some((w) => w.includes("ENG-45 devient ENG-47"))).toBe(true);
    expect(store.createIssue(projectId, { title: "Encore un" }, ana!.id).ref).toBe("ENG-48");

    // A third run changes nothing more, and does not read the comments.
    const again = linear(fx);
    const third = await run(fx, { overwrite: true });
    expect(third).toMatchObject({ issuesCreated: 0, issuesUpdated: 8, comments: 0 });
    expect(again.count("Comments")).toBe(0);
    expect(store.getProjectData("ENG")!.issues).toHaveLength(10);
    expect(store.getIssue("ENG-47")!.title).toBe("Nouveau dans Linear");
  });

  it("clé déjà prise par un autre projet : une clé libre est dérivée", async () => {
    store.createProject({ key: "ENG", name: "Existant", template: "general", leadId: ana!.id });
    const fx = fixture();
    linear(fx);
    expect(await previewLinear(linearClient(KEY))).toEqual([{ id: "t1", key: "ENG", name: "Engineering", issueCount: 7, projectKey: "ENG2", existing: false }]);
    const r = await run(fx);
    expect(r.projectKey).toBe("ENG2");
    expect(r.warnings[0]).toContain("ENG2");
    expect(store.getIssue("ENG2-42")!.title).toBe("Ticket 42");
    expect(store.getProjectData("ENG")!.issues).toHaveLength(0);
    // The second time, the same project is found again.
    expect((await previewLinear(linearClient(KEY)))[0]).toMatchObject({ projectKey: "ENG2", existing: true });
    expect((await run(fx)).projectKey).toBe("ENG2");
    expect(store.listProjects()).toHaveLength(2);
  });

  it("sans les commentaires si on le demande", async () => {
    const fx = fixture();
    const { count } = linear(fx);
    const r = await run(fx, { comments: false });
    expect(r.comments).toBe(0);
    expect(count("Comments")).toBe(0);
  });

  it("un sprint démarré ici garde sa place : celui de Linear arrive comme prévu", async () => {
    const fx = fixture();
    linear(fx);
    const data = await fetchTeam(linearClient(KEY), "t1");
    writeTeam(data, ana!.id, "2026-11-17");
    const projectId = store.getProject("ENG")!.id;
    const lancement = store.listSprints(projectId).find((s) => s.name === "Lancement")!;
    store.updateSprint(lancement.id, { state: "planned" });
    const mine = store.addSprint(projectId, { name: "Le mien" });
    store.updateSprint(mine.id, { state: "active" });
    writeTeam(data, ana!.id, "2026-11-17", true);
    expect(store.listSprints(projectId).filter((s) => s.state === "active").map((s) => s.name)).toEqual(["Le mien"]);
  });

  it("réimporter sans écraser n'ajoute que le nouveau : ce qui a changé ici reste", async () => {
    const fx = fixture();
    linear(fx);
    await run(fx);
    const projectId = store.getProject("ENG")!.id;
    const before = store.getProjectData("ENG")!;
    const done = before.statuses.find((x) => x.category === "done")!;
    const first = store.getIssue("ENG-1")!;
    store.updateIssue(first.id, { title: "Renommé ici", statusId: done.id, sprintId: null, labelIds: [] });
    const active = before.sprints.find((x) => x.state === "active");
    if (active) store.updateSprint(active.id, { state: "done" });
    store.updateProject(projectId, { name: "Mon nom" });

    fx.issues.t1[0] = { ...fx.issues.t1[0], title: "Renommé dans Linear" };
    fx.issues.t1.push(issue(60, { title: "Nouveau" }));
    fx.teams[0].name = "Engineering 2";
    linear(fx);
    const r = await run(fx);
    expect(r).toMatchObject({ created: false, issuesCreated: 1, issuesUpdated: 0, issuesKept: before.issues.length });
    expect(store.getIssue("ENG-1")).toMatchObject({ title: "Renommé ici", statusId: done.id, sprintId: null, labelIds: [] });
    expect(store.getIssue("ENG-60")!.title).toBe("Nouveau");
    expect(store.getProject("ENG")!.name).toBe("Mon nom");
    expect(store.listSprints(projectId).filter((x) => x.state === "active")).toHaveLength(0);
    expect(store.getProjectData("ENG")!.statuses.map((x) => x.name)).toEqual(before.statuses.map((x) => x.name));
  });

  it("une équipe qui échoue ne laisse rien, et une clé refusée arrête la suite", async () => {
    const fx = fixture();
    // A ticket in a state the team does not have is fine; a team without states is not.
    fx.teams.push({ id: "t2", key: "OPS", name: "Ops", description: null, issueCount: 1, timezone: "UTC", states: [], cycles: [], labels: [] });
    fx.issues.t2 = [issue(1, { id: "x1" })];
    linear(fx);
    const results = await importLinear(linearClient(KEY), ["t2", "t1"], {}, ana!.id);
    expect(results[0]).toMatchObject({ teamId: "t2", teamName: "Ops", error: expect.stringContaining("aucun statut") });
    expect((results[1] as TeamSummary).projectKey).toBe("ENG");
    expect(store.listProjects().map((p) => p.key)).toEqual(["ENG"]);

    answer(401, { errors: [{ message: "Authentication required" }] });
    const refused = await importLinear(linearClient(KEY), ["t1", "t2"], {}, ana!.id);
    expect(refused.map((r) => "error" in r && r.error.includes("Clé Linear refusée"))).toEqual([true, true]);
    expect(JSON.stringify(refused)).not.toContain(KEY);
  });
});

describe("import depuis un fichier", () => {
  const file = () => ({
    team: { id: "t9", key: "ANT", name: "Antoine", description: "", states: [{ id: "s-todo", name: "Todo", type: "unstarted" }, { id: "s-done", name: "Done", type: "completed" }], labels: [{ id: "l1", name: "Epic" }] },
    issues: [
      { id: "a1", identifier: "ANT-1", number: 1, title: "Parent", description: "Texte **complet**", priority: 2, createdAt: "2026-09-14T16:56:05.925Z", updatedAt: "2026-09-15T10:00:00.000Z", stateId: "s-todo", labels: [{ id: "l1", name: "Epic" }], blocks: ["a2"], project: { id: "p1", name: "Site", description: "Le site", state: "started", startDate: "2026-12-01", targetDate: null } },
      { id: "a2", identifier: "ANT-2", number: 2, title: "Enfant", createdAt: "2026-09-14T17:00:00.000Z", stateId: "s-done", completedAt: "2026-09-15T17:05:37.602Z", parentId: "a1", assignee: { name: "Ana", email: "ANA@exemple.ch" } },
    ],
    comments: [
      { issueId: "a2", body: "Second", createdAt: "2026-09-16T10:00:00.000Z", author: { name: "Zoé", email: null } },
      { issueId: "a2", body: "Premier", createdAt: "2026-09-15T10:00:00.000Z", author: { name: "Ana", email: "ana@exemple.ch" } },
      { issueId: "inconnu", body: "Perdu", createdAt: "2026-09-15T10:00:00.000Z" },
    ],
  });

  it("écrit le projet comme l'import par clé, et réimporter ne duplique rien", () => {
    const data = teamDataFrom(file());
    if (typeof data === "string") throw new Error(data);
    const r = writeTeam(data, ana!.id, "2026-11-17");
    expect(r).toMatchObject({ projectKey: "ANT", created: true, statuses: 2, labels: 1, epics: 1, sprints: 0, issuesCreated: 2, comments: 2, links: 1 });

    const project = store.getProjectData("ANT")!;
    const [parent, child] = [1, 2].map((n) => project.issues.find((i) => i.number === n)!);
    expect(parent).toMatchObject({ title: "Parent", description: "Texte **complet**", priority: 2 });
    expect(child).toMatchObject({ parentId: parent.id, assigneeId: ana!.id });
    expect(child.completedAt).toBe("2026-09-15T17:05:37.602Z");
    expect(project.epics.map((e) => e.name)).toEqual(["Site"]);

    const again = writeTeam(data, ana!.id, "2026-11-17");
    expect(again).toMatchObject({ created: false, issuesCreated: 0, issuesKept: 2, comments: 0, links: 0 });
    expect(store.getProjectData("ANT")!.issues).toHaveLength(2);
  });

  it("refuse un fichier incomplet, avec la raison", () => {
    expect(teamDataFrom(null)).toMatch(/équipe/);
    expect(teamDataFrom({ team: { id: "t9", key: "ANT", name: "A", states: [] }, issues: [] })).toMatch(/aucun statut/);
    const twice = file();
    twice.issues.push({ ...twice.issues[0] });
    expect(teamDataFrom(twice)).toMatch(/ANT-1 apparaît deux fois/);
    const lost = file();
    lost.issues[1].stateId = "s-ailleurs";
    expect(teamDataFrom(lost)).toMatch(/ANT-2 a un statut inconnu/);
    const noNumber = file();
    (noNumber.issues[0] as Record<string, unknown>).number = "1";
    expect(teamDataFrom(noNumber)).toMatch(/numéro/);
    expect(teamDataFrom({ ...file(), issues: "x" })).toMatch(/liste des tickets/);
    const huge = file();
    huge.issues[0].number = 2 ** 53;
    expect(teamDataFrom(huge)).toMatch(/numéro valide/);
  });

  it("nettoie ce que Linear ne produit jamais : boucle de parents, dates avec décalage, doublons de dépendances", () => {
    const odd = file() as { team: unknown; issues: Record<string, unknown>[]; comments: Record<string, unknown>[] };
    odd.issues[0].parentId = "a2";
    odd.issues[0].blocks = ["a2", "a2", "a1"];
    odd.issues[0].createdAt = "2026-09-14T18:56:05+02:00";
    odd.issues[1].dueDate = "2026-02-31";
    odd.comments[0].createdAt = "2026-09-16 10:00";
    const data = teamDataFrom(odd);
    if (typeof data === "string") throw new Error(data);
    expect(data.issues.filter((i) => i.parentId)).toHaveLength(1);
    expect(data.issues[0].blocks).toEqual(["a2"]);
    expect(data.issues[0].createdAt).toBe("2026-09-14T16:56:05.000Z");
    expect(data.issues[1].dueDate).toBeNull();
    expect(data.comments.map((c) => c.body)).toEqual(["Premier"]);
    writeTeam(data, ana!.id, "2026-11-17");
    expect(store.getProjectData("ANT")!.issues.filter((i) => i.parentId)).toHaveLength(1);
  });
});
