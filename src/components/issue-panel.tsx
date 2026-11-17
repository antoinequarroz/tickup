"use client";

import { ArrowUpRight, Ban, ChevronRight, Copy, CornerLeftUp, Hash, Link2, Plus, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useApp } from "@/lib/store";
import type { Comment, Issue } from "@/lib/types";
import { api, cn, relative } from "@/lib/utils";
import { AssigneeField, DueField, EpicField, LabelsField, PriorityField, SprintField, StartField, StatusField, TypeField } from "./fields";
import { PriorityIcon, StatusIcon } from "./icons";
import { Picker } from "./picker";
import { useProjectCtx } from "./project-context";
import { Avatar, Button } from "./ui";

/** The ticket opened from a board, a list or an epic, in a panel on the right (full screen on a phone). */
export function IssuePanel() {
  const { data, openRef, openIssue } = useProjectCtx();
  const { newIssue, newProject, commandOpen } = useApp();
  // A dialog or the command menu sits above the panel: Escape is theirs.
  const layered = !!newIssue || newProject || commandOpen;
  const issue = openRef ? data.issues.find((i) => i.ref === openRef.toUpperCase()) : undefined;

  useEffect(() => {
    if (!openRef) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || layered) return;
      const target = e.target as HTMLElement;
      if (target.closest("[role=listbox]")) return;
      // In a field, Escape first leaves the field (which saves it); a second Escape closes the panel.
      if (target.closest("input, textarea")) return target.blur();
      openIssue(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openRef, openIssue, layered]);

  if (!openRef) return null;
  return (
    <>
      <div className="dialog-backdrop absolute inset-0 z-20 bg-[rgba(15,14,12,0.12)]" onClick={() => openIssue(null)} />
      <aside role="dialog" aria-label={issue ? `${issue.ref} ${issue.title}` : "Ticket"} className="panel-in absolute inset-y-0 right-0 z-30 flex w-[min(760px,100%)] flex-col border-l border-line-strong bg-surface shadow-[-30px_0_80px_-30px_rgba(0,0,0,0.35)]">
        {issue ? (
          <IssueDetail key={issue.id} issue={issue} />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
            <p className="text-[15px] font-medium">Ticket introuvable</p>
            <Button onClick={() => openIssue(null)}>Fermer</Button>
          </div>
        )}
      </aside>
    </>
  );
}

