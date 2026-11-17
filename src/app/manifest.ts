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
    // The dark variant is the approved one for installed icons, whatever the page's theme.
    icons: [
      { src: "/brand/tickup/app-dark-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/brand/tickup/app-dark-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/brand/tickup/maskable-dark-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/brand/tickup/maskable-dark-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
