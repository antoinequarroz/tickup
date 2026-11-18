import "server-only";
import { getClient, type OAuthClient } from "./agents";

export type AuthorizeRequest = { client: OAuthClient; redirectUri: string; state: string | null; codeChallenge: string };

/**
 * Checks an authorization request (from the query string or the consent form). An unknown client
 * or redirect address is an error shown on the page: never send the browser to an unchecked address.
 */
export function readAuthorize(get: (name: string) => string | null | undefined): AuthorizeRequest | string {
  const client = getClient(get("client_id"));
  if (!client) return "Ce connecteur n'est pas inscrit auprès de TickUp. Reprends la connexion depuis ton agent.";
  const redirectUri = get("redirect_uri") ?? (client.redirectUris.length === 1 ? client.redirectUris[0] : "");
  if (!client.redirectUris.includes(redirectUri)) return "L'adresse de retour ne correspond pas à celle du connecteur.";
  if (get("response_type") !== "code") return "Type de réponse non pris en charge.";
  const codeChallenge = get("code_challenge") ?? "";
  if (get("code_challenge_method") !== "S256" || !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)) return "Ce connecteur doit utiliser PKCE (S256).";
  const state = get("state") ?? null;
  if (state && state.length > 1000) return "Paramètre state trop long.";
  return { client, redirectUri, state, codeChallenge };
}

/** The connector's address with the answer added (code or error, and its state). */
export function backTo(req: AuthorizeRequest, params: Record<string, string>): string {
  const url = new URL(req.redirectUri);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  if (req.state) url.searchParams.set("state", req.state);
  return url.toString();
}
