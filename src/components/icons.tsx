import { Bug, Camera, CircleCheck, FileText, Flag, Mic, Palette, Sparkles, SquareCheck, TrendingUp, Users, Video, type LucideProps } from "lucide-react";
import type { Label, Priority, StatusCategory } from "@/lib/types";
import { cn } from "@/lib/utils";

const TYPE: Record<string, React.ComponentType<LucideProps>> = {
  task: SquareCheck,
  milestone: Flag,
  meeting: Users,
  doc: FileText,
  video: Video,
  audio: Mic,
  photo: Camera,
  design: Palette,
  feature: Sparkles,
  bug: Bug,
  improvement: TrendingUp,
};

export function TypeIcon({ icon, ...props }: { icon: string } & LucideProps) {
  const Icon = TYPE[icon] ?? SquareCheck;
  return <Icon {...props} />;
}

/** A status drawn from its category, Linear style, in black and white: empty, dashed, half, three quarters, full. */
export function StatusIcon({ category, className }: { category: StatusCategory; className?: string }) {
  const c = cn("size-[14px] shrink-0", className);
  if (category === "done") return <CircleCheck className={cn(c, "fill-ink text-bg")} strokeWidth={2.4} aria-label="Terminé" />;
  if (category === "canceled")
    return (
      <svg viewBox="0 0 14 14" className={c} aria-label="Annulé">
        <circle cx="7" cy="7" r="6" fill="var(--ink-3)" />
        <path d="M4.8 4.8l4.4 4.4M9.2 4.8l-4.4 4.4" stroke="var(--bg)" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  const fill = { backlog: 0, todo: 0, active: 0.5, review: 0.75 }[category];
  const r = 3;
  const len = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 14 14" className={c} aria-label={category}>
      <circle cx="7" cy="7" r="6" fill="none" stroke={category === "backlog" ? "var(--ink-3)" : "var(--ink)"} strokeWidth="1.5" strokeDasharray={category === "backlog" ? "1.6 1.6" : undefined} />
      {fill > 0 && <circle cx="7" cy="7" r={r} fill="none" stroke="var(--ink)" strokeWidth={r * 2} strokeDasharray={`${len * fill} ${len}`} transform="rotate(-90 7 7)" />}
    </svg>
  );
}

/** Bars like a signal, an exclamation mark for urgent. */
export function PriorityIcon({ priority, className }: { priority: Priority; className?: string }) {
  const c = cn("size-[14px] shrink-0", className);
  if (priority === 0)
    return (
      <svg viewBox="0 0 14 14" className={c} aria-label="Aucune priorité">
        {[2, 6, 10].map((x) => (
          <rect key={x} x={x} y="6.4" width="2.2" height="1.2" rx=".5" fill="var(--ink-3)" />
        ))}
      </svg>
    );
  if (priority === 1)
    return (
      <svg viewBox="0 0 14 14" className={c} aria-label="Urgente">
        <rect x="1" y="1" width="12" height="12" rx="3" fill="var(--ink)" />
        <rect x="6.2" y="3.4" width="1.6" height="4.8" rx=".8" fill="var(--bg)" />
        <circle cx="7" cy="10.2" r=".95" fill="var(--bg)" />
      </svg>
    );
  const level = { 2: 3, 3: 2, 4: 1 }[priority];
  return (
    <svg viewBox="0 0 14 14" className={c} aria-label={["", "", "Haute", "Moyenne", "Basse"][priority]}>
      {[0, 1, 2].map((i) => (
        <rect key={i} x={1.5 + i * 4} y={9 - i * 3} width="3" height={3 + i * 3} rx=".8" fill={i < level ? "var(--ink)" : "var(--line-strong)"} />
      ))}
    </svg>
  );
}

export function LabelChip({ label, className }: { label: Label; className?: string }) {
  return <span className={cn("inline-flex h-[18px] items-center rounded-[5px] px-1.5 text-[10.5px] leading-none font-medium whitespace-nowrap", `tone-${label.tone}`, className)}>{label.name}</span>;
}

/** A small progress ring, for epics and sub-tickets. */
export function Progress({ done, total, className }: { done: number; total: number; className?: string }) {
  const r = 5;
  const len = 2 * Math.PI * r;
  const p = total ? done / total : 0;
  return (
    <svg viewBox="0 0 14 14" className={cn("size-[14px] shrink-0", className)} aria-label={`${done} sur ${total}`}>
      <circle cx="7" cy="7" r={r} fill="none" stroke="var(--line-strong)" strokeWidth="2" />
      <circle cx="7" cy="7" r={r} fill="none" stroke="var(--ink)" strokeWidth="2" strokeDasharray={`${len * p} ${len}`} strokeLinecap="round" transform="rotate(-90 7 7)" />
    </svg>
  );
}
