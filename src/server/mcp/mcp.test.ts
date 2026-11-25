import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import * as agents from "../agents";
import * as store from "../db";
import type { User } from "@/lib/types";
import { handleBody, handleMessage } from "./server";

const account = (n: string) => ({ email: `${n}@exemple.ch`, name: n, salt: "s", hash: "h" });

beforeEach(() => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tickup-mcp-"));
  delete process.env.SUITE_WEBHOOK_URL;
});

function setup() {
  const ana = store.createFirstUser(account("Ana"))!;
  store.createProject({ key: "WEB", name: "Site web", template: "software", leadId: ana.id });
  const { token } = agents.createToken({ name: "Claude", createdBy: ana.id });
  const claude = agents.tokenUser(token)!;
  return { ana, claude, token };
}

let seq = 0;
function call(me: User, name: string, args: Record<string, unknown> = {}) {
  const res = handleMessage({ jsonrpc: "2.0", id: ++seq, method: "tools/call", params: { name, arguments: args } }, me) as { result: { content: { text: string }[]; isError: boolean } };
  const text = res.result.content[0].text;
  return { isError: res.result.isError, text, data: res.result.isError ? null : JSON.parse(text) };
}

describe("clés des agents", () => {
  it("une clé ouvre un compte d'agent à son nom, révocable, et le compte reste", () => {
    const { ana, claude, token } = setup();
    expect(claude.agent).toBe(true);
    expect(claude.name).toBe("Claude");
    expect(token.startsWith("tku_")).toBe(true);
    // Same name, same agent.
    const second = agents.createToken({ name: "claude", createdBy: ana.id });
    expect(agents.tokenUser(second.token)!.id).toBe(claude.id);
    expect(agents.listTokens()).toHaveLength(2);
    expect(agents.revokeToken(agents.listTokens()[1].id)).toBe(true);
    expect(agents.tokenUser(token)).toBeNull();
    expect(store.getUser(claude.id)).not.toBeNull();
    // The agent never stands in for the admin of the scripts (API_TOKEN), and cannot sign in.
    expect(store.firstAdmin()!.id).toBe(ana.id);
    expect(agents.tokenUser("tku_inconnu")).toBeNull();
  });

  it("OAuth : un code PKCE donne une clé, une seule fois, avec la bonne adresse de retour", () => {
    const { ana } = setup();
    const client = agents.registerClient("Claude", ["https://claude.ai/api/mcp/auth_callback"]);
    const verifier = crypto.randomBytes(40).toString("base64url");
    const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
    const code = agents.createCode({ clientId: client.id, userId: ana.id, redirectUri: client.redirectUris[0], codeChallenge: challenge, agentName: "Claude" });
    const base = { code, clientId: client.id, redirectUri: client.redirectUris[0], codeVerifier: verifier };
    expect(agents.redeemCode({ ...base, codeVerifier: crypto.randomBytes(40).toString("base64url") })).toBeNull();
    // A wrong verifier burns the code: it cannot be retried.
    const code2 = agents.createCode({ clientId: client.id, userId: ana.id, redirectUri: client.redirectUris[0], codeChallenge: challenge, agentName: "Claude" });
    expect(agents.redeemCode({ ...base, code: code2, redirectUri: "https://ailleurs.example/cb" })).toBeNull();
    const code3 = agents.createCode({ clientId: client.id, userId: ana.id, redirectUri: client.redirectUris[0], codeChallenge: challenge, agentName: "Claude" });
    const issued = agents.redeemCode({ ...base, code: code3 })!;
    expect(agents.tokenUser(issued.token)!.name).toBe("Claude");
    expect(issued.apiToken.source).toBe("oauth");
    expect(agents.redeemCode({ ...base, code: code3 })).toBeNull();
  });

  it("n'accepte que des adresses de retour https ou locales", () => {
    expect(agents.validRedirectUri("https://claude.ai/api/mcp/auth_callback")).toBe(true);
    expect(agents.validRedirectUri("http://localhost:6274/oauth/callback")).toBe(true);
    expect(agents.validRedirectUri("http://evil.example/cb")).toBe(false);
    expect(agents.validRedirectUri("javascript:alert(1)")).toBe(false);
  });
});

