import type { Notification } from "./types";

/** One line for a notification, in the bell and in the e-mail: "Ana t'a attribué ce ticket". */
export function notificationText(n: Pick<Notification, "kind" | "actor" | "data">): string {
  const who = n.actor?.name ?? "Quelqu'un";
  switch (n.kind) {
    case "assigned":
      return `${who} t'a attribué ce ticket`;
    case "mentioned":
      return `${who} t'a mentionné dans un commentaire`;
    case "status":
      return n.actor ? `${who} l'a passé de « ${n.data.from} » à « ${n.data.to} »` : `Passé de « ${n.data.from} » à « ${n.data.to} »${n.data.via === "github" ? " par GitHub" : ""}`;
    case "due":
      return "L'échéance est demain";
  }
}
