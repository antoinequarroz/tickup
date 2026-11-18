export type Role = "admin" | "member";

/** `agent`: an AI agent (Claude, Alfred…) that works through the MCP server or the API with its own key. */
export type User = { id: string; name: string; email: string; role: Role; createdAt: string; agent: boolean;
  /** Also wants notifications by e-mail (off by default). */
  notifyEmail: boolean;
};

/** An agent's key, as Réglages shows it (never the key itself). */
export type ApiToken = { id: string; name: string; prefix: string; userId: string; source: "manual" | "oauth"; createdAt: string; lastUsedAt: string | null };

/** The kind of project, chosen at creation: it sets the first statuses, types and labels. */
export type TemplateId = "general" | "media" | "software";

/** What a status means, whatever its name: drives the icons, the progress and "done". */
export type StatusCategory = "backlog" | "todo" | "active" | "review" | "done" | "canceled";

export type Status = { id: string; projectId: string; name: string; category: StatusCategory; position: number };

/** Black and white app: a label is told apart by its tone (0 = light grey … 4 = black) and its name. */
export type Label = { id: string; projectId: string; name: string; tone: number };

export type IssueType = { id: string; projectId: string; name: string; icon: string; position: number };

export type Project = {
  id: string;
  /** Short uppercase key, used in ticket ids: WEB-12. */
  key: string;
  name: string;
  description: string;
  template: TemplateId;
  leadId: string | null;
  archived: boolean;
  createdAt: string;
  /** Counters, for the project list. */
  issueCount: number;
  doneCount: number;
};

export type EpicState = "planned" | "active" | "done" | "canceled";

export type Epic = {
  id: string;
  projectId: string;
  name: string;
  description: string;
  state: EpicState;
  startDate: string | null;
  targetDate: string | null;
  createdAt: string;
  issueCount: number;
  doneCount: number;
};

/** 0 none, 1 urgent, 2 high, 3 medium, 4 low (same order as Linear, so an import keeps it). */
export type Priority = 0 | 1 | 2 | 3 | 4;

export type Issue = {
  id: string;
  projectId: string;
  number: number;
  /** "WEB-12" */
  ref: string;
  title: string;
  description: string;
  statusId: string;
  typeId: string | null;
  priority: Priority;
  assigneeId: string | null;
  epicId: string | null;
  /** Sub-ticket of this ticket. */
  parentId: string | null;
  estimate: number | null;
  dueDate: string | null;
  /** When work is planned to start: with dueDate, the bar of the ticket on the Gantt. */
  startDate: string | null;
  sprintId: string | null;
  /** Ids of the tickets that must be finished before this one. */
  blockedBy: string[];
  /** Ids of the tickets waiting on this one. */
  blocks: string[];
  /** Order inside a kanban column. */
  position: number;
  labelIds: string[];
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  /** Sub-tickets, counted. */
  subCount: number;
  subDone: number;
};

/** `editedAt`: when its author last corrected it, null if never. */
export type Comment = { id: string; issueId: string; userId: string | null; body: string; createdAt: string; editedAt: string | null };

export type SprintState = "planned" | "active" | "done";

export type Sprint = {
  id: string;
  projectId: string;
  name: string;
  goal: string;
  startDate: string | null;
  endDate: string | null;
  state: SprintState;
  createdAt: string;
  issueCount: number;
  doneCount: number;
  /** Sum of the estimates of its tickets, and of the finished ones. */
  points: number;
  pointsDone: number;
};

export type ProjectData = {
  project: Project;
  statuses: Status[];
  labels: Label[];
  types: IssueType[];
  epics: Epic[];
  sprints: Sprint[];
  issues: Issue[];
};

/** One project on the roadmap, with what has dates: its epics and its sprints. */
export type RoadmapProject = { project: Project; epics: Epic[]; sprints: Sprint[] };

export type ModuleStatus = "core" | "linked" | "soon";

export type ModuleInfo = {
  id: string;
  name: string;
  role: string;
  description: string;
  icon: string;
  status: ModuleStatus;
  href?: string;
  url?: string;
};

/** Which links to the rest of the suite are configured (never the secrets themselves). */
export type Integrations = { apiToken: boolean; webhook: boolean; github: boolean; compte: boolean; email: boolean };

/** A pull request, a commit or a branch on GitHub that names a ticket (WEB-12). */
export type GithubLink = {
  id: string;
  issueId: string;
  kind: "pr" | "commit" | "branch";
  /** "owner/name" */
  repo: string;
  /** PR number, short commit sha, or branch name. */
  ref: string;
  title: string;
  url: string;
  /** For a PR: "open" | "draft" | "merged" | "closed". Empty otherwise. */
  state: string;
  author: string;
  updatedAt: string;
};

export type AppState = { me: User; users: User[]; projects: Project[]; modules: ModuleInfo[]; integrations: Integrations; unreadNotifications: number };

export type NotificationKind = "assigned" | "mentioned" | "status" | "due";

/** Something that concerns me, in the bell. */
export type Notification = {
  id: string;
  kind: NotificationKind;
  issue: { id: string; ref: string; title: string; projectKey: string };
  actor: { id: string; name: string } | null;
  /** status: { from, to } status names. mentioned: { excerpt }. due: { dueDate }. */
  data: Record<string, string>;
  createdAt: string;
  readAt: string | null;
};

/** What the server pushes over /api/events. Views reload what they show when it concerns them. */
export type ServerEvent = { type: "project"; projectId: string } | { type: "issue"; projectId: string; issueId: string } | { type: "refresh" } | { type: "notifications" };
