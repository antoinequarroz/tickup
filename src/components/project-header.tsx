"use client";

import { Columns3, Layers, Plus, Rows3, Search, Settings2, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useApp } from "@/lib/store";
import { PRIORITIES, templateById } from "@/lib/templates";
import { cn } from "@/lib/utils";
import { PriorityIcon, Progress, TypeIcon } from "./icons";
import { Picker } from "./picker";
import { NO_FILTERS, useProjectCtx } from "./project-context";
import { Avatar, Button } from "./ui";

export function ProjectHeader() {
  const { data } = useProjectCtx();
  const { setNewIssue } = useApp();
  const pathname = usePathname();
  const base = `/p/${data.project.key}`;
  const tabs = [
    { href: base, label: "Tableau", Icon: Columns3 },
    { href: `${base}/list`, label: "Liste", Icon: Rows3 },
    { href: `${base}/epics`, label: "Epics", Icon: Layers },
    { href: `${base}/settings`, label: "Réglages", Icon: Settings2 },
  ];
  const showFilters = pathname === base || pathname === `${base}/list`;
  const { project } = data;

  return (
    <header className="border-b border-line">
      <div className="flex items-end gap-3 px-7 pt-5 pb-3 max-md:px-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[12px] text-ink-3">
            <span className="rounded-md border border-line-strong px-1.5 py-px font-mono text-[10.5px] text-ink-2">{project.key}</span>
            <span>{templateById(project.template).name}</span>
            {project.archived && <span className="rounded-full bg-ink/[0.06] px-2 py-px text-[11px]">Archivé</span>}
          </div>
          <h1 className="mt-1.5 truncate font-display text-[28px] leading-none">{project.name}</h1>
        </div>
        <div className="flex items-center gap-2 pb-0.5 text-[12.5px] text-ink-3 max-sm:hidden">
          <Progress done={project.doneCount} total={project.issueCount} />
          <span className="tabular">
            {project.doneCount}/{project.issueCount}
          </span>
        </div>
        <Button variant="primary" size="sm" onClick={() => setNewIssue({ projectKey: project.key })}>
          <Plus className="size-3.5" strokeWidth={2.4} />
          Ticket
        </Button>
      </div>
      <div className="flex items-center gap-1 px-6 max-md:overflow-x-auto max-md:px-3">
        {tabs.map(({ href, label, Icon }) => {
          const active = pathname === href;
          return (
            <Link key={href} href={href} className={cn("relative flex h-9 shrink-0 items-center gap-1.5 px-2 text-[13px] transition-colors", active ? "font-medium text-ink" : "text-ink-3 hover:text-ink")}>
              <Icon className="size-3.5" />
              {label}
              {active && <span className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-ink" />}
            </Link>
          );
        })}
      </div>
      {showFilters && <FilterBar />}
    </header>
  );
}

function FilterBar() {
  const { data, filters, setFilters } = useProjectCtx();
  const { users, userById } = useApp();
  const set = (patch: Partial<typeof filters>) => setFilters({ ...filters, ...patch });
  const active = JSON.stringify({ ...filters, subIssues: false }) !== JSON.stringify({ ...NO_FILTERS, subIssues: false });

  const chip = (on: boolean) => cn("flex h-7 items-center gap-1.5 rounded-lg border px-2 text-[12.5px] whitespace-nowrap", on ? "border-ink bg-ink text-bg" : "border-line-strong bg-surface text-ink-2 hover:text-ink");
  const label = data.labels.find((l) => l.id === filters.label);
  const epic = data.epics.find((e) => e.id === filters.epic);
  const type = data.types.find((t) => t.id === filters.type);
  const who = filters.assignee === "none" ? "Personne" : userById(filters.assignee)?.name;

  return (
    <div className="flex items-center gap-1.5 border-t border-line px-7 py-2 max-md:overflow-x-auto max-md:px-4">
      <label className="flex h-7 w-[200px] shrink-0 items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-2 focus-within:border-ink/50">
        <Search className="size-3.5 text-ink-3" />
        <input value={filters.q} onChange={(e) => set({ q: e.target.value })} placeholder="Filtrer les tickets" className="min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-ink-3" />
      </label>
      <Picker label="Responsable" value={filters.assignee} noneLabel="Tout le monde" onChange={(v) => set({ assignee: (v as string) || null })} options={[{ value: "none", label: "Personne" }, ...users.map((u) => ({ value: u.id, label: u.name, icon: <Avatar id={u.id} name={u.name} size="xs" /> }))]} className="shrink-0">
        <span className={chip(!!filters.assignee)}>{who ?? "Responsable"}</span>
      </Picker>
      <Picker label="Priorité" value={filters.priority} noneLabel="Toutes" onChange={(v) => set({ priority: (v as string) || null })} options={PRIORITIES.map((p) => ({ value: String(p.value), label: p.label, icon: <PriorityIcon priority={p.value} /> }))} className="shrink-0">
        <span className={chip(!!filters.priority)}>{filters.priority ? PRIORITIES[Number(filters.priority)].label : "Priorité"}</span>
      </Picker>
      {data.labels.length > 0 && (
        <Picker label="Étiquette" value={filters.label} noneLabel="Toutes" onChange={(v) => set({ label: (v as string) || null })} options={data.labels.map((l) => ({ value: l.id, label: l.name, icon: <span className={cn("size-2.5 rounded-full", `dot-${l.tone}`)} /> }))} className="shrink-0">
          {label ? <span className={chip(true)}>{label.name}</span> : <span className={chip(false)}>Étiquette</span>}
        </Picker>
      )}
      {data.epics.length > 0 && (
        <Picker label="Epic" value={filters.epic} noneLabel="Toutes" onChange={(v) => set({ epic: (v as string) || null })} options={[{ value: "none", label: "Sans epic" }, ...data.epics.map((e) => ({ value: e.id, label: e.name }))]} className="shrink-0">
          <span className={chip(!!filters.epic)}>{filters.epic === "none" ? "Sans epic" : (epic?.name ?? "Epic")}</span>
        </Picker>
      )}
      {data.types.length > 0 && (
        <Picker label="Type" value={filters.type} noneLabel="Tous" onChange={(v) => set({ type: (v as string) || null })} options={data.types.map((t) => ({ value: t.id, label: t.name, icon: <TypeIcon icon={t.icon} className="size-3.5" /> }))} className="shrink-0">
          <span className={chip(!!filters.type)}>
            {type && <TypeIcon icon={type.icon} className="size-3.5" />}
            {type?.name ?? "Type"}
          </span>
        </Picker>
      )}
      <button onClick={() => set({ subIssues: !filters.subIssues })} aria-pressed={filters.subIssues} className={cn("press shrink-0", chip(filters.subIssues))}>
        Sous-tickets
      </button>
      {active && (
        <button onClick={() => setFilters({ ...NO_FILTERS, subIssues: filters.subIssues })} className="press flex h-7 shrink-0 items-center gap-1 rounded-lg px-2 text-[12.5px] text-ink-3 hover:text-ink">
          <X className="size-3.5" />
          Effacer
        </button>
      )}
    </div>
  );
}
