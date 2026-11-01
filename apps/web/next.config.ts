import path from "node:path";
import type { NextConfig } from "next";

const api = process.env.NEXT_PUBLIC_API_URL ?? "";
const ws = process.env.NEXT_PUBLIC_WS_URL ?? "";
const sb = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const dev = process.env.NODE_ENV !== "production";

// TRD 8.3. Next injects inline scripts/styles, so script/style need 'unsafe-inline' (dev also eval).
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  `connect-src 'self' ${[api, ws, sb].filter(Boolean).join(" ")}${dev ? " ws://localhost:* http://localhost:*" : ""}`,
  "img-src 'self' data: https://*.tile.openstreetmap.org",
  "font-src 'self'",
  "media-src 'self' blob:",
  "worker-src 'self'",
].join("; ");

const config: NextConfig = {
  ...(process.env.VERCEL ? {} : { outputFileTracingRoot: path.join(__dirname, "../../") }),
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        ],
      },
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Permissions-Policy", value: "geolocation=(self), microphone=(self)" },
          { key: "Strict-Transport-Security", value: "max-age=31536000" },
        ],
      },
    ];
  },
};

export default config;
