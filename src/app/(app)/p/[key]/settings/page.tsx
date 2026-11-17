"use client";

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { StatusIcon, TypeIcon } from "@/components/icons";
import { Picker } from "@/components/picker";
import { useProjectCtx } from "@/components/project-context";
import { Avatar, Button, Card, Field, inputClass } from "@/components/ui";
import { useApp } from "@/lib/store";
import { CATEGORIES } from "@/lib/templates";
import { TYPE_ICONS } from "@/lib/type-icons";
import type { StatusCategory } from "@/lib/types";
import { api, cn } from "@/lib/utils";

/** The project's workflow (statuses), labels and ticket types, all editable whatever the template. */
export default function ProjectSettingsPage() {
  return (
    <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-7 max-md:p-4">
      <div className="mx-auto flex max-w-[640px] flex-col gap-4">
        <General />
        <Statuses />
        <Labels />
        <Types />
        <Danger />
      </div>
    </div>
  );
}

/** Runs a change, then reloads the project; errors become a toast. */
function useAct() {
  const { reload } = useProjectCtx();
  return async (url: string, method: string, json?: unknown) => {
    try {
      await api(url, { method, json });
      await reload();
      return true;
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    }
  };
}

function Title({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <h2 className="text-[15px] font-medium">{children}</h2>
      {hint && <p className="mt-1 text-[13px] text-ink-3">{hint}</p>}
    </div>
  );
}

/** A text that saves itself when it loses focus. */
function InlineText({ value, onSave, className }: { value: string; onSave: (v: string) => void; className?: string }) {
  const [text, setText] = useState(value);
  return (
    <input
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => (text.trim() && text.trim() !== value ? onSave(text.trim()) : setText(value))}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      maxLength={80}
      className={cn("h-8 min-w-0 flex-1 rounded-md bg-transparent px-2 text-[13.5px] outline-none hover:bg-ink/[0.04] focus:bg-surface focus:shadow-[0_0_0_1px_var(--line-strong)]", className)}
    />
  );
}

function General() {
  const { data } = useProjectCtx();
  const { users, reload } = useApp();
  const act = useAct();
  const [name, setName] = useState(data.project.name);
  const [description, setDescription] = useState(data.project.description);
  const lead = users.find((u) => u.id === data.project.leadId);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await act(`/api/projects/${data.project.key}`, "PATCH", { name, description })) {
      await reload();
      toast("Projet enregistré");
    }
  };
  return (
    <Card>
      <form onSubmit={save} className="flex flex-col gap-3">
        <Title hint={`Clé ${data.project.key} : elle préfixe les tickets (${data.project.key}-1, ${data.project.key}-2…).`}>Projet</Title>
        <Field label="Nom">
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className={inputClass} />
        </Field>
        <Field label="Description">
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={2000} className={cn(inputClass, "h-auto py-2")} />
        </Field>
        <Field label="Responsable du projet">
          <Picker
            label="Responsable du projet"
            value={data.project.leadId}
            noneLabel="Personne"
            onChange={async (v) => (await act(`/api/projects/${data.project.key}`, "PATCH", { leadId: v || null })) && reload()}
            options={users.map((u) => ({ value: u.id, label: u.name, icon: <Avatar id={u.id} name={u.name} size="xs" /> }))}
          >
            <span className={cn(inputClass, "flex items-center gap-2")}>
              {lead && <Avatar id={lead.id} name={lead.name} size="xs" />}
              <span className={cn(!lead && "text-ink-3")}>{lead?.name ?? "Personne"}</span>
            </span>
          </Picker>
        </Field>
        <Button variant="primary" className="self-start" disabled={!name.trim() || (name === data.project.name && description === data.project.description)}>
          Enregistrer
        </Button>
      </form>
    </Card>
  );
}

