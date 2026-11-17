"use client";

import { ArrowUpRight, FolderKanban, Inbox, LayoutGrid, Map as MapIcon, Plus, Search, Settings, SquarePen } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { Toaster } from "sonner";
import { AppProvider, useApp } from "@/lib/store";
import { APP_NAME, cn } from "@/lib/utils";
import { CommandMenu } from "./command-menu";
import { NewIssueDialog, NewProjectDialog } from "./dialogs";
import { Progress } from "./icons";
import { Logo } from "./logo";
import { ModulePicto } from "./module-icon";
import { Avatar, Kbd, primaryClass } from "./ui";

const NAV = [
  { href: "/my", label: "Mes tickets", Icon: Inbox },
  { href: "/projects", label: "Projets", Icon: FolderKanban },
  { href: "/roadmap", label: "Roadmap", Icon: MapIcon },
  { href: "/modules", label: "Suite", Icon: LayoutGrid },
  { href: "/settings", label: "Réglages", Icon: Settings },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <AppProvider>
      <Shell>{children}</Shell>
    </AppProvider>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const { commandOpen, setCommandOpen, newProject, setNewProject, newIssue, setNewIssue } = useApp();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).closest("input, textarea, select, [contenteditable=true], [role=listbox], [role=dialog][aria-modal]");
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandOpen(!commandOpen);
      } else if (!typing && !e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === "c" && !newIssue && !newProject && !commandOpen) {
        // "C" creates a ticket, in the project on screen when there is one.
        e.preventDefault();
        const key = /^\/p\/([^/]+)/.exec(window.location.pathname)?.[1];
        setNewIssue({ projectKey: key ? decodeURIComponent(key).toUpperCase() : undefined });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [commandOpen, setCommandOpen, newIssue, newProject, setNewIssue]);

  return (
    <div className="flex h-dvh min-h-0">
      <aside className="flex w-[248px] shrink-0 flex-col gap-1 px-3 py-3 max-md:hidden">
        <Sidebar />
      </aside>
      <main className="flex min-w-0 flex-1 flex-col p-2 pl-0 max-md:p-0">
        <MobileBar />
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-line bg-surface/70 shadow-card backdrop-blur-xl max-md:rounded-none max-md:border-0">{children}</div>
      </main>
      <CommandMenu />
      {newProject && <NewProjectDialog onClose={() => setNewProject(false)} />}
      {newIssue && <NewIssueDialog draft={newIssue} onClose={() => setNewIssue(null)} />}
      <Toaster position="bottom-right" toastOptions={{ className: "!rounded-xl !border-line-strong !bg-surface !text-ink !shadow-card !font-sans" }} />
    </div>
  );
}

