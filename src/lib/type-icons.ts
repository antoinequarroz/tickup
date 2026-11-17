/** The icons a ticket type can take. Names only: the components live in components/icons.tsx. */
export const TYPE_ICONS = {
  task: "Tâche",
  milestone: "Jalon",
  meeting: "Réunion",
  doc: "Document",
  video: "Vidéo",
  audio: "Audio",
  photo: "Photo",
  design: "Graphisme",
  feature: "Feature",
  bug: "Bug",
  improvement: "Amélioration",
} as const;

export type TypeIcon = keyof typeof TYPE_ICONS;
