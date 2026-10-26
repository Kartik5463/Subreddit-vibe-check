/**
 * Post-build prerender.
 *
 * Without this, every /r/<name> URL is served the same index.html by the SPA
 * rewrite, so the sitemap advertises dozens of pages that are byte-identical
 * duplicates with one shared title. This writes a real HTML file per route
 * with its own title, description, canonical URL, structured data and visible
 * heading, which is what actually gets indexed.
 *
 * The app still renders client-side; this only varies the static page that
 * React replaces on mount, so what a crawler reads matches what a visitor
 * sees before the bundle loads.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(here, "..", "dist");

const { ALL_SUBS, TOPICS } = await import(
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

const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Replaces the content between two marker comments, markers included. */
function replaceRegion(html, name, replacement) {
  const pattern = new RegExp(
    `<!-- ?${name}:START[^>]*-->[\\s\\S]*?<!-- ?${name}:END ?-->`
  );
  if (!pattern.test(html)) {
    throw new Error(`Marker ${name} not found in index.html`);
  }
  return html.replace(
    pattern,
    `<!-- ${name}:START -->${replacement}<!-- ${name}:END -->`
  );
}

const FAQ = [
  {
    q: "What is a subreddit vibe check?",
    a: "It is a quick read of a subreddit's mood. Instead of scrolling a community to guess how it feels, the analyzer scores the sentiment of its hottest post titles and summarises them as positive, neutral or negative.",
  },
  {
    q: "Is this really semantic analysis?",
    a: "It is lexicon-based sentiment analysis, which is a shallow form of semantic analysis: each word carries a known emotional polarity from the AFINN-165 list and the scores are summed per title. It does not parse grammar, resolve context or reliably detect sarcasm.",
  },
  {
    q: "Which subreddits can I analyze?",
    a: "Any public subreddit. Private, banned and quarantined communities cannot be read, and the analyzer will say so rather than guess.",
  },
  {
    q: "Is it free?",
    a: "Yes. There is no account, no sign-up and no payment, and sentiment scoring runs in your own browser.",
  },
];

function seoTags({ title, description, canonical }) {
  const t = escapeHtml(title);
  const d = escapeHtml(description);
  return `
    <title>${t}</title>
    <meta name="description" content="${d}" />
    <link rel="canonical" href="${canonical}" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Subreddit Vibe Check" />
    <meta property="og:title" content="${t}" />
    <meta property="og:description" content="${d}" />
    <meta name="twitter:card" content="summary" />
    <meta name="twitter:title" content="${t}" />
    <meta name="twitter:description" content="${d}" />
  `;
}

function jsonLd(subreddit, { title, description, canonical }) {
  const graph = [
    {
      "@type": "WebApplication",
      "@id": `${origin}/#app`,
      name: "Subreddit Vibe Check",
      alternateName: "Semantic Subreddit Analyzer",
      url: `${origin}/`,
      applicationCategory: "UtilityApplication",
      operatingSystem: "Any",
      description:
        "Measure the sentiment and mood of any subreddit's hottest posts.",
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    },
    {
      "@type": "WebPage",
      "@id": canonical,
      url: canonical,
      name: title,
      description,
      isPartOf: { "@id": `${origin}/#app` },
    },
  ];

  if (subreddit) {
    graph.push({
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: `${origin}/` },
        {
          "@type": "ListItem",
          position: 2,
          name: `r/${subreddit}`,
          item: canonical,
        },
      ],
    });
  } else {
    // The FAQ is only marked up on the page that actually shows all of it.
    graph.push({
      "@type": "FAQPage",
      mainEntity: FAQ.map(({ q, a }) => ({
        "@type": "Question",
        name: q,
        acceptedAnswer: { "@type": "Answer", text: a },
      })),
    });
  }

  return `\n    <script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@graph": graph,
  })}</script>\n  `;
}

