"use client";

import { Clapperboard, Code2, FolderKanban } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { useApp, useProject, type NewIssueDraft } from "@/lib/store";
import { suggestKey, TEMPLATES, validKey } from "@/lib/templates";
import type { Issue, Project, TemplateId } from "@/lib/types";
import { api, cn } from "@/lib/utils";
import { AssigneeField, DueField, SprintField, EpicField, LabelsField, PriorityField, StatusField, TypeField } from "./fields";
import { Picker } from "./picker";
import { Button, Field, inputClass, Modal } from "./ui";

const TEMPLATE_ICON = { general: FolderKanban, media: Clapperboard, software: Code2 };

export function NewProjectDialog({ onClose }: { onClose: () => void }) {
  const { reload } = useApp();
  const router = useRouter();
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [keyTouched, setKeyTouched] = useState(false);
  const [template, setTemplate] = useState<TemplateId>("general");
  const [busy, setBusy] = useState(false);
  const shownKey = keyTouched ? key : suggestKey(name);
  const t = TEMPLATES.find((x) => x.id === template)!;

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const project = await api<Project>("/api/projects", { method: "POST", json: { name, key: shownKey, template } });
      await reload();
      onClose();
      router.push(`/p/${project.key}`);
    } catch (err) {
      toast.error((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal title="Nouveau projet" onClose={onClose} wide>
      <form onSubmit={create} className="flex flex-col gap-4">
        <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Style de projet">
          {TEMPLATES.map((x) => {
            const Icon = TEMPLATE_ICON[x.id];
            const on = x.id === template;
            return (
              <button
                key={x.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setTemplate(x.id)}
                className={cn("press flex flex-col gap-2 rounded-xl border p-3 text-left", on ? "border-ink bg-ink text-bg" : "border-line-strong bg-surface hover:bg-surface-2")}
              >
                <Icon className="size-5" />
                <span className="text-[13.5px] font-medium leading-tight">{x.name}</span>
                <span className={cn("text-[11.5px] leading-snug", on ? "text-bg/70" : "text-ink-3")}>{x.description}</span>
              </button>
            );
          })}
        </div>
        <div className="rounded-xl border border-line bg-surface-2/60 p-3 text-[12px] text-ink-3">
          <span className="font-medium text-ink-2">Statuts : </span>
          {t.statuses.map((s) => s.name).join(" → ")}
          <br />
          <span className="font-medium text-ink-2">Types : </span>
          {t.types.map((s) => s.name).join(", ")}
          {t.epics.length > 0 && (
            <>
              <br />
              <span className="font-medium text-ink-2">Epics de départ : </span>
              {t.epics.join(", ")}
            </>
          )}
        </div>
        <div className="grid grid-cols-[1fr_120px] gap-3">
          <Field label="Nom du projet">
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder={template === "media" ? "Podcast saison 2" : template === "software" ? "Site Saint-Martimmo" : "Mariage de Léa"} className={inputClass} />
          </Field>
          <Field label="Clé">
            <input
              value={shownKey}
              onChange={(e) => {
                setKeyTouched(true);
                setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6));
              }}
              placeholder="WEB"
              className={cn(inputClass, "font-mono uppercase")}
            />
          </Field>
        </div>
        <p className="-mt-2 text-[11.5px] text-ink-3">Les tickets seront numérotés {shownKey || "CLÉ"}-1, {shownKey || "CLÉ"}-2… Tout reste modifiable dans les réglages du projet.</p>
        <Button variant="primary" className="self-end" disabled={busy || !name.trim() || !validKey(shownKey)}>
          {busy ? "Création…" : "Créer le projet"}
        </Button>
      </form>
    </Modal>
  );
}

type Draft = Pick<Issue, "statusId" | "priority" | "assigneeId" | "labelIds" | "epicId" | "typeId" | "dueDate" | "sprintId"> & { parentId: string | null };

