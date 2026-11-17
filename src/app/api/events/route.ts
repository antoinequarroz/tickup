import { currentUser } from "@/server/auth";
import { subscribe } from "@/server/events";
import { unauthorized } from "@/server/http";

export const dynamic = "force-dynamic";

/** Live updates (Server-Sent Events): new messages, deleted messages, "something changed, reload". */
export async function GET(req: Request) {
  const me = await currentUser();
  if (!me) return unauthorized();

  const encoder = new TextEncoder();
  let close = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (chunk: string) => controller.enqueue(encoder.encode(chunk));
      const unsubscribe = subscribe(me.id, (event) => write(`data: ${JSON.stringify(event)}\n\n`));
      // A comment line every 25 s keeps proxies from closing a quiet connection.
      const ping = setInterval(() => {
        try {
          write(": ping\n\n");
        } catch {
          close();
        }
      }, 25_000);
      close = () => {
        clearInterval(ping);
        unsubscribe();
        try {
          controller.close();
        } catch {}
      };
      req.signal.addEventListener("abort", close);
      write(": connected\n\n");
    },
    cancel() {
      close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" } });
}
