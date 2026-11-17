import { cn } from "@/lib/utils";

/** A ticket with a check rising out of it: TickUp. Black and white, like the app. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 28" className={cn("size-7", className)} aria-hidden>
      <rect width="28" height="28" rx="8" fill="var(--ink)" />
      <path d="M7.5 14.6 12 19l8.6-10" fill="none" stroke="var(--bg)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M17.6 8.2h3.4v3.4" fill="none" stroke="var(--bg)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" opacity=".55" />
    </svg>
  );
}
