import { redirect } from "next/navigation";
import { Logo } from "@/components/logo";
import { sessionPerson } from "@/server/auth";
import { readAuthorize } from "@/server/oauth";
import { cn } from "@/lib/utils";

// Same look as the app's primary button (components/ui is a client module: its strings do not cross to the server).
const primaryClass = "bg-accent text-accent-ink shadow-[0_1px_0_rgba(255,255,255,0.25)_inset,0_1px_2px_rgba(0,0,0,0.12),0_6px_16px_-6px_var(--accent)] hover:brightness-[1.06]";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** Where Claude (or another agent) asks for access to TickUp. The signed-in person says yes or no. */
export default async function AuthorizePage({ searchParams }: Props) {
  const params = await searchParams;
  const get = (k: string) => {
    const v = params[k];
    return typeof v === "string" ? v : null;
  };
  const me = await sessionPerson();
  if (!me) {
    const query = new URLSearchParams(Object.entries(params).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : [])));
    redirect(`/login?next=${encodeURIComponent(`/oauth/authorize?${query}`)}`);
  }
  const request = readAuthorize(get);

  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <div className="rise w-full max-w-[400px] rounded-2xl border border-line bg-surface/80 p-7 shadow-card backdrop-blur-xl">
        <Logo className="size-9" />
        {typeof request === "string" ? (
          <>
            <h1 className="mt-5 font-display text-[26px] leading-tight">Connexion impossible</h1>
            <p className="mt-2 text-[13px] text-ink-3">{request}</p>
          </>
        ) : (
          <form method="post" action="/api/oauth/authorize">
            <h1 className="mt-5 font-display text-[26px] leading-tight">Connecter {request.client.name} à TickUp ?</h1>
            <p className="mt-2 text-[13px] text-ink-3">
              Cet agent pourra lire tous les projets et tickets, en créer, les modifier, les déplacer et les commenter. Il agira sous son propre nom, pas sous le tien ({me.name}).
            </p>
            {Object.entries({ client_id: request.client.id, redirect_uri: request.redirectUri, state: request.state ?? "", response_type: "code", code_challenge: request.codeChallenge, code_challenge_method: "S256" }).map(([k, v]) => (
              <input key={k} type="hidden" name={k} value={v} />
            ))}
            <label className="mt-5 flex flex-col gap-1.5">
              <span className="text-[12px] font-medium text-ink-2">Nom de l&apos;agent dans TickUp</span>
              <input
                name="agent_name"
                defaultValue={request.client.name}
                maxLength={80}
                className="h-10 w-full rounded-lg border border-line-strong bg-surface px-3 text-[14px] outline-none focus:border-accent/60 focus:shadow-[0_0_0_3px_var(--accent-soft)]"
              />
              <span className="text-[11.5px] text-ink-3">Ses commentaires et ses tickets porteront ce nom. Tu pourras couper l&apos;accès dans Réglages.</span>
            </label>
            <div className="mt-6 flex gap-2">
              <button name="decision" value="deny" className="press h-9 flex-1 rounded-lg border border-line-strong bg-surface text-[13.5px] font-medium shadow-card hover:bg-surface-2">
                Refuser
              </button>
              <button name="decision" value="allow" className={cn("press h-9 flex-1 rounded-lg text-[13.5px] font-medium", primaryClass)}>
                Autoriser
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
