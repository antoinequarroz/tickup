"use client";

import { CalendarDays } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { PriorityIcon } from "@/components/icons";
import { PageHeader } from "@/components/ui";
import { useApp } from "@/lib/store";
import type { Issue } from "@/lib/types";
import { api, cn, isOverdue, shortDate } from "@/lib/utils";

/** My open tickets across every project, most urgent first. */
export default function MyIssuesPage() {
  const { projects, listen } = useApp();
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const load = useCallback(() => api<Issue[]>("/api/my-issues").then(setIssues, () => setIssues([])), []);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => listen(() => void load()), [listen, load]);

  const byProject = projects.map((p) => ({ project: p, issues: (issues ?? []).filter((i) => i.projectId === p.id) })).filter((g) => g.issues.length);

  return (
    <>
      <PageHeader title="Mes tickets" subtitle={issues ? (issues.length ? `${issues.length} ticket${issues.length > 1 ? "s" : ""} ouvert${issues.length > 1 ? "s" : ""} pour toi` : undefined) : undefined} />
      <div className="scroll-thin flex-1 overflow-y-auto pb-10">
        {issues && !issues.length && (
          <div className="flex flex-col items-center gap-2 p-16 text-center">
            <p className="font-display text-[24px]">Rien sur ta pile</p>
            <p className="text-[13px] text-ink-3">Les tickets qui te sont attribués, dans tous les projets, arrivent ici.</p>
          </div>
        )}
        {byProject.map(({ project, issues }) => (
          <section key={project.id}>
            <div className="sticky top-0 z-10 flex h-9 items-center gap-2 border-b border-line bg-surface-2/90 px-7 backdrop-blur max-md:px-4">
              <span className="font-mono text-[11px] text-ink-3">{project.key}</span>
              <span className="text-[13px] font-medium">{project.name}</span>
              <span className="text-[12px] text-ink-3">{issues.length}</span>
            </div>
            {issues.map((i) => (
              <Link key={i.id} href={`/p/${project.key}?issue=${i.ref}`} className="flex h-10 items-center gap-3 border-b border-line px-7 text-[13px] hover:bg-ink/[0.025] max-md:px-4">
                <PriorityIcon priority={i.priority} />
                <span className="w-[62px] shrink-0 font-mono text-[11.5px] text-ink-3">{i.ref}</span>
                <span className="min-w-0 flex-1 truncate font-medium">{i.title}</span>
                {i.dueDate && (
                  <span className={cn("flex items-center gap-1 text-[12px] text-ink-3", isOverdue(i.dueDate) && "font-semibold text-ink underline decoration-dotted underline-offset-2")}>
                    <CalendarDays className="size-3.5" />
                    {shortDate(i.dueDate)}
                  </span>
                )}
              </Link>
            ))}
          </section>
        ))}
      </div>
    </>
  );
}
