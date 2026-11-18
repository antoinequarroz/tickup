/** Runs once when the server starts: the due-date reminders, checked every 15 minutes. */
export async function register() {
  // Inside the "if", so the edge build leaves the Node-only modules out.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startReminders } = await import("./server/reminders");
    startReminders();
  }
}