function Statuses() {
  const { data } = useProjectCtx();
  const act = useAct();
  const [name, setName] = useState("");
  const [category, setCategory] = useState<StatusCategory>("todo");
  const list = data.statuses;

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    // Swap the two positions.
    void act(`/api/statuses/${list[i].id}`, "PATCH", { position: list[j].position }).then(() => act(`/api/statuses/${list[j].id}`, "PATCH", { position: list[i].position }));
  };

  const remove = (id: string) => {
    const others = list.filter((s) => s.id !== id);
    const count = data.issues.filter((i) => i.statusId === id).length;
    const target = others.find((s) => s.category !== "canceled") ?? others[0];
    if (!target) return toast.error("Un projet garde au moins un statut");
    if (!window.confirm(count ? `Supprimer ce statut ? Ses ${count} tickets iront dans « ${target.name} ».` : "Supprimer ce statut ?")) return;
    void act(`/api/statuses/${id}?moveTo=${target.id}`, "DELETE");
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await act(`/api/projects/${data.project.key}/statuses`, "POST", { name, category })) setName("");
  };

  return (
    <Card className="flex flex-col gap-3">
      <Title hint="Les colonnes du tableau, dans l'ordre. La catégorie dit ce que veut dire le statut (terminé, en cours…), quel que soit son nom.">Statuts</Title>
      <ul className="flex flex-col">
        {list.map((s, i) => (
          <li key={s.id} className="flex items-center gap-1 border-b border-line py-1 last:border-0">
            <StatusIcon category={s.category} className="mx-1" />
            <InlineText key={s.name} value={s.name} onSave={(v) => act(`/api/statuses/${s.id}`, "PATCH", { name: v })} />
            <Picker label="Catégorie" value={s.category} onChange={(v) => v && act(`/api/statuses/${s.id}`, "PATCH", { category: v })} options={CATEGORIES.map((c) => ({ value: c.value, label: c.label, icon: <StatusIcon category={c.value} /> }))} align="end" className="w-[110px] shrink-0">
              <span className="flex h-7 w-full items-center rounded-md px-2 text-[12px] text-ink-3 hover:bg-ink/[0.05]">{CATEGORIES.find((c) => c.value === s.category)?.label}</span>
            </Picker>
            <SmallButton label="Monter" onClick={() => move(i, -1)} disabled={i === 0}>
              <ArrowUp className="size-3.5" />
            </SmallButton>
            <SmallButton label="Descendre" onClick={() => move(i, 1)} disabled={i === list.length - 1}>
              <ArrowDown className="size-3.5" />
            </SmallButton>
            <SmallButton label="Supprimer" onClick={() => remove(s.id)} disabled={list.length < 2}>
              <Trash2 className="size-3.5" />
            </SmallButton>
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="flex gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nouveau statut" maxLength={80} className={cn(inputClass, "h-9")} />
        <Picker label="Catégorie" value={category} onChange={(v) => v && setCategory(v as StatusCategory)} options={CATEGORIES.map((c) => ({ value: c.value, label: c.label, icon: <StatusIcon category={c.value} /> }))} className="w-[140px] shrink-0">
          <span className={cn(inputClass, "flex h-9 items-center gap-2 text-[13px]")}>
            <StatusIcon category={category} />
            {CATEGORIES.find((c) => c.value === category)?.label}
          </span>
        </Picker>
        <Button disabled={!name.trim()}>
          <Plus className="size-4" />
        </Button>
      </form>
    </Card>
  );
}

const TONES = [0, 1, 2, 3, 4];

function ToneDots({ value, onChange }: { value: number; onChange: (t: number) => void }) {
  return (
    <span className="flex gap-1" role="radiogroup" aria-label="Teinte">
      {TONES.map((t) => (
        <button key={t} type="button" role="radio" aria-checked={value === t} aria-label={`Teinte ${t}`} onClick={() => onChange(t)} className={cn("press size-4 rounded-full border border-line-strong", `dot-${t}`, value === t && "ring-2 ring-ink ring-offset-2 ring-offset-surface")} />
      ))}
    </span>
  );
}

function Labels() {
  const { data } = useProjectCtx();
  const act = useAct();
  const [name, setName] = useState("");
  const [tone, setTone] = useState(2);
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await act(`/api/projects/${data.project.key}/labels`, "POST", { name, tone })) setName("");
  };
  return (
    <Card className="flex flex-col gap-3">
      <Title hint="En noir et blanc : cinq teintes, du gris clair au noir.">Étiquettes</Title>
      <ul className="flex flex-col">
        {data.labels.map((l) => (
          <li key={l.id} className="flex items-center gap-2 border-b border-line py-1 last:border-0">
            <span className={cn("ml-1 size-2.5 shrink-0 rounded-full", `dot-${l.tone}`)} />
            <InlineText key={l.name} value={l.name} onSave={(v) => act(`/api/labels/${l.id}`, "PATCH", { name: v })} />
            <ToneDots value={l.tone} onChange={(t) => act(`/api/labels/${l.id}`, "PATCH", { tone: t })} />
            <SmallButton label="Supprimer" onClick={() => window.confirm(`Supprimer l'étiquette « ${l.name} » ?`) && act(`/api/labels/${l.id}`, "DELETE")}>
              <Trash2 className="size-3.5" />
            </SmallButton>
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="flex items-center gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nouvelle étiquette" maxLength={40} className={cn(inputClass, "h-9")} />
        <ToneDots value={tone} onChange={setTone} />
        <Button disabled={!name.trim()}>
          <Plus className="size-4" />
        </Button>
      </form>
    </Card>
  );
}

const ICON_OPTIONS = Object.entries(TYPE_ICONS).map(([value, label]) => ({ value, label, icon: <TypeIcon icon={value} className="size-3.5" /> }));

function Types() {
  const { data } = useProjectCtx();
  const act = useAct();
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("task");
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await act(`/api/projects/${data.project.key}/types`, "POST", { name, icon })) setName("");
  };
  return (
    <Card className="flex flex-col gap-3">
      <Title hint="Vidéo, podcast, bug, feature… ce que sont les tickets de ce projet.">Types de tickets</Title>
      <ul className="flex flex-col">
        {data.types.map((t) => (
          <li key={t.id} className="flex items-center gap-1 border-b border-line py-1 last:border-0">
            <Picker label="Icône" value={t.icon} onChange={(v) => v && act(`/api/types/${t.id}`, "PATCH", { icon: v })} options={ICON_OPTIONS} className="shrink-0">
              <span className="flex size-8 items-center justify-center rounded-md hover:bg-ink/[0.05]">
                <TypeIcon icon={t.icon} className="size-4" />
              </span>
            </Picker>
            <InlineText key={t.name} value={t.name} onSave={(v) => act(`/api/types/${t.id}`, "PATCH", { name: v })} />
            <SmallButton label="Supprimer" onClick={() => window.confirm(`Supprimer le type « ${t.name} » ? Les tickets restent, sans type.`) && act(`/api/types/${t.id}`, "DELETE")}>
              <Trash2 className="size-3.5" />
            </SmallButton>
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="flex items-center gap-2">
        <Picker label="Icône" value={icon} onChange={(v) => v && setIcon(v as string)} options={ICON_OPTIONS} className="shrink-0">
          <span className="flex size-9 items-center justify-center rounded-lg border border-line-strong bg-surface">
            <TypeIcon icon={icon} className="size-4" />
          </span>
        </Picker>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nouveau type" maxLength={40} className={cn(inputClass, "h-9")} />
        <Button disabled={!name.trim()}>
          <Plus className="size-4" />
        </Button>
      </form>
    </Card>
  );
}

function Danger() {
  const { data } = useProjectCtx();
  const { me, reload } = useApp();
  const act = useAct();
  const router = useRouter();
  const archived = data.project.archived;
  const toggle = async () => {
    if (await act(`/api/projects/${data.project.key}`, "PATCH", { archived: !archived })) await reload();
  };
  const remove = async () => {
    const typed = window.prompt(`Supprimer définitivement le projet et ses ${data.issues.length} tickets ? Tape ${data.project.key} pour confirmer.`);
    if (typed?.trim().toUpperCase() !== data.project.key) return;
    try {
      await api(`/api/projects/${data.project.key}`, { method: "DELETE" });
      await reload();
      router.push("/projects");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  return (
    <Card className="flex flex-col gap-3">
      <Title hint={archived ? "Le projet est archivé : il n'apparaît plus dans la barre de gauche ni dans « Mes tickets »." : "Archiver range le projet sans rien effacer."}>Archiver ou supprimer</Title>
      <div className="flex gap-2">
        <Button onClick={toggle}>{archived ? "Désarchiver" : "Archiver le projet"}</Button>
        {me.role === "admin" && (
          <Button variant="danger" onClick={remove}>
            <Trash2 className="size-4" />
            Supprimer
          </Button>
        )}
      </div>
    </Card>
  );
}

function SmallButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} title={label} className="press flex size-7 shrink-0 items-center justify-center rounded-md text-ink-3 hover:bg-ink/[0.05] hover:text-ink disabled:pointer-events-none disabled:opacity-30">
      {children}
    </button>
  );
}
