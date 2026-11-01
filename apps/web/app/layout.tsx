import type { Metadata, Viewport } from "next";
import { Atkinson_Hyperlegible, Gabarito, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import RegisterSW from "@/components/RegisterSW";
import { LARGE_KEY, THEME_KEY } from "@/lib/theme";

// Gabarito for the big Sill headings; Atkinson Hyperlegible (built for low-vision legibility)
// for body, buttons and answers. JetBrains Mono for clocks and codes.
const sans = Atkinson_Hyperlegible({
  subsets: ["latin"],
  weight: ["400", "700"],
  display: "swap",
  fallback: ["system-ui", "sans-serif"],
  variable: "--font-sans",
});
const display = Gabarito({
  subsets: ["latin"],
  weight: ["700", "800", "900"],
  display: "swap",
  fallback: ["Arial Black", "system-ui"],
  variable: "--font-display",
});
const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["700"],
  display: "swap",
  fallback: ["ui-monospace", "monospace"],
  variable: "--font-mono",
});

// Runs before first paint so a saved dark choice or large text never flashes the default.
const themeScript = `try{var d=document.documentElement;if(localStorage.getItem("${THEME_KEY}")==="dark")d.dataset.theme="dark";if(localStorage.getItem("${LARGE_KEY}")==="1")d.classList.add("large-text")}catch(e){}`;

export const metadata: Metadata = {
  title: "Jembatan 112",
  description: "Jembatan antara Anda dan operator 112, tanpa perlu bicara.",
};

export const viewport: Viewport = {
  themeColor: "#f4f1ee",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className={`${sans.variable} ${display.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <RegisterSW />
        {children}
      </body>
    </html>
  );
}
