"use client";

import { CalendarDays, CalendarPlus, Layers, Tag, Timer, UserRound } from "lucide-react";
import { useApp } from "@/lib/store";
import { PRIORITIES } from "@/lib/templates";
import type { Issue, Priority, ProjectData } from "@/lib/types";
import { cn, isOverdue, shortDate } from "@/lib/utils";
import { LabelChip, PriorityIcon, Progress, StatusIcon, TypeIcon } from "./icons";
import { Picker } from "./picker";
import { Avatar } from "./ui";

/** How a field shows: "row" in the ticket's side panel (icon and text), "icon" on a card or a list row. */
type Look = "row" | "icon";

type FieldProps = { data: ProjectData; issue: Pick<Issue, "statusId" | "priority" | "assigneeId" | "labelIds" | "epicId" | "typeId" | "dueDate"> & Partial<Pick<Issue, "startDate" | "sprintId">>; onChange: (patch: Partial<Issue>) => void; look?: Look };

const rowClass = "flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-[13px] text-ink hover:bg-ink/[0.04]";
const iconClass = "flex size-6 items-center justify-center rounded-md hover:bg-ink/[0.06]";

export function StatusField({ data, issue, onChange, look = "row" }: FieldProps) {
  const status = data.statuses.find((s) => s.id === issue.statusId);
  return (
    <Picker
      label="Statut"
      value={issue.statusId}
      onChange={(v) => v && onChange({ statusId: v as string })}
      options={data.statuses.map((s) => ({ value: s.id, label: s.name, icon: <StatusIcon category={s.category} /> }))}
    >
      {look === "row" ? (
        <span className={rowClass}>
          {status && <StatusIcon category={status.category} />}
          <span className="truncate">{status?.name ?? "Statut"}</span>
        </span>
      ) : (
        <span className={iconClass} title={status?.name}>
          {status && <StatusIcon category={status.category} />}
        </span>
      )}
    </Picker>
  );
}

export function PriorityField({ issue, onChange, look = "row" }: FieldProps) {
  const p = PRIORITIES.find((x) => x.value === issue.priority)!;
  return (
    <Picker
      label="Priorité"
      value={String(issue.priority)}
      onChange={(v) => onChange({ priority: Number(v ?? 0) as Priority })}
      options={PRIORITIES.map((x) => ({ value: String(x.value), label: x.label, icon: <PriorityIcon priority={x.value} /> }))}
    >
      {look === "row" ? (
        <span className={rowClass}>
          <PriorityIcon priority={issue.priority} />
          <span className={cn("truncate", !issue.priority && "text-ink-3")}>{issue.priority ? p.label : "Priorité"}</span>
        </span>
      ) : (
        <span className={iconClass} title={`Priorité : ${p.label}`}>
          <PriorityIcon priority={issue.priority} />
        </span>
      )}
    </Picker>
  );
}

export function AssigneeField({ issue, onChange, look = "row" }: FieldProps) {
  const { users, userById, me } = useApp();
  const who = userById(issue.assigneeId);
  return (
    <Picker
      label="Responsable"
      value={issue.assigneeId}
      noneLabel="Personne"
      onChange={(v) => onChange({ assigneeId: (v as string) || null })}
      options={users.map((u) => ({ value: u.id, label: u.id === me.id ? `${u.name} (toi)` : u.name, icon: <Avatar id={u.id} name={u.name} size="xs" /> }))}
      align={look === "icon" ? "end" : "start"}
    >
      {look === "row" ? (
        <span className={rowClass}>
          {who ? <Avatar id={who.id} name={who.name} size="xs" /> : <UserRound className="size-[14px] text-ink-3" />}
          <span className={cn("truncate", !who && "text-ink-3")}>{who?.name ?? "Personne"}</span>
        </span>
      ) : (
        <span className={iconClass} title={who ? who.name : "Personne"}>
          {who ? <Avatar id={who.id} name={who.name} size="xs" /> : <UserRound className="size-[14px] text-ink-3" />}
        </span>
      )}
    </Picker>
  );
}