/** The hero shown for a /r/<name> page, mirroring what the app then renders. */
function subredditHero(subreddit) {
  const related = (
    TOPICS.find((topic) => topic.subs.includes(subreddit)) || TOPICS[0]
  ).subs
    .filter((name) => name !== subreddit)
    .slice(0, 3);

  return `
      <main class="shell">
        <div class="shell-hero">
          <span class="shell-badge">Reddit sentiment analyzer</span>
          <h1>r/${escapeHtml(subreddit)} <span>vibe check</span></h1>
          <p class="shell-lede">
            Semantic sentiment analysis of the hottest posts in
            r/${escapeHtml(subreddit)}. Every post title is scored for
            emotional polarity and grouped as positive, neutral or negative to
            show how the community is feeling right now.
          </p>
          <span class="shell-status">
            <span class="shell-spinner"></span>
            Analyzing r/${escapeHtml(subreddit)}…
          </span>
        </div>

        <section>
          <h2>How r/${escapeHtml(subreddit)} is analyzed</h2>
          <ol class="shell-steps">
            <li>
              <h3>1. Hot posts are fetched</h3>
              <p>Up to 50 of the subreddit's hottest posts are collected from Reddit.</p>
            </li>
            <li>
              <h3>2. Titles are scored</h3>
              <p>Each title is scored against the AFINN-165 sentiment lexicon.</p>
            </li>
            <li>
              <h3>3. Results are grouped</h3>
              <p>Scores become positive, neutral and negative counts with an average.</p>
            </li>
            <li>
              <h3>4. You get the verdict</h3>
              <p>An overall vibe summarises the mood of r/${escapeHtml(subreddit)}.</p>
            </li>
          </ol>
        </section>

        <section>
          <h2>Analyze related subreddits</h2>
          <ul class="shell-links">
            ${related
              .map(
                (name) =>
                  `<li><a href="/r/${name}">r/${escapeHtml(name)}</a></li>`
              )
              .join("\n            ")}
            <li><a href="/">All topics</a></li>
          </ul>
        </section>

        <p class="shell-foot">
          Sentiment scored locally with the AFINN-165 word list. Titles only,
          so treat the result as a rough read rather than a verdict. Not
          affiliated with Reddit.
        </p>
      </main>
    `;
}

const template = await readFile(resolve(distDir, "index.html"), "utf8");

// The landing page keeps the template's own shell; only its tags are rewritten
// so the canonical URL reflects the configured origin.
const landing = {
  title: "Semantic Subreddit Analyzer — Reddit Sentiment & Mood Checker",
  description:
    "Free semantic subreddit analyzer. Measure the sentiment and mood of any subreddit's hottest posts in seconds — r/AskReddit, r/aww, r/Cooking, gaming, sports, science and every other public community.",
  canonical: `${origin}/`,
};

let landingHtml = replaceRegion(template, "SEO", seoTags(landing));
landingHtml = replaceRegion(landingHtml, "JSONLD", jsonLd(null, landing));
await writeFile(resolve(distDir, "index.html"), landingHtml, "utf8");

let written = 1;

for (const sub of ALL_SUBS) {
  const meta = {
    title: `r/${sub} sentiment analysis — Subreddit Vibe Check`,
    description: `Is r/${sub} positive or negative right now? Semantic sentiment analysis of the hottest posts in r/${sub}, scored and grouped to show the community's current mood.`,
    canonical: `${origin}/r/${sub}`,
  };

  let html = replaceRegion(template, "SEO", seoTags(meta));
  html = replaceRegion(html, "JSONLD", jsonLd(sub, meta));
  html = replaceRegion(html, "SHELL", subredditHero(sub));

  // Flat "r/<sub>.html" rather than "r/<sub>/index.html": with Vercel's
  // cleanUrls this is served at the bare /r/<sub> path, which is what the
  // canonical URLs and the sitemap point at. A directory index only resolves
  // for the trailing-slash form on some static hosts.
  await mkdir(resolve(distDir, "r"), { recursive: true });
  await writeFile(resolve(distDir, "r", `${sub}.html`), html, "utf8");
  written++;
}

console.log(
  `Prerendered ${written} pages for ${origin} (1 landing + ${ALL_SUBS.length} subreddit routes).`
);
