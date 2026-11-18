"use client";

import { useEffect, useState } from "react";
import { Logo } from "@/components/logo";
import { Button, inputClass } from "@/components/ui";
import { api } from "@/lib/utils";

export default function LoginPage() {
  /** No account yet: the first person to arrive creates theirs and becomes admin. */
  const [setup, setSetup] = useState<boolean | null>(null);
  /** The Compte Postmelo is plugged in: it is the way in, the TickUp password stays as a spare key. */
  const [compte, setCompte] = useState(false);
  const [spare, setSpare] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  /** Where to go once signed in: a page of TickUp (an agent asking for access), else the projects. */
  const [next, setNext] = useState("/projects");

  useEffect(() => {
    const asked = new URLSearchParams(window.location.search).get("next");
    if (asked && /^\/(?![/\\])/.test(asked)) setNext(asked);
    // Sent back here by the Compte Postmelo when the sign-in did not go through.
    setError(new URLSearchParams(window.location.search).get("erreur") ?? "");
    api<{ needsSetup: boolean; compte?: boolean }>("/api/auth/status").then(
      (s) => {
        setCompte(!!s.compte);
        setSetup(s.needsSetup);
      },
      () => setSetup(false),
    );
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(setup ? "/api/auth/setup" : "/api/auth/login", { method: "POST", json: { name, email, password } });
      window.location.href = next;
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  if (setup === null) return null;

  if (compte && !spare)
    return (
      <div className="flex min-h-dvh items-center justify-center p-4">
        <div className="rise w-full max-w-[360px] rounded-2xl border border-line bg-surface/80 p-7 shadow-card backdrop-blur-xl">
          <Logo className="size-9" />
          <h1 className="mt-5 font-display text-[30px] leading-none">TickUp</h1>
          <p className="mt-2 text-[13px] text-ink-3">Connecte-toi avec ton Compte Postmelo, le même pour tous tes outils.</p>
          {error && (
            <p role="alert" className="mt-4 text-[12.5px] text-danger">
              {error}
            </p>
          )}
          <Button variant="primary" className="mt-6 w-full" onClick={() => (window.location.href = next === "/projects" ? "/api/auth/compte/start" : `/api/auth/compte/start?next=${encodeURIComponent(next)}`)}>
            Continuer avec mon Compte Postmelo
          </Button>
          {!setup && (
            <button type="button" onClick={() => (setSpare(true), setError(""))} className="mt-4 w-full text-center text-[12.5px] text-ink-3 underline-offset-2 hover:text-ink hover:underline">
              Utiliser mon mot de passe TickUp
            </button>
          )}
        </div>
      </div>
    );

  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <form onSubmit={submit} className="rise w-full max-w-[360px] rounded-2xl border border-line bg-surface/80 p-7 shadow-card backdrop-blur-xl">
        <Logo className="size-9" />
        <h1 className="mt-5 font-display text-[30px] leading-none">TickUp</h1>
        <p className="mt-2 text-[13px] text-ink-3">{setup ? "Bienvenue. Crée ton compte : ce sera celui de l'administrateur." : "Connecte-toi pour retrouver tes projets."}</p>
        <div className="mt-6 flex flex-col gap-2.5">
          {setup && <input autoFocus autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ton nom" aria-label="Ton nom" maxLength={80} className={inputClass} />}
          <input type="email" autoFocus={!setup} autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="E-mail" aria-label="E-mail" className={inputClass} />
          <input type="password" aria-label="Mot de passe" autoComplete={setup ? "new-password" : "current-password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={setup ? "Mot de passe (10 caractères au moins)" : "Mot de passe"} className={inputClass} />
        </div>
        {error && <p role="alert" className="mt-2 text-[12.5px] text-danger">{error}</p>}
        <Button variant="primary" className="mt-4 w-full" disabled={busy || !email || !password || (setup && (!name.trim() || password.length < 10))}>
          {busy ? "Un instant…" : setup ? "Créer mon compte" : "Se connecter"}
        </Button>
        {compte && (
          <button type="button" onClick={() => (setSpare(false), setError(""))} className="mt-4 w-full text-center text-[12.5px] text-ink-3 underline-offset-2 hover:text-ink hover:underline">
            Revenir au Compte Postmelo
          </button>
        )}
      </form>
    </div>
  );
}
