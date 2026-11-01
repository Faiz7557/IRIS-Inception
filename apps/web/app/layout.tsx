import type { Metadata, Viewport } from "next";
import { Atkinson_Hyperlegible_Mono, Gabarito, Rethink_Sans } from "next/font/google";
import "./globals.css";
import RegisterSW from "@/components/RegisterSW";
import { THEME_KEY } from "@/lib/theme";

// Sill template faces: Gabarito for headings, Rethink Sans for body and buttons. Mono stays for clocks and codes.
const sans = Rethink_Sans({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
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

// Runs before first paint so a saved dark choice never flashes light.
const themeScript = `try{if(localStorage.getItem("${THEME_KEY}")==="dark")document.documentElement.dataset.theme="dark"}catch(e){}`;

export const metadata: Metadata = {
  title: "Jembatan 112",
  description: "Jembatan antara Anda dan operator 112, tanpa perlu bicara.",
};

export const viewport: Viewport = {
  themeColor: "#f4f1ee",
  width: "device-width",
  initialScale: 1,
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
