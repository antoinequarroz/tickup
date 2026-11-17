"use client";

import { LogOut, Monitor, Moon, Sun } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Avatar, Button, Card, Field, inputClass, PageHeader } from "@/components/ui";
import { useApp } from "@/lib/store";
import { setTheme, type Theme, useTheme } from "@/lib/theme";
import { api, cn } from "@/lib/utils";

const THEMES: { value: Theme; label: string; Icon: typeof Sun }[] = [
  { value: "system", label: "Système", Icon: Monitor },
  { value: "light", label: "Clair", Icon: Sun },
  { value: "dark", label: "Sombre", Icon: Moon },
];

export default function SettingsPage() {
  const { me } = useApp();
  return (
    <>
      <PageHeader title="Réglages" />
      <div className="scroll-thin flex-1 overflow-y-auto p-7 max-md:p-4">
        <div className="mx-auto flex max-w-[560px] flex-col gap-4">
          <Profile />
          <Appearance />
          <Password />
          {me.role === "admin" && <Members />}
          <Session />
        </div>
      </div>
    </>
  );
}

function Title({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <h2 className="text-[15px] font-medium">{children}</h2>
      {hint && <p className="mt-1 text-[13px] text-ink-3">{hint}</p>}
    </div>
  );
}

function Profile() {
  const { me, reload } = useApp();
  const [name, setName] = useState(me.name);
  const [busy, setBusy] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/api/me", { method: "PATCH", json: { name } });
      await reload();
      toast("Nom enregistré");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <form onSubmit={save} className="flex flex-col gap-3">
        <Title hint={me.email}>Profil</Title>
        <Field label="Nom affiché">
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className={inputClass} />
        </Field>
        <Button variant="primary" className="self-start" disabled={busy || !name.trim() || name.trim() === me.name}>
          Enregistrer
        </Button>
      </form>
    </Card>
  );
}

function Appearance() {
  const theme = useTheme();
  return (
    <Card className="flex flex-col gap-3">
      <Title hint="Clair, sombre, ou comme ton appareil.">Apparence</Title>
      <div className="flex gap-1 self-start rounded-lg border border-line bg-surface-2 p-1">
        {THEMES.map(({ value, label, Icon }) => (
          <button
            key={value}
            onClick={() => setTheme(value)}
            aria-pressed={theme === value}
            className={cn("press flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px]", theme === value ? "bg-surface font-medium text-ink shadow-card" : "text-ink-2 hover:text-ink")}
          >
            <Icon className={cn("size-4", theme === value ? "text-accent" : "text-ink-3")} />
            {label}
          </button>
        ))}
      </div>
    </Card>
  );
}

function Password() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);

  const change = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/api/me/password", { method: "POST", json: { current, next } });
      setCurrent("");
      setNext("");
      toast("Mot de passe changé", { description: "Les autres appareils ont été déconnectés." });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <form onSubmit={change} className="flex flex-col gap-3">
        <Title>Mot de passe</Title>
        <Field label="Mot de passe actuel">
          <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Nouveau mot de passe" hint="Au moins 10 caractères.">
          <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} className={inputClass} />
        </Field>
        <Button variant="primary" className="self-start" disabled={busy || next.length < 10 || !current}>
          {busy ? "Enregistrement…" : "Changer le mot de passe"}
        </Button>
      </form>
    </Card>
  );
}

function Members() {
  const { users, me, reload } = useApp();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/api/users", { method: "POST", json: { name, email, password } });
      await reload();
      toast(`${name} a maintenant un compte`, { description: "Transmets-lui son e-mail et ce mot de passe." });
      setName("");
      setEmail("");
      setPassword("");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="flex flex-col gap-4">
      <Title hint="Chaque membre voit tous les projets et peut y créer des tickets.">Membres</Title>
      <ul className="flex flex-col gap-2">
        {users.map((u) => (
          <li key={u.id} className="flex items-center gap-2.5">
            <Avatar id={u.id} name={u.name} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-medium leading-tight">
                {u.name}
                {u.id === me.id && <span className="font-normal text-ink-3"> (toi)</span>}
              </span>
              <span className="block truncate text-[12px] leading-tight text-ink-3">{u.email}</span>
            </span>
            <span className="text-[12px] text-ink-3">{u.role === "admin" ? "Administrateur" : "Membre"}</span>
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="flex flex-col gap-3 border-t border-line pt-4">
        <span className="text-[13px] font-medium">Ajouter un membre</span>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nom">
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className={inputClass} />
          </Field>
          <Field label="E-mail">
            <input type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
          </Field>
        </div>
        <Field label="Premier mot de passe" hint="Au moins 10 caractères. La personne pourra le changer dans ses réglages.">
          <input type="text" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} className={cn(inputClass, "font-mono text-[13px]")} />
        </Field>
        <Button className="self-start" disabled={busy || !name.trim() || !email.trim() || password.length < 10}>
          Créer le compte
        </Button>
      </form>
    </Card>
  );
}

function Session() {
  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  };
  return (
    <Card className="flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <Title hint="Tu resteras connecté sur tes autres appareils.">Session</Title>
      </div>
      <Button onClick={logout}>
        <LogOut className="size-4" />
        Se déconnecter
      </Button>
    </Card>
  );
}
