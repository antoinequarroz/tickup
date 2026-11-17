import { BrandIcon } from "./logo";
import { CalendarDays, Clapperboard, FileText, KanbanSquare, LayoutGrid, MessagesSquare, Send, type LucideProps } from "lucide-react";

const ICONS: Record<string, React.ComponentType<LucideProps>> = {
  projects: KanbanSquare,
  messages: MessagesSquare,
  notes: FileText,
  publication: Send,
  agenda: CalendarDays,
  studio: Clapperboard,
};

export function ModuleIcon({ icon, ...props }: { icon: string } & LucideProps) {
  const Icon = ICONS[icon] ?? LayoutGrid;
  return <Icon {...props} />;
}

// The picto of each tool, from the Postmelo identity kit (public/brand/<slug>/).
const PICTOS: Record<string, string> = {
  projects: "tickup",
  messages: "lamio",
  notes: "cairn",
  publication: "metricove",
  agenda: "alfred",
  studio: "nino",
};

/** The tool's own picto when the kit has one, otherwise its generic icon. */
export function ModulePicto({ icon, className }: { icon: string; className?: string }) {
  const slug = PICTOS[icon];
  return slug ? <BrandIcon slug={slug} className={className} /> : <ModuleIcon icon={icon} className={className} />;
}
