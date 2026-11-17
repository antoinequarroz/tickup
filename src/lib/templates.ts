import type { StatusCategory, TemplateId } from "./types";

/**
 * The project styles. Each one gives a project its first workflow, ticket types and labels;
 * everything stays editable afterwards in the project's settings.
 */
export type Template = {
  id: TemplateId;
  name: string;
  description: string;
  icon: string;
  statuses: { name: string; category: StatusCategory }[];
  types: { name: string; icon: string }[];
  labels: { name: string; tone: number }[];
  /** Epics proposed when the project is created, as a starting point. */
  epics: string[];
};

export const TEMPLATES: Template[] = [
  {
    id: "general",
    name: "Projet général",
    description: "Pour tout le reste : un événement, un déménagement, un client. Simple et sans jargon.",
    icon: "folder",
    statuses: [
      { name: "À faire", category: "todo" },
      { name: "En cours", category: "active" },
      { name: "En attente", category: "review" },
      { name: "Terminé", category: "done" },
      { name: "Abandonné", category: "canceled" },
    ],
    types: [
      { name: "Tâche", icon: "task" },
      { name: "Jalon", icon: "milestone" },
      { name: "Réunion", icon: "meeting" },
      { name: "Document", icon: "doc" },
    ],
    labels: [
      { name: "Important", tone: 4 },
      { name: "Client", tone: 3 },
      { name: "Admin", tone: 2 },
      { name: "Idée", tone: 1 },
    ],
    epics: [],
  },
  {
    id: "media",
    name: "Création multimédia",
    description: "Vidéo, podcast, photo, graphisme : de l'idée à la publication, étape par étape.",
    icon: "clapper",
    statuses: [
      { name: "Idées", category: "backlog" },
      { name: "Écriture", category: "todo" },
      { name: "Production", category: "active" },
      { name: "Post-production", category: "active" },
      { name: "Validation", category: "review" },
      { name: "Publié", category: "done" },
      { name: "Abandonné", category: "canceled" },
    ],
    types: [
      { name: "Vidéo", icon: "video" },
      { name: "Podcast", icon: "audio" },
      { name: "Photo", icon: "photo" },
      { name: "Graphisme", icon: "design" },
      { name: "Article", icon: "doc" },
      { name: "Tâche", icon: "task" },
    ],
    labels: [
      { name: "Script", tone: 1 },
      { name: "Tournage", tone: 3 },
      { name: "Montage", tone: 4 },
      { name: "Son", tone: 2 },
      { name: "Étalonnage", tone: 2 },
      { name: "Réseaux sociaux", tone: 1 },
    ],
    epics: ["Pré-production", "Production", "Diffusion"],
  },
  {
    id: "software",
    name: "Développement informatique",
    description: "Features, bugs et dette technique, avec un cycle backlog, revue de code et livraison.",
    icon: "code",
    statuses: [
      { name: "Backlog", category: "backlog" },
      { name: "À faire", category: "todo" },
      { name: "En cours", category: "active" },
      { name: "En revue", category: "review" },
      { name: "Terminé", category: "done" },
      { name: "Annulé", category: "canceled" },
    ],
    types: [
      { name: "Feature", icon: "feature" },
      { name: "Bug", icon: "bug" },
      { name: "Amélioration", icon: "improvement" },
      { name: "Tâche technique", icon: "task" },
    ],
    labels: [
      { name: "Frontend", tone: 1 },
      { name: "Backend", tone: 3 },
      { name: "Infra", tone: 4 },
      { name: "Design", tone: 2 },
      { name: "Sécurité", tone: 4 },
    ],
    epics: [],
  },
];

export const templateById = (id: string) => TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0];

export const PRIORITIES = [
  { value: 0, label: "Aucune" },
  { value: 1, label: "Urgente" },
  { value: 2, label: "Haute" },
  { value: 3, label: "Moyenne" },
  { value: 4, label: "Basse" },
] as const;

export const CATEGORIES: { value: StatusCategory; label: string }[] = [
  { value: "backlog", label: "Backlog" },
  { value: "todo", label: "À faire" },
  { value: "active", label: "En cours" },
  { value: "review", label: "En revue" },
  { value: "done", label: "Terminé" },
  { value: "canceled", label: "Annulé" },
];

export const EPIC_STATES = [
  { value: "planned", label: "Prévu" },
  { value: "active", label: "En cours" },
  { value: "done", label: "Terminé" },
  { value: "canceled", label: "Annulé" },
] as const;

/** A project key from its name: "Site web Saint-Martin" → "SWS". */
export function suggestKey(name: string) {
  const words = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return "";
  if (words.length === 1) return words[0].slice(0, 4);
  return words
    .map((w) => w[0])
    .join("")
    .slice(0, 5);
}

export const validKey = (key: string) => /^[A-Z][A-Z0-9]{1,5}$/.test(key);
