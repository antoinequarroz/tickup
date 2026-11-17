"use client";

import { Archive, Clapperboard, Code2, FolderKanban, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Progress } from "@/components/icons";
import { Avatar, Button, Card, PageHeader } from "@/components/ui";
import { useApp } from "@/lib/store";
import { templateById } from "@/lib/templates";
import { cn } from "@/lib/utils";

const ICON = { general: FolderKanban, media: Clapperboard, software: Code2 };

export default function ProjectsPage() {
  const { projects, setNewProject, userById } = useApp();
  const [archived, setArchived] = useState(false);
  const shown = projects.filter((p) => p.archived === archived);
  const archivedCount = projects.filter((p) => p.archived).length;

  return (
    <>
      <PageHeader title="Projets" subtitle="Projet général, création multimédia ou développement : chaque style vient avec ses statuts, ses types et ses étiquettes.">
        {archivedCount > 0 && (
          <Button size="sm" variant="ghost" onClick={() => setArchived(!archived)}>
            <Archive className="size-3.5" />
            {archived ? "En cours" : `Archivés (${archivedCount})`}
          </Button>
        )}
        <Button variant="primary" size="sm" onClick={() => setNewProject(true)}>
          <Plus className="size-3.5" strokeWidth={2.4} />
          Projet
        </Button>
      </PageHeader>
      <div className="scroll-thin flex-1 overflow-y-auto p-7 max-md:p-4">
        <div className="mx-auto grid max-w-[980px] gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((p, i) => {
            const Icon = ICON[p.template] ?? FolderKanban;
            const lead = userById(p.leadId);
            const pct = p.issueCount ? Math.round((p.doneCount / p.issueCount) * 100) : 0;
            return (
              <Link key={p.id} href={`/p/${p.key}`}>
                <Card className="rise press flex h-full flex-col gap-3 hover:bg-surface-2" style={{ animationDelay: `${i * 35}ms` }}>
                  <div className="flex items-center gap-3">
                    <span className="flex size-10 items-center justify-center rounded-xl bg-ink text-bg">
                      <Icon className="size-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <h2 className="truncate text-[15px] font-medium leading-tight">{p.name}</h2>
                      <p className="text-[12px] leading-tight text-ink-3">{templateById(p.template).name}</p>
                    </div>
                    <span className="rounded-md border border-line-strong px-1.5 py-px font-mono text-[10.5px] text-ink-2">{p.key}</span>
                  </div>
                  {p.description && <p className="line-clamp-2 text-[13px] text-ink-2">{p.description}</p>}
                  <div className="mt-auto flex items-center gap-2 text-[12px] text-ink-3">
                    <Progress done={p.doneCount} total={p.issueCount} />
                    <span className="tabular">
                      {p.doneCount}/{p.issueCount} tickets · {pct} %
                    </span>
                    {lead && <Avatar id={lead.id} name={lead.name} size="xs" className="ml-auto" />}
                  </div>
                </Card>
              </Link>
            );
          })}
          {!archived && (
            <button onClick={() => setNewProject(true)} className={cn("press flex min-h-[140px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong text-[13px] text-ink-3 hover:border-ink/40 hover:text-ink")}>
              <Plus className="size-5" />
              Nouveau projet
            </button>
          )}
        </div>
      </div>
    </>
  );
}
