/**
 * Generates public/robots.txt and public/sitemap.xml before a build.
 *
 * Both files need absolute URLs, so the origin comes from SITE_URL (or
 * VITE_SITE_URL). Vercel exposes VERCEL_PROJECT_PRODUCTION_URL, which is
 * used as a fallback so a deploy without configuration still emits something
 * valid.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(here, "..", "public");

// A bare Windows path is not a valid ESM specifier, so import by file URL.
const { ALL_SUBS } = await import(
  pathToFileURL(resolve(here, "..", "src", "topics.js")).href
);

function resolveOrigin() {
  const explicit = process.env.SITE_URL || process.env.VITE_SITE_URL;
  if (explicit) return explicit.replace(/\/+$/, "");

  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercel) return `https://${vercel.replace(/\/+$/, "")}`;

  return "https://subreddit-vibe-check.vercel.app";
}

const origin = resolveOrigin();
const today = new Date().toISOString().slice(0, 10);

const urls = [
  { loc: `${origin}/`, priority: "1.0", changefreq: "daily" },
  // The catalog's subreddits are real, linkable pages thanks to the /r/:name
  // route, so list them to give crawlers more than a single entry point.
  ...ALL_SUBS.map((sub) => ({
    loc: `${origin}/r/${sub}`,
    priority: "0.7",
    changefreq: "daily",
  })),
];

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    ({ loc, priority, changefreq }) =>
      `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>${changefreq}</changefreq>\n    <priority>${priority}</priority>\n  </url>`
  )
  .join("\n")}
</urlset>
`;

const robots = `User-agent: *
Allow: /

Sitemap: ${origin}/sitemap.xml
`;

await mkdir(publicDir, { recursive: true });
await writeFile(resolve(publicDir, "sitemap.xml"), sitemap, "utf8");
await writeFile(resolve(publicDir, "robots.txt"), robots, "utf8");

console.log(
  `SEO files written for ${origin} (${urls.length} sitemap entries).`
);
