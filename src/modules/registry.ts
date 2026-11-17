import type { ModuleInfo } from "@/lib/types";

/**
 * The suite, seen from TickUp. Same list and same levels as in Cordée (the base of the suite):
 *  - "core"   : TickUp itself (project management).
 *  - "linked" : the tool runs at its own address (set its URL in .env), TickUp links to it.
 *  - "soon"   : planned, not plugged in yet.
 */
type ModuleDef = Omit<ModuleInfo, "status" | "url"> & { core?: boolean; env?: string };

const MODULES: ModuleDef[] = [
  {
    id: "projets",
    name: "TickUp",
    role: "Gestion de projet",
    description: "Projets, epics, tickets et sous-tickets, en kanban ou en liste.",
    icon: "projects",
    core: true,
    href: "/projects",
  },
  {
    id: "messagerie",
    name: "Cordée",
    role: "Messagerie",
    description: "La base de la suite : canaux, messages directs, fichiers.",
    icon: "messages",
    env: "CORDEE_URL",
  },
  {
    id: "notes",
    name: "Cairn",
    role: "Notes et coffre",
    description: "Notes en Markdown et coffre chiffré pour les mots de passe et les clés.",
    icon: "notes",
    env: "CAIRN_URL",
  },
  {
    id: "publication",
    name: "Metricove",
    role: "Publication",
    description: "Calendrier éditorial et publication sur les réseaux sociaux.",
    icon: "publication",
    env: "METRICOVE_URL",
  },
  {
    id: "agenda",
    name: "Alfred",
    role: "Calendrier et rendez-vous",
    description: "Agenda, prise de rendez-vous et visio.",
    icon: "agenda",
    env: "ALFRED_URL",
  },
  {
    id: "studio",
    name: "Nino",
    role: "Régie vidéo",
    description: "Podcasts, tables rondes et lives, pilotés depuis la salle.",
    icon: "studio",
    env: "NINO_URL",
  },
];

const validUrl = (value: string | undefined) => (value && /^https?:\/\//.test(value) ? value : undefined);

export function listModules(env: Record<string, string | undefined> = process.env): ModuleInfo[] {
  return MODULES.map(({ core, env: key, ...m }) => {
    const url = key ? validUrl(env[key]) : undefined;
    return { ...m, status: core ? "core" : url ? "linked" : "soon", url };
  });
}
