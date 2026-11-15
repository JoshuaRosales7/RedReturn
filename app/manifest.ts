import type { MetadataRoute } from "next";

export const dynamic = "force-static";

/** Web app manifest: lets tablets and phones install RedReturn like an app (e.g. as a field device). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "RedReturn — Mars mission decision intelligence",
    short_name: "RedReturn",
    description: "Plan a crewed Mars surface excursion on real NASA MOLA terrain.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#0a0d11",
    theme_color: "#0a0d11",
    categories: ["education", "science", "navigation"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
