/** Public address of the site (canonical URLs, social previews, sitemap). Override per deployment with NEXT_PUBLIC_SITE_URL. */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://redreturngt.us").replace(/\/$/, "");
