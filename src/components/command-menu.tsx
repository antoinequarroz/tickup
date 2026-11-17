"use client";

import { Command } from "cmdk";
import { FolderKanban, Hash, Inbox, LayoutGrid, Plus, Settings, SquarePen } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useApp } from "@/lib/store";

export function CommandMenu() {
  const { projects, commandOpen: open, setCommandOpen: setOpen, setNewIssue, setNewProject } = useApp();
  const router = useRouter();
  const [search, setSearch] = useState("");
  // "WEB-12": go straight to that ticket.
  const ref = /^([A-Za-z][A-Za-z0-9]{1,5})-(\d+)$/.exec(search.trim());
  const refProject = ref && projects.find((p) => p.key === ref[1].toUpperCase());

  const run = (fn: () => void) => {
    setOpen(false);
    setSearch("");
    fn();
  };

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Recherche"
      overlayClassName="fixed inset-0 z-40 bg-[rgba(15,14,12,0.3)] backdrop-blur-[2px]"
      contentClassName="fixed top-[16vh] left-1/2 z-50 w-[min(600px,calc(100vw-32px))] -translate-x-1/2 overflow-hidden rounded-2xl border border-line-strong bg-surface shadow-[0_30px_80px_-20px_rgba(0,0,0,0.45)]"
    >
      <Command.Input value={search} onValueChange={setSearch} placeholder="Aller à un projet, un ticket (WEB-12), une action…" className="h-12 w-full border-b border-line bg-transparent px-4 text-[14.5px] outline-none placeholder:text-ink-3" />
      <Command.List className="scroll-thin max-h-[380px] overflow-y-auto p-2 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-ink-3">
        <Command.Empty className="py-10 text-center text-[13px] text-ink-3">Aucun résultat.</Command.Empty>
        {refProject && (
          <Command.Group heading="Ticket">
            <Item value={search} onSelect={() => run(() => router.push(`/p/${refProject.key}?issue=${search.trim().toUpperCase()}`))} icon={<Hash className="size-4" />}>
              Ouvrir {search.trim().toUpperCase()}
            </Item>
          </Command.Group>
        )}
        <Command.Group heading="Projets">
          {projects.map((p) => (
            <Item key={p.id} value={`projet ${p.name} ${p.key} ${p.id}`} onSelect={() => run(() => router.push(`/p/${p.key}`))} icon={<FolderKanban className="size-4" />}>
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
              <span className="shrink-0 font-mono text-[11px] text-ink-3">{p.key}</span>
            </Item>
          ))}
        </Command.Group>
        <Command.Group heading="Actions">
          <Item onSelect={() => run(() => setNewIssue({ projectKey: /^\/p\/([^/]+)/.exec(window.location.pathname)?.[1]?.toUpperCase() }))} icon={<SquarePen className="size-4" />}>
            Nouveau ticket
          </Item>
          <Item onSelect={() => run(() => setNewProject(true))} icon={<Plus className="size-4" />}>
            Nouveau projet
          </Item>
          <Item onSelect={() => run(() => router.push("/my"))} icon={<Inbox className="size-4" />}>
            Mes tickets
          </Item>
          <Item onSelect={() => run(() => router.push("/modules"))} icon={<LayoutGrid className="size-4" />}>
            Suite
          </Item>
          <Item onSelect={() => run(() => router.push("/settings"))} icon={<Settings className="size-4" />}>
            Réglages
          </Item>
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  );
}

function Item({ children, icon, onSelect, value }: { children: React.ReactNode; icon: React.ReactNode; onSelect: () => void; value?: string }) {
  return (
    <Command.Item value={value} onSelect={onSelect} className="flex h-9 cursor-default items-center gap-2.5 rounded-lg px-2 text-[13.5px] text-ink-2 data-[selected=true]:bg-ink/[0.05] data-[selected=true]:text-ink">
      <span className="text-ink-3">{icon}</span>
      {children}
    </Command.Item>
  );
}
