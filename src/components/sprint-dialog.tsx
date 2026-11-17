"use client";

import { Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useProjectCtx } from "@/components/project-context";
import { Button, Field, inputClass, Modal } from "@/components/ui";
import type { Sprint } from "@/lib/types";
import { api, cn } from "@/lib/utils";

// Dates are "YYYY-MM-DD" strings: the math is done in UTC so no timezone can shift a day.
const DAY = 86_400_000;

/** The number of the day since 1970, to subtract two dates. */
export function dayNumber(date: string) {
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY);
}

export function addDays(date: string, days: number) {
  return new Date((dayNumber(date) + days) * DAY).toISOString().slice(0, 10);
}

/** The local day of a moment (now by default), as "YYYY-MM-DD". */
export function localDay(at: Date = new Date()) {
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
}

/** "Sprint 4" after "Sprint 3", and two weeks starting the day after the last sprint ends (never in the past). */
export function suggestSprint(sprints: Sprint[]) {
  const numbers = sprints.map((s) => Number(/sprint\s+(\d+)/i.exec(s.name)?.[1] ?? 0));
  const next = Math.max(sprints.length, ...numbers) + 1;
  const today = localDay();
  const lastEnd = sprints.reduce<string | null>((max, s) => (s.endDate && (!max || s.endDate > max) ? s.endDate : max), null);
  const after = lastEnd ? addDays(lastEnd, 1) : today;
  const startDate = after > today ? after : today;
  return { name: `Sprint ${next}`, startDate, endDate: addDays(startDate, 13) };
}

