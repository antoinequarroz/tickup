import "server-only";
import crypto from "node:crypto";
import type { ApiToken, User } from "@/lib/types";
import { db, getUser, newId } from "./db";

/**
 * The keys of the AI agents (Claude, Alfred, a script…). Each key belongs to an agent account: what
 * the agent does in TickUp (a ticket created, a comment, a ticket moved) shows under its own name,
 * and a ticket can be assigned to it. Revoking the key cuts the agent off; its account stays, so
 * its comments keep their author.
 */

export const sha256 = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
const now = () => new Date().toISOString();

/** Keys look like "tku_" + 43 random characters: easy to spot in a leaked file. */
export const TOKEN_PREFIX = "tku_";
const newToken = () => TOKEN_PREFIX + crypto.randomBytes(32).toString("base64url");

type TokenRow = { id: string; name: string; prefix: string; user_id: string; source: "manual" | "oauth"; created_at: string; last_used_at: string | null };
const toToken = (r: TokenRow): ApiToken => ({ id: r.id, name: r.name, prefix: r.prefix, userId: r.user_id, source: r.source, createdAt: r.created_at, lastUsedAt: r.last_used_at });

/** The agent account with this name, created on first use. Agents are told apart by name: "Claude" reconnecting stays the same "Claude". */
export function agentAccount(name: string): User {
  const clean = name.trim().slice(0, 80) || "Agent";
  const found = db().prepare("select id from users where agent = 1 and name = ? collate nocase").get(clean) as { id: string } | undefined;
  if (found) return getUser(found.id)!;
  const id = newId();
  // No password: an agent never signs in. The address only fills the column (unique, unreachable).
  db()
    .prepare("insert into users (id, email, name, role, salt, password_hash, created_at, agent) values (?, ?, ?, 'member', ?, '', ?, 1)")
    .run(id, `agent-${id.toLowerCase()}@agents.tickup.invalid`, clean, crypto.randomBytes(16).toString("hex"), now());
  return getUser(id)!;
}

/** Creates a key for an agent. Returns the key itself: it is shown once, then only its hash is kept. */
export function createToken(input: { name: string; agentName?: string; createdBy: string | null; source?: "manual" | "oauth" }): { token: string; apiToken: ApiToken } {
  return db().transaction(() => {
    const agent = agentAccount(input.agentName ?? input.name);
    const token = newToken();
    const id = newId();
    db()
      .prepare("insert into api_tokens (id, name, token_hash, prefix, user_id, created_by, source, created_at) values (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, input.name.trim().slice(0, 80) || agent.name, sha256(token), token.slice(0, 10), agent.id, input.createdBy, input.source ?? "manual", now());
    return { token, apiToken: getToken(id)! };
  })();
}

export function getToken(id: string): ApiToken | null {
  const r = db().prepare("select * from api_tokens where id = ?").get(id) as TokenRow | undefined;
  return r ? toToken(r) : null;
}

/** Every key, the most recent first. With `createdBy`, only the keys this person made. */
export const listTokens = (createdBy?: string) =>
  (createdBy ? (db().prepare("select * from api_tokens where created_by = ? order by created_at desc").all(createdBy) as TokenRow[]) : (db().prepare("select * from api_tokens order by created_at desc").all() as TokenRow[])).map(toToken);

export const tokenCreator = (id: string) => (db().prepare("select created_by from api_tokens where id = ?").get(id) as { created_by: string | null } | undefined)?.created_by ?? null;

export const revokeToken = (id: string) => db().prepare("delete from api_tokens where id = ?").run(id).changes > 0;

/** The agent behind a key, or null. Notes when the key was last used (at most once a minute). */
export function tokenUser(token: string): User | null {
  if (!token.startsWith(TOKEN_PREFIX) || token.length > 200) return null;
  const r = db().prepare("select id, user_id, last_used_at from api_tokens where token_hash = ?").get(sha256(token)) as { id: string; user_id: string; last_used_at: string | null } | undefined;
  if (!r) return null;
  if (!r.last_used_at || Date.now() - new Date(r.last_used_at).getTime() > 60_000) db().prepare("update api_tokens set last_used_at = ? where id = ?").run(now(), r.id);
  return getUser(r.user_id);
}

// ---- OAuth: how Claude (claude.ai, the desktop and mobile apps) connects without a key to copy.

export type OAuthClient = { id: string; name: string; redirectUris: string[] };

/** Only https addresses, or http on this machine (Claude Code, MCP Inspector). */
export function validRedirectUri(uri: unknown): uri is string {
  if (typeof uri !== "string" || uri.length > 500) return false;
  try {
    const u = new URL(uri);
    if (u.hash) return false;
    if (u.protocol === "https:") return true;
    return u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]");
  } catch {
    return false;
  }
}

export function registerClient(name: string, redirectUris: string[]): OAuthClient {
  const id = `mcp_${crypto.randomBytes(12).toString("base64url")}`;
  const clean = name.trim().slice(0, 80) || "Agent";
  db().prepare("insert into oauth_clients (id, name, redirect_uris, created_at) values (?, ?, ?, ?)").run(id, clean, JSON.stringify(redirectUris), now());
  return { id, name: clean, redirectUris };
}

export function getClient(id: unknown): OAuthClient | null {
  if (typeof id !== "string") return null;
  const r = db().prepare("select * from oauth_clients where id = ?").get(id) as { id: string; name: string; redirect_uris: string } | undefined;
  return r ? { id: r.id, name: r.name, redirectUris: JSON.parse(r.redirect_uris) as string[] } : null;
}

/** A one-time code, valid 5 minutes, that the connector trades for a key (with PKCE). */
export function createCode(input: { clientId: string; userId: string; redirectUri: string; codeChallenge: string; agentName: string }): string {
  const code = crypto.randomBytes(32).toString("base64url");
  db().prepare("delete from oauth_codes where expires_at < ?").run(now());
  db()
    .prepare("insert into oauth_codes (code_hash, client_id, user_id, redirect_uri, code_challenge, agent_name, expires_at) values (?, ?, ?, ?, ?, ?, ?)")
    .run(sha256(code), input.clientId, input.userId, input.redirectUri, input.codeChallenge, input.agentName, new Date(Date.now() + 5 * 60_000).toISOString());
  return code;
}

const pkce = (verifier: string) => crypto.createHash("sha256").update(verifier).digest("base64url");

/** Trades a code for a new key. Each code works once. Returns null when anything does not match. */
export function redeemCode(input: { code: unknown; clientId: unknown; redirectUri: unknown; codeVerifier: unknown }): { token: string; apiToken: ApiToken } | null {
  if (typeof input.code !== "string" || typeof input.codeVerifier !== "string" || input.codeVerifier.length < 43 || input.codeVerifier.length > 128) return null;
  return db().transaction(() => {
    const r = db().prepare("delete from oauth_codes where code_hash = ? returning *").get(sha256(input.code as string)) as
      | { client_id: string; user_id: string; redirect_uri: string; code_challenge: string; agent_name: string; expires_at: string }
      | undefined;
    if (!r || r.expires_at < now()) return null;
    if (r.client_id !== input.clientId || r.redirect_uri !== input.redirectUri) return null;
    const expected = Buffer.from(r.code_challenge);
    const given = Buffer.from(pkce(input.codeVerifier as string));
    if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
    return createToken({ name: r.agent_name, createdBy: r.user_id, source: "oauth" });
  })();
}
