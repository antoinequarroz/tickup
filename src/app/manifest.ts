import type { MetadataRoute } from "next";

// Lets TickUp be installed as an app: "Ajouter au Dock" on Mac, "Sur l'écran d'accueil" on iPhone.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TickUp",
    short_name: "TickUp",
    description: "La gestion de projet de la suite.",
    start_url: "/projects",
    display: "standalone",
    background_color: "#efede8",
    theme_color: "#efede8",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