/** Creates a sprint, or edits its name, goal and dates. */
export function SprintDialog({ sprint, onClose }: { sprint: Sprint | null; onClose: () => void }) {
  const { data, reload } = useProjectCtx();
  const [suggestion] = useState(() => suggestSprint(data.sprints));
  const [name, setName] = useState(sprint?.name ?? suggestion.name);
  const [goal, setGoal] = useState(sprint?.goal ?? "");
  const [startDate, setStartDate] = useState(sprint ? (sprint.startDate ?? "") : suggestion.startDate);
  const [endDate, setEndDate] = useState(sprint ? (sprint.endDate ?? "") : suggestion.endDate);
  const [busy, setBusy] = useState(false);
  const badDates = !!startDate && !!endDate && endDate < startDate;
  const days = startDate && endDate && !badDates ? dayNumber(endDate) - dayNumber(startDate) + 1 : 0;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (badDates) return;
    setBusy(true);
    const json = { name, goal, startDate: startDate || null, endDate: endDate || null };
    try {
      if (sprint) await api(`/api/sprints/${sprint.id}`, { method: "PATCH", json });
      else await api(`/api/projects/${data.project.key}/sprints`, { method: "POST", json });
      await reload();
      onClose();
    } catch (err) {
      toast.error((err as Error).message);
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!sprint || !(await deleteSprint(sprint))) return;
    await reload();
    onClose();
  };

  return (
    <Modal title={sprint ? "Modifier le sprint" : "Nouveau sprint"} onClose={onClose}>
      <form onSubmit={save} className="flex flex-col gap-3">
        <Field label="Nom">
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={300} placeholder="Sprint 1" className={inputClass} />
        </Field>
        <Field label="Objectif" hint="Ce que l'équipe veut avoir fini à la fin du sprint.">
          <textarea value={goal} onChange={(e) => setGoal(e.target.value)} rows={2} maxLength={2000} className={cn(inputClass, "h-auto py-2")} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Début">
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Fin">
            <input type="date" value={endDate} min={startDate || undefined} onChange={(e) => setEndDate(e.target.value)} aria-invalid={badDates} className={inputClass} />
          </Field>
        </div>
        <p role={badDates ? "alert" : undefined} className={cn("text-[12px]", badDates ? "font-medium text-ink" : "text-ink-3")}>
          {badDates ? "La fin du sprint est avant son début." : days ? `${days} jour${days > 1 ? "s" : ""}, premier et dernier compris.` : "Sans dates, le sprint n'a ni compte à rebours ni courbe."}
        </p>
        <div className="mt-1 flex items-center gap-2">
          {sprint && (
            <Button type="button" variant="ghost" onClick={remove} className="mr-auto">
              <Trash2 className="size-3.5" />
              Supprimer
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={onClose} className={sprint ? undefined : "ml-auto"}>
            Annuler
          </Button>
          <Button type="submit" variant="primary" disabled={busy || !name.trim() || badDates}>
            {sprint ? "Enregistrer" : "Créer le sprint"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Asks, then deletes a sprint. Its tickets go back to the backlog. Answers whether it was deleted. */
export async function deleteSprint(sprint: Sprint) {
  if (!window.confirm(`Supprimer « ${sprint.name} » ? Ses tickets retournent dans le backlog.`)) return false;
  try {
    await api(`/api/sprints/${sprint.id}`, { method: "DELETE" });
    return true;
  } catch (err) {
    toast.error((err as Error).message);
    return false;
  }
}

/** Ends the sprint in progress: says how many tickets are still open and asks where they go. */
export function CloseSprintDialog({ sprint, openCount, planned, onClose }: { sprint: Sprint; openCount: number; planned: Sprint[]; onClose: () => void }) {
  const { reload } = useProjectCtx();
  // The next planned sprint by default, the backlog ("") when there is none.
  const [target, setTarget] = useState(planned[0]?.id ?? "");
  const [busy, setBusy] = useState(false);

  const finish = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/api/sprints/${sprint.id}`, { method: "PATCH", json: { state: "done", moveOpenTo: (openCount && target) || null } });
      await reload();
      toast.success(`${sprint.name} est terminé`);
      onClose();
    } catch (err) {
      toast.error((err as Error).message);
      setBusy(false);
    }
  };

  const choices = [...planned.map((s, i) => ({ value: s.id, label: s.name, hint: i === 0 ? "prochain sprint" : "sprint à venir" })), { value: "", label: "Backlog", hint: "à replanifier plus tard" }];

  return (
    <Modal title="Terminer le sprint" onClose={onClose}>
      <form onSubmit={finish} className="flex flex-col gap-3">
        {openCount === 0 ? (
          <p className="text-[13.5px] text-ink-2">Tous les tickets de « {sprint.name} » sont terminés. Beau travail.</p>
        ) : (
          <>
            <p className="text-[13.5px] text-ink-2">
              {openCount === 1 ? "1 ticket est encore ouvert" : `${openCount} tickets sont encore ouverts`} dans « {sprint.name} ». Où veux-tu {openCount === 1 ? "l'envoyer" : "les envoyer"} ?
            </p>
            <fieldset className="flex flex-col gap-1.5">
              <legend className="sr-only">Destination des tickets ouverts</legend>
              {choices.map((c) => (
                <label key={c.value || "backlog"} className={cn("press flex h-10 cursor-pointer items-center gap-2.5 rounded-lg border px-3 text-[13.5px]", target === c.value ? "border-ink bg-ink/[0.04]" : "border-line-strong hover:bg-ink/[0.03]")}>
                  <input type="radio" name="moveOpenTo" value={c.value} checked={target === c.value} onChange={() => setTarget(c.value)} className="accent-[var(--ink)]" />
                  <span className="min-w-0 flex-1 truncate font-medium">{c.label}</span>
                  <span className="shrink-0 text-[12px] text-ink-3">{c.hint}</span>
                </label>
              ))}
            </fieldset>
          </>
        )}
        <p className="text-[12px] text-ink-3">Les tickets terminés restent dans le sprint, pour garder son bilan.</p>
        <div className="mt-1 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" variant="primary" disabled={busy}>
            Terminer le sprint
          </Button>
        </div>
      </form>
    </Modal>
  );
}
