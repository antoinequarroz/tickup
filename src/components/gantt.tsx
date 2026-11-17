"use client";

import { ChevronRight, Plus, TriangleAlert, X } from "lucide-react";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Progress, StatusIcon } from "@/components/icons";
import { useProjectCtx } from "@/components/project-context";
import { Button } from "@/components/ui";
import { arrowMiddle, arrowPath, barGeometry, dateOfDay, dayAtX, dayNumber, dragDates, ganttRange, isConflict, isWeekend, localDate, monthSegments, orderTree, spanOf, weekdayOf, weekSegments, type DragMode, type GanttRange, type Span } from "@/lib/gantt";
import { useApp } from "@/lib/store";
import type { Epic, Issue, Sprint, StatusCategory } from "@/lib/types";
import { api, cn, shortDate } from "@/lib/utils";

const ROW_H = 34;
const BAR_H = 18;
const SCALES = [
  { id: "week", label: "Semaine", dayW: 40 },
  { id: "month", label: "Mois", dayW: 18 },
  { id: "quarter", label: "Trimestre", dayW: 6 },
] as const;
type ScaleId = (typeof SCALES)[number]["id"];

const MONTHS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
const MONTHS_SHORT = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const WEEKDAYS = ["L", "M", "M", "J", "V", "S", "D"];

const isClosed = (c: StatusCategory) => c === "done" || c === "canceled";

type Row =
  | { kind: "group"; key: string; epic: Epic | null; total: number; done: number; open: boolean; span: Span | null }
  | { kind: "issue"; key: string; issue: Issue; depth: number; span: Span | null; category: StatusCategory };

/** Where a bar sits in the grid: left, width, and the middle of its row. */
type Box = { x: number; w: number; y: number };

type Link = { key: string; blocker: Issue; blocked: Issue; x1: number; y1: number; x2: number; y2: number; conflict: boolean; faded: boolean };

type Draft = { x1: number; y1: number; x2: number; y2: number; target: { x: number; y: number; w: number; h: number } | null };

type LinkApi = { move: (fromId: string, cx: number, cy: number) => void; end: (fromId: string, cx: number, cy: number) => void; cancel: () => void };

/** The box of a span: a due date alone is a diamond centred on its day, a very short bar keeps a width one can grab. */
function boxOf(span: Span, rangeStart: number, dayW: number): { x: number; w: number } {
  const g = barGeometry(span, rangeStart, dayW);
  if (span.kind === "due") return { x: g.x + g.width / 2 - 7, w: 14 };
  return { x: g.x + 1, w: Math.max(g.width - 2, 8) };
}

/** Black and white bars: the status category gives the fill, a late ticket is hatched. */
function barLook(category: StatusCategory, overdue: boolean): { className: string; style?: React.CSSProperties } {
  const filled = category === "active" || category === "review";
  const className = cn(
    "border",
    category === "done" && "border-transparent bg-ink opacity-35",
    filled && "border-ink bg-ink",
    category === "todo" && "border-ink bg-surface",
    category === "backlog" && "border-ink-3 bg-surface",
    category === "canceled" && "border-dashed border-ink-3 opacity-60",
    overdue && "border-2 border-ink",
  );
  if (!overdue) return { className };
  return { className, style: { backgroundImage: filled ? "repeating-linear-gradient(135deg, transparent 0 3px, var(--surface) 3px 5px)" : "repeating-linear-gradient(135deg, var(--ink) 0 1.5px, transparent 1.5px 5px)" } };
}

/**
 * Planning: the tickets of the project on a time grid, grouped by epic, with their dependencies.
 * Sub-tickets sit under their parent, one level deeper (when both are in the same epic).
 */
export function Gantt() {
  const { data } = useProjectCtx();
  const { setNewIssue } = useApp();
  if (!data.issues.length && !data.epics.length)
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="font-display text-[24px]">Rien à planifier pour l&apos;instant</p>
        <p className="max-w-[360px] text-[13px] text-ink-3">Crée un ticket, puis donne-lui un « Début » et une « Échéance » : il apparaîtra ici sous forme de barre.</p>
        <Button variant="primary" onClick={() => setNewIssue({ projectKey: data.project.key })}>
          <Plus className="size-4" />
          Nouveau ticket
        </Button>
      </div>
    );
  return <Chart />;
}

