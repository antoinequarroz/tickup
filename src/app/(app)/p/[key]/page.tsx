"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { StatusIcon } from "@/components/icons";
import { IssueCard } from "@/components/issue-card";
import { useProjectCtx } from "@/components/project-context";
import { useApp } from "@/lib/store";
import type { Issue } from "@/lib/types";
import { cn, positionBetween } from "@/lib/utils";

/** The kanban: one column per status, tickets dragged from one to another or reordered. */
export default function BoardPage() {
  const { data, visible, updateIssue } = useProjectCtx();
  const { setNewIssue } = useApp();
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<{ statusId: string; index: number } | null>(null);

  const columns = data.statuses.map((s) => ({ status: s, issues: visible.filter((i) => i.statusId === s.id).sort((a, b) => a.position - b.position) }));

  const drop = (statusId: string, index: number) => {
    const issue = data.issues.find((i) => i.id === dragId);
    setDragId(null);
    setOver(null);
    if (!issue) return;
    const list = columns.find((c) => c.status.id === statusId)!.issues.filter((i) => i.id !== issue.id);
    // Index counted with the dragged card still in place: correct it when moving down the same column.
    const from = columns.find((c) => c.status.id === statusId)!.issues.findIndex((i) => i.id === issue.id);
    const at = from !== -1 && from < index ? index - 1 : index;
    const position = positionBetween(list[at - 1]?.position, list[at]?.position);
    if (issue.statusId === statusId && from === at) return;
    const patch: Partial<Issue> = { position };
    if (issue.statusId !== statusId) patch.statusId = statusId;
    void updateIssue(issue, patch);
  };

  return (
    <div className="scroll-thin flex min-h-0 flex-1 gap-3 overflow-x-auto p-4 max-md:p-3">
      {columns.map(({ status, issues }) => (
        <section
          key={status.id}
          aria-label={status.name}
          onDragOver={(e) => {
            if (!dragId) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            // Over the empty part of a column: at the end.
            if (e.target === e.currentTarget || (e.target as HTMLElement).dataset.zone === "end") setOver({ statusId: status.id, index: issues.length });
          }}
          onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOver(null)}
          onDrop={(e) => {
            e.preventDefault();
            drop(status.id, over?.statusId === status.id ? over.index : issues.length);
          }}
          className={cn("flex w-[290px] shrink-0 flex-col rounded-2xl transition-colors duration-150", over?.statusId === status.id && "drop-target", status.category === "canceled" && "opacity-70")}
        >
          <div className="flex h-9 items-center gap-2 px-2">
            <StatusIcon category={status.category} />
            <h2 className="text-[13px] font-medium">{status.name}</h2>
            <span className="text-[12px] text-ink-3 tabular">{issues.length}</span>
            <button onClick={() => setNewIssue({ projectKey: data.project.key, statusId: status.id })} aria-label={`Nouveau ticket dans ${status.name}`} className="press ml-auto flex size-6 items-center justify-center rounded-md text-ink-3 hover:bg-ink/[0.06] hover:text-ink">
              <Plus className="size-3.5" strokeWidth={2.4} />
            </button>
          </div>
          <div className="scroll-thin flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-1 pt-1 pb-2">
            {issues.map((issue, index) => (
              <div
                key={issue.id}
                onDragOver={(e) => {
                  if (!dragId) return;
                  e.preventDefault();
                  const r = e.currentTarget.getBoundingClientRect();
                  setOver({ statusId: status.id, index: e.clientY < r.top + r.height / 2 ? index : index + 1 });
                }}
              >
                {over?.statusId === status.id && over.index === index && dragId !== issue.id && <DropLine />}
                <IssueCard
                  issue={issue}
                  dragging={dragId === issue.id}
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", issue.ref);
                    setDragId(issue.id);
                  }}
                  onDragEnd={() => {
                    setDragId(null);
                    setOver(null);
                  }}
                />
              </div>
            ))}
            {over?.statusId === status.id && over.index === issues.length && <DropLine />}
            <div data-zone="end" className="min-h-10 flex-1" />
          </div>
        </section>
      ))}
    </div>
  );
}

function DropLine() {
  return <div className="mb-2 h-[2px] rounded-full bg-ink" />;
}
