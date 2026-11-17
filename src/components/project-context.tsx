"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useProject } from "@/lib/store";
import type { Issue, ProjectData } from "@/lib/types";
import { api } from "@/lib/utils";

export type Filters = { q: string; assignee: string | null; label: string | null; epic: string | null; sprint: string | null; type: string | null; priority: string | null; subIssues: boolean };
export const NO_FILTERS: Filters = { q: "", assignee: null, label: null, epic: null, sprint: null, type: null, priority: null, subIssues: false };

type ProjectCtx = {
  filters: Filters;
  setFilters: (f: Filters) => void;
  /** The tickets that pass the filters. */
  visible: Issue[];
  data: ProjectData;
  reload: () => Promise<void>;
  mutate: (fn: (d: ProjectData) => ProjectData) => void;
  /** Changes a ticket on screen at once, then on the server. On failure, the server's version comes back. */
  updateIssue: (issue: Issue, patch: Partial<Issue>) => Promise<void>;
  /** Opens a ticket in the side panel (?issue=WEB-12), or closes it with null. */
  openIssue: (ref: string | null) => void;
  openRef: string | null;
};

const Ctx = createContext<ProjectCtx | null>(null);

export function useProjectCtx() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useProjectCtx hors de ProjectProvider");
  return ctx;
}

export function ProjectProvider({ projectKey, children }: { projectKey: string; children: React.ReactNode }) {
  const { data, error, reload, mutate } = useProject(projectKey);
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const openRef = params.get("issue");
  const [rawFilters, setFilters] = useState<Filters>(NO_FILTERS);

  // A filter on a label, type or epic that has since been deleted no longer applies.
  const filters = useMemo<Filters>(() => {
    if (!data) return rawFilters;
    const alive = (id: string | null, list: { id: string }[], extra?: string) => (id && (id === extra || list.some((x) => x.id === id)) ? id : null);
    const next = { ...rawFilters, label: alive(rawFilters.label, data.labels), type: alive(rawFilters.type, data.types), epic: alive(rawFilters.epic, data.epics, "none"), sprint: alive(rawFilters.sprint, data.sprints, "none") };
    return next.label === rawFilters.label && next.type === rawFilters.type && next.epic === rawFilters.epic && next.sprint === rawFilters.sprint ? rawFilters : next;
  }, [rawFilters, data]);

  const visible = useMemo(() => {
    if (!data) return [];
    const q = filters.q.trim().toLowerCase();
    return data.issues.filter(
      (i) =>
        (filters.subIssues || !i.parentId || q) &&
        (!q || i.title.toLowerCase().includes(q) || i.ref.toLowerCase() === q || i.ref.toLowerCase().includes(q)) &&
        (!filters.assignee || (filters.assignee === "none" ? !i.assigneeId : i.assigneeId === filters.assignee)) &&
        (!filters.label || i.labelIds.includes(filters.label)) &&
        (!filters.epic || (filters.epic === "none" ? !i.epicId : i.epicId === filters.epic)) &&
        (!filters.sprint || (filters.sprint === "none" ? !i.sprintId : i.sprintId === filters.sprint)) &&
        (!filters.type || i.typeId === filters.type) &&
        (!filters.priority || String(i.priority) === filters.priority),
    );
  }, [data, filters]);

  const pending = useRef(new Map<string, number>());

  const updateIssue = useCallback(
    async (issue: Issue, patch: Partial<Issue>) => {
      const mine = (pending.current.get(issue.id) ?? 0) + 1;
      pending.current.set(issue.id, mine);
      mutate((d) => ({ ...d, issues: d.issues.map((i) => (i.id === issue.id ? { ...i, ...patch } : i)) }));
      try {
        const saved = await api<Issue>(`/api/issues/${issue.id}`, { method: "PATCH", json: patch });
        // A newer change to the same ticket is on its way: its answer is the one to show.
        if (pending.current.get(issue.id) !== mine) return;
        mutate((d) => ({ ...d, issues: d.issues.map((i) => (i.id === saved.id ? saved : i)) }));
        void reload();
      } catch (e) {
        toast.error((e as Error).message);
        void reload();
      }
    },
    [mutate, reload],
  );

  const openIssue = useCallback(
    (ref: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (ref) next.set("issue", ref);
      else next.delete("issue");
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  const value = useMemo(() => (data ? { data, reload, mutate, updateIssue, openIssue, openRef, filters, setFilters, visible } : null), [data, reload, mutate, updateIssue, openIssue, openRef, filters, visible]);

  if (!value)
    return error ? (
      <div className="flex flex-1 flex-col items-center justify-center gap-1 p-8 text-center">
        <p className="text-[15px] font-medium">{error}</p>
        <p className="text-[13px] text-ink-3">Le projet a peut-être été supprimé ou sa clé a changé.</p>
      </div>
    ) : (
      <div className="flex-1" />
    );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
