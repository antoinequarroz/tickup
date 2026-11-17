"use client";

import { CalendarDays, ChevronRight, ListTree, Plus } from "lucide-react";
import { useState } from "react";
import { AssigneeField, PriorityField, StatusField } from "@/components/fields";
import { LabelChip, StatusIcon, TypeIcon } from "@/components/icons";
import { useProjectCtx } from "@/components/project-context";
import { useApp } from "@/lib/store";
import type { Issue } from "@/lib/types";
import { cn, isOverdue, shortDate } from "@/lib/utils";

/** Every ticket, grouped by status. Sub-tickets sit under their parent when they are shown. */
export default function ListPage() {
  const { data, visible } = useProjectCtx();
  const { setNewIssue } = useApp();
  const [closed, setClosed] = useState<Set<string>>(() => new Set(data.statuses.filter((s) => s.category === "canceled").map((s) => s.id)));
  const visibleIds = new Set(visible.map((i) => i.id));

  const toggle = (id: string) => setClosed((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set([...s, id])));

  /** Top of each tree: a ticket whose parent is not shown here. */
  const rows = (statusId: string) => {
    const inStatus = visible.filter((i) => i.statusId === statusId);
    const out: { issue: Issue; depth: number }[] = [];
    const walk = (issue: Issue, depth: number) => {
      out.push({ issue, depth });
      visible
        .filter((c) => c.parentId === issue.id && c.statusId === statusId)
        .sort((a, b) => a.number - b.number)
        .forEach((c) => walk(c, depth + 1));
    };
    inStatus
      .filter((i) => !i.parentId || !visibleIds.has(i.parentId) || visible.find((p) => p.id === i.parentId)?.statusId !== statusId)
      .sort((a, b) => (a.priority || 9) - (b.priority || 9) || a.position - b.position)
      .forEach((i) => walk(i, 0));
    return out;
  };

  if (!data.issues.length) return <Empty onCreate={() => setNewIssue({ projectKey: data.project.key })} />;

  return (
    <div className="scroll-thin min-h-0 flex-1 overflow-y-auto pb-10">
      {data.statuses.map((s) => {
        const list = rows(s.id);
        const open = !closed.has(s.id);
        return (
          <section key={s.id}>
            <div className="sticky top-0 z-10 flex h-9 items-center gap-2 border-b border-line bg-surface-2/90 px-5 backdrop-blur max-md:px-3">
              <button onClick={() => toggle(s.id)} className="press flex items-center gap-2" aria-expanded={open}>
                <ChevronRight className={cn("size-3.5 text-ink-3 transition-transform duration-150", open && "rotate-90")} />
                <StatusIcon category={s.category} />
                <span className="text-[13px] font-medium">{s.name}</span>
                <span className="text-[12px] text-ink-3 tabular">{list.length}</span>
              </button>
              <button onClick={() => setNewIssue({ projectKey: data.project.key, statusId: s.id })} aria-label={`Nouveau ticket dans ${s.name}`} className="press ml-auto flex size-6 items-center justify-center rounded-md text-ink-3 hover:bg-ink/[0.06] hover:text-ink">
                <Plus className="size-3.5" strokeWidth={2.4} />
              </button>
            </div>
            {open && list.map(({ issue, depth }) => <Row key={issue.id} issue={issue} depth={depth} />)}
          </section>
        );
      })}
    </div>
  );
}

function Row({ issue, depth }: { issue: Issue; depth: number }) {
  const { data, updateIssue, openIssue } = useProjectCtx();
  const type = data.types.find((t) => t.id === issue.typeId);
  const epic = data.epics.find((e) => e.id === issue.epicId);
  const labels = data.labels.filter((l) => issue.labelIds.includes(l.id));
  const change = (patch: Partial<Issue>) => updateIssue(issue, patch);
  return (
    <div onClick={() => openIssue(issue.ref)} className="group flex h-10 cursor-pointer items-center gap-2 border-b border-line px-5 text-[13px] hover:bg-ink/[0.025] max-md:px-3">
      <PriorityField data={data} issue={issue} onChange={change} look="icon" />
      <span className="w-[62px] shrink-0 font-mono text-[11.5px] text-ink-3 tabular max-sm:hidden">{issue.ref}</span>
      <StatusField data={data} issue={issue} onChange={change} look="icon" />
      <span className="flex min-w-0 flex-1 items-center gap-1.5" style={{ paddingLeft: depth * 20 }}>
        {depth > 0 && <span className="text-ink-3">└</span>}
        {type && <TypeIcon icon={type.icon} className="size-3.5 shrink-0 text-ink-3" />}
        <span className="truncate font-medium">{issue.title}</span>
        {issue.subCount > 0 && (
          <span className="flex shrink-0 items-center gap-1 text-[11.5px] text-ink-3">
            <ListTree className="size-3.5" />
            {issue.subDone}/{issue.subCount}
          </span>
        )}
      </span>
      <span className="flex shrink-0 items-center gap-1.5 max-md:hidden">
        {labels.slice(0, 3).map((l) => (
          <LabelChip key={l.id} label={l} />
        ))}
        {epic && <span className="inline-flex h-[18px] max-w-[140px] items-center truncate rounded-[5px] border border-line-strong px-1.5 text-[10.5px] text-ink-2">{epic.name}</span>}
      </span>
      {issue.dueDate && (
        <span className={cn("flex w-[70px] shrink-0 items-center justify-end gap-1 text-[12px] text-ink-3 max-sm:hidden", isOverdue(issue.dueDate) && "font-semibold text-ink underline decoration-dotted underline-offset-2")}>
          <CalendarDays className="size-3.5" />
          {shortDate(issue.dueDate)}
        </span>
      )}
      <AssigneeField data={data} issue={issue} onChange={change} look="icon" />
    </div>
  );
}

function Empty({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <p className="font-display text-[24px]">Rien pour l&apos;instant</p>
      <p className="max-w-[340px] text-[13px] text-ink-3">Crée le premier ticket du projet. Tu pourras le découper en sous-tickets et le ranger dans une epic.</p>
      <button onClick={onCreate} className="press mt-1 flex h-9 items-center gap-1.5 rounded-lg bg-ink px-3.5 text-[13.5px] font-medium text-bg">
        <Plus className="size-4" />
        Nouveau ticket
      </button>
    </div>
  );
}