function Sidebar() {
  const pathname = usePathname();
  const { me, projects, modules, setCommandOpen, setNewIssue, setNewProject } = useApp();
  const linked = modules.filter((m) => m.status === "linked");
  const open = projects.filter((p) => !p.archived);
  const current = /^\/p\/([^/]+)/.exec(pathname)?.[1]?.toUpperCase();

  return (
    <>
      <div className="flex items-center gap-2 px-1.5 pb-3">
        <Logo />
        <span className="text-[15px] font-semibold tracking-[-0.01em]">{APP_NAME}</span>
        <span className="ml-auto rounded-md border border-line px-1.5 py-px font-mono text-[10px] text-ink-3">v0.2</span>
      </div>

      <div className="mb-2 flex gap-1.5">
        <button onClick={() => setNewIssue({ projectKey: current })} className={cn("press flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg text-[13px] font-medium", primaryClass)}>
          <SquarePen className="size-4" strokeWidth={2.2} />
          Nouveau ticket
        </button>
        <button onClick={() => setCommandOpen(true)} aria-label="Rechercher" className="press flex size-9 items-center justify-center rounded-lg border border-line-strong bg-surface text-ink-2 shadow-card hover:text-ink">
          <Search className="size-4" />
        </button>
      </div>

      <nav className="flex flex-col gap-px">
        {NAV.map(({ href, label, Icon }) => {
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn("flex h-8 items-center gap-2.5 rounded-lg px-2 text-[13.5px] transition-colors duration-150", active ? "bg-surface font-medium text-ink shadow-card" : "text-ink-2 hover:bg-ink/[0.04] hover:text-ink")}
            >
              <Icon className={cn("size-4", active ? "text-ink" : "text-ink-3")} strokeWidth={2} />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="scroll-thin -mx-1 mt-3 flex min-h-0 flex-1 flex-col overflow-y-auto px-1">
        <SectionTitle onAdd={() => setNewProject(true)} addLabel="Nouveau projet">
          Projets
        </SectionTitle>
        {open.map((p) => {
          const active = current === p.key;
          return (
            <Link
              key={p.id}
              href={`/p/${p.key}`}
              className={cn("flex h-8 shrink-0 items-center gap-2.5 rounded-lg px-2 text-[13.5px] transition-colors duration-150", active ? "bg-surface font-medium text-ink shadow-card" : "text-ink-2 hover:bg-ink/[0.04] hover:text-ink")}
            >
              <Progress done={p.doneCount} total={p.issueCount} />
              <span className="truncate">{p.name}</span>
              <span className="ml-auto font-mono text-[10.5px] text-ink-3">{p.key}</span>
            </Link>
          );
        })}
        {!open.length && (
          <button onClick={() => setNewProject(true)} className="flex items-center gap-1.5 px-2 py-1 text-left text-[12.5px] text-ink-3 hover:text-ink">
            <Plus className="size-3.5" />
            Créer ton premier projet
          </button>
        )}
        {linked.length > 0 && (
          <>
            <SectionTitle>Suite</SectionTitle>
            {linked.map((m) => (
              <a key={m.id} href={m.url} target="_blank" rel="noreferrer" className="group flex h-8 shrink-0 items-center gap-2.5 rounded-lg px-2 text-[13.5px] text-ink-2 transition-colors duration-150 hover:bg-ink/[0.04] hover:text-ink">
                <ModulePicto icon={m.icon} className="size-[18px]" />
                {m.name}
                <ArrowUpRight className="ml-auto size-3.5 text-ink-3 opacity-0 transition-opacity group-hover:opacity-100" />
              </a>
            ))}
          </>
        )}
      </div>

      <div className="mt-2 flex flex-col gap-1.5 rounded-xl border border-line bg-surface/60 p-2.5">
        <Link href="/settings" className="flex items-center gap-2 text-[12.5px]">
          <Avatar id={me.id} name={me.name} size="sm" />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium leading-tight">{me.name}</span>
            <span className="block truncate text-[11px] leading-tight text-ink-3">{me.role === "admin" ? "Administrateur" : "Membre"}</span>
          </span>
        </Link>
        <div className="mt-1 flex items-center gap-1.5 text-[11px] text-ink-3">
          <Kbd>⌘</Kbd>
          <Kbd>K</Kbd>
          <span>tout trouver ·</span>
          <Kbd>C</Kbd>
          <span>ticket</span>
        </div>
      </div>
    </>
  );
}

function SectionTitle({ children, onAdd, addLabel }: { children: React.ReactNode; onAdd?: () => void; addLabel?: string }) {
  return (
    <div className="mt-4 flex shrink-0 items-center justify-between px-2 pb-1.5 first:mt-1">
      <span className="text-[11px] font-medium tracking-wide text-ink-3 uppercase">{children}</span>
      {onAdd && (
        <button onClick={onAdd} aria-label={addLabel} title={addLabel} className="press -mr-1 flex size-5 items-center justify-center rounded-md text-ink-3 hover:bg-ink/[0.06] hover:text-ink">
          <Plus className="size-3.5" strokeWidth={2.4} />
        </button>
      )}
    </div>
  );
}

function MobileBar() {
  const pathname = usePathname();
  const { setCommandOpen, setNewIssue } = useApp();
  return (
    <div className="flex items-center gap-1 border-b border-line px-3 py-2 md:hidden">
      <Logo className="mr-1 size-6" />
      {NAV.map(({ href, label, Icon }) => (
        <Link key={href} href={href} aria-label={label} className={cn("flex size-9 items-center justify-center rounded-lg", pathname.startsWith(href) ? "bg-surface text-ink shadow-card" : "text-ink-3")}>
          <Icon className="size-[18px]" />
        </Link>
      ))}
      <button onClick={() => setCommandOpen(true)} aria-label="Rechercher" className="ml-auto flex size-9 items-center justify-center rounded-lg text-ink-3">
        <Search className="size-[18px]" />
      </button>
      <button onClick={() => setNewIssue({ projectKey: /^\/p\/([^/]+)/.exec(pathname)?.[1]?.toUpperCase() })} aria-label="Nouveau ticket" className="press flex size-9 items-center justify-center rounded-lg bg-accent text-accent-ink">
        <SquarePen className="size-4" strokeWidth={2.2} />
      </button>
    </div>
  );
}