function IssueDetail({ issue }: { issue: Issue }) {
  const { data, updateIssue, openIssue, reload } = useProjectCtx();
  const { me } = useApp();
  const change = (patch: Partial<Issue>) => updateIssue(issue, patch);
  const parent = issue.parentId ? data.issues.find((i) => i.id === issue.parentId) : null;
  const subs = data.issues.filter((i) => i.parentId === issue.id).sort((a, b) => a.number - b.number);
  const canParent = data.issues.filter((i) => i.id !== issue.id && !isDescendant(data.issues, i.id, issue.id));

  const remove = async () => {
    if (!window.confirm(`Supprimer ${issue.ref}${subs.length ? ` et ses ${subs.length} sous-tickets` : ""} ?`)) return;
    try {
      await api(`/api/issues/${issue.id}`, { method: "DELETE" });
      openIssue(null);
      await reload();
      toast(`${issue.ref} supprimé`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const copyLink = () => {
    void navigator.clipboard?.writeText(`${window.location.origin}/p/${data.project.key}?issue=${issue.ref}`);
    toast("Lien copié");
  };

  return (
    <>
      <div className="flex h-12 shrink-0 items-center gap-1 border-b border-line px-4">
        {parent && (
          <>
            <button onClick={() => openIssue(parent.ref)} className="press flex min-w-0 items-center gap-1 rounded-md px-1.5 py-1 text-[12.5px] text-ink-3 hover:bg-ink/[0.05] hover:text-ink">
              <CornerLeftUp className="size-3.5" />
              <span className="font-mono">{parent.ref}</span>
              <span className="max-w-[180px] truncate">{parent.title}</span>
            </button>
            <ChevronRight className="size-3.5 text-ink-3" />
          </>
        )}
        <span className="font-mono text-[12.5px] font-medium">{issue.ref}</span>
        <div className="ml-auto flex items-center gap-0.5">
          <IconButton label="Copier le lien" onClick={copyLink}>
            <Link2 className="size-4" />
          </IconButton>
          <IconButton
            label="Copier la référence"
            onClick={() => {
              void navigator.clipboard?.writeText(`${issue.ref} ${issue.title}`);
              toast("Référence copiée");
            }}
          >
            <Copy className="size-4" />
          </IconButton>
          <IconButton label="Supprimer" onClick={remove}>
            <Trash2 className="size-4" />
          </IconButton>
          <IconButton label="Fermer" onClick={() => openIssue(null)}>
            <X className="size-4" />
          </IconButton>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 max-md:flex-col max-md:overflow-y-auto">
        <div className="scroll-thin min-w-0 flex-1 overflow-y-auto px-7 py-6 max-md:overflow-visible max-md:px-4">
          <Title issue={issue} onSave={(title) => change({ title })} />
          <Description issue={issue} onSave={(description) => change({ description })} />

          <SubIssues parent={issue} subs={subs} />
          <Links issue={issue} />
          <Comments issueId={issue.id} meId={me.id} />
        </div>

        <div className="scroll-thin flex w-[240px] shrink-0 flex-col gap-0.5 overflow-y-auto border-l border-line bg-surface-2/50 p-3 max-md:w-full max-md:overflow-visible max-md:border-t max-md:border-l-0">
          <Prop label="Statut">
            <StatusField data={data} issue={issue} onChange={change} />
          </Prop>
          <Prop label="Priorité">
            <PriorityField data={data} issue={issue} onChange={change} />
          </Prop>
          <Prop label="Responsable">
            <AssigneeField data={data} issue={issue} onChange={change} />
          </Prop>
          <Prop label="Type">
            <TypeField data={data} issue={issue} onChange={change} />
          </Prop>
          <Prop label="Étiquettes">
            <LabelsField data={data} issue={issue} onChange={change} />
          </Prop>
          <Prop label="Epic">
            <EpicField data={data} issue={issue} onChange={change} />
          </Prop>
          <Prop label="Sprint">
            <SprintField data={data} issue={issue} onChange={change} />
          </Prop>
          <Prop label="Début">
            <StartField data={data} issue={issue} onChange={change} />
          </Prop>
          <Prop label="Échéance">
            <DueField data={data} issue={issue} onChange={change} />
          </Prop>
          <Prop label="Estimation">
            <Estimate value={issue.estimate} onSave={(estimate) => change({ estimate })} />
          </Prop>
          <Prop label="Ticket parent">
            <Picker
              label="Ticket parent"
              value={issue.parentId}
              noneLabel="Aucun"
              onChange={(v) => change({ parentId: (v as string) || null })}
              options={canParent.map((i) => ({ value: i.id, label: `${i.ref} ${i.title}` }))}
            >
              <span className="flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-[13px] hover:bg-ink/[0.04]">
                <CornerLeftUp className={cn("size-[14px]", parent ? "text-ink" : "text-ink-3")} />
                <span className={cn("truncate", !parent && "text-ink-3")}>{parent ? `${parent.ref} ${parent.title}` : "Aucun"}</span>
              </span>
            </Picker>
          </Prop>
          <p className="mt-3 px-2 text-[11.5px] leading-relaxed text-ink-3">
            Créé {relative(issue.createdAt)}
            <br />
            Modifié {relative(issue.updatedAt)}
            {issue.completedAt && (
              <>
                <br />
                Terminé {relative(issue.completedAt)}
              </>
            )}
          </p>
        </div>
      </div>
    </>
  );
}

const isDescendant = (issues: Issue[], id: string, ancestor: string): boolean => {
  let at = issues.find((i) => i.id === id);
  for (let d = 0; at && d < 50; d++) {
    if (at.parentId === ancestor) return true;
    at = issues.find((i) => i.id === at!.parentId);
  }
  return false;
};

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} aria-label={label} title={label} className="press flex size-8 items-center justify-center rounded-lg text-ink-3 hover:bg-ink/5 hover:text-ink">
      {children}
    </button>
  );
}

