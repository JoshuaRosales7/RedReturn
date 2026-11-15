import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RedReturn | Mars mission decision intelligence",
  description: "Can a crew reach a Martian science target, survive plausible failures, and return? Real NASA MOLA terrain, explainable uncertainty, revised-mission planning.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0a0d11" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
