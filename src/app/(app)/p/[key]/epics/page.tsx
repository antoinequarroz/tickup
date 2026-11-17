"use client";

import { CalendarDays, Layers, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Progress, StatusIcon } from "@/components/icons";
import { Picker } from "@/components/picker";
import { useProjectCtx } from "@/components/project-context";
import { Button, Card, Field, inputClass, Modal } from "@/components/ui";
import { useApp } from "@/lib/store";
import { EPIC_STATES } from "@/lib/templates";
import type { Epic, EpicState } from "@/lib/types";
import { api, cn, shortDate } from "@/lib/utils";

/** Epics: the big pieces of a project, each with its tickets and its progress. The roadmap and Gantt will build on their dates. */
export default function EpicsPage() {
  const { data } = useProjectCtx();
  const [editing, setEditing] = useState<Epic | "new" | null>(null);

  return (
    <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-7 max-md:p-4">
      <div className="mx-auto flex max-w-[860px] flex-col gap-3">
        <div className="flex items-center">
          <p className="flex-1 text-[13px] text-ink-3">Regroupe les tickets par grand chantier, avec une date de début et une date cible.</p>
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus className="size-3.5" />
            Nouvelle epic
          </Button>
        </div>
        {data.epics.map((e, i) => (
          <EpicCard key={e.id} epic={e} index={i} onEdit={() => setEditing(e)} />
        ))}
        {!data.epics.length && (
          <Card className="flex flex-col items-center gap-2 py-10 text-center">
            <Layers className="size-6 text-ink-3" />
            <p className="text-[14px] font-medium">Pas encore d&apos;epic</p>
            <p className="max-w-[360px] text-[13px] text-ink-3">Une epic rassemble les tickets d&apos;un même chantier : « Refonte du site », « Tournage », « Saison 2 »…</p>
          </Card>
        )}
      </div>
      {editing && <EpicDialog epic={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function EpicCard({ epic, index, onEdit }: { epic: Epic; index: number; onEdit: () => void }) {
  const { data, openIssue, reload } = useProjectCtx();
  const { setNewIssue } = useApp();
  const issues = data.issues.filter((i) => i.epicId === epic.id && !i.parentId);
  const state = EPIC_STATES.find((s) => s.value === epic.state)!;
  const setState = async (value: EpicState) => {
    try {
      await api(`/api/epics/${epic.id}`, { method: "PATCH", json: { state: value } });
      await reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const pct = epic.issueCount ? Math.round((epic.doneCount / epic.issueCount) * 100) : 0;

  return (
    <Card className="rise flex flex-col gap-3 p-4" style={{ animationDelay: `${index * 30}ms` }}>
      <div className="flex items-start gap-3">
        <Progress done={epic.doneCount} total={epic.issueCount} className="mt-1 size-5" />
        <button onClick={onEdit} className="min-w-0 flex-1 text-left">
          <h2 className="text-[15px] font-medium leading-tight hover:underline">{epic.name}</h2>
          {epic.description && <p className="mt-1 line-clamp-2 text-[13px] text-ink-3">{epic.description}</p>}
        </button>
        <Picker label="État de l'epic" value={epic.state} onChange={(v) => v && setState(v as EpicState)} options={EPIC_STATES.map((s) => ({ value: s.value, label: s.label }))} align="end" className="shrink-0">
          <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", epic.state === "active" ? "bg-ink text-bg" : epic.state === "done" ? "border border-ink text-ink" : "bg-ink/[0.06] text-ink-3")}>{state.label}</span>
        </Picker>
      </div>
      <div className="flex items-center gap-3 text-[12px] text-ink-3">
        <span className="tabular">
          {epic.doneCount}/{epic.issueCount} tickets · {pct} %
        </span>
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-ink/[0.08]">
          <div className="h-full rounded-full bg-ink transition-[width] duration-500" style={{ width: `${pct}%` }} />
        </div>
        {(epic.startDate || epic.targetDate) && (
          <span className="flex items-center gap-1">
            <CalendarDays className="size-3.5" />
            {epic.startDate ? shortDate(epic.startDate) : "…"} → {epic.targetDate ? shortDate(epic.targetDate) : "…"}
          </span>
        )}
      </div>
      {issues.length > 0 && (
        <div className="flex flex-col border-t border-line pt-1">
          {issues.slice(0, 8).map((i) => {
            const status = data.statuses.find((s) => s.id === i.statusId);
            return (
              <button key={i.id} onClick={() => openIssue(i.ref)} className="flex h-8 items-center gap-2 rounded-md px-1 text-left text-[13px] hover:bg-ink/[0.03]">
                {status && <StatusIcon category={status.category} />}
                <span className="w-[56px] shrink-0 font-mono text-[11.5px] text-ink-3">{i.ref}</span>
                <span className="truncate">{i.title}</span>
              </button>
            );
          })}
          {issues.length > 8 && <p className="px-1 pt-1 text-[12px] text-ink-3">et {issues.length - 8} autres</p>}
        </div>
      )}
      <button onClick={() => setNewIssue({ projectKey: data.project.key, epicId: epic.id })} className="press flex items-center gap-1 self-start rounded-md px-1 text-[12.5px] text-ink-3 hover:text-ink">
        <Plus className="size-3.5" />
        Ticket dans cette epic
      </button>
    </Card>
  );
}

function EpicDialog({ epic, onClose }: { epic: Epic | null; onClose: () => void }) {
  const { data, reload } = useProjectCtx();
  const [name, setName] = useState(epic?.name ?? "");
  const [description, setDescription] = useState(epic?.description ?? "");
  const [startDate, setStartDate] = useState(epic?.startDate ?? "");
  const [targetDate, setTargetDate] = useState(epic?.targetDate ?? "");
  const [busy, setBusy] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const json = { name, description, startDate: startDate || null, targetDate: targetDate || null };
    try {
      if (epic) await api(`/api/epics/${epic.id}`, { method: "PATCH", json });
      else await api(`/api/projects/${data.project.key}/epics`, { method: "POST", json });
      await reload();
      onClose();
    } catch (err) {
      toast.error((err as Error).message);
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!epic || !window.confirm(`Supprimer l'epic « ${epic.name} » ? Ses tickets restent, sans epic.`)) return;
    await api(`/api/epics/${epic.id}`, { method: "DELETE" }).catch((err) => toast.error(err.message));
    await reload();
    onClose();
  };

  return (
    <Modal title={epic ? "Modifier l'epic" : "Nouvelle epic"} onClose={onClose}>
      <form onSubmit={save} className="flex flex-col gap-3">
        <Field label="Nom">
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={300} placeholder="Refonte du site, Tournage saison 2…" className={inputClass} />
        </Field>
        <Field label="Description">
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className={cn(inputClass, "h-auto py-2")} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Début">
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Date cible">
            <input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} className={inputClass} />
          </Field>
        </div>
        <div className="mt-1 flex items-center gap-2">
          {epic && (
            <Button type="button" variant="danger" onClick={remove}>
              <Trash2 className="size-4" />
              Supprimer
            </Button>
          )}
          <Button variant="primary" className="ml-auto" disabled={busy || !name.trim()}>
            {epic ? "Enregistrer" : "Créer l'epic"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
