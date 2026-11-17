import "server-only";
import type { EpicState, Priority, SprintState, StatusCategory } from "@/lib/types";

/**
 * The Linear side of the import: a small GraphQL client and the pure mapping from Linear's
 * vocabulary to TickUp's. Nothing here touches the database (see import.ts).
 *
 * The API key lives in the closure of `linearClient` for the time of one request: it is never
 * stored, never logged, and scrubbed from every error message.
 */

// The only address this module ever calls: the import route is not a proxy.
const LINEAR_URL = "https://api.linear.app/graphql";
const TIMEOUT_MS = 30_000;
const ISSUES_PER_PAGE = 50;
// Nested lists multiply the query cost on Linear's side: keep them short and warn when cut.
const LABELS_PER_ISSUE = 10;
const RELATIONS_PER_ISSUE = 10;
const MAX_PAGES = 2000;

export type LinearErrorCode = "auth" | "rate" | "complexity" | "timeout" | "network" | "graphql" | "http";

/** An error whose message is in French and safe to show as is. */
export class LinearError extends Error {
  constructor(
    public code: LinearErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "LinearError";
  }
}

export type LinearTeamSummary = { id: string; key: string; name: string; description: string; issueCount: number };
export type LinearState = { id: string; name: string; type: string; position: number };
export type LinearLabel = { id: string; name: string };
export type LinearCycle = { id: string; number: number; name: string | null; description: string | null; startsAt: string; endsAt: string; completedAt: string | null };
export type LinearTeam = { id: string; key: string; name: string; description: string; timezone: string; states: LinearState[]; labels: LinearLabel[]; cycles: LinearCycle[] };
export type LinearPerson = { name: string; email: string | null };
export type LinearProject = { id: string; name: string; description: string; state: string; startDate: string | null; targetDate: string | null };
export type LinearIssue = {
  id: string;
  identifier: string;
  number: number;
  title: string;
  description: string;
  priority: number;
  estimate: number | null;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  canceledAt: string | null;
  stateId: string;
  assignee: LinearPerson | null;
  parentId: string | null;
  project: LinearProject | null;
  cycleId: string | null;
  labels: LinearLabel[];
  /** Linear ids of the tickets this one blocks. */
  blocks: string[];
  /** True when the ticket has more labels or relations than one page holds. */
  truncated: boolean;
};
export type LinearComment = { issueId: string; body: string; createdAt: string; author: LinearPerson | null };