export function LabelsField({ data, issue, onChange }: FieldProps) {
  const chosen = data.labels.filter((l) => issue.labelIds.includes(l.id));
  return (
    <Picker
      label="Étiquettes"
      multiple
      value={issue.labelIds}
      onChange={(v) => onChange({ labelIds: v as string[] })}
      options={data.labels.map((l) => ({ value: l.id, label: l.name, icon: <span className={cn("size-2.5 rounded-full", `dot-${l.tone}`)} /> }))}
    >
      <span className={cn(rowClass, "h-auto min-h-8 flex-wrap py-1")}>
        {chosen.length ? (
          chosen.map((l) => <LabelChip key={l.id} label={l} />)
        ) : (
          <>
            <Tag className="size-[14px] text-ink-3" />
            <span className="text-ink-3">Étiquettes</span>
          </>
        )}
      </span>
    </Picker>
  );
}

export function EpicField({ data, issue, onChange }: FieldProps) {
  const epic = data.epics.find((e) => e.id === issue.epicId);
  return (
    <Picker
      label="Epic"
      value={issue.epicId}
      noneLabel="Aucune epic"
      onChange={(v) => onChange({ epicId: (v as string) || null })}
      options={data.epics.map((e) => ({ value: e.id, label: e.name, icon: <Progress done={e.doneCount} total={e.issueCount} /> }))}
    >
      <span className={rowClass}>
        <Layers className={cn("size-[14px]", epic ? "text-ink" : "text-ink-3")} />
        <span className={cn("truncate", !epic && "text-ink-3")}>{epic?.name ?? "Aucune epic"}</span>
      </span>
    </Picker>
  );
}

export function TypeField({ data, issue, onChange }: FieldProps) {
  const type = data.types.find((t) => t.id === issue.typeId);
  return (
    <Picker
      label="Type"
      value={issue.typeId}
      noneLabel="Sans type"
      onChange={(v) => onChange({ typeId: (v as string) || null })}
      options={data.types.map((t) => ({ value: t.id, label: t.name, icon: <TypeIcon icon={t.icon} className="size-[14px]" /> }))}
    >
      <span className={rowClass}>
        <TypeIcon icon={type?.icon ?? "task"} className={cn("size-[14px]", type ? "text-ink" : "text-ink-3")} />
        <span className={cn("truncate", !type && "text-ink-3")}>{type?.name ?? "Sans type"}</span>
      </span>
    </Picker>
  );
}

export function DueField({ issue, onChange }: FieldProps) {
  return <DateField label="Échéance" value={issue.dueDate} late={isOverdue(issue.dueDate)} min={issue.startDate ?? undefined} onChange={(dueDate) => onChange({ dueDate })} />;
}

/** When work starts: with the due date, the bar of the ticket on the planning. */
export function StartField({ issue, onChange }: FieldProps) {
  return <DateField label="Début" value={issue.startDate ?? null} max={issue.dueDate ?? undefined} Icon={CalendarPlus} onChange={(startDate) => onChange({ startDate })} />;
}

function DateField({ label, value, late, min, max, Icon = CalendarDays, onChange }: { label: string; value: string | null; late?: boolean; min?: string; max?: string; Icon?: typeof CalendarDays; onChange: (v: string | null) => void }) {
  return (
    <label className={cn(rowClass, "relative cursor-pointer")}>
      <Icon className={cn("size-[14px]", value ? "text-ink" : "text-ink-3")} />
      <span className={cn("truncate", !value && "text-ink-3", late && "font-semibold text-ink underline decoration-dotted underline-offset-2")}>{value ? shortDate(value) : label}</span>
      <input
        type="date"
        aria-label={label}
        value={value ?? ""}
        min={min}
        max={max}
        onChange={(e) => onChange(e.target.value || null)}
        className="absolute inset-0 cursor-pointer opacity-0 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:size-full [&::-webkit-calendar-picker-indicator]:cursor-pointer"
      />
    </label>
  );
}

const SPRINT_HINT = { active: "en cours", planned: "prévu", done: "terminé" } as const;

export function SprintField({ data, issue, onChange }: FieldProps) {
  const sprint = data.sprints.find((s) => s.id === issue.sprintId);
  return (
    <Picker
      label="Sprint"
      value={issue.sprintId ?? null}
      noneLabel="Hors sprint (backlog)"
      onChange={(v) => onChange({ sprintId: (v as string) || null })}
      options={data.sprints.filter((s) => s.state !== "done" || s.id === issue.sprintId).map((s) => ({ value: s.id, label: s.name, hint: SPRINT_HINT[s.state] }))}
    >
      <span className={rowClass}>
        <Timer className={cn("size-[14px]", sprint ? "text-ink" : "text-ink-3")} />
        <span className={cn("truncate", !sprint && "text-ink-3")}>{sprint?.name ?? "Hors sprint"}</span>
      </span>
    </Picker>
  );
}