function Chart() {
  const { data, reload, updateIssue, openIssue } = useProjectCtx();
  const [scale, setScale] = useState<ScaleId>("month");
  const [hideDone, setHideDone] = useState(false);
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [today] = useState(() => localDate());
  const todayDay = dayNumber(today);
  const dayW = SCALES.find((s) => s.id === scale)!.dayW;

  const scroller = useRef<HTMLDivElement>(null);
  const corner = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);

  const range = useMemo(
    () =>
      ganttRange(
        [...data.issues.flatMap((i) => [i.startDate, i.dueDate]), ...data.epics.flatMap((e) => [e.startDate, e.targetDate]), ...data.sprints.flatMap((s) => [s.startDate, s.endDate])],
        today,
      ),
    [data.issues, data.epics, data.sprints, today],
  );

  const categories = useMemo(() => new Map(data.statuses.map((s) => [s.id, s.category])), [data.statuses]);

  // Rows: one header per epic, then its tickets, and a last group for the tickets without epic.
  const rows = useMemo(() => {
    const cat = (i: Issue) => categories.get(i.statusId) ?? "todo";
    const epicIds = new Set(data.epics.map((e) => e.id));
    const byGroup = new Map<string, Issue[]>();
    for (const i of data.issues) {
      const key = i.epicId && epicIds.has(i.epicId) ? i.epicId : "none";
      const list = byGroup.get(key);
      if (list) list.push(i);
      else byGroup.set(key, [i]);
    }
    const out: Row[] = [];
    for (const epic of [...data.epics, null]) {
      const key = epic?.id ?? "none";
      const all = byGroup.get(key) ?? [];
      if (!epic && !all.length) continue;
      const open = !closed.has(key);
      // Same count as the Epics tab and the roadmap: top-level tickets, done or canceled.
      const top = all.filter((i) => !i.parentId);
      out.push({ kind: "group", key, epic, total: epic ? epic.issueCount : top.length, done: epic ? epic.doneCount : top.filter((i) => isClosed(cat(i))).length, open, span: epic ? spanOf(epic.startDate, epic.targetDate) : null });
      if (!open) continue;
      for (const { issue, depth } of orderTree(hideDone ? all.filter((i) => !isClosed(cat(i))) : all)) out.push({ kind: "issue", key: issue.id, issue, depth, span: spanOf(issue.startDate, issue.dueDate), category: cat(issue) });
    }
    return out;
  }, [data.issues, data.epics, categories, closed, hideDone]);

  // Where each visible bar is, for the arrows.
  const boxes = useMemo(() => {
    const map = new Map<string, Box>();
    rows.forEach((r, index) => {
      if (r.kind === "issue" && r.span) map.set(r.issue.id, { ...boxOf(r.span, range.start, dayW), y: index * ROW_H + ROW_H / 2 });
    });
    return map;
  }, [rows, range.start, dayW]);

  const { links, warnings } = useMemo(() => {
    const byId = new Map(data.issues.map((i) => [i.id, i]));
    const cat = (i: Issue) => categories.get(i.statusId) ?? "todo";
    const links: Link[] = [];
    const warnings = new Map<string, string>();
    for (const r of rows) {
      if (r.kind !== "issue" || !r.span || !r.issue.blockedBy.length) continue;
      const late: string[] = [];
      for (const id of r.issue.blockedBy) {
        const blocker = byId.get(id);
        if (!blocker) continue;
        // A blocker that is already finished no longer holds anything back.
        const conflict = !isClosed(cat(blocker)) && !isClosed(r.category) && isConflict(spanOf(blocker.startDate, blocker.dueDate), r.span);
        if (conflict) late.push(blocker.ref);
        const from = boxes.get(id);
        const to = boxes.get(r.issue.id);
        if (from && to) links.push({ key: `${id}>${r.issue.id}`, blocker, blocked: r.issue, x1: from.x + from.w, y1: from.y, x2: to.x, y2: to.y, conflict, faded: cat(blocker) === "done" && r.category === "done" });
      }
      if (late.length) warnings.set(r.issue.id, `Commence avant la fin de ${late.join(", ")}`);
    }
    return { links, warnings };
  }, [rows, boxes, data.issues, categories]);

  const hasDates = data.issues.some((i) => i.startDate || i.dueDate) || data.epics.some((e) => e.startDate || e.targetDate);
  const sprints = useMemo(() => data.sprints.filter((s) => s.startDate && s.endDate && s.endDate >= s.startDate), [data.sprints]);

  // Scroll: today in view on load, the same days in view after a change of scale, and no jump when the range grows to the left.
  const anchor = useRef<{ start: number; dayW: number } | null>(null);
  const keepDay = useRef<number | null>(null);
  const viewWidth = () => (scroller.current?.clientWidth ?? 0) - (corner.current?.offsetWidth ?? 0);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const prev = anchor.current;
    if (!prev) el.scrollLeft = (todayDay - range.start) * dayW - viewWidth() / 3;
    else if (keepDay.current !== null) el.scrollLeft = (keepDay.current - range.start) * dayW - viewWidth() / 2;
    else if (prev.start !== range.start) el.scrollLeft += (prev.start - range.start) * dayW;
    keepDay.current = null;
    anchor.current = { start: range.start, dayW };
  }, [range.start, dayW, todayDay]);

  const changeScale = (id: ScaleId) => {
    if (id === scale) return;
    if (scroller.current) keepDay.current = range.start + (scroller.current.scrollLeft + viewWidth() / 2) / dayW;
    setScale(id);
  };
  const goToday = () => scroller.current?.scrollTo({ left: (todayDay - range.start) * dayW - viewWidth() / 3, behavior: "smooth" });

  const toggle = useCallback((key: string) => setClosed((s) => (s.has(key) ? new Set([...s].filter((x) => x !== key)) : new Set([...s, key]))), []);

  const commit = useCallback((issue: Issue, patch: { startDate: string | null; dueDate: string | null }) => void updateIssue(issue, patch), [updateIssue]);
  const plan = useCallback((issue: Issue, from: number, to: number) => void updateIssue(issue, { startDate: dateOfDay(Math.min(from, to)), dueDate: dateOfDay(Math.max(from, to)) }), [updateIssue]);
  const open = useCallback((ref: string) => openIssue(ref), [openIssue]);

  // Dependencies drawn by hand: from the handle of a bar onto another bar.
  const boxesRef = useRef(boxes);
  const issuesRef = useRef(data.issues);
  useEffect(() => {
    boxesRef.current = boxes;
    issuesRef.current = data.issues;
  }, [boxes, data.issues]);
  const setDraft = useRef<(d: Draft | null) => void>(() => {});

  const linkApi = useMemo<LinkApi>(() => {
    const targetAt = (cx: number, cy: number, fromId: string) => {
      const el = document.elementFromPoint(cx, cy)?.closest<HTMLElement>("[data-bar-id]");
      return el && el.dataset.barId !== fromId ? el : null;
    };
    return {
      move(fromId, cx, cy) {
        const from = boxesRef.current.get(fromId);
        if (!grid.current || !from) return;
        const g = grid.current.getBoundingClientRect();
        const t = targetAt(cx, cy, fromId)?.getBoundingClientRect();
        setDraft.current({ x1: from.x + from.w, y1: from.y, x2: cx - g.left, y2: cy - g.top, target: t ? { x: t.left - g.left, y: t.top - g.top, w: t.width, h: t.height } : null });
      },
      async end(fromId, cx, cy) {
        setDraft.current(null);
        const toId = targetAt(cx, cy, fromId)?.dataset.barId;
        if (!toId) return;
        if (issuesRef.current.find((i) => i.id === fromId)?.blocks.includes(toId)) return;
        try {
          await api(`/api/issues/${fromId}/links`, { method: "POST", json: { blocks: toId } });
          await reload();
        } catch (e) {
          toast.error((e as Error).message);
        }
      },
      cancel: () => setDraft.current(null),
    };
  }, [reload]);

  const selectedLink = links.find((l) => l.key === selected) ?? null;
  const removeLink = useCallback(
    async (link: Link) => {
      setSelected(null);
      try {
        await api(`/api/issues/${link.blocked.id}/links`, { method: "DELETE", json: { blockedBy: link.blocker.id } });
        await reload();
      } catch (e) {
        toast.error((e as Error).message);
      }
    },
    [reload],
  );

  // Delete removes the selected arrow, Escape lets it go.
  useEffect(() => {
    if (!selectedLink) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest?.("input, textarea, select, [contenteditable=true]")) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        void removeLink(selectedLink);
      } else if (e.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedLink, removeLink]);

  const gridW = range.days * dayW;
  const gridH = rows.length * ROW_H;
  const week = 7 * dayW;
  const weekend = "color-mix(in oklab, var(--ink) 3.5%, transparent)";
  const months = useMemo(() => monthSegments(range), [range]);
  const middle = selectedLink && arrowMiddle(selectedLink.x1, selectedLink.y1, selectedLink.x2 - 6, selectedLink.y2, ROW_H);

  return (
    <div className="flex min-h-0 flex-1 flex-col [--gl:260px] max-md:[--gl:132px]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-5 py-2 max-md:px-3">
        <div role="group" aria-label="Échelle du planning" className="flex rounded-lg border border-line-strong bg-surface p-0.5">
          {SCALES.map((s) => (
            <button key={s.id} onClick={() => changeScale(s.id)} aria-pressed={scale === s.id} className={cn("press h-6 rounded-md px-2.5 text-[12.5px] font-medium", scale === s.id ? "bg-ink text-bg" : "text-ink-2 hover:text-ink")}>
              {s.label}
            </button>
          ))}
        </div>
        <Button size="sm" onClick={goToday}>
          Aujourd&apos;hui
        </Button>
        <label className="flex cursor-pointer select-none items-center gap-1.5 text-[12.5px] text-ink-2">
          <input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} className="size-3.5 accent-[var(--ink)]" />
          Masquer les terminés
        </label>
        <div className="ml-auto flex items-center gap-3 text-[11.5px] text-ink-3 max-lg:hidden" aria-hidden>
          {(
            [
              ["À faire", "todo", false],
              ["En cours", "active", false],
              ["Terminé", "done", false],
              ["En retard", "todo", true],
            ] as const
          ).map(([label, category, overdue]) => {
            const look = barLook(category, overdue);
            return (
              <span key={label} className="flex items-center gap-1.5">
                <span className={cn("h-[10px] w-5 rounded-[3px]", look.className)} style={look.style} />
                {label}
              </span>
            );
          })}
        </div>
      </div>

      {!hasDates && (
        <div className="border-b border-line bg-surface-2 px-5 py-2.5 text-[13px] text-ink-2 max-md:px-3">
          <span className="font-medium text-ink">Aucune date pour l&apos;instant.</span> Ouvre un ticket et renseigne « Début » et « Échéance », ou clique directement dans la grille, sur la ligne d&apos;un ticket, au jour voulu.
        </div>
      )}

      <div ref={scroller} className="scroll-thin min-h-0 flex-1 overflow-auto overscroll-x-contain bg-surface">
        <div className="relative" style={{ width: `calc(var(--gl) + ${gridW}px)` }}>
          <div className="sticky top-0 z-30 flex border-b border-line-strong bg-surface-2">
            <div ref={corner} className="sticky left-0 z-10 flex w-[var(--gl)] shrink-0 items-end border-r border-line-strong bg-surface-2 px-3 pb-1.5 text-[11.5px] font-medium text-ink-3">
              Tickets
            </div>
            <Header range={range} months={months} scale={scale} dayW={dayW} todayDay={todayDay} sprints={sprints} />
          </div>

          <div className="flex">
            <LeftColumn rows={rows} onToggle={toggle} onOpen={open} />

            <div ref={grid} role="presentation" onClick={() => setSelected(null)} className="relative z-0 shrink-0 select-none overflow-hidden" style={{ width: gridW, height: gridH }}>
              {/* Weekends, week lines and row lines are painted, not built from elements. */}
              <div
                className="pointer-events-none absolute inset-0"
                style={{
                  backgroundImage: `linear-gradient(90deg, var(--line) 1px, transparent 1px), linear-gradient(90deg, transparent ${5 * dayW}px, ${weekend} ${5 * dayW}px), linear-gradient(180deg, transparent ${ROW_H - 1}px, var(--line) ${ROW_H - 1}px)`,
                  backgroundSize: `${scale === "week" ? dayW : week}px 100%, ${week}px 100%, 100% ${ROW_H}px`,
                }}
              />
              {months.map((m) => m.offset > 0 && <div key={m.key} className="pointer-events-none absolute inset-y-0 w-px bg-line-strong" style={{ left: m.offset * dayW }} />)}
              {sprints.map((s) => {
                const g = barGeometry({ start: dayNumber(s.startDate!), end: dayNumber(s.endDate!) }, range.start, dayW);
                return <div key={s.id} className={cn("pointer-events-none absolute inset-y-0 border-x border-dashed border-line-strong", s.state === "active" ? "bg-ink/[0.045]" : "bg-ink/[0.02]")} style={{ left: g.x, width: g.width }} />;
              })}
              {rows.map((r, index) =>
                r.kind === "group" ? (
                  <div key={r.key} className="absolute inset-x-0 bg-ink/[0.035]" style={{ top: index * ROW_H, height: ROW_H - 1 }}>
                    {r.span && r.epic && <EpicBar epic={r.epic} span={r.span} done={r.done} total={r.total} rangeStart={range.start} dayW={dayW} />}
                  </div>
                ) : !r.span ? (
                  <PlanRow key={r.key} issue={r.issue} top={index * ROW_H} rangeStart={range.start} dayW={dayW} todayDay={todayDay} onPlan={plan} />
                ) : null,
              )}
              <div className="pointer-events-none absolute inset-y-0 w-px bg-ink/60" style={{ left: (todayDay - range.start + 0.5) * dayW }} />

              <Arrows links={links} width={gridW} height={gridH} selected={selected} onSelect={setSelected} />

              {rows.map(
                (r, index) =>
                  r.kind === "issue" &&
                  r.span && (
                    <Bar
                      key={r.key}
                      issue={r.issue}
                      category={r.category}
                      top={index * ROW_H}
                      rangeStart={range.start}
                      dayW={dayW}
                      overdue={!isClosed(r.category) && !!r.issue.dueDate && r.issue.dueDate < today}
                      warning={warnings.get(r.issue.id) ?? null}
                      scroller={scroller}
                      onOpen={open}
                      onCommit={commit}
                      link={linkApi}
                    />
                  ),
              )}

              <LinkDraft register={setDraft} width={gridW} height={gridH} />

              {selectedLink && middle && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    void removeLink(selectedLink);
                  }}
                  aria-label={`Retirer la dépendance entre ${selectedLink.blocker.ref} et ${selectedLink.blocked.ref}`}
                  className="press absolute z-20 flex h-6 -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-md border border-line-strong bg-surface px-1.5 text-[11.5px] font-medium shadow-card hover:bg-surface-2"
                  style={{ left: Math.max(middle.x, 36), top: middle.y }}
                >
                  <X className="size-3" />
                  Retirer
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Months, then days (or weeks at the widest scale), then the sprints. */
const Header = memo(function Header({ range, months, scale, dayW, todayDay, sprints }: { range: GanttRange; months: ReturnType<typeof monthSegments>; scale: ScaleId; dayW: number; todayDay: number; sprints: Sprint[] }) {
  const days = useMemo(() => Array.from({ length: range.days }, (_, i) => range.start + i), [range]);
  const weeks = useMemo(() => weekSegments(range), [range]);
  return (
    <div className="relative shrink-0" style={{ width: range.days * dayW }}>
      <div className="relative h-[26px]">
        {months.map((m) => {
          const width = m.days * dayW;
          return (
            <div key={m.key} className={cn("absolute inset-y-0 flex items-center", m.offset > 0 && "border-l border-line-strong")} style={{ left: m.offset * dayW, width }}>
              {width >= 44 && <span className="sticky left-[calc(var(--gl)+10px)] px-2.5 text-[12px] font-medium whitespace-nowrap">{width >= 120 ? `${MONTHS[m.month - 1]} ${m.year}` : MONTHS_SHORT[m.month - 1]}</span>}
            </div>
          );
        })}
      </div>
      <div className="flex h-[22px] text-[10.5px] text-ink-3 tabular">
        {scale === "quarter"
          ? weeks.map((w) => (
              <div key={w.monday} className={cn("flex shrink-0 items-center justify-center border-l border-line", todayDay >= w.monday && todayDay < w.monday + 7 && "font-semibold text-ink")} style={{ width: w.days * dayW }} title={`Semaine ${w.week}, dès le ${shortDate(dateOfDay(w.monday))}`}>
                {w.days === 7 && `S${w.week}`}
              </div>
            ))
          : days.map((d) => {
              const isToday = d === todayDay;
              const number = Number(dateOfDay(d).slice(8));
              return (
                <div key={d} className={cn("flex shrink-0 items-center justify-center gap-1", isWeekend(d) && "opacity-55")} style={{ width: dayW }}>
                  {scale === "week" && <span>{WEEKDAYS[weekdayOf(d)]}</span>}
                  <span className={cn(isToday && "flex h-4 min-w-4 items-center justify-center rounded-full bg-ink px-[3px] font-semibold text-bg")}>{number}</span>
                </div>
              );
            })}
      </div>
      {sprints.length > 0 && (
        <div className="relative h-[18px] border-t border-line">
          {sprints.map((s) => {
            const g = barGeometry({ start: dayNumber(s.startDate!), end: dayNumber(s.endDate!) }, range.start, dayW);
            return (
              <div
                key={s.id}
                title={`${s.name} · ${shortDate(s.startDate!)} → ${shortDate(s.endDate!)}`}
                className={cn("absolute inset-y-[2px] flex items-center overflow-clip rounded-[4px] border border-dashed border-line-strong text-[10.5px]", s.state === "active" ? "bg-ink/[0.08] font-medium text-ink" : "text-ink-3")}
                style={{ left: g.x + 1, width: g.width - 2 }}
              >
                <span className="sticky left-[calc(var(--gl)+6px)] truncate px-1.5">{s.name}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});

/** The names: epics (they fold) and their tickets (they open). Stays in place while the grid scrolls sideways. */
const LeftColumn = memo(function LeftColumn({ rows, onToggle, onOpen }: { rows: Row[]; onToggle: (key: string) => void; onOpen: (ref: string) => void }) {
  return (
    <div className="sticky left-0 z-20 w-[var(--gl)] shrink-0 border-r border-line-strong bg-surface">
      {rows.map((r) =>
        r.kind === "group" ? (
          <button key={r.key} onClick={() => onToggle(r.key)} aria-expanded={r.open} className="flex w-full items-center gap-2 border-b border-line bg-ink/[0.035] px-2.5 text-left hover:bg-ink/[0.06]" style={{ height: ROW_H }}>
            <ChevronRight className={cn("size-3.5 shrink-0 text-ink-3 transition-transform duration-150", r.open && "rotate-90")} />
            <Progress done={r.done} total={r.total} className="max-md:hidden" />
            <span className={cn("min-w-0 flex-1 truncate text-[13px] font-medium", !r.epic && "text-ink-2")}>{r.epic ? r.epic.name : "Sans epic"}</span>
            <span className="shrink-0 text-[11.5px] text-ink-3 tabular">
              {r.done}/{r.total}
            </span>
          </button>
        ) : (
          <button key={r.key} onClick={() => onOpen(r.issue.ref)} title={`${r.issue.ref} · ${r.issue.title}`} className="flex w-full items-center gap-2 border-b border-line pr-2.5 text-left text-[13px] hover:bg-ink/[0.03]" style={{ height: ROW_H, paddingLeft: 12 + r.depth * 14 }}>
            <StatusIcon category={r.category} />
            <span className="shrink-0 font-mono text-[11.5px] text-ink-3 tabular max-md:hidden">{r.issue.ref}</span>
            <span className={cn("truncate", isClosed(r.category) && "text-ink-3")}>{r.issue.title}</span>
          </button>
        ),
      )}
    </div>
  );
});

/** The thin bar of an epic, from its start to its target date, filled up to its progress. */
function EpicBar({ epic, span, done, total, rangeStart, dayW }: { epic: Epic; span: Span; done: number; total: number; rangeStart: number; dayW: number }) {
  const g = barGeometry(span, rangeStart, dayW);
  return (
    <div
      title={`${epic.name} · ${epic.startDate ? shortDate(epic.startDate) : "…"} → ${epic.targetDate ? shortDate(epic.targetDate) : "…"} · ${done}/${total}`}
      className="absolute top-1/2 h-[7px] -translate-y-1/2 overflow-hidden rounded-[2px] border-x-2 border-ink bg-ink/20"
      style={{ left: g.x + 1, width: Math.max(g.width - 2, 6) }}
    >
      <div className="h-full bg-ink" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
    </div>
  );
}

/** The bar of a ticket. Its drag lives here, so moving it re-renders nothing else; the dates are saved on release. */
const Bar = memo(function Bar({
  issue,
  category,
  top,
  rangeStart,
  dayW,
  overdue,
  warning,
  scroller,
  onOpen,
  onCommit,
  link,
}: {
  issue: Issue;
  category: StatusCategory;
  top: number;
  rangeStart: number;
  dayW: number;
  overdue: boolean;
  warning: string | null;
  scroller: React.RefObject<HTMLDivElement | null>;
  onOpen: (ref: string) => void;
  onCommit: (issue: Issue, patch: { startDate: string | null; dueDate: string | null }) => void;
  link: LinkApi;
}) {
  const [preview, setPreview] = useState<{ startDate: string | null; dueDate: string | null } | null>(null);
  const drag = useRef<{ mode: DragMode | "link"; x0: number; moved: boolean; delta: number } | null>(null);

  const dates = preview ?? issue;
  const span = spanOf(dates.startDate, dates.dueDate)!;
  const box = boxOf(span, rangeStart, dayW);
  const small = box.w < 22;
  const look = barLook(category, overdue);
  const when = span.kind === "range" && span.end > span.start ? `${shortDate(dateOfDay(span.start))} → ${shortDate(dateOfDay(span.end))}` : shortDate(dateOfDay(span.start));

  const pageX = (e: React.PointerEvent) => e.clientX + (scroller.current?.scrollLeft ?? 0);

  const begin = (mode: DragMode | "link") => (e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { mode, x0: pageX(e), moved: false, delta: 0 };
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (d.mode === "link") return link.move(issue.id, e.clientX, e.clientY);
    const dx = pageX(e) - d.x0;
    if (Math.abs(dx) > 3) d.moved = true;
    if (!d.moved) return;
    // Snap to whole days; only a change of day re-renders the bar.
    const delta = Math.round(dx / dayW);
    if (delta === d.delta) return;
    d.delta = delta;
    setPreview(delta ? dragDates(issue.startDate, issue.dueDate, d.mode, delta) : null);
  };

  const onUp = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    if (d.mode === "link") return link.end(issue.id, e.clientX, e.clientY);
    setPreview(null);
    // A plain click opens the ticket, a drag never does.
    if (!d.moved) return d.mode === "move" ? onOpen(issue.ref) : undefined;
    const next = dragDates(issue.startDate, issue.dueDate, d.mode, d.delta);
    if (next.startDate !== issue.startDate || next.dueDate !== issue.dueDate) onCommit(issue, next);
  };

  const onCancel = () => {
    if (drag.current?.mode === "link") link.cancel();
    drag.current = null;
    setPreview(null);
  };

  // Keyboard: Enter opens, the arrows move the bar by a day, with Shift they move its end.
  const onKey = (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpen(issue.ref);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const next = dragDates(issue.startDate, issue.dueDate, e.shiftKey ? "end" : "move", e.key === "ArrowLeft" ? -1 : 1);
      if (next.startDate !== issue.startDate || next.dueDate !== issue.dueDate) onCommit(issue, next);
    }
  };

  return (
    <div
      data-bar-id={issue.id}
      role="button"
      tabIndex={0}
      aria-label={`${issue.ref} ${issue.title}, ${when}${warning ? `. ${warning}` : ""}`}
      title={`${issue.ref} · ${issue.title} · ${when}`}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onCancel}
      onKeyDown={onKey}
      onClick={(e) => e.stopPropagation()}
      className={cn("group/bar absolute rounded-[5px] outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-surface", preview && "z-10")}
      style={{ left: box.x, top: top + (ROW_H - BAR_H) / 2, width: box.w, height: BAR_H }}
    >
      {span.kind === "due" ? (
        <div onPointerDown={begin("move")} className="absolute inset-0 cursor-grab touch-none active:cursor-grabbing">
          <div className={cn("absolute top-1/2 left-1/2 size-[11px] -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px]", look.className)} style={look.style} />
        </div>
      ) : (
        <div onPointerDown={begin("move")} className={cn("absolute inset-0 cursor-grab touch-none rounded-[5px] active:cursor-grabbing", look.className)} style={look.style} />
      )}
      {/* The edges: inside a long bar, just outside a short one so its middle stays free to move it. */}
      <span onPointerDown={begin("start")} className={cn("absolute inset-y-0 w-2 cursor-ew-resize touch-none", small ? "right-full" : "left-0")} />
      <span onPointerDown={begin("end")} className={cn("absolute inset-y-0 w-2 cursor-ew-resize touch-none", small ? "left-full" : "right-0")} />

      {warning && (
        <span title={warning} role="img" aria-label={warning} className={cn("absolute top-1/2 flex size-4 -translate-y-1/2 items-center justify-center rounded-[4px] bg-surface text-ink", small ? "right-full mr-2.5" : "right-full mr-1")}>
          <TriangleAlert className="size-3.5" strokeWidth={2.2} />
        </span>
      )}

      <span
        onPointerDown={begin("link")}
        title="Tire jusqu'à un autre ticket pour indiquer que celui-ci le bloque"
        aria-hidden
        className={cn("absolute top-1/2 size-[11px] -translate-y-1/2 cursor-crosshair touch-none rounded-full border-[1.5px] border-ink bg-surface opacity-0 transition-opacity group-hover/bar:opacity-100 [@media(hover:none)]:opacity-50", small ? "left-full ml-2.5" : "left-full ml-1")}
      />

      <span className={cn("pointer-events-none absolute top-1/2 left-full max-w-[260px] -translate-y-1/2 truncate text-[11.5px] whitespace-nowrap", small ? "ml-7" : "ml-5", preview ? "font-medium text-ink tabular" : isClosed(category) ? "text-ink-3 line-through" : "text-ink-2")}>{preview ? when : issue.title}</span>
    </div>
  );
});

/** The row of a ticket without dates: a click on a day plans it there, a drag with the mouse gives it a start and an end. */
const PlanRow = memo(function PlanRow({ issue, top, rangeStart, dayW, todayDay, onPlan }: { issue: Issue; top: number; rangeStart: number; dayW: number; todayDay: number; onPlan: (issue: Issue, from: number, to: number) => void }) {
  const [ghost, setGhost] = useState<{ a: number; b: number } | null>(null);
  const drag = useRef<number | null>(null);
  const handled = useRef(false);
  const dayOf = (e: React.MouseEvent<HTMLElement>) => dayAtX(e.clientX - e.currentTarget.getBoundingClientRect().left, rangeStart, dayW);

  return (
    <div
      className="absolute inset-x-0 cursor-cell"
      style={{ top, height: ROW_H - 1 }}
      onPointerDown={(e) => {
        // A finger scrolls the chart: on touch, only a tap plans (see onClick).
        if (e.pointerType === "touch" || e.button !== 0 || e.target !== e.currentTarget) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = dayOf(e);
        setGhost({ a: drag.current, b: drag.current });
      }}
      onPointerMove={(e) => {
        if (e.pointerType === "touch") return;
        const d = dayOf(e);
        const next = drag.current === null ? { a: d, b: d } : { a: Math.min(drag.current, d), b: Math.max(drag.current, d) };
        setGhost((g) => (g && g.a === next.a && g.b === next.b ? g : next));
      }}
      onPointerLeave={() => drag.current === null && setGhost(null)}
      onPointerCancel={() => {
        drag.current = null;
        setGhost(null);
      }}
      onPointerUp={(e) => {
        if (drag.current === null) return;
        const d = dayOf(e);
        const from = drag.current;
        drag.current = null;
        handled.current = true;
        setGhost(null);
        onPlan(issue, from, d);
      }}
      onClick={(e) => {
        if (handled.current) return void (handled.current = false);
        if (e.target === e.currentTarget) onPlan(issue, dayOf(e), dayOf(e));
      }}
    >
      {ghost && (
        <div className="pointer-events-none absolute top-1/2 -translate-y-1/2 rounded-[5px] border border-dashed border-ink-3 bg-ink/[0.04]" style={{ left: (ghost.a - rangeStart) * dayW + 1, width: Math.max((ghost.b - ghost.a + 1) * dayW - 2, 8), height: BAR_H }}>
          <span className="absolute top-1/2 left-full ml-2 -translate-y-1/2 text-[11.5px] whitespace-nowrap text-ink-3">
            Planifier · {shortDate(dateOfDay(ghost.a))}
            {ghost.b > ghost.a && ` → ${shortDate(dateOfDay(ghost.b))}`}
          </span>
        </div>
      )}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onPlan(issue, todayDay, todayDay);
        }}
        className="absolute top-1/2 h-5 -translate-y-1/2 rounded-md border border-dashed border-ink-3 bg-surface px-1.5 text-[11.5px] whitespace-nowrap text-ink-2 opacity-0 outline-none pointer-events-none focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-accent/50"
        style={{ left: (todayDay - rangeStart + 1) * dayW + 4 }}
        aria-label={`Planifier ${issue.ref} aujourd'hui`}
      >
        Planifier aujourd&apos;hui
      </button>
    </div>
  );
});

/** The dependency arrows, over the rows and under the bars. Only their strokes take clicks. */
const Arrows = memo(function Arrows({ links, width, height, selected, onSelect }: { links: Link[]; width: number; height: number; selected: string | null; onSelect: (key: string | null) => void }) {
  return (
    <svg width={width} height={height} className="pointer-events-none absolute top-0 left-0" role="group" aria-label="Dépendances">
      {links.map((l) => {
        const on = l.key === selected;
        // The line stops where the arrowhead starts.
        const d = arrowPath(l.x1, l.y1, l.x2 - 6, l.y2, ROW_H);
        const label = `${l.blocker.ref} bloque ${l.blocked.ref}${l.conflict ? ` : ${l.blocked.ref} commence avant la fin de ${l.blocker.ref}` : ""}`;
        return (
          <g
            key={l.key}
            role="button"
            tabIndex={0}
            aria-label={`Dépendance : ${label}`}
            aria-pressed={on}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(on ? null : l.key);
            }}
            onKeyDown={(e) => {
              if (e.key !== "Enter" && e.key !== " ") return;
              e.preventDefault();
              onSelect(on ? null : l.key);
            }}
            className="cursor-pointer outline-none focus-visible:opacity-100 [&:focus-visible>path:nth-of-type(2)]:[stroke-width:2.5]"
            opacity={on ? 1 : l.faded ? 0.3 : l.conflict ? 0.95 : 0.6}
          >
            <title>{label}</title>
            <path d={d} fill="none" stroke="transparent" strokeWidth={11} pointerEvents="stroke" />
            <path d={d} fill="none" stroke="var(--ink)" strokeWidth={on ? 2.25 : l.conflict ? 2 : l.faded ? 1 : 1.25} strokeDasharray={l.conflict ? "5 3" : undefined} strokeLinejoin="round" />
            <path d={`M${l.x2} ${l.y2}l-6.5 -3.5v7z`} fill="var(--ink)" pointerEvents="all" />
          </g>
        );
      })}
    </svg>
  );
});

/** The line that follows the pointer while a dependency is being drawn. It keeps its own state: nothing else re-renders. */
function LinkDraft({ register, width, height }: { register: React.RefObject<(d: Draft | null) => void>; width: number; height: number }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  useEffect(() => {
    register.current = setDraft;
    return () => {
      register.current = () => {};
    };
  }, [register]);
  if (!draft) return null;
  return (
    <svg width={width} height={height} className="pointer-events-none absolute top-0 left-0 z-20">
      {draft.target && <rect x={draft.target.x - 3} y={draft.target.y - 3} width={draft.target.w + 6} height={draft.target.h + 6} rx={7} fill="none" stroke="var(--ink)" strokeWidth={1.5} />}
      <path d={`M${draft.x1} ${draft.y1}L${draft.x2} ${draft.y2}`} fill="none" stroke="var(--ink)" strokeWidth={1.5} strokeDasharray="4 3" />
      <circle cx={draft.x2} cy={draft.y2} r={3} fill="var(--ink)" />
    </svg>
  );
}
