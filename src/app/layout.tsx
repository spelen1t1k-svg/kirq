import type { Metadata, Viewport } from "next";
import { Rajdhani, JetBrains_Mono } from "next/font/google";
import "@/styles/globals.css";

const rajdhani = Rajdhani({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-rajdhani",
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: "KIRQ — Kirka PUGs",
  description:
    "The ranked matchmaking Kirka never shipped. 1v1 Duel and 2v2 Point queues, Elo, divisions, region & map veto, verified results. Community-run, not affiliated with kirka.io.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0B0D10",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${rajdhani.variable} ${jetbrains.variable}`}>
      {/* Fonts: next/font self-hosts Rajdhani + JetBrains Mono; the token file
          references them by family name, so we bridge the CSS variables here. */}
      <body
        style={{
          ["--kq-font-ui" as string]: `var(--font-rajdhani), sans-serif`,
          ["--kq-font-mono" as string]: `var(--font-jetbrains), monospace`,
        }}
      >
        {children}
      </body>
    </html>
  );
}
