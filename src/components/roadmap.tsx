"use client";

import { Check, Eye, EyeOff, Map as MapIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Progress } from "@/components/icons";
import { Button, Card } from "@/components/ui";
import { type DragMode, epicOverdue, hasDates, monthsBetween, roadmapRange, shiftSpan, type Span, toDay, todayIso } from "@/lib/roadmap";
import { useApp } from "@/lib/store";
import { EPIC_STATES } from "@/lib/templates";
import type { Epic, RoadmapProject, Sprint } from "@/lib/types";
import { api, cn, shortDate } from "@/lib/utils";

/** How many months fit, roughly, in a desktop window: sets the width of a month. */
const SCALES = [
  { id: "quarter", label: "Trimestre", monthWidth: 240 },
  { id: "half", label: "Semestre", monthWidth: 120 },
  { id: "year", label: "Année", monthWidth: 60 },
] as const;
type ScaleId = (typeof SCALES)[number]["id"];

const DAYS_PER_MONTH = 30.4375;

const mix = (pct: number) => `color-mix(in oklab, var(--ink) ${pct}%, var(--surface))`;
const HATCH = "repeating-linear-gradient(135deg, var(--ink) 0 1px, transparent 1px 5px)";

/** Every open project on one timeline: epics as bars, sprints as bands. */
export function Roadmap() {
  const { listen } = useApp();
  const [data, setData] = useState<RoadmapProject[] | null>(null);
  const [error, setError] = useState("");
  const [scale, setScale] = useState<ScaleId>("half");
  const [showDone, setShowDone] = useState(true);
  const [viewWidth, setViewWidth] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const seq = useRef(0);
  const today = todayIso();

  const load = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const next = await api<RoadmapProject[]>("/api/roadmap");
      // An older answer arriving late must not replace a newer one.
      if (mine !== seq.current) return;
      setData(next);
      setError("");
    } catch (e) {
      if (mine === seq.current) setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Any change may move a bar or a counter: the roadmap shows every project.
  useEffect(() => listen(() => void load()), [listen, load]);

  const ready = !!data && hasDates(data);
  const monthWidth = SCALES.find((s) => s.id === scale)!.monthWidth;
  const px = monthWidth / DAYS_PER_MONTH;
  const range = useMemo(() => roadmapRange(data ?? [], today, Math.ceil(viewWidth / monthWidth) + 1), [data, today, viewWidth, monthWidth]);
  const months = useMemo(() => monthsBetween(range.start, range.end), [range]);
  const x = (day: number) => (day - range.start) * px;
  const todayX = x(toDay(today)) + px / 2;

  useEffect(() => {
    const el = scroller.current;
    if (!ready || !el) return;
    const observer = new ResizeObserver(() => setViewWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, [ready]);

  // Opens on today; afterwards a new scale or a longer window keeps the same date in the middle.
  const shown = useRef<{ start: number; px: number } | null>(null);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!ready || !el) {
      shown.current = null;
      return;
    }
    const before = shown.current;
    if (!before) el.scrollLeft = (toDay(today) - range.start + 0.5) * px - el.clientWidth / 3;
    else if (before.start !== range.start || before.px !== px) {
      const centre = before.start + (el.scrollLeft + el.clientWidth / 2) / before.px;
      el.scrollLeft = (centre - range.start) * px - el.clientWidth / 2;
    }
    shown.current = { start: range.start, px };
  }, [ready, range.start, px, today]);

  const goToday = () => {
    const el = scroller.current;
    el?.scrollTo({ left: todayX - el.clientWidth / 3, behavior: "smooth" });
  };

  // Shown at once, then saved; whatever the answer, the server has the last word.
  const moveEpic = async (epic: Epic, span: Span) => {
    seq.current++;
    setData((d) => d && d.map((rp) => (rp.project.id === epic.projectId ? { ...rp, epics: rp.epics.map((e) => (e.id === epic.id ? { ...e, startDate: span.start, targetDate: span.target } : e)) } : rp)));
    try {
      await api(`/api/epics/${epic.id}`, { method: "PATCH", json: { startDate: span.start, targetDate: span.target } });
    } catch (e) {
      toast.error((e as Error).message);
    }
    void load();
  };

  if (!data) return error ? <p className="p-7 text-[13px] text-ink-3 max-md:p-4">{error}</p> : <div className="flex-1" />;

  if (!ready) {
    return (
      <div className="scroll-thin flex-1 overflow-y-auto p-7 max-md:p-4">
        <Card className="mx-auto flex max-w-[520px] flex-col items-center gap-2 py-10 text-center">
          <MapIcon className="size-6 text-ink-3" />
          <p className="text-[14px] font-medium">Rien à placer sur la frise</p>
          <p className="max-w-[380px] text-[13px] text-ink-3">Donne une date de début et une date cible à tes epics depuis l&apos;onglet « Epics » d&apos;un projet : elles apparaîtront ici, avec les sprints datés.</p>
          {data.length > 0 && (
            <div className="mt-2 flex flex-wrap justify-center gap-1.5">
              {data.map(({ project }) => (
                <Link key={project.id} href={`/p/${project.key}/epics`} className="press rounded-full border border-line-strong px-2.5 py-1 text-[12px] text-ink-2 hover:border-ink/40 hover:text-ink">
                  Epics de {project.name}
                </Link>
              ))}
            </div>
          )}
        </Card>
      </div>
    );
  }

  const width = x(range.end);
  const years = months.reduce<{ year: number; days: number }[]>((acc, m) => {
    const last = acc[acc.length - 1];
    if (last?.year === m.year) last.days += m.days;
    else acc.push({ year: m.year, days: m.days });
    return acc;
  }, []);
  const stickyStyle = { maxWidth: viewWidth || undefined };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-7 py-2 max-md:px-4">
        <div role="group" aria-label="Échelle de la frise" className="flex rounded-lg border border-line-strong bg-surface p-0.5">
          {SCALES.map((s) => (
            <button
              key={s.id}
              onClick={() => setScale(s.id)}
              aria-pressed={scale === s.id}
              className={cn("press h-6 rounded-md px-2.5 text-[12.5px] font-medium", scale === s.id ? "bg-ink text-bg" : "text-ink-2 hover:text-ink")}
            >
              {s.label}
            </button>
          ))}
        </div>
        <Button size="sm" variant="ghost" onClick={goToday}>
          Aujourd&apos;hui
        </Button>
        <Button size="sm" variant="ghost" className="ml-auto" aria-pressed={showDone} onClick={() => setShowDone(!showDone)}>
          {showDone ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
          {showDone ? "Epics terminées affichées" : "Epics terminées masquées"}
        </Button>
      </div>

      <div ref={scroller} className="scroll-thin relative min-h-0 flex-1 overflow-auto">
        <div className="relative min-h-full pb-6" style={{ width }}>
          {/* Month lines, behind everything. */}
          <div aria-hidden className="pointer-events-none absolute inset-0">
            {months.map((m) => (
              <div key={m.start} className={cn("absolute inset-y-0 border-l", m.month === 0 ? "border-line-strong" : "border-line")} style={{ left: x(m.start) }} />
            ))}
          </div>

          <div className="sticky top-0 z-20 border-b border-line-strong bg-surface text-[11px] text-ink-3">
            <div className="flex h-5">
              {years.map((y) => (
                <div key={y.year} className="shrink-0 border-l border-line-strong" style={{ width: y.days * px }}>
                  <span className="tabular sticky left-0 inline-block px-2 pt-1 font-medium leading-none text-ink">{y.year}</span>
                </div>
              ))}
            </div>
            <div className="flex h-6">
              {months.map((m) => (
                <div key={m.start} className={cn("shrink-0 truncate border-l px-2 leading-6 first-letter:uppercase", m.month === 0 ? "border-line-strong" : "border-line")} style={{ width: m.days * px }}>
                  {new Date(Date.UTC(m.year, m.month, 1)).toLocaleDateString("fr-CH", { month: monthWidth >= 120 ? "long" : "short", timeZone: "UTC" })}
                </div>
              ))}
            </div>
            <span aria-hidden className="absolute -bottom-[4px] size-[7px] -translate-x-1/2 rounded-full bg-ink" style={{ left: todayX }} />
          </div>

          {data.map(({ project, epics, sprints }) => {
            const visible = epics.filter((e) => showDone || (e.state !== "done" && e.state !== "canceled"));
            const dated = visible.filter((e) => e.startDate || e.targetDate).sort((a, b) => (a.startDate ?? a.targetDate)!.localeCompare((b.startDate ?? b.targetDate)!));
            const undated = visible.filter((e) => !e.startDate && !e.targetDate);
            const bands = sprints.filter((s) => s.startDate || s.endDate);
            const pct = project.issueCount ? Math.round((project.doneCount / project.issueCount) * 100) : 0;
            return (
              <section key={project.id} aria-label={project.name} className="relative border-b border-line pb-1.5">
                <div className="relative bg-surface-2">
                  <Link href={`/p/${project.key}`} style={stickyStyle} className="group sticky left-0 flex h-10 w-fit items-center gap-2 px-4 text-[13px]">
                    <span className="truncate font-medium group-hover:underline">{project.name}</span>
                    <span className="shrink-0 rounded-md border border-line-strong px-1.5 py-px font-mono text-[10.5px] text-ink-2">{project.key}</span>
                    <Progress done={project.doneCount} total={project.issueCount} />
                    <span className="tabular shrink-0 text-[12px] text-ink-3">
                      {project.doneCount}/{project.issueCount} · {pct} %
                    </span>
                  </Link>
                </div>

                {bands.length > 0 && (
                  <div className="relative mt-1.5 h-[18px]">
                    {bands.map((s) => (
                      <SprintBand key={s.id} sprint={s} x={x} px={px} />
                    ))}
                  </div>
                )}

                {dated.map((e) => (
                  <EpicRow key={e.id} epic={e} projectKey={project.key} today={today} todayX={todayX} x={x} px={px} min={range.start} max={range.end - 1} scroller={scroller} onMove={moveEpic} />
                ))}

                {undated.length > 0 && (
                  <div style={stickyStyle} className="sticky left-0 flex w-fit flex-wrap items-center gap-1.5 px-4 pt-1.5 pb-1 text-[11.5px]">
                    <span className="text-ink-3">Sans date</span>
                    {undated.map((e) => (
                      <Link
                        key={e.id}
                        href={`/p/${project.key}/epics`}
                        title="Donne-lui des dates dans l'onglet Epics"
                        className={cn("press max-w-[220px] truncate rounded-full border border-line-strong bg-surface px-2 py-0.5 text-ink-2 hover:border-ink/40 hover:text-ink", e.state === "canceled" && "line-through")}
                      >
                        {e.name}
                      </Link>
                    ))}
                  </div>
                )}

                {!bands.length && !dated.length && !undated.length && (
                  <p style={stickyStyle} className="sticky left-0 w-fit px-4 pt-1.5 pb-1 text-[12px] text-ink-3">
                    {epics.length ? "Que des epics terminées." : "Rien de planifié pour l'instant."}
                  </p>
                )}
              </section>
            );
          })}

          {/* Today. */}
          <div aria-hidden className="pointer-events-none absolute inset-y-0 w-px bg-ink/35" style={{ left: todayX }} />
        </div>
      </div>
    </>
  );
}

