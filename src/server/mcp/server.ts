import "server-only";
import type { User } from "@/lib/types";
import { toolByName, ToolError, TOOLS } from "./tools";

/**
 * A Model Context Protocol server, "Streamable HTTP" transport, stateless: every POST carries one
 * JSON-RPC message (or a batch) and gets its answer as plain JSON. No session, no stream to keep
 * open: it fits a Next.js route and a small VPS. See https://modelcontextprotocol.io/specification
 */

export const SUPPORTED_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
export const LATEST_VERSION = SUPPORTED_VERSIONS[0];

const INSTRUCTIONS = `TickUp est le gestionnaire de projet d'Antoine (kanban, epics, sprints, Gantt). Un projet a une clé (WEB) et ses tickets une référence (WEB-12).
Avant de créer ou modifier des tickets dans un projet, lis get_project : il donne les noms des statuts (colonnes), types, étiquettes, epics et sprints.
Pour déplacer un ticket sur le kanban, change son status ; « done » le termine. Rends compte de ton travail avec add_comment.
Tu agis sous ton propre nom d'agent : list_my_issues donne les tickets qui te sont assignés.`;

type Json = Record<string, unknown>;
type Message = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };

const isObj = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);
const result = (id: unknown, value: unknown) => ({ jsonrpc: "2.0", id, result: value });
const error = (id: unknown, code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

/** Answers one message. Null for a notification (no id): nothing to send back. */
export function handleMessage(msg: unknown, me: User): Json | null {
  if (!isObj(msg) || msg.jsonrpc !== "2.0") return error(null, -32600, "Invalid Request");
  const { id, method, params } = msg as Message;
  const notification = id === undefined;
  if (typeof method !== "string") return notification ? null : error(id, -32600, "Invalid Request");
  // A response from the client (to a request we never send) or a notification: nothing to do.
  if (notification) return null;
  if (typeof id !== "string" && typeof id !== "number") return error(null, -32600, "Invalid Request");
  const p = isObj(params) ? params : {};

  switch (method) {
    case "initialize": {
      const asked = typeof p.protocolVersion === "string" ? p.protocolVersion : "";
      return result(id, {
        protocolVersion: SUPPORTED_VERSIONS.includes(asked) ? asked : LATEST_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "tickup", title: "TickUp", version: "1.0.0" },
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return result(id, {});
    case "tools/list":
      return result(id, { tools: TOOLS.map(({ name, title, description, inputSchema, annotations }) => ({ name, title, description, inputSchema, annotations: { title, ...annotations } })) });
    case "tools/call": {
      const tool = toolByName(p.name);
      if (!tool) return error(id, -32602, `Unknown tool: ${String(p.name)}`);
      const args = isObj(p.arguments) ? p.arguments : {};
      try {
        const out = tool.run(args, me);
        return result(id, { content: [{ type: "text", text: JSON.stringify(out, null, 1) }], isError: false });
      } catch (e) {
        // The agent's mistake: told as a tool result, so it can read it and try again.
        if (e instanceof ToolError) return result(id, { content: [{ type: "text", text: e.message }], isError: true });
        console.error("[mcp]", tool.name, e);
        return result(id, { content: [{ type: "text", text: "Erreur interne de TickUp." }], isError: true });
      }
    }
    // Asked by some clients even when not announced: empty lists rather than an error.
    case "resources/list":
      return result(id, { resources: [] });
    case "resources/templates/list":
      return result(id, { resourceTemplates: [] });
    case "prompts/list":
      return result(id, { prompts: [] });
    default:
      return error(id, -32601, `Method not found: ${method}`);
  }
}

/** Answers a POST body: one message or a batch. Null when only notifications came (HTTP 202). */
export function handleBody(body: unknown, me: User): Json | Json[] | null {
  if (Array.isArray(body)) {
    if (!body.length || body.length > 50) return error(null, -32600, "Invalid Request");
    const out = body.map((m) => handleMessage(m, me)).filter((r): r is Json => r !== null);
    return out.length ? out : null;
  }
  return handleMessage(body, me);
}
