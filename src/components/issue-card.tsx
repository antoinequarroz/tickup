"use client";

import { CalendarDays, ListTree } from "lucide-react";
import type { Issue } from "@/lib/types";
import { cn, isOverdue, shortDate } from "@/lib/utils";
import { AssigneeField, PriorityField } from "./fields";
import { LabelChip, Progress, TypeIcon } from "./icons";
import { useProjectCtx } from "./project-context";

/** A ticket on the board. Priority and person can be changed right on the card. */
export function IssueCard({ issue, dragging, onDragStart, onDragEnd }: { issue: Issue; dragging?: boolean; onDragStart?: (e: React.DragEvent) => void; onDragEnd?: () => void }) {
  const { data, updateIssue, openIssue } = useProjectCtx();
  const type = data.types.find((t) => t.id === issue.typeId);
  const epic = data.epics.find((e) => e.id === issue.epicId);
  const parent = issue.parentId ? data.issues.find((i) => i.id === issue.parentId) : null;
  const labels = data.labels.filter((l) => issue.labelIds.includes(l.id));
  const change = (patch: Partial<Issue>) => updateIssue(issue, patch);

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={() => openIssue(issue.ref)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
        e.preventDefault();
        openIssue(issue.ref);
      }}
      tabIndex={0}
      role="button"
      aria-label={`${issue.ref} ${issue.title}`}
      className={cn(
        "group flex cursor-pointer flex-col gap-2 rounded-xl border border-line bg-surface p-3 shadow-card outline-none transition-[border-color,box-shadow] duration-150 hover:border-line-strong focus-visible:border-ink/40",
        dragging && "dragging",
      )}
    >
      <div className="flex items-center gap-1.5 text-[11.5px] text-ink-3">
        {type && <TypeIcon icon={type.icon} className="size-3.5" />}
        <span className="font-mono tabular">{issue.ref}</span>
        {parent && <span className="truncate">· sous {parent.ref}</span>}
        <span className="ml-auto flex items-center">
          <PriorityField data={data} issue={issue} onChange={change} look="icon" />
          <AssigneeField data={data} issue={issue} onChange={change} look="icon" />
        </span>
      </div>
      <p className="text-[13.5px] leading-snug font-medium text-ink">{issue.title}</p>
      {(labels.length > 0 || epic || issue.subCount > 0 || issue.dueDate || issue.estimate != null) && (
        <div className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-ink-3">
          {epic && <span className="inline-flex h-[18px] max-w-[140px] items-center truncate rounded-[5px] border border-line-strong px-1.5 text-[10.5px] text-ink-2">{epic.name}</span>}
          {labels.map((l) => (
            <LabelChip key={l.id} label={l} />
          ))}
          {issue.subCount > 0 && (
            <span className="inline-flex items-center gap-1">
              <ListTree className="size-3.5" />
              <span className="tabular">
                {issue.subDone}/{issue.subCount}
              </span>
              <Progress done={issue.subDone} total={issue.subCount} className="size-3" />
            </span>
          )}
          {issue.dueDate && (
            <span className={cn("inline-flex items-center gap-1", isOverdue(issue.dueDate) && "font-semibold text-ink underline decoration-dotted underline-offset-2")}>
              <CalendarDays className="size-3.5" />
              {shortDate(issue.dueDate)}
            </span>
          )}
          {issue.estimate != null && <span className="ml-auto rounded-[5px] bg-ink/[0.06] px-1.5 font-mono text-[10.5px] tabular">{issue.estimate}</span>}
        </div>
      )}
    </div>
  );
}