function SprintBand({ sprint, x, px }: { sprint: Sprint; x: (day: number) => number; px: number }) {
  const first = toDay((sprint.startDate ?? sprint.endDate)!);
  const last = Math.max(toDay((sprint.endDate ?? sprint.startDate)!), first);
  const width = Math.max((last - first + 1) * px, 4);
  const state = sprint.state === "active" ? "en cours" : sprint.state === "done" ? "terminé" : "prévu";
  const label = `${sprint.name} · ${shortDate((sprint.startDate ?? sprint.endDate)!)} → ${shortDate((sprint.endDate ?? sprint.startDate)!)} · ${state}`;
  return (
    <div
      role="img"
      aria-label={label}
      title={label}
      className={cn(
        "absolute top-0.5 h-3.5 overflow-hidden rounded-[4px] px-1 text-[9.5px] font-medium leading-[14px] whitespace-nowrap",
        sprint.state === "active" ? "bg-ink text-bg" : sprint.state === "done" ? "text-ink-3" : "bg-surface text-ink-2 ring-1 ring-inset ring-line-strong",
      )}
      style={{ left: x(first), width, background: sprint.state === "done" ? mix(16) : undefined }}
    >
      {width >= sprint.name.length * 5.5 + 10 && sprint.name}
    </div>
  );
}

