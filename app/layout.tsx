import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SITE_URL } from "@/lib/site";
const TITLE = "RedReturn — Plan a Marswalk on real NASA terrain";
const DESCRIPTION = "Plan a crewed Mars surface excursion on real NASA MOLA terrain: routes, return margins, risk, emergencies, daylight, space weather and a field card.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: TITLE, template: "%s · RedReturn" },
  description: DESCRIPTION,
  applicationName: "RedReturn",
  keywords: ["Mars", "Marswalk", "EVA planning", "NASA MOLA", "Mars terrain", "route planning", "space weather", "Mars24",
    "Perseverance", "Curiosity", "Jezero", "Gale crater", "NASA Space Apps", "education"],
  category: "science",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website", url: "/", siteName: "RedReturn", locale: "en_US", title: TITLE,
    description: "Real NASA MOLA elevations, terrain-aware routes and return margins, Mars24 daylight, NASA space weather, rover ground views and a field card with visor mode. Research & education prototype — not certified.",
  },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
  robots: { index: true, follow: true },
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "RedReturn", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false, address: false, email: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#0a0d11", colorScheme: "dark" };

/** Structured data for search engines (schema.org WebApplication). */
const JSON_LD = {
  "@context": "https://schema.org", "@type": "WebApplication", name: "RedReturn", url: SITE_URL, description: DESCRIPTION,
  applicationCategory: "EducationalApplication", operatingSystem: "Any (web browser)", isAccessibleForFree: true, inLanguage: "en",
  image: `${SITE_URL}/opengraph-image.png`,
  about: ["Mars surface exploration", "Extravehicular activity planning", "NASA MOLA topography"],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }} />
        <noscript><p style={{ padding: 16 }}>RedReturn is an interactive mission planner and needs JavaScript enabled.</p></noscript>
        {children}
      </body>
    </html>
  );
}
