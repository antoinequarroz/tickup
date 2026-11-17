"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { toast } from "sonner";
import { useProject } from "@/lib/store";
import type { Issue, ProjectData } from "@/lib/types";
import { api } from "@/lib/utils";

export type Filters = { q: string; assignee: string | null; label: string | null; epic: string | null; type: string | null; priority: string | null; subIssues: boolean };
export const NO_FILTERS: Filters = { q: "", assignee: null, label: null, epic: null, type: null, priority: null, subIssues: false };

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
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);

  const visible = useMemo(() => {
    if (!data) return [];
    const q = filters.q.trim().toLowerCase();
    return data.issues.filter(
      (i) =>
        (filters.subIssues || !i.parentId || filters.q) &&
        (!q || i.title.toLowerCase().includes(q) || i.ref.toLowerCase() === q || i.ref.toLowerCase().includes(q)) &&
        (!filters.assignee || (filters.assignee === "none" ? !i.assigneeId : i.assigneeId === filters.assignee)) &&
        (!filters.label || i.labelIds.includes(filters.label)) &&
        (!filters.epic || (filters.epic === "none" ? !i.epicId : i.epicId === filters.epic)) &&
        (!filters.type || i.typeId === filters.type) &&
        (!filters.priority || String(i.priority) === filters.priority),
    );
  }, [data, filters]);

  const updateIssue = useCallback(
    async (issue: Issue, patch: Partial<Issue>) => {
      mutate((d) => ({ ...d, issues: d.issues.map((i) => (i.id === issue.id ? { ...i, ...patch } : i)) }));
      try {
        const saved = await api<Issue>(`/api/issues/${issue.id}`, { method: "PATCH", json: patch });
        mutate((d) => ({ ...d, issues: d.issues.map((i) => (i.id === saved.id ? saved : i)) }));
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
