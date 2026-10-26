/**
 * Document head management.
 *
 * The app is a single-page client render, so the crawler-visible title,
 * description, canonical URL and structured data have to be kept in sync
 * with whatever the user is currently looking at.
 */

export const SITE_NAME = "Subreddit Vibe Check";

/**
 * Public origin used for canonical URLs and structured data. Set
 * VITE_SITE_URL in production; falls back to the current origin.
 */
export function siteOrigin() {
  const configured = import.meta.env.VITE_SITE_URL;
  if (configured) return String(configured).replace(/\/+$/, "");
  if (typeof window !== "undefined") return window.location.origin;
  return "";
}

function setMeta(selector, attr, value) {
  if (!value) return;
  let el = document.head.querySelector(selector);
  if (!el) {
    el = document.createElement("meta");
    const [, key, val] = selector.match(/\[(\w+)="([^"]+)"\]/) || [];
    if (key && val) el.setAttribute(key, val);
    document.head.appendChild(el);
  }
  el.setAttribute(attr, value);
}

function setLink(rel, href) {
  if (!href) return;
  let el = document.head.querySelector(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", rel);
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

/** Replaces the JSON-LD block, keeping a single source of truth in the head. */
function setStructuredData(data) {
  const id = "vibe-check-jsonld";
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement("script");
    el.id = id;
    el.type = "application/ld+json";
    document.head.appendChild(el);
  }
  el.textContent = JSON.stringify(data);
}

/**
 * Applies title, description, canonical, social cards and structured data.
 * Pass a subreddit (and optionally its measured vibe) for a results page, or
 * nothing for the landing page.
 */
export function applySeo({ subreddit, vibe, postCount } = {}) {
  const origin = siteOrigin();

  const title = subreddit
    ? `r/${subreddit} vibe check${vibe && vibe !== "—" ? ` — ${vibe}` : ""} | ${SITE_NAME}`
    : `${SITE_NAME} — Reddit sentiment analyzer for any subreddit`;

  const description = subreddit
    ? `Sentiment analysis of the hottest posts in r/${subreddit}.${
        vibe && vibe !== "—"
          ? ` The current mood reads ${vibe.toLowerCase()}`
          : ""
      }${postCount ? ` across ${postCount} posts` : ""}. Check the vibe of any subreddit instantly.`
    : "Analyze the sentiment of the hottest posts in any subreddit — from AskReddit and aww to Cooking, movies, sports and science. See any community's current mood at a glance.";

  const canonical = subreddit ? `${origin}/r/${subreddit}` : `${origin}/`;

  document.title = title;

  setMeta('meta[name="description"]', "content", description);
  setLink("canonical", canonical);

  setMeta('meta[property="og:title"]', "content", title);
  setMeta('meta[property="og:description"]', "content", description);
  setMeta('meta[property="og:url"]', "content", canonical);
  setMeta('meta[property="og:type"]', "content", "website");
  setMeta('meta[property="og:site_name"]', "content", SITE_NAME);

  setMeta('meta[name="twitter:card"]', "content", "summary_large_image");
  setMeta('meta[name="twitter:title"]', "content", title);
  setMeta('meta[name="twitter:description"]', "content", description);

  const graph = [
    {
      "@type": "WebApplication",
      "@id": `${origin}/#app`,
      name: SITE_NAME,
      url: `${origin}/`,
      applicationCategory: "UtilityApplication",
      operatingSystem: "Any",
      description,
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    },
  ];

  if (subreddit) {
    graph.push({
      "@type": "BreadcrumbList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "Home",
          item: `${origin}/`,
        },
        {
          "@type": "ListItem",
          position: 2,
          name: `r/${subreddit}`,
          item: canonical,
        },
      ],
    });
  }

  setStructuredData({ "@context": "https://schema.org", "@graph": graph });
}

/** Reads a subreddit from a /r/<name> path, if present. */
export function subredditFromPath(pathname = window.location.pathname) {
  const match = pathname.match(/^\/r\/([A-Za-z0-9_]{2,21})\/?$/);
  return match ? match[1] : null;
}

/** Pushes /r/<name> so results are linkable, shareable and indexable. */
export function pushSubredditUrl(subreddit, { replace = false } = {}) {
  const url = subreddit ? `/r/${subreddit}` : "/";
  if (window.location.pathname === url) return;
  const method = replace ? "replaceState" : "pushState";
  window.history[method]({ subreddit }, "", url);
}