function Prop({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="px-2 pt-1.5 text-[11px] font-medium text-ink-3">{label}</p>
      {children}
    </div>
  );
}

/** A textarea that grows with its text and saves when it loses focus. */
function useAutosize(value: string) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return ref;
}

function Title({ issue, onSave }: { issue: Issue; onSave: (title: string) => void }) {
  const [value, setValue] = useState(issue.title);
  const ref = useAutosize(value);
  // A live reload must not wipe what is being typed.
  useEffect(() => {
    if (document.activeElement !== ref.current) setValue(issue.title);
  }, [issue.title, ref]);
  const save = () => {
    const v = value.trim().replace(/\s+/g, " ");
    if (!v) return setValue(issue.title);
    if (v !== issue.title) onSave(v);
  };
  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.target as HTMLTextAreaElement).blur();
        }
      }}
      aria-label="Titre"
      maxLength={300}
      className="w-full resize-none bg-transparent font-display text-[28px] leading-[1.15] outline-none"
    />
  );
}

function Description({ issue, onSave }: { issue: Issue; onSave: (description: string) => void }) {
  const [value, setValue] = useState(issue.description);
  const ref = useAutosize(value);
  useEffect(() => {
    if (document.activeElement !== ref.current) setValue(issue.description);
  }, [issue.description, ref]);
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => value !== issue.description && onSave(value)}
      placeholder="Ajoute une description, des liens, une checklist en Markdown…"
      aria-label="Description"
      className="mt-3 min-h-[90px] w-full resize-none bg-transparent text-[14px] leading-relaxed text-ink-2 outline-none placeholder:text-ink-3"
    />
  );
}

function Estimate({ value, onSave }: { value: number | null; onSave: (v: number | null) => void }) {
  const [text, setText] = useState(value?.toString() ?? "");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (document.activeElement !== input.current) setText(value?.toString() ?? "");
  }, [value]);
  const save = () => {
    const n = text.trim() === "" ? null : Number(text.replace(",", "."));
    if (n !== null && (Number.isNaN(n) || n < 0)) return setText(value?.toString() ?? "");
    if (n !== value) onSave(n);
  };
  return (
    <label className="flex h-8 items-center gap-2 rounded-md px-2 text-[13px] hover:bg-ink/[0.04]">
      <Hash className={cn("size-[14px]", value != null ? "text-ink" : "text-ink-3")} />
      <input ref={input} value={text} onChange={(e) => setText(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} inputMode="decimal" placeholder="Points ou heures" className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-ink-3" />
    </label>
  );
}

