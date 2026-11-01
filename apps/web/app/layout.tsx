import type { Metadata, Viewport } from "next";
import { Atkinson_Hyperlegible_Mono, Atkinson_Hyperlegible_Next, Gabarito } from "next/font/google";
import "./globals.css";
import RegisterSW from "@/components/RegisterSW";
import { LARGE_KEY, THEME_KEY } from "@/lib/theme";

// Gabarito for the big Sill headings; Atkinson Hyperlegible Next (brand font, built for low-vision legibility)
// for body, buttons and answers. Mono stays for clocks and codes.
const sans = Atkinson_Hyperlegible_Next({
  subsets: ["latin"],
  weight: ["400", "600", "700", "800"],
  display: "swap",
  fallback: ["system-ui"],
  variable: "--font-sans",
});
const display = Gabarito({
  subsets: ["latin"],
  weight: ["700", "800", "900"],
  display: "swap",
  fallback: ["Arial Black", "system-ui"],
  variable: "--font-display",
});
const mono = Atkinson_Hyperlegible_Mono({
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
