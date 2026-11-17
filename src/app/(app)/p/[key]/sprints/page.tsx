"use client";

import { ArrowRightLeft, CalendarDays, ChevronRight, Flag, Pencil, Play, Plus, Timer, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { StatusIcon } from "@/components/icons";
import { Picker } from "@/components/picker";
import { useProjectCtx } from "@/components/project-context";
import { CloseSprintDialog, dayNumber, deleteSprint, localDay, SprintDialog } from "@/components/sprint-dialog";
import { Avatar, Button, Card } from "@/components/ui";
import { useApp } from "@/lib/store";
import type { Issue, Sprint, StatusCategory } from "@/lib/types";
import { api, cn, shortDate } from "@/lib/utils";

/** What a dragged ticket row carries: its id. */
const DRAG_TYPE = "application/x-tickup-issue";

// In a sprint, what is being worked on comes first and what is finished last.
const CATEGORY_ORDER: StatusCategory[] = ["active", "review", "todo", "backlog", "done", "canceled"];
const isClosed = (c: StatusCategory | undefined) => c === "done" || c === "canceled";

type Stats = { total: number; done: number; open: number; points: number; pointsDone: number };

/** Everything the page derives from the project, computed once per change. */
function useSprintBoard() {
  const { data } = useProjectCtx();
  return useMemo(() => {
    const status = new Map(data.statuses.map((s) => [s.id, s]));
    const categoryOf = (i: Issue) => status.get(i.statusId)?.category;
    const rank = (i: Issue) => CATEGORY_ORDER.indexOf(categoryOf(i) ?? "backlog") * 1e6 + (status.get(i.statusId)?.position ?? 0);
    // Sub-tickets count in a sprint (the server counts them too); the backlog only lists top-level tickets.
    const bySprint = new Map<string, Issue[]>();
    const backlog: Issue[] = [];
    for (const i of data.issues) {
      if (i.sprintId) bySprint.set(i.sprintId, [...(bySprint.get(i.sprintId) ?? []), i]);
      else if (!isClosed(categoryOf(i))) backlog.push(i);
    }
    for (const list of bySprint.values()) list.sort((a, b) => rank(a) - rank(b) || a.position - b.position || a.number - b.number);
    // Urgent first, no priority last, then the oldest.
    backlog.sort((a, b) => (a.priority || 9) - (b.priority || 9) || a.number - b.number);
    // Counted from the tickets on screen, so a move shows in the totals at once (same rules as the server).
    const statsOf = (sprintId: string): Stats => {
      const list = bySprint.get(sprintId) ?? [];
      const done = list.filter((i) => isClosed(categoryOf(i))).length;
      const sum = (l: Issue[]) => l.reduce((n, i) => n + (i.estimate ?? 0), 0);
      return { total: list.length, done, open: list.length - done, points: sum(list), pointsDone: sum(list.filter((i) => categoryOf(i) === "done")) };
    };
    return {
      categoryOf,
      issuesOf: (sprintId: string) => bySprint.get(sprintId) ?? [],
      statsOf,
      backlog,
      active: data.sprints.find((s) => s.state === "active") ?? null,
      planned: data.sprints.filter((s) => s.state === "planned"),
      finished: data.sprints.filter((s) => s.state === "done"),
    };
  }, [data]);
}

type Board = ReturnType<typeof useSprintBoard>;

/** Sprints: the one in progress, the ones to come, the backlog to fill them from, and the finished ones. */
export default function SprintsPage() {
  const { data } = useProjectCtx();
  const board = useSprintBoard();
  const [editing, setEditing] = useState<Sprint | "new" | null>(null);
  const [closing, setClosing] = useState(false);
  const [showFinished, setShowFinished] = useState(false);
  const { active, planned, finished, backlog } = board;
  const backlogPoints = backlog.reduce((n, i) => n + (i.estimate ?? 0), 0);

  return (
    <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-7 max-md:p-4">
      <div className="mx-auto flex max-w-[860px] flex-col gap-3">
        <div className="flex items-center gap-3">
          <p className="flex-1 text-[13px] text-ink-3">Découpe le travail en périodes courtes, avec un objectif et une date de fin.</p>
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus className="size-3.5" />
            Nouveau sprint
          </Button>
        </div>

        {!data.sprints.length ? (
          <Card className="flex flex-col items-center gap-2 py-10 text-center">
            <Timer className="size-6 text-ink-3" />
            <p className="text-[14px] font-medium">Pas encore de sprint</p>
            <p className="max-w-[400px] text-[13px] text-ink-3">Un sprint, c&apos;est une ou deux semaines pendant lesquelles l&apos;équipe s&apos;engage sur un petit lot de tickets. Tu le remplis depuis le backlog, tu le démarres, et tu vois chaque jour ce qu&apos;il reste à faire.</p>
            <Button size="sm" variant="primary" className="mt-2" onClick={() => setEditing("new")}>
              <Plus className="size-3.5" />
              Créer le premier sprint
            </Button>
          </Card>
        ) : (
          <>
            {active ? (
              <ActiveSprint sprint={active} board={board} onEdit={() => setEditing(active)} onClose={() => setClosing(true)} />
            ) : (
              <Card className="py-6 text-center text-[13px] text-ink-3">{planned.length ? "Aucun sprint en cours. Démarre le prochain quand l'équipe est prête." : "Aucun sprint en cours ni à venir. Crée le suivant pour planifier la suite."}</Card>
            )}

            {planned.length > 0 && <SectionTitle>À venir</SectionTitle>}
            {planned.map((s) => (
              <PlannedSprint key={s.id} sprint={s} board={board} onEdit={() => setEditing(s)} />
            ))}

            <SectionTitle hint="tickets ouverts sans sprint">Backlog</SectionTitle>
            <DropZone sprintId={null}>
              <Card className="flex flex-col gap-1 p-4">
                <p className="tabular text-[12px] text-ink-3">
                  {plural(backlog.length, "ticket")}
                  {backlogPoints > 0 && ` · ${plural(backlogPoints, "point")}`}
                </p>
                <IssueList issues={backlog} board={board} limit={25} empty="Le backlog est vide : tout ce qui est ouvert est déjà dans un sprint." />
              </Card>
            </DropZone>

            {finished.length > 0 && (
              <>
                <button onClick={() => setShowFinished(!showFinished)} aria-expanded={showFinished} className="press mt-3 flex items-center gap-1.5 self-start rounded-md text-[12px] font-medium uppercase tracking-wide text-ink-3 hover:text-ink">
                  <ChevronRight className={cn("size-3.5 transition-transform", showFinished && "rotate-90")} />
                  Terminés
                  <span className="tabular font-normal">{finished.length}</span>
                </button>
                {showFinished && finished.map((s) => <FinishedSprint key={s.id} sprint={s} board={board} onEdit={() => setEditing(s)} />)}
              </>
            )}
          </>
        )}
      </div>
      {editing && <SprintDialog sprint={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      {closing && active && <CloseSprintDialog sprint={active} openCount={board.statsOf(active.id).open} planned={planned} onClose={() => setClosing(false)} />}
    </div>
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? "s" : ""}`;

function SectionTitle({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <h2 className="mt-3 flex flex-wrap items-baseline gap-x-2 text-[12px] font-medium uppercase tracking-wide text-ink-3">
      {children}
      {hint && <span className="font-normal normal-case tracking-normal">{hint}</span>}
    </h2>
  );
}

/** "J-3", "dernier jour", "en retard de 2 jours": where today stands in the sprint. */
function countdown(sprint: Sprint) {
  if (!sprint.endDate) return null;
  const today = dayNumber(localDay());
  if (sprint.startDate && dayNumber(sprint.startDate) > today) {
    const wait = dayNumber(sprint.startDate) - today;
    return wait === 1 ? "commence demain" : `commence dans ${wait} jours`;
  }
  const left = dayNumber(sprint.endDate) - today;
  if (left > 0) return `J-${left}`;
  if (left === 0) return "dernier jour";
  return `en retard de ${plural(-left, "jour")}`;
}

function SprintDates({ sprint }: { sprint: Sprint }) {
  if (!sprint.startDate && !sprint.endDate) return null;
  return (
    <span className="flex items-center gap-1 whitespace-nowrap">
      <CalendarDays className="size-3.5" />
      {sprint.startDate ? shortDate(sprint.startDate) : "…"} → {sprint.endDate ? shortDate(sprint.endDate) : "…"}
    </span>
  );
}

const iconButton = "press flex size-7 shrink-0 items-center justify-center rounded-lg text-ink-3 outline-none hover:bg-ink/5 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/40";

function AddTicket({ sprint }: { sprint: Sprint }) {
  const { data } = useProjectCtx();
  const { setNewIssue } = useApp();
  return (
    <Button size="sm" variant="ghost" onClick={() => setNewIssue({ projectKey: data.project.key, sprintId: sprint.id })} aria-label={`Nouveau ticket dans ${sprint.name}`}>
      <Plus className="size-3.5" />
      Ticket
    </Button>
  );
}

function Bar({ label, done, total, unit }: { label: string; done: number; total: number; unit?: string }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      <div className="flex items-baseline gap-2 text-[12px] text-ink-3">
        <span className="flex-1">{label}</span>
        <span className="tabular text-ink">
          {done}/{total}
          {unit}
        </span>
        <span className="tabular w-9 text-right">{pct} %</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-ink/[0.08]" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
        <div className="h-full rounded-full bg-ink transition-[width] duration-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function ActiveSprint({ sprint, board, onEdit, onClose }: { sprint: Sprint; board: Board; onEdit: () => void; onClose: () => void }) {
  const issues = board.issuesOf(sprint.id);
  const stats = board.statsOf(sprint.id);
  const when = countdown(sprint);
  const late = !!sprint.endDate && dayNumber(sprint.endDate) < dayNumber(localDay());

  return (
    <DropZone sprintId={sprint.id}>
      <Card className="flex flex-col gap-4 p-5 max-md:p-4">
        <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
          <div className="min-w-0 flex-1 basis-[240px]">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-[24px] leading-none">{sprint.name}</h2>
              <span className="rounded-full bg-ink px-2 py-0.5 text-[11px] font-medium text-bg">En cours</span>
            </div>
            {sprint.goal && <p className="mt-2 whitespace-pre-line text-[13px] text-ink-2">{sprint.goal}</p>}
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-3">
              <SprintDates sprint={sprint} />
              {when && <span className={cn("tabular rounded-full px-2 py-0.5 text-[11px] font-medium", late ? "border border-ink text-ink" : "bg-ink/[0.06] text-ink-2")}>{when}</span>}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <AddTicket sprint={sprint} />
            <button onClick={onEdit} aria-label={`Modifier ${sprint.name}`} title="Modifier" className={iconButton}>
              <Pencil className="size-3.5" />
            </button>
            <Button size="sm" variant="primary" onClick={onClose} className="ml-1">
              <Flag className="size-3.5" />
              Terminer le sprint
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-x-6 gap-y-3">
          <Bar label="Tickets" done={stats.done} total={stats.total} />
          {stats.points > 0 && <Bar label="Points" done={stats.pointsDone} total={stats.points} unit=" pts" />}
        </div>

        <Burndown sprint={sprint} issues={issues} board={board} />

        <div className="border-t border-line pt-1">
          <IssueList issues={issues} board={board} limit={40} empty="Ce sprint est vide. Envoie-lui des tickets depuis le backlog, ou glisse-les ici." />
        </div>
      </Card>
    </DropZone>
  );
}

/**
 * What is left to do, day by day, against the straight line to zero. In points when the tickets are estimated, in tickets otherwise.
 * Drawn from the tickets the sprint holds today: one added on the way counts as if it had been there from the start.
 */
function Burndown({ sprint, issues, board }: { sprint: Sprint; issues: Issue[]; board: Board }) {
  if (!sprint.startDate || !sprint.endDate) return null;
  const inPoints = issues.some((i) => i.estimate);
  const weight = (i: Issue) => (inPoints ? (i.estimate ?? 0) : 1);
  const total = issues.reduce((n, i) => n + weight(i), 0);
  if (!total) return null;

  const start = dayNumber(sprint.startDate);
  const today = dayNumber(localDay());
  const length = Math.max(1, dayNumber(sprint.endDate) - start);
  // A late sprint keeps drawing after its end date.
  const span = Math.max(length, today - start);
  const now = Math.min(today - start, span);

  // The day each finished ticket was closed, counted from the start of the sprint (same rules as the totals above).
  const closedOn = issues
    .filter((i) => (inPoints ? board.categoryOf(i) === "done" : isClosed(board.categoryOf(i))))
    .map((i) => ({ day: Math.max(0, dayNumber(localDay(new Date(i.completedAt ?? i.updatedAt))) - start), weight: weight(i) }));
  const left: number[] = [];
  for (let d = 0; d <= now; d++) left.push(total - closedOn.reduce((n, c) => n + (c.day <= d ? c.weight : 0), 0));

  const W = 100;
  const H = 40;
  const x = (d: number) => (d / span) * W;
  const y = (v: number) => (1 - v / total) * H;
  const line = left.map((v, d) => `${x(d)},${y(v)}`).join(" ");
  const last = left.length ? left[left.length - 1] : total;
  const ideal = Math.max(0, Math.round(total * (1 - Math.max(0, now) / length)));
  const unit = inPoints ? "pts" : last > 1 ? "tickets" : "ticket";

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-baseline gap-x-3 text-[12px] text-ink-3">
        <span className="flex-1 whitespace-nowrap">
          Reste à faire <span className="tabular font-medium text-ink">{last} {unit}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0 w-4 border-t-[1.5px] border-ink" />
          réel
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0 w-4 border-t-[1.5px] border-dashed border-ink-3" />
          idéal
        </span>
      </div>
      <div className="relative h-24 border-b border-l border-line-strong">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible" role="img" aria-label={`Burndown : il reste ${last} ${unit} sur ${total}, la courbe idéale en prévoit ${ideal} aujourd'hui.`}>
          <line x1="0" y1={H / 2} x2={W} y2={H / 2} stroke="var(--line)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          <line x1="0" y1="0" x2={x(length)} y2={H} stroke="var(--ink-3)" strokeWidth="1.5" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
          {span > length && <line x1={x(length)} y1="0" x2={x(length)} y2={H} stroke="var(--line-strong)" strokeWidth="1" vectorEffect="non-scaling-stroke" />}
          {left.length > 1 && (
            <>
              <polygon points={`0,${H} ${line} ${x(now)},${H}`} fill="var(--ink)" opacity="0.06" />
              <polyline points={line} fill="none" stroke="var(--ink)" strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            </>
          )}
        </svg>
        {/* Today's point, in HTML so it stays round whatever the width. */}
        {left.length > 0 && <span className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink ring-2 ring-surface" style={{ left: `${x(now)}%`, top: `${(y(last) / H) * 100}%` }} />}
      </div>
      <div className="flex justify-between text-[11px] text-ink-3">
        <span>{shortDate(sprint.startDate)}</span>
        <span>{shortDate(sprint.endDate)}</span>
      </div>
    </div>
  );
}

function PlannedSprint({ sprint, board, onEdit }: { sprint: Sprint; board: Board; onEdit: () => void }) {
  const { reload } = useProjectCtx();
  const [busy, setBusy] = useState(false);
  const stats = board.statsOf(sprint.id);

  const start = async () => {
    setBusy(true);
    try {
      await api(`/api/sprints/${sprint.id}`, { method: "PATCH", json: { state: "active" } });
      await reload();
    } catch (e) {
      // 409: another sprint is already in progress.
      toast.error((e as Error).message);
    }
    setBusy(false);
  };

  const remove = async () => {
    if (await deleteSprint(sprint)) await reload();
  };

  return (
    <DropZone sprintId={sprint.id}>
      <Card className="flex flex-col gap-2 p-4">
        <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
          <div className="min-w-0 flex-1 basis-[200px]">
            <h3 className="text-[15px] font-medium leading-tight">{sprint.name}</h3>
            {sprint.goal && <p className="mt-1 line-clamp-2 text-[13px] text-ink-3">{sprint.goal}</p>}
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-3">
              <SprintDates sprint={sprint} />
              <span className="tabular">
                {plural(stats.total, "ticket")}
                {stats.points > 0 && ` · ${plural(stats.points, "point")}`}
              </span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <AddTicket sprint={sprint} />
            <button onClick={onEdit} aria-label={`Modifier ${sprint.name}`} title="Modifier" className={iconButton}>
              <Pencil className="size-3.5" />
            </button>
            <button onClick={remove} aria-label={`Supprimer ${sprint.name}`} title="Supprimer" className={iconButton}>
              <Trash2 className="size-3.5" />
            </button>
            <Button size="sm" onClick={start} disabled={busy} className="ml-1" aria-label={`Démarrer ${sprint.name}`}>
              <Play className="size-3.5" />
              Démarrer
            </Button>
          </div>
        </div>
        <div className="border-t border-line pt-1">
          <IssueList issues={board.issuesOf(sprint.id)} board={board} limit={12} empty="Encore vide. Envoie-lui des tickets depuis le backlog, ou glisse-les ici." />
        </div>
      </Card>
    </DropZone>
  );
}

function FinishedSprint({ sprint, board, onEdit }: { sprint: Sprint; board: Board; onEdit: () => void }) {
  const [open, setOpen] = useState(false);
  const stats = board.statsOf(sprint.id);
  return (
    <Card className="flex flex-col gap-1 px-4 py-3">
      <div className="flex items-center gap-2">
        <button onClick={() => setOpen(!open)} aria-expanded={open} className="press flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
          <span className="flex min-w-0 items-center gap-1.5">
            <ChevronRight className={cn("size-3.5 shrink-0 text-ink-3 transition-transform", open && "rotate-90")} />
            <span className="truncate text-[13.5px] font-medium">{sprint.name}</span>
          </span>
          <span className="flex flex-wrap items-center gap-x-3 text-[12px] text-ink-3">
            <SprintDates sprint={sprint} />
            <span className="tabular whitespace-nowrap">
              {stats.done}/{stats.total} tickets
              {stats.points > 0 && ` · ${stats.pointsDone}/${stats.points} pts`}
            </span>
          </span>
        </button>
        <button onClick={onEdit} aria-label={`Modifier ${sprint.name}`} title="Modifier" className={iconButton}>
          <Pencil className="size-3.5" />
        </button>
      </div>
      {open && (
        <div className="border-t border-line pt-1">
          <IssueList issues={board.issuesOf(sprint.id)} board={board} limit={20} locked empty="Aucun ticket dans ce sprint." />
        </div>
      )}
    </Card>
  );
}

/** A sprint card or the backlog: a ticket row dropped on it moves there (sprintId null = backlog). */
function DropZone({ sprintId, children }: { sprintId: string | null; children: React.ReactNode }) {
  const { data, updateIssue } = useProjectCtx();
  const [over, setOver] = useState(false);
  const accepts = (e: React.DragEvent) => e.dataTransfer.types.includes(DRAG_TYPE);

  return (
    <div
      onDragOver={(e) => {
        if (!accepts(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (!over) setOver(true);
      }}
      onDragLeave={(e) => {
        // Leaving for a child is not leaving.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(e) => {
        if (!accepts(e)) return;
        e.preventDefault();
        setOver(false);
        const issue = data.issues.find((i) => i.id === e.dataTransfer.getData(DRAG_TYPE));
        if (issue && issue.sprintId !== sprintId) void updateIssue(issue, { sprintId });
      }}
      className={cn("rounded-xl outline-2 outline-offset-2 transition-[outline-color]", over ? "outline-dashed outline-ink/50" : "outline-transparent")}
    >
      {children}
    </div>
  );
}

function IssueList({ issues, board, limit, empty, locked }: { issues: Issue[]; board: Board; limit: number; empty: string; locked?: boolean }) {
  const [all, setAll] = useState(false);
  if (!issues.length) return <p className="px-1 py-3 text-[13px] text-ink-3">{empty}</p>;
  const shown = all ? issues : issues.slice(0, limit);
  return (
    <div className="flex flex-col">
      {shown.map((i) => (
        <IssueRow key={i.id} issue={i} board={board} locked={locked} />
      ))}
      {issues.length > shown.length && (
        <button onClick={() => setAll(true)} className="press self-start rounded-md px-1 pt-1 text-[12.5px] text-ink-3 hover:text-ink">
          Afficher les {issues.length - shown.length} autres
        </button>
      )}
    </div>
  );
}

/** One ticket: opens on click, moves with its picker or by drag and drop. `locked` in a finished sprint: read only. */
function IssueRow({ issue, board, locked }: { issue: Issue; board: Board; locked?: boolean }) {
  const { openIssue, updateIssue } = useProjectCtx();
  const { userById } = useApp();
  const category = board.categoryOf(issue);
  const assignee = userById(issue.assigneeId);
  const targets = board.active ? [board.active, ...board.planned] : board.planned;

  return (
    // A div, not a button: Firefox does not start a drag from a button.
    <div
      role="button"
      tabIndex={0}
      draggable={!locked}
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_TYPE, issue.id);
        e.dataTransfer.setData("text/plain", issue.ref);
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={() => openIssue(issue.ref)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
        e.preventDefault();
        openIssue(issue.ref);
      }}
      className="flex h-8 cursor-pointer items-center gap-2 rounded-md px-1 text-[13px] outline-none hover:bg-ink/[0.03] focus-visible:ring-2 focus-visible:ring-accent/40"
    >
      {category && <StatusIcon category={category} />}
      <span className="w-[56px] shrink-0 truncate font-mono text-[11.5px] text-ink-3">{issue.ref}</span>
      <span className={cn("min-w-0 flex-1 truncate", isClosed(category) && "text-ink-3")}>{issue.title}</span>
      {issue.estimate != null && (
        <span className="tabular shrink-0 rounded-[5px] bg-ink/[0.06] px-1.5 text-[11px] leading-[18px] text-ink-2" title={`Estimation : ${plural(issue.estimate, "point")}`}>
          {issue.estimate}
        </span>
      )}
      {assignee ? (
        <span title={assignee.name} className="shrink-0">
          <Avatar id={assignee.id} name={assignee.name} size="xs" />
          <span className="sr-only">{assignee.name}</span>
        </span>
      ) : (
        <span className="size-5 shrink-0" />
      )}
      {!locked && targets.length > 0 && (
        <Picker
          label={`Déplacer ${issue.ref} vers un sprint ou le backlog`}
          value={issue.sprintId}
          noneLabel="Backlog"
          placeholder="Envoyer vers…"
          onChange={(v) => {
            const sprintId = (v as string | null) || null;
            if (sprintId !== issue.sprintId) void updateIssue(issue, { sprintId });
          }}
          options={targets.map((s) => ({ value: s.id, label: s.name, hint: s.state === "active" ? "en cours" : s.startDate ? shortDate(s.startDate) : undefined }))}
          align="end"
          className="shrink-0"
        >
          <span title="Déplacer vers un sprint ou le backlog" className="flex size-7 items-center justify-center rounded-md text-ink-3 hover:bg-ink/5 hover:text-ink">
            <ArrowRightLeft className="size-3.5" />
          </span>
        </Picker>
      )}
    </div>
  );
}
