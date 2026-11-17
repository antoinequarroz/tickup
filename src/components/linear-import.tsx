"use client";

import { ArrowRight, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button, Card, Field, inputClass } from "@/components/ui";
import { useApp } from "@/lib/store";
import { api, cn } from "@/lib/utils";
import type { PreviewTeam, TeamResult, TeamSummary } from "@/server/import";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n > 1 ? many : one}`;

/** Admin card of the settings page: brings teams, projects and tickets over from Linear. */
export function LinearImport() {
  const { reload } = useApp();
  const [apiKey, setApiKey] = useState("");
  const [teams, setTeams] = useState<PreviewTeam[] | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [comments, setComments] = useState(true);
  const [overwrite, setOverwrite] = useState(false);
  const [archived, setArchived] = useState(false);
  const [busy, setBusy] = useState<"preview" | "import" | null>(null);
  const [error, setError] = useState("");
  const [results, setResults] = useState<TeamResult[] | null>(null);

  const preview = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy("preview");
    setError("");
    setResults(null);
    try {
      const data = await api<{ teams: PreviewTeam[] }>("/api/import/linear", { method: "POST", json: { apiKey, action: "preview" } });
      setTeams(data.teams);
      setChosen(new Set(data.teams.map((t) => t.id)));
    } catch (err) {
      setTeams(null);
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const run = async () => {
    setBusy("import");
    setError("");
    setResults(null);
    try {
      const data = await api<{ teams: TeamResult[] }>("/api/import/linear", { method: "POST", json: { apiKey, action: "import", teamIds: [...chosen], options: { comments, archived, overwrite } } });
      setResults(data.teams);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const toggle = (id: string) =>
    setChosen((cur) => {
      const next = new Set(cur);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const nameOf = (r: TeamResult) => r.teamName || teams?.find((t) => t.id === r.teamId)?.name || "Équipe";

  return (
    <Card className="flex flex-col gap-4">
      <div>
        <h2 className="text-[15px] font-medium">Importer depuis Linear</h2>
        <p className="mt-1 text-[13px] text-ink-3">
          Chaque équipe Linear devient un projet, avec ses statuts, ses étiquettes, ses projets (en epics), ses cycles (en sprints), ses tickets et leurs numéros, les sous-tickets, les dépendances et les commentaires. Crée une clé dans Linear → Settings →
          Security &amp; access → Personal API keys : elle sert le temps de l&apos;import et n&apos;est jamais enregistrée.
        </p>
      </div>

      <form onSubmit={preview} className="flex flex-col gap-3">
        <Field label="Clé d'API Linear">
          <input
            type="password"
            name="linear-api-key"
            autoComplete="off"
            spellCheck={false}
            placeholder="lin_api_…"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            disabled={busy !== null}
            className={cn(inputClass, "font-mono text-[13px]")}
          />
        </Field>
        <Button variant={teams ? "secondary" : "primary"} className="self-start" disabled={busy !== null || apiKey.trim().length < 10}>
          {busy === "preview" ? "Lecture des équipes…" : "Voir mes équipes"}
        </Button>
      </form>

      {error && (
        <p role="alert" className="flex items-start gap-2 rounded-lg border border-line-strong bg-surface-2 px-3 py-2 text-[13px] text-ink">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      )}

      {teams && (
        <div className="flex flex-col gap-3 border-t border-line pt-4">
          {teams.length === 0 ? (
            <p className="text-[13px] text-ink-3">Cette clé ne voit aucune équipe.</p>
          ) : (
            <>
              <span className="text-[13px] font-medium">Équipes à importer</span>
              <ul className="flex flex-col">
                {teams.map((t) => (
                  <li key={t.id}>
                    <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-ink/5">
                      <input type="checkbox" checked={chosen.has(t.id)} onChange={() => toggle(t.id)} disabled={busy !== null} className="size-3.5 shrink-0 accent-[var(--ink)]" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-medium leading-tight">{t.name}</span>
                        <span className="tabular block truncate text-[12px] leading-tight text-ink-3">
                          {plural(t.issueCount, "ticket")}
                          {t.existing ? ` · déjà importée : seuls les nouveaux tickets s'ajoutent à ${t.projectKey}` : t.projectKey !== t.key ? ` · la clé ${t.key} n'est pas disponible` : ""}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5 font-mono text-[12px] text-ink-3">
                        {t.key}
                        <ArrowRight aria-hidden className="size-3" />
                        <span className="text-ink">{t.projectKey}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              <div className="flex flex-col gap-1.5 text-[13px] text-ink-2">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={comments} onChange={(e) => setComments(e.target.checked)} disabled={busy !== null} className="size-3.5 accent-[var(--ink)]" />
                  Importer les commentaires
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} disabled={busy !== null} className="size-3.5 accent-[var(--ink)]" />
                  Inclure les tickets archivés par Linear
                </label>
                {teams.some((t) => t.existing && chosen.has(t.id)) && (
                  <label className="flex items-start gap-2">
                    <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} disabled={busy !== null} className="mt-0.5 size-3.5 shrink-0 accent-[var(--ink)]" />
                    <span>
                      Reprendre la version de Linear pour ce qui est déjà importé
                      <span className="block text-[12px] text-ink-3">Écrase les changements faits ici sur ces tickets (titre, statut, sprint, étiquettes…). Sans cette case, ils restent comme ils sont.</span>
                    </span>
                  </label>
                )}
              </div>
              <p className="text-[12px] text-ink-3">
                Tu peux relancer l&apos;import plus tard : seuls les nouveaux tickets de Linear s&apos;ajoutent, rien n&apos;est dupliqué, et ce que tu as changé ici reste en place. Les commentaires n&apos;arrivent qu&apos;à la première importation d&apos;un ticket. Les
                personnes sont reconnues par leur e-mail : crée leurs comptes avant d&apos;importer.
              </p>
              <div className="flex items-center gap-3">
                <Button variant="primary" onClick={run} disabled={busy !== null || chosen.size === 0}>
                  {busy === "import" ? "Import en cours…" : `Importer ${plural(chosen.size, "équipe")}`}
                </Button>
                {busy === "import" && (
                  <span role="status" className="text-[12px] text-ink-3">
                    Ça peut prendre quelques minutes. Garde cette page ouverte.
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {results && (
        <ul aria-label="Résultat de l'import" className="flex flex-col gap-3 border-t border-line pt-4">
          {results.map((r) => (
            <li key={r.teamId} className="rise rounded-lg border border-line bg-surface-2 p-3 text-[13px]">
              {"error" in r ? (
                <>
                  <span className="font-medium">{nameOf(r)} : pas importée</span>
                  <p className="mt-1 text-ink-2">{r.error}</p>
                </>
              ) : (
                <Summary r={r} />
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Summary({ r }: { r: TeamSummary }) {
  const counts = [
    plural(r.issuesCreated, "ticket créé", "tickets créés"),
    plural(r.issuesUpdated, "mis à jour", "mis à jour"),
    plural(r.issuesKept, "déjà là, inchangé", "déjà là, inchangés"),
    plural(r.statuses, "statut"),
    plural(r.labels, "étiquette"),
    plural(r.epics, "epic"),
    plural(r.sprints, "sprint"),
    plural(r.comments, "commentaire"),
    plural(r.links, "dépendance"),
  ];
  return (
    <>
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-medium">
          {r.projectName} <span className="font-normal text-ink-3">{r.created ? "importé" : "mis à jour"}</span>
        </span>
        <Link href={`/p/${r.projectKey}`} className="press inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[12px] underline decoration-line-strong underline-offset-2 hover:bg-ink/5">
          {r.projectKey}
          <ArrowRight aria-hidden className="size-3" />
          <span className="sr-only">Ouvrir le projet</span>
        </Link>
      </div>
      <p className="tabular mt-1 text-ink-2">{counts.join(" · ")}</p>
      {r.unmatched.length > 0 && (
        <p className="mt-2 text-ink-2">
          <span className="font-medium text-ink">Sans compte ici</span> (leurs tickets arrivent sans responsable) : {r.unmatched.map((p) => (p.email ? `${p.name} (${p.email})` : p.name)).join(", ")}
        </p>
      )}
      {r.warnings.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1 text-ink-2">
          {r.warnings.map((w) => (
            <li key={w} className="flex items-start gap-1.5">
              <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              {w}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
