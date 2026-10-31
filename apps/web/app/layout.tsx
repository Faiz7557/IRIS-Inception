import type { Metadata, Viewport } from "next";
import { Atkinson_Hyperlegible_Next, Atkinson_Hyperlegible_Mono } from "next/font/google";
import "./globals.css";
import RegisterSW from "@/components/RegisterSW";

const sans = Atkinson_Hyperlegible_Next({
  subsets: ["latin"],
  weight: ["400", "700", "800"],
  display: "swap",
  fallback: ["system-ui"],
  variable: "--font-sans",
});
const mono = Atkinson_Hyperlegible_Mono({
  subsets: ["latin"],
  weight: ["700"],
  display: "swap",
  fallback: ["ui-monospace", "monospace"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "Jembatan 112",
  description: "Jembatan antara Anda dan operator 112, tanpa perlu bicara.",
};

export const viewport: Viewport = {
  themeColor: "#15171b",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <RegisterSW />
        {children}
      </body>
    </html>
  );
}
