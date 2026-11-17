"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { AppState, ProjectData, ServerEvent, User } from "./types";
import { api, APP_NAME } from "./utils";

/** What a view hears: server events, plus "resync" after the connection came back. */
export type LiveEvent = ServerEvent | { type: "resync" };

/** A ticket to create, with the fields the place it is created from already knows. */
export type NewIssueDraft = { projectKey?: string; statusId?: string; epicId?: string; parentId?: string };

type Store = AppState & {
  userById: (id: string | null | undefined) => User | undefined;
  reload: () => Promise<void>;
  listen: (fn: (event: LiveEvent) => void) => () => void;
  commandOpen: boolean;
  setCommandOpen: (open: boolean) => void;
  newProject: boolean;
  setNewProject: (open: boolean) => void;
  newIssue: NewIssueDraft | null;
  setNewIssue: (draft: NewIssueDraft | null) => void;
};

const Ctx = createContext<Store | null>(null);

export function useApp() {
  const store = useContext(Ctx);
  if (!store) throw new Error("useApp hors de AppProvider");
  return store;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AppState | null>(null);
  const [error, setError] = useState("");
  const [commandOpen, setCommandOpen] = useState(false);
  const [newProject, setNewProject] = useState(false);
  const [newIssue, setNewIssue] = useState<NewIssueDraft | null>(null);
  const listeners = useRef(new Set<(event: LiveEvent) => void>());

  const reload = useCallback(async () => {
    try {
      setState(await api<AppState>("/api/state"));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    reload();
    let dropped = false;
    const source = new EventSource("/api/events");
    source.onopen = () => {
      if (!dropped) return;
      // Events were missed while offline: reload everything.
      dropped = false;
      reload();
      listeners.current.forEach((fn) => fn({ type: "resync" }));
    };
    source.onerror = () => {
      dropped = true;
    };
    source.onmessage = (e) => {
      const event = JSON.parse(e.data) as ServerEvent;
      // Project counters live in the shell: any change may move them.
      void reload();
      listeners.current.forEach((fn) => fn(event));
    };
    return () => source.close();
  }, [reload]);

  const listen = useCallback((fn: (event: LiveEvent) => void) => {
    listeners.current.add(fn);
    return () => void listeners.current.delete(fn);
  }, []);

  const store = useMemo<Store | null>(() => {
    if (!state) return null;
    const byId = new Map(state.users.map((u) => [u.id, u]));
    return {
      ...state,
      userById: (id) => (id ? byId.get(id) : undefined),
      reload,
      listen,
      commandOpen,
      setCommandOpen,
      newProject,
      setNewProject,
      newIssue,
      setNewIssue,
    };
  }, [state, reload, listen, commandOpen, newProject, newIssue]);

  if (!store) {
    return error ? (
      <div className="flex h-dvh flex-col items-center justify-center gap-2 p-8 text-center">
        <p className="text-[15px] font-medium">Impossible de charger {APP_NAME}</p>
        <p className="text-[13px] text-ink-3">{error}</p>
      </div>
    ) : (
      <div className="h-dvh" />
    );
  }
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

/**
 * One project, loaded at once and kept fresh: reloaded whenever the server says it changed.
 * `mutate` applies a change on screen first (a kanban drop must feel instant), then the server confirms.
 */
export function useProject(key: string) {
  const { listen } = useApp();
  const [data, setData] = useState<ProjectData | null>(null);
  const [error, setError] = useState("");
  const idRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await api<ProjectData>(`/api/projects/${encodeURIComponent(key)}`);
      idRef.current = next.project.id;
      setData(next);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [key]);

  useEffect(() => {
    setData(null);
    load();
  }, [load]);

  useEffect(
    () =>
      listen((event) => {
        if (event.type === "resync" || event.type === "refresh" || ("projectId" in event && event.projectId === idRef.current)) void load();
      }),
    [listen, load],
  );

  const mutate = useCallback((fn: (d: ProjectData) => ProjectData) => setData((d) => (d ? fn(d) : d)), []);

  return { data, error, reload: load, mutate };
}