function spanDates(span: Span) {
  if (span.start && span.target) return `${shortDate(span.start)} → ${shortDate(span.target)}`;
  return span.start ? `début ${shortDate(span.start)}` : span.target ? `cible ${shortDate(span.target)}` : "";
}

type EpicRowProps = {
  epic: Epic;
  projectKey: string;
  today: string;
  todayX: number;
  x: (day: number) => number;
  px: number;
  /** The window of the timeline, in day numbers: a drag stays inside. */
  min: number;
  max: number;
  scroller: React.RefObject<HTMLDivElement | null>;
  onMove: (epic: Epic, span: Span) => void;
};

/** One epic: a bar between its two dates, or a diamond when it has only one. Dragged with a mouse or a pen. */
function EpicRow({ epic, projectKey, today, todayX, x, px, min, max, scroller, onMove }: EpicRowProps) {
  const [drag, setDrag] = useState<{ mode: DragMode; delta: number } | null>(null);
  const origin = useRef({ x: 0, scroll: 0 });
  const moved = useRef(false);

  const saved: Span = { start: epic.startDate, target: epic.targetDate };
  const span = drag ? shiftSpan(saved, drag.mode, drag.delta, min, max) : saved;
  const milestone = !span.start || !span.target;
  const first = toDay((span.start ?? span.target)!);
  const last = Math.max(toDay((span.target ?? span.start)!), first);
  const left = milestone ? x(first) + px / 2 - 10 : x(first);
  const width = milestone ? 20 : Math.max((last - first + 1) * px, 6);
  const right = left + width;

  const overdue = epicOverdue({ state: epic.state, targetDate: span.target }, today);
  const lateWidth = overdue ? Math.max(todayX - right, 8) : 0;
  const pct = epic.issueCount ? Math.round((epic.doneCount / epic.issueCount) * 100) : 0;
  const stateLabel = EPIC_STATES.find((s) => s.value === epic.state)!.label;
  const inside = !milestone && width >= epic.name.length * 6.6 + (epic.state === "done" ? 40 : 24);
  const title = `${epic.name} · ${spanDates(span)} · ${epic.doneCount}/${epic.issueCount} tickets · ${stateLabel}${overdue ? " · en retard" : ""}`;

  const onPointerDown = (e: React.PointerEvent<HTMLAnchorElement>) => {
    moved.current = false;
    // Touch keeps scrolling the chart: a tap opens the epics, dates are edited there.
    if (e.button !== 0 || e.pointerType === "touch") return;
    const mode = ((e.target as HTMLElement).dataset.mode as DragMode | undefined) ?? "move";
    e.currentTarget.setPointerCapture(e.pointerId);
    origin.current = { x: e.clientX, scroll: scroller.current?.scrollLeft ?? 0 };
    setDrag({ mode, delta: 0 });
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const dx = e.clientX - origin.current.x + (scroller.current?.scrollLeft ?? 0) - origin.current.scroll;
    if (Math.abs(dx) > 3) moved.current = true;
    // Below the threshold it is a click: no date moves, even where a day is narrower than that.
    if (!moved.current) return;
    const delta = Math.round(dx / px);
    if (delta !== drag.delta) setDrag({ ...drag, delta });
  };
  const onPointerUp = () => {
    if (!drag) return;
    setDrag(null);
    if (span.start !== saved.start || span.target !== saved.target) onMove(epic, span);
  };

  return (
    <div className="relative h-9">
      <Link
        href={`/p/${projectKey}/epics`}
        draggable={false}
        title={drag ? undefined : title}
        aria-label={title}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => setDrag(null)}
        onDragStart={(e) => e.preventDefault()}
        onClick={(e) => {
          // A drag is not a click.
          if (moved.current) e.preventDefault();
          moved.current = false;
        }}
        className={cn(
          "absolute top-1.5 flex h-6 select-none items-center outline-none focus-visible:ring-2 focus-visible:ring-accent/50",
          drag ? "z-10 cursor-grabbing" : "cursor-grab",
          milestone
            ? "justify-center rounded-md"
            : cn(
                "overflow-hidden rounded-md text-[12px] font-medium",
                epic.state === "planned" && "border border-ink bg-surface text-ink",
                epic.state === "active" && "text-bg",
                epic.state === "done" && "text-ink-2",
                epic.state === "canceled" && "border border-dashed border-line-strong bg-surface text-ink-3",
              ),
        )}
        style={{ left, width, background: milestone ? undefined : epic.state === "active" ? mix(58) : epic.state === "done" ? mix(24) : undefined }}
      >
        {milestone ? (
          <span
            className={cn(
              "size-3 rotate-45 rounded-[2px]",
              epic.state === "planned" && "border-[1.5px] border-ink bg-surface",
              epic.state === "active" && "bg-ink",
              epic.state === "canceled" && "border border-dashed border-ink-3 bg-surface",
            )}
            style={{ background: epic.state === "done" ? mix(34) : undefined }}
          />
        ) : (
          <>
            {(epic.state === "planned" || epic.state === "active") && pct > 0 && (
              <span className={cn("pointer-events-none absolute inset-y-0 left-0", epic.state === "active" ? "bg-ink" : "bg-ink/15")} style={{ width: `${pct}%` }} />
            )}
            {inside && (
              <span className={cn("pointer-events-none relative flex min-w-0 items-center gap-1 px-2", epic.state === "canceled" && "line-through")}>
                {epic.state === "done" && <Check className="size-3.5 shrink-0" strokeWidth={2.4} />}
                <span className="truncate">{epic.name}</span>
              </span>
            )}
            {!inside && epic.state === "done" && width >= 18 && <Check className="pointer-events-none relative mx-auto size-3.5 shrink-0" strokeWidth={2.4} />}
            {width >= 28 && (
              <>
                <span data-mode="start" className="absolute inset-y-0 left-0 w-[7px] cursor-ew-resize" />
                <span data-mode="end" className="absolute inset-y-0 right-0 w-[7px] cursor-ew-resize" />
              </>
            )}
          </>
        )}
      </Link>

      {/* Late: hatched from the target up to today. */}
      {overdue && (
        <span
          aria-hidden
          className={cn("pointer-events-none absolute top-[9px] h-[18px] border-y border-r border-ink/40 opacity-70", milestone ? "rounded-r-[4px] border-l" : "rounded-r-[4px]")}
          style={{ left: right, width: lateWidth, backgroundImage: HATCH }}
        />
      )}

      <span className="pointer-events-none absolute top-1.5 flex h-6 items-center gap-1.5 whitespace-nowrap text-[12px]" style={{ left: right + lateWidth + 8 }}>
        {drag ? (
          <span className="tabular rounded-md bg-ink px-1.5 py-0.5 text-[11px] font-medium text-bg">{spanDates(span)}</span>
        ) : (
          <>
            {!inside && <span className={cn(epic.state === "done" || epic.state === "canceled" ? "text-ink-3" : "text-ink-2", epic.state === "canceled" && "line-through")}>{epic.name}</span>}
            {overdue && <span className="rounded-[5px] border border-ink px-1 text-[10.5px] leading-[16px] font-medium text-ink">en retard</span>}
          </>
        )}
      </span>
    </div>
  );
}
