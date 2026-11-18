import "server-only";
import { remindDueDates } from "./notify";

const globalForReminders = globalThis as unknown as { __tickupReminders?: NodeJS.Timeout };

export function startReminders() {
  if (globalForReminders.__tickupReminders) return;
  const run = () => {
    try {
      remindDueDates();
    } catch (e) {
      console.error(`[reminders] ${(e as Error).message}`);
    }
  };
  // Not during the build, and a little after the start so the first requests come first.
  setTimeout(run, 10_000).unref();
  globalForReminders.__tickupReminders = setInterval(run, 15 * 60_000);
  globalForReminders.__tickupReminders.unref();
}
