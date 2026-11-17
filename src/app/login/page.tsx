"use client";

import { useEffect, useState } from "react";
import { Logo } from "@/components/logo";
import { Button, inputClass } from "@/components/ui";
import { api } from "@/lib/utils";

export default function LoginPage() {
  /** No account yet: the first person to arrive creates theirs and becomes admin. */
  const [setup, setSetup] = useState<boolean | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ needsSetup: boolean }>("/api/auth/status").then(
      (s) => setSetup(s.needsSetup),
      () => setSetup(false),
    );
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(setup ? "/api/auth/setup" : "/api/auth/login", { method: "POST", json: { name, email, password } });
      window.location.href = "/projects";
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  if (setup === null) return null;

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
      </form>
    </div>
  );
}