/** Dependencies: the tickets this one waits for, and the tickets waiting for it. They are the arrows of the planning. */
function Links({ issue }: { issue: Issue }) {
  const { data, openIssue, reload } = useProjectCtx();
  const byId = new Map(data.issues.map((i) => [i.id, i]));
  const linked = new Set([issue.id, ...issue.blockedBy, ...issue.blocks]);
  const others = data.issues.filter((i) => !linked.has(i.id)).map((i) => ({ value: i.id, label: `${i.ref} ${i.title}` }));
  const isDone = (i: Issue) => {
    const c = data.statuses.find((x) => x.id === i.statusId)?.category;
    return c === "done" || c === "canceled";
  };

  const send = async (method: "POST" | "DELETE", json: { blockedBy: string } | { blocks: string }) => {
    try {
      await api(`/api/issues/${issue.id}/links`, { method, json });
      await reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const rows = [
    ...issue.blockedBy.map((id) => ({ other: byId.get(id), kind: "Bloqué par", body: { blockedBy: id } })),
    ...issue.blocks.map((id) => ({ other: byId.get(id), kind: "Bloque", body: { blocks: id } })),
  ].filter((r) => r.other);
  const waiting = issue.blockedBy.some((id) => byId.get(id) && !isDone(byId.get(id)!));
  const add = "press flex h-7 items-center gap-1 rounded-md px-2 text-[12.5px] text-ink-3 hover:bg-ink/[0.05] hover:text-ink";

  return (
    <section className="mt-6">
      <div className="flex items-center gap-1 border-b border-line pb-2">
        <h3 className="text-[13px] font-medium">Dépendances</h3>
        {waiting && (
          <span className="ml-1 flex items-center gap-1 rounded-full bg-ink px-2 py-px text-[11px] font-medium text-bg">
            <Ban className="size-3" />
            En attente
          </span>
        )}
        <Picker label="Bloqué par" value={null} onChange={(v) => v && send("POST", { blockedBy: v as string })} options={others} align="end" className="ml-auto">
          <span className={add}>
            <Plus className="size-3.5" />
            Bloqué par
          </span>
        </Picker>
        <Picker label="Bloque" value={null} onChange={(v) => v && send("POST", { blocks: v as string })} options={others} align="end">
          <span className={add}>
            <Plus className="size-3.5" />
            Bloque
          </span>
        </Picker>
      </div>
      {rows.map(({ other, kind, body }) => {
        const o = other!;
        const status = data.statuses.find((x) => x.id === o.statusId);
        return (
          <div key={kind + o.id} onClick={() => openIssue(o.ref)} className="group flex h-9 cursor-pointer items-center gap-2 border-b border-line px-1 text-[13px] hover:bg-ink/[0.025]">
            <span className="w-[68px] shrink-0 text-[11.5px] text-ink-3">{kind}</span>
            {status && <StatusIcon category={status.category} />}
            <span className="w-[56px] shrink-0 font-mono text-[11.5px] text-ink-3">{o.ref}</span>
            <span className={cn("min-w-0 flex-1 truncate", isDone(o) && "text-ink-3 line-through")}>{o.title}</span>
            <button
              aria-label={`Retirer la dépendance avec ${o.ref}`}
              title="Retirer"
              onClick={(e) => {
                e.stopPropagation();
                void send("DELETE", body);
              }}
              className="press flex size-6 items-center justify-center rounded-md text-ink-3 opacity-0 hover:bg-ink/[0.06] hover:text-ink group-hover:opacity-100 focus-visible:opacity-100"
            >
              <X className="size-3.5" />
            </button>
          </div>
        );
      })}
      {!rows.length && <p className="px-1 py-2 text-[12.5px] text-ink-3">Aucune. Indique les tickets à finir avant celui-ci : ils apparaissent reliés sur le planning.</p>}
    </section>
  );
}

function SubIssues({ parent, subs }: { parent: Issue; subs: Issue[] }) {
  const { data, updateIssue, openIssue, reload } = useProjectCtx();
  const [title, setTitle] = useState("");
  const [adding, setAdding] = useState(false);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    setTitle("");
    try {
      await api(`/api/projects/${data.project.key}/issues`, { method: "POST", json: { title: t, parentId: parent.id, epicId: parent.epicId, assigneeId: parent.assigneeId } });
      await reload();
    } catch (err) {
      toast.error((err as Error).message);
      setTitle(t);
    }
  };

  const done = subs.filter((s) => {
    const c = data.statuses.find((x) => x.id === s.statusId)?.category;
    return c === "done" || c === "canceled";
  }).length;

  return (
    <section className="mt-6">
      <div className="flex items-center gap-2 border-b border-line pb-2">
        <h3 className="text-[13px] font-medium">Sous-tickets</h3>
        {subs.length > 0 && (
          <span className="text-[12px] text-ink-3 tabular">
            {done}/{subs.length}
          </span>
        )}
        <button onClick={() => setAdding(true)} className="press ml-auto flex h-7 items-center gap-1 rounded-md px-2 text-[12.5px] text-ink-3 hover:bg-ink/[0.05] hover:text-ink">
          <Plus className="size-3.5" />
          Ajouter
        </button>
      </div>
      {subs.map((s) => {
        const status = data.statuses.find((x) => x.id === s.statusId);
        return (
          <div key={s.id} onClick={() => openIssue(s.ref)} className="group flex h-9 cursor-pointer items-center gap-2 border-b border-line px-1 text-[13px] hover:bg-ink/[0.025]">
            <StatusField data={data} issue={s} onChange={(p) => updateIssue(s, p)} look="icon" />
            <span className="w-[56px] shrink-0 font-mono text-[11.5px] text-ink-3">{s.ref}</span>
            <span className={cn("min-w-0 flex-1 truncate", (status?.category === "done" || status?.category === "canceled") && "text-ink-3 line-through")}>{s.title}</span>
            {s.subCount > 0 && <span className="text-[11.5px] text-ink-3">{s.subDone}/{s.subCount}</span>}
            <PriorityIcon priority={s.priority} />
            <AssigneeField data={data} issue={s} onChange={(p) => updateIssue(s, p)} look="icon" />
            <ArrowUpRight className="size-3.5 text-ink-3 opacity-0 group-hover:opacity-100" />
          </div>
        );
      })}
      {(adding || !subs.length) && (
        <form onSubmit={add} className="flex h-9 items-center gap-2 border-b border-line px-1">
          <StatusIcon category="todo" className="opacity-40" />
          <input
            autoFocus={adding}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && (setAdding(false), setTitle(""))}
            placeholder="Titre du sous-ticket, puis Entrée"
            maxLength={300}
            className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-ink-3"
          />
        </form>
      )}
    </section>
  );
}