export function NewIssueDialog({ draft, onClose }: { draft: NewIssueDraft; onClose: () => void }) {
  const { projects } = useApp();
  const open = projects.filter((p) => !p.archived);
  // The key comes from the address bar: if it names no project, start from the first one.
  const [projectKey, setProjectKey] = useState((draft.projectKey && projects.some((p) => p.key === draft.projectKey) ? draft.projectKey : open[0]?.key) ?? "");

  if (!projectKey) {
    return (
      <Modal title="Nouveau ticket" onClose={onClose}>
        <p className="text-[13.5px] text-ink-2">Crée d&apos;abord un projet : chaque ticket appartient à un projet.</p>
      </Modal>
    );
  }

  return (
    <Modal title="Nouveau ticket" onClose={onClose} wide>
      <Picker label="Projet" value={projectKey} onChange={(v) => v && setProjectKey(v as string)} options={open.map((p) => ({ value: p.key, label: p.name, hint: p.key }))} className="-mt-2 mb-3 w-fit">
        <span className="flex h-7 items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-2 text-[12.5px] text-ink-2 hover:text-ink">
          <span className="font-mono text-[11px] text-ink-3">{projectKey}</span>
          {projects.find((p) => p.key === projectKey)?.name}
        </span>
      </Picker>
      <IssueForm key={projectKey} projectKey={projectKey} draft={draft} onClose={onClose} />
    </Modal>
  );
}

function IssueForm({ projectKey, draft, onClose }: { projectKey: string; draft: NewIssueDraft; onClose: () => void }) {
  const { data, error } = useProject(projectKey);
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fields, setFields] = useState<Draft | null>(null);

  if (!data) return <div className="flex h-40 items-center justify-center text-[13px] text-ink-3">{error && `${error}. Choisis un autre projet ci-dessus.`}</div>;
  const sameProject = draft.projectKey === projectKey;
  const f: Draft = fields ?? {
    statusId: (sameProject && draft.statusId) || data.statuses.find((s) => s.category === "todo")?.id || data.statuses[0].id,
    priority: 0,
    assigneeId: null,
    labelIds: [],
    epicId: (sameProject && draft.epicId) || null,
    typeId: data.types[0]?.id ?? null,
    dueDate: null,
    sprintId: (sameProject && draft.sprintId) || null,
    parentId: (sameProject && draft.parentId) || null,
  };
  const change = (patch: Partial<Draft>) => setFields({ ...f, ...patch });

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const issue = await api<Issue>(`/api/projects/${projectKey}/issues`, { method: "POST", json: { title, description, ...f } });
      toast(`${issue.ref} créé`, { action: { label: "Ouvrir", onClick: () => router.push(`/p/${projectKey}?issue=${issue.ref}`) } });
      if (more) {
        setTitle("");
        setDescription("");
        setBusy(false);
      } else onClose();
    } catch (err) {
      toast.error((err as Error).message);
      setBusy(false);
    }
  };

  const parent = f.parentId ? data.issues.find((i) => i.id === f.parentId) : null;

  return (
    <form onSubmit={create} className="flex flex-col gap-3">
      {parent && (
        <p className="text-[12.5px] text-ink-3">
          Sous-ticket de <span className="font-mono">{parent.ref}</span> {parent.title}
        </p>
      )}
      <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} placeholder="Titre du ticket" aria-label="Titre" className="w-full bg-transparent font-display text-[24px] leading-tight outline-none placeholder:text-ink-3" />
      <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} placeholder="Description (Markdown)…" aria-label="Description" className="w-full resize-none bg-transparent text-[14px] leading-relaxed text-ink-2 outline-none placeholder:text-ink-3" />
      <div className="flex flex-wrap gap-1 border-t border-line pt-3 [&>*]:w-auto [&>*]:rounded-lg [&>*]:border [&>*]:border-line-strong">
        <StatusField data={data} issue={f} onChange={change} />
        <PriorityField data={data} issue={f} onChange={change} />
        <AssigneeField data={data} issue={f} onChange={change} />
        <TypeField data={data} issue={f} onChange={change} />
        <LabelsField data={data} issue={f} onChange={change} />
        <EpicField data={data} issue={f} onChange={change} />
        {data.sprints.some((x) => x.state !== "done") && <SprintField data={data} issue={f} onChange={change} />}
        <DueField data={data} issue={f} onChange={change} />
      </div>
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-[12.5px] text-ink-3">
          <input type="checkbox" checked={more} onChange={(e) => setMore(e.target.checked)} className="accent-[var(--ink)]" />
          En créer un autre
        </label>
        <Button variant="primary" className="ml-auto" disabled={busy || !title.trim()}>
          Créer le ticket
        </Button>
      </div>
    </form>
  );
}