type Connection<T> = { nodes: T[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
type Fetcher = <T>(query: string, variables?: Record<string, unknown>) => Promise<T>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One GraphQL request. Throws a LinearError; the key never appears in it. */
function fetcher(apiKey: string): Fetcher {
  const scrub = (s: string) => s.split(apiKey).join("…").slice(0, 300);

  const once = async <T>(query: string, variables: Record<string, unknown>): Promise<T> => {
    let res: Response;
    try {
      res = await fetch(LINEAR_URL, {
        method: "POST",
        // Personal API keys go as is, without "Bearer".
        headers: { "Content-Type": "application/json", Authorization: apiKey },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
        redirect: "error",
      });
    } catch (e) {
      const name = (e as { name?: string })?.name;
      if (name === "TimeoutError" || name === "AbortError") throw new LinearError("timeout", "Linear met trop de temps à répondre. Réessaie dans un instant.");
      throw new LinearError("network", "Impossible de joindre Linear. Vérifie la connexion du serveur à Internet.");
    }
    // Linear answers most errors (even a wrong key or the rate limit) with JSON and an "errors" list.
    const json = (await res.json().catch(() => null)) as { data?: T; errors?: { message?: string; extensions?: { code?: string; type?: string } }[] } | null;
    const errors = Array.isArray(json?.errors) ? json.errors : [];
    const codes = errors.map((e) => `${e.extensions?.code ?? ""} ${e.extensions?.type ?? ""}`.toUpperCase()).join(" ");
    const first = typeof errors[0]?.message === "string" ? errors[0].message : "";
    if (res.status === 401 || res.status === 403 || /AUTHENTICATION|FORBIDDEN/.test(codes) || /authentication (required|failed)|not authenticated/i.test(first)) {
      throw new LinearError("auth", "Clé Linear refusée. Vérifie qu'elle est complète et toujours active.");
    }
    if (res.status === 429 || /RATELIMITED|RATE_LIMITED/.test(codes)) {
      throw new LinearError("rate", "Linear limite le nombre de requêtes pour cette clé. Attends une heure, puis relance l'import : rien n'a été importé à moitié.");
    }
    if (errors.length) {
      if (/complex/i.test(first)) throw new LinearError("complexity", "Linear a jugé la requête trop lourde.");
      throw new LinearError("graphql", `Linear a renvoyé une erreur : ${scrub(first) || "sans détail"}`);
    }
    if (!res.ok) throw new LinearError("http", `Linear a répondu avec une erreur (HTTP ${res.status}).`);
    if (!json || json.data === undefined || json.data === null) throw new LinearError("http", "Réponse de Linear illisible.");
    return json.data;
  };

  return async (query, variables = {}) => {
    try {
      return await once(query, variables);
    } catch (e) {
      // One more try for a hiccup (network, 5xx); never for a refused key or the rate limit.
      const code = (e as LinearError).code;
      const retry = code === "network" || code === "timeout" || (code === "http" && /HTTP 5\d\d/.test((e as Error).message));
      if (!retry) throw e;
      await sleep(800);
      return once(query, variables);
    }
  };
}

/** Follows a cursor to the end. */
async function all<T>(page: (after: string | null) => Promise<Connection<T>>): Promise<T[]> {
  const out: T[] = [];
  let after: string | null = null;
  for (let i = 0; i < MAX_PAGES; i++) {
    const c = await page(after);
    out.push(...(c?.nodes ?? []));
    if (!c?.pageInfo?.hasNextPage || !c.pageInfo.endCursor || c.pageInfo.endCursor === after) return out;
    after = c.pageInfo.endCursor;
  }
  // Never a silent partial import.
  throw new LinearError("graphql", "Trop de pages à lire dans Linear : import interrompu, rien n'a été importé à moitié.");
}

const TEAMS_QUERY = `query Teams($after: String) {
  teams(first: 50, after: $after) {
    nodes { id key name description issueCount }
    pageInfo { hasNextPage endCursor }
  }
}`;

const TEAM_QUERY = `query Team($id: String!) {
  team(id: $id) {
    id key name description timezone
    states(first: 100) { nodes { id name type position } }
    cycles(first: 250) { nodes { id number name description startsAt endsAt completedAt } }
  }
}`;

const TEAM_LABELS_QUERY = `query TeamLabels($id: String!, $after: String) {
  team(id: $id) {
    labels(first: 100, after: $after) {
      nodes { id name }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

const issuesQuery = (first: number) => `query Issues($teamId: ID!, $after: String, $archived: Boolean) {
  issues(first: ${first}, after: $after, includeArchived: $archived, filter: { team: { id: { eq: $teamId } } }) {
    nodes {
      id identifier number title description priority estimate dueDate
      createdAt updatedAt completedAt canceledAt trashed
      state { id }
      assignee { name email }
      parent { id }
      project { id name description startDate targetDate status { type } }
      cycle { id }
      labels(first: ${LABELS_PER_ISSUE}) { nodes { id name } pageInfo { hasNextPage } }
      relations(first: ${RELATIONS_PER_ISSUE}) { nodes { type relatedIssue { id } } pageInfo { hasNextPage } }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

const COMMENTS_QUERY = `query Comments($teamId: ID!, $after: String, $archived: Boolean) {
  comments(first: 100, after: $after, includeArchived: $archived, filter: { issue: { team: { id: { eq: $teamId } } } }) {
    nodes { body createdAt issue { id } user { name email } externalUser { name email } botActor { name } }
    pageInfo { hasNextPage endCursor }
  }
}`;

type RawIssue = {
  id: string;
  identifier: string;
  number: number;
  title: string;
  description: string | null;
  priority: number;
  estimate: number | null;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  canceledAt: string | null;
  trashed: boolean | null;
  state: { id: string } | null;
  assignee: { name: string; email: string | null } | null;
  parent: { id: string } | null;
  project: { id: string; name: string; description: string | null; startDate: string | null; targetDate: string | null; status: { type: string } | null } | null;
  cycle: { id: string } | null;
  labels: { nodes: LinearLabel[]; pageInfo?: { hasNextPage: boolean } } | null;
  relations: { nodes: { type: string; relatedIssue: { id: string } | null }[]; pageInfo?: { hasNextPage: boolean } } | null;
};

const toIssue = (r: RawIssue): LinearIssue => ({
  id: r.id,
  identifier: r.identifier,
  number: r.number,
  title: r.title ?? "",
  description: r.description ?? "",
  priority: r.priority,
  estimate: r.estimate ?? null,
  dueDate: r.dueDate ?? null,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt ?? r.createdAt,
  completedAt: r.completedAt ?? null,
  canceledAt: r.canceledAt ?? null,
  stateId: r.state?.id ?? "",
  assignee: r.assignee ? { name: r.assignee.name, email: r.assignee.email ?? null } : null,
  parentId: r.parent?.id ?? null,
  project: r.project ? { id: r.project.id, name: r.project.name, description: r.project.description ?? "", state: r.project.status?.type ?? "planned", startDate: r.project.startDate ?? null, targetDate: r.project.targetDate ?? null } : null,
  cycleId: r.cycle?.id ?? null,
  labels: r.labels?.nodes ?? [],
  blocks: (r.relations?.nodes ?? []).filter((n) => n.type === "blocks" && n.relatedIssue).map((n) => n.relatedIssue!.id),
  truncated: !!r.labels?.pageInfo?.hasNextPage || !!r.relations?.pageInfo?.hasNextPage,
});

type RawComment = { body: string; createdAt: string; issue: { id: string } | null; user: { name: string; email: string | null } | null; externalUser: { name: string; email: string | null } | null; botActor: { name: string | null } | null };

export function linearClient(apiKey: string) {
  const gql = fetcher(apiKey);
  return {
    teams: async (): Promise<LinearTeamSummary[]> => {
      const nodes = await all(async (after) => (await gql<{ teams: Connection<LinearTeamSummary> }>(TEAMS_QUERY, { after })).teams);
      return nodes.map((t) => ({ id: t.id, key: t.key, name: t.name, description: t.description ?? "", issueCount: t.issueCount ?? 0 }));
    },

    team: async (id: string): Promise<LinearTeam> => {
      type Raw = Omit<LinearTeam, "states" | "labels" | "cycles" | "description"> & { description: string | null; states: { nodes: LinearState[] }; cycles: { nodes: LinearCycle[] } };
      const { team } = await gql<{ team: Raw }>(TEAM_QUERY, { id });
      const labels = await all(async (after) => (await gql<{ team: { labels: Connection<LinearLabel> } }>(TEAM_LABELS_QUERY, { id, after })).team.labels);
      return { id: team.id, key: team.key, name: team.name, description: team.description ?? "", timezone: team.timezone, states: team.states?.nodes ?? [], labels, cycles: team.cycles?.nodes ?? [] };
    },

    /** Every ticket of a team. `archived` also brings the ones Linear archived (never the trash). */
    issues: async (teamId: string, archived = false): Promise<LinearIssue[]> => {
      // If Linear finds the page too heavy, start again with smaller pages.
      for (let size = ISSUES_PER_PAGE; ; size = Math.floor(size / 2)) {
        try {
          const nodes = await all(async (after) => (await gql<{ issues: Connection<RawIssue> }>(issuesQuery(size), { teamId, after, archived })).issues);
          return nodes.filter((n) => !n.trashed).map(toIssue);
        } catch (e) {
          if ((e as LinearError).code !== "complexity" || size <= 10) throw e;
        }
      }
    },

    comments: async (teamId: string, archived = false): Promise<LinearComment[]> => {
      const nodes = await all(async (after) => (await gql<{ comments: Connection<RawComment> }>(COMMENTS_QUERY, { teamId, after, archived })).comments);
      return nodes
        .filter((c) => c.issue && typeof c.body === "string" && c.body.trim())
        .map((c) => {
          const who = c.user ?? c.externalUser;
          const author = who ? { name: who.name, email: who.email ?? null } : c.botActor?.name ? { name: c.botActor.name, email: null } : null;
          return { issueId: c.issue!.id, body: c.body, createdAt: c.createdAt, author };
        });
    },
  };
}

export type LinearClient = ReturnType<typeof linearClient>;

// ---- Mapping (pure)

const STATE_ORDER = ["triage", "backlog", "unstarted", "started", "completed", "canceled", "duplicate"];
const LOOKS_LIKE_REVIEW = /review|revue|relecture|\bqa\b|valid/i;

/** A Linear workflow state → a TickUp category. Null for a type we do not know. */
export function categoryForState(type: string, name: string): StatusCategory | null {
  switch (type) {
    case "triage":
    case "backlog":
      return "backlog";
    case "unstarted":
      return "todo";
    case "started":
      return LOOKS_LIKE_REVIEW.test(name) ? "review" : "active";
    case "completed":
      return "done";
    case "canceled":
    case "duplicate":
      return "canceled";
    default:
      return null;
  }
}

/** The states in the order Linear shows them: by type, then by position inside the type. */
export function orderStates(states: LinearState[]): LinearState[] {
  const rank = (t: string) => (STATE_ORDER.includes(t) ? STATE_ORDER.indexOf(t) : STATE_ORDER.length);
  return [...states].sort((a, b) => rank(a.type) - rank(b.type) || a.position - b.position);
}

export function epicStateFor(state: string): EpicState {
  if (state === "started" || state === "paused") return "active";
  if (state === "completed") return "done";
  if (state === "canceled") return "canceled";
  return "planned";
}

/** Same numbers on both sides: 0 none, 1 urgent, 2 high, 3 medium, 4 low. */
export const priorityFor = (p: unknown): Priority => (p === 1 || p === 2 || p === 3 || p === 4 ? p : 0);

/** "2026-11-17" from a Linear date field, or null. */
export const dayOf = (value: string | null | undefined) => (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null);

/** The calendar day of an instant in a timezone ("Europe/Zurich"); UTC when the zone is unknown. */
export function dayInZone(iso: string, timeZone: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    // en-CA formats as YYYY-MM-DD.
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

export type MappedSprint = { cycle: LinearCycle; name: string; startDate: string | null; endDate: string | null; state: SprintState };

/**
 * Cycles → sprints. A cycle ends at the instant the next one starts, so its last day is the day
 * before. Finished or past → done; the one running today → active (one at most); the rest → planned.
 */
export function mapCycles(cycles: LinearCycle[], timeZone: string, today: string): MappedSprint[] {
  let active = false;
  return [...cycles]
    .sort((a, b) => a.number - b.number)
    .map((cycle) => {
      const startDate = dayInZone(cycle.startsAt, timeZone);
      const end = new Date(cycle.endsAt).getTime();
      const endDate = Number.isNaN(end) ? null : dayInZone(new Date(end - 1000).toISOString(), timeZone);
      let state: SprintState = "planned";
      if (cycle.completedAt || (endDate && endDate < today)) state = "done";
      else if (!active && startDate && startDate <= today) {
        state = "active";
        active = true;
      }
      return { cycle, name: cycle.name?.trim() || `Cycle ${cycle.number}`, startDate, endDate, state };
    });
}

/** A Linear team key made valid for TickUp (2 to 6 letters or digits, a letter first). "" when hopeless. */
export function cleanKey(key: string): string {
  const k = key
    .normalize("NFD")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/^[0-9]+/, "")
    .slice(0, 6);
  return k.length >= 2 ? k : "";
}