function Comments({ issueId, meId }: { issueId: string; meId: string }) {
  const { userById, listen, me } = useApp();
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await api<{ comments: Comment[] }>(`/api/issues/${issueId}`);
      setComments(res.comments);
    } catch {
      setComments([]);
    }
  }, [issueId]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => listen((e) => (e.type === "issue" && e.issueId === issueId) || e.type === "resync" ? void load() : undefined), [listen, load, issueId]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const sent = text;
    if (!sent.trim() || sending.current) return;
    sending.current = true;
    setBusy(true);
    try {
      await api(`/api/issues/${issueId}/comments`, { method: "POST", json: { body: sent } });
      // Only clear what was sent: text typed meanwhile stays.
      setText((t) => (t === sent ? "" : t.startsWith(sent) ? t.slice(sent.length).trimStart() : t));
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await api(`/api/comments/${id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <section className="mt-8">
      <h3 className="border-b border-line pb-2 text-[13px] font-medium">Activité</h3>
      <div className="flex flex-col gap-4 py-4">
        {comments?.map((c) => {
          const who = userById(c.userId);
          return (
            <div key={c.id} className="group flex gap-2.5">
              <Avatar id={who?.id ?? c.id} name={who?.name ?? "?"} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px]">
                  <span className="font-medium">{who?.name ?? "Ancien membre"}</span> <span className="text-ink-3">{relative(c.createdAt)}</span>
                  {(c.userId === meId || me.role === "admin") && (
                    <button onClick={() => remove(c.id)} className="ml-2 text-[11.5px] text-ink-3 opacity-0 group-hover:opacity-100 hover:text-ink">
                      Supprimer
                    </button>
                  )}
                </p>
                <p className="mt-0.5 text-[13.5px] leading-relaxed whitespace-pre-wrap text-ink-2">{c.body}</p>
              </div>
            </div>
          );
        })}
        {comments && !comments.length && <p className="text-[12.5px] text-ink-3">Pas encore de commentaire.</p>}
      </div>
      <form onSubmit={send} className="rounded-xl border border-line-strong bg-surface p-2 focus-within:border-ink/40">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(e);
          }}
          placeholder="Écrire un commentaire… (⌘ Entrée pour envoyer)"
          rows={2}
          maxLength={10000}
          className="w-full resize-none bg-transparent px-1 text-[13.5px] outline-none placeholder:text-ink-3"
        />
        <div className="flex justify-end">
          <Button size="sm" variant="primary" disabled={busy || !text.trim()}>
            Commenter
          </Button>
        </div>
      </form>
    </section>
  );
}
