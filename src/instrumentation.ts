/**
 * Remontée des erreurs du serveur vers Orbi (le monitoring de la suite), avec le SDK Sentry : Orbi
 * accepte son protocole tel quel. Côté serveur seulement : aucune page ne charge de script en plus,
 * et la Content-Security-Policy ne change pas.
 *
 * SENTRY_DSN vide = rien n'est envoyé (développement, tests). En production : le DSN du projet
 * « TickUp » d'Orbi (orbi.postmelo.ch > TickUp > Brancher).
 */
import type { Instrumentation } from "next";

/** Runs once when the server starts: the due-date reminders, checked every 15 minutes. */
export async function register() {
  // Inside the "if", so the edge build leaves the Node-only modules out.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startErrorReporting } = await import("./lib/error-reporting.node");
    await startErrorReporting();
    const { startReminders } = await import("./server/reminders");
    startReminders();
  }
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { reportRequestError } = await import("./lib/error-reporting.node");
    await reportRequestError(error, request, context);
  }
};