describe("serveur MCP", () => {
  it("se présente et liste ses outils", () => {
    const { claude } = setup();
    const init = handleMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } }, claude) as { result: { protocolVersion: string; serverInfo: { name: string } } };
    expect(init.result.protocolVersion).toBe("2025-06-18");
    expect(init.result.serverInfo.name).toBe("tickup");
    expect(handleMessage({ jsonrpc: "2.0", method: "notifications/initialized" }, claude)).toBeNull();
    const list = handleMessage({ jsonrpc: "2.0", id: 2, method: "tools/list" }, claude) as { result: { tools: { name: string; inputSchema: { type: string } }[] } };
    expect(list.result.tools.map((t) => t.name)).toEqual(expect.arrayContaining(["list_projects", "get_project", "list_issues", "get_issue", "create_issue", "update_issue", "add_comment", "list_my_issues", "create_epic"]));
    expect(list.result.tools.every((t) => t.inputSchema.type === "object")).toBe(true);
    expect((handleMessage({ jsonrpc: "2.0", id: 3, method: "nope" }, claude) as { error: { code: number } }).error.code).toBe(-32601);
    expect(handleBody([{ jsonrpc: "2.0", method: "notifications/initialized" }], claude)).toBeNull();
  });

  it("crée, assigne, déplace et commente un ticket avec des noms, sous le nom de l'agent", () => {
    const { claude } = setup();
    const project = call(claude, "get_project", { project: "web" }).data;
    expect(project.statuses.length).toBeGreaterThan(2);

    const epic = call(claude, "create_epic", { project: "WEB", name: "Lancement" }).data;
    expect(epic.name).toBe("Lancement");

    const created = call(claude, "create_issue", { project: "WEB", title: "Page d'accueil", type: project.types[0], priority: "haute", assignee: "me", epic: "lancement", labels: [project.labels[0]] }).data;
    expect(created.ref).toBe("WEB-1");
    expect(created.assignee).toBe("Claude");
    expect(created.createdBy).toBe("Claude");
    expect(created.priority).toBe("Haute");
    expect(created.epic).toBe("Lancement");

    const sub = call(claude, "create_issue", { project: "WEB", title: "Hero", parent: "WEB-1" }).data;
    expect(sub.parent).toBe("WEB-1");

    expect(call(claude, "list_my_issues").data.map((i: { ref: string }) => i.ref)).toEqual(["WEB-1"]);

    const done = call(claude, "update_issue", { issue: "WEB-1", status: "done" }).data;
    expect(done.category).toBe("done");
    expect(done.completedAt).not.toBeNull();
    // Closed tickets leave the default list, a category filter brings them back.
    expect(call(claude, "list_issues", { project: "WEB" }).data.issues.map((i: { ref: string }) => i.ref)).toEqual(["WEB-2"]);
    expect(call(claude, "list_issues", { project: "WEB", status: "done" }).data.total).toBe(1);

    expect(call(claude, "add_comment", { issue: "WEB-1", body: "PR fusionnée." }).data.ok).toBe(true);
    const full = call(claude, "get_issue", { issue: "web-1" }).data;
    expect(full.comments[0]).toMatchObject({ author: "Claude", body: "PR fusionnée." });
    expect(full.subIssues.map((s: { ref: string }) => s.ref)).toEqual(["WEB-2"]);
    expect(full.comments[0].editedAt).toBeUndefined();

    // Corrects its own comment; never someone else's.
    expect(call(claude, "edit_comment", { commentId: full.comments[0].id, body: "PR #3 fusionnée." }).data.ok).toBe(true);
    const fixed = call(claude, "get_issue", { issue: "WEB-1" }).data.comments[0];
    expect(fixed).toMatchObject({ body: "PR #3 fusionnée.", editedAt: expect.any(String) });
    const ana = store.listUsers().find((u) => u.name === "Ana")!;
    const hers = store.addComment(store.getIssue("WEB-1")!.id, ana.id, "Merci");
    expect(call(claude, "edit_comment", { commentId: hers.id, body: "Piraté" }).isError).toBe(true);
    expect(store.getComment(hers.id)!.body).toBe("Merci");

    expect(call(claude, "link_issues", { blocker: "WEB-2", blocked: "WEB-1" }).data.ok).toBe(true);
    expect(call(claude, "link_issues", { blocker: "WEB-1", blocked: "WEB-2" }).isError).toBe(true);
  });

  it("répond aux erreurs de l'agent par un message qui l'aide à corriger", () => {
    const { claude } = setup();
    const r = call(claude, "create_issue", { project: "WEB", title: "X", status: "Inexistant" });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("Statuts :");
    expect(call(claude, "get_issue", { issue: "WEB-99" }).isError).toBe(true);
    expect(call(claude, "create_issue", { project: "NOPE", title: "X" }).text).toContain("list_projects");
    expect(call(claude, "update_issue", { issue: "WEB-1" }).isError).toBe(true);
  });

  it("crée un projet d'un des trois styles", () => {
    const { claude } = setup();
    expect(call(claude, "create_project", { key: "vid", name: "Clip", style: "media" }).data.key).toBe("VID");
    expect(call(claude, "create_project", { key: "VID", name: "Doublon", style: "media" }).isError).toBe(true);
    expect(call(claude, "list_projects").data.map((p: { key: string }) => p.key).sort()).toEqual(["VID", "WEB"]);
  });
});
