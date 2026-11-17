import "server-only";
import type { ServerEvent } from "@/lib/types";

// Live updates, in memory: fine for one server process. With several, this becomes Postgres
// LISTEN/NOTIFY or Redis, behind the same two functions.
type Listener = { userId: string; send: (event: ServerEvent) => void };

const globalForEvents = globalThis as unknown as { __tickupListeners?: Set<Listener> };
const listeners = (globalForEvents.__tickupListeners ??= new Set());

export function subscribe(userId: string, send: Listener["send"]) {
  const listener = { userId, send };
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function publish(event: ServerEvent, audience: "all" | string[]) {
  for (const l of listeners) {
    if (audience !== "all" && !audience.includes(l.userId)) continue;
    try {
      l.send(event);
    } catch {
      listeners.delete(l);
    }
  }
}
