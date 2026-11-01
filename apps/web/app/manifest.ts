import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Jembatan 112",
    short_name: "J112",
    display: "standalone",
    start_url: "/",
    theme_color: "#f4f1ee",
    background_color: "#f4f1ee",
    // Long-press the app icon: jump straight to a preselected plate or the officer card.
    shortcuts: [
      { name: "Kebakaran", url: "/?kejadian=kebakaran" },
      { name: "Sakit", url: "/?kejadian=sakit" },
      { name: "Kecelakaan", url: "/?kejadian=kecelakaan" },
      { name: "Kartu darurat", url: "/kartu" },
    ],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
