"use client";

import { Bot, Check, Copy, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button, Card, Field, inputClass } from "@/components/ui";
import type { ApiToken } from "@/lib/types";
import { useApp } from "@/lib/store";
import { api, cn, relative } from "@/lib/utils";

function CopyField({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch {
      toast.error("Copie impossible : sélectionne le texte à la main");
    }
  };
  return (
    <div className="flex items-center gap-2">
      <input readOnly value={value} aria-label={label} onFocus={(e) => e.currentTarget.select()} className={cn(inputClass, "h-9 font-mono text-[12.5px]")} />
      <Button type="button" size="sm" className="h-9" onClick={copy} aria-label={`Copier ${label}`}>
        {done ? <Check className="size-4" /> : <Copy className="size-4" />}
      </Button>
    </div>
  );
}

/**
 * Réglages › Agents IA: the address of the MCP server, the keys of the agents (Claude, Alfred…),
 * a new key for an agent, and revoking one.
 */
export function AgentKeys() {
  const { users, reload } = useApp();
  const [tokens, setTokens] = useState<ApiToken[] | null>(null);
  const [mcpUrl, setMcpUrl] = useState("");
  const [name, setName] = useState("");
  const [fresh, setFresh] = useState<{ name: string; token: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api<{ tokens: ApiToken[]; mcpUrl: string }>("/api/tokens");
      setTokens(data.tokens);
      setMcpUrl(data.mcpUrl);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }, []);
  useEffect(() => void load(), [load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { token, apiToken } = await api<{ token: string; apiToken: ApiToken }>("/api/tokens", { method: "POST", json: { name } });
      setFresh({ name: apiToken.name, token });
      setName("");
      await Promise.all([load(), reload()]);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (t: ApiToken) => {
    try {
      await api(`/api/tokens/${t.id}`, { method: "DELETE" });
      toast(`Clé « ${t.name} » révoquée`, { description: "Cet agent n'a plus accès à TickUp." });
      if (fresh && t.prefix === fresh.token.slice(0, 10)) setFresh(null);
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const agentName = (id: string) => users.find((u) => u.id === id)?.name ?? "Agent";

  return (
    <Card className="flex flex-col gap-4">
      <div>
        <h2 className="text-[15px] font-medium">Agents IA</h2>
        <p className="mt-1 text-[13px] text-ink-3">
          Tes agents (Claude, Alfred, Claude Code…) lisent, créent, déplacent et commentent les tickets par le serveur MCP de TickUp. Chacun agit sous son propre nom.
        </p>
      </div>

      <Field label="Adresse du serveur MCP" hint="Dans Claude : Réglages › Connecteurs › Ajouter un connecteur personnalisé, colle cette adresse, puis autorise l'accès. Aucune clé à copier.">
        <CopyField value={mcpUrl || "…"} label="l'adresse du serveur MCP" />
      </Field>

      {fresh && (
        <div className="flex flex-col gap-2 rounded-lg border border-line-strong bg-surface-2 p-3">
          <span className="text-[13px] font-medium">Clé de « {fresh.name} »</span>
          <span className="text-[12px] text-ink-3">Copie-la maintenant : elle ne sera plus affichée. À mettre dans l&apos;en-tête « Authorization: Bearer … » de l&apos;agent.</span>
          <CopyField value={fresh.token} label="la clé" />
        </div>
      )}

      {tokens && tokens.length > 0 && (
        <ul className="flex flex-col gap-2">
          {tokens.map((t) => (
            <li key={t.id} className="flex items-center gap-2.5">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-ink/[0.06] text-ink-2">
                <Bot className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-medium leading-tight">
                  {t.name}
                  {t.name !== agentName(t.userId) && <span className="font-normal text-ink-3"> · agit comme {agentName(t.userId)}</span>}
                </span>
                <span className="block truncate text-[12px] leading-tight text-ink-3">
                  <span className="font-mono">{t.prefix}…</span> · {t.source === "oauth" ? "connecté par OAuth" : "clé manuelle"} · {t.lastUsedAt ? `utilisée ${relative(t.lastUsedAt)}` : "jamais utilisée"}
                </span>
              </span>
              <Button size="sm" variant="ghost" onClick={() => revoke(t)} aria-label={`Révoquer ${t.name}`} title="Révoquer">
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={create} className="flex flex-col gap-3 border-t border-line pt-4">
        <Field label="Nouvelle clé pour un agent" hint="Pour Claude Code, Alfred ou un script. L'agent est créé avec ce nom s'il n'existe pas encore.">
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Alfred" className={inputClass} />
        </Field>
        <Button className="self-start" disabled={busy || !name.trim()}>
          Créer la clé
        </Button>
      </form>
    </Card>
  );
}
