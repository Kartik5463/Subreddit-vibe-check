import Parser from "rss-parser";

const parser = new Parser();

// In-memory cache for subreddits: key -> { posts, hasUpvotes, timestamp }
const cache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes fresh cache
const STALE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours stale fallback cache
const CACHE_MAX_ENTRIES = 500; // hard cap so the map cannot grow without bound

// Deduplicate concurrent in-flight requests for the same subreddit
const inFlightRequests = new Map();

// Reddit subreddit names are letters, digits and underscores only
const SUBREDDIT_PATTERN = /^[A-Za-z0-9_]{2,21}$/;

// Cached Reddit OAuth token (if credentials are provided in .env)
let redditAccessToken = null;
let tokenExpiresAt = 0;

// User agents for RSS feed requests
const USER_AGENTS = [
  "web:vibe-check-app:v1.0 (by /u/Human_Point_4829)",
  "web:subreddit-vibe-checker:v1.2 (by /u/vibe_checker_bot)",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
];

function getRandomUserAgent() {
  const index = Math.floor(Math.random() * USER_AGENTS.length);
  return USER_AGENTS[index];
}

/**
 * Drops entries past the stale window, then trims the oldest remaining
 * entries if the cache is still over its size cap.
 */
function pruneCache() {
  const now = Date.now();

  for (const [key, entry] of cache) {
    if (now - entry.timestamp > STALE_TTL_MS) {
      cache.delete(key);
    }
  }

  if (cache.size <= CACHE_MAX_ENTRIES) return;

  // Map keeps insertion order and every write re-inserts, so the leading
  // keys are the least recently refreshed.
  const overflow = cache.size - CACHE_MAX_ENTRIES;
  let removed = 0;
  for (const key of cache.keys()) {
    if (removed >= overflow) break;
    cache.delete(key);
    removed++;
  }
}

/**
 * Obtains an application-only Reddit OAuth token if client credentials exist in environment.
 * Reddit grants 100 requests per minute with OAuth tokens.
 */
async function getRedditOAuthToken() {
  const clientId = process.env.REDDIT_CLIENT_ID;
  const clientSecret = process.env.REDDIT_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return null;
  }

  // Use cached token if still valid (60s buffer)
  if (redditAccessToken && Date.now() < tokenExpiresAt - 60000) {
    return redditAccessToken;
  }

  try {
    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const userAgent =
      process.env.REDDIT_USER_AGENT ||
      "web:subreddit-vibe-check:v1.0 (by /u/Human_Point_4829)";

    const response = await fetch("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": userAgent,
      },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      console.warn("Reddit OAuth token request failed:", response.status);
      return null;
    }

    const data = await response.json();
    if (data.access_token) {
      redditAccessToken = data.access_token;
      tokenExpiresAt = Date.now() + (data.expires_in || 3600) * 1000;
      console.log("Reddit OAuth token obtained successfully (100 req/min limit active)");
      return redditAccessToken;
    }
  } catch (error) {
    console.warn("Reddit OAuth token fetch error:", error.message);
  }

  return null;
}

/**
 * Fetch posts via Reddit Official OAuth API
 */
async function fetchViaOAuth(subreddit, token) {
  const userAgent =
    process.env.REDDIT_USER_AGENT ||
    "web:subreddit-vibe-check:v1.0 (by /u/Human_Point_4829)";

  const response = await fetch(
    `https://oauth.reddit.com/r/${encodeURIComponent(subreddit)}/hot?limit=50`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": userAgent,
      },
      signal: AbortSignal.timeout(10000),
    }
  );

  console.log("Reddit OAuth response status:", response.status);

  if (!response.ok) {
    // A revoked or stale token should not poison every later request.
    if (response.status === 401 || response.status === 403) {
      redditAccessToken = null;
      tokenExpiresAt = 0;
    }

    return {
      success: false,
      status: response.status,
      rateLimited: response.status === 429,
    };
  }

  const json = await response.json();
  const children = json?.data?.children || [];

  if (children.length === 0) {
    return {
      success: false,
      status: 404,
      error: "No posts found for this subreddit.",
    };
  }

  const posts = children.map((child, index) => ({
    id: child.data.id || String(index),
    title: child.data.title || "Untitled",
    url: child.data.permalink
      ? `https://reddit.com${child.data.permalink}`
      : child.data.url || "",
    upvotes: child.data.ups ?? null,
  }));

  return {
    success: true,
    posts,
    status: 200,
    hasUpvotes: true,
  };
}

/**
 * Reddit sometimes answers 200 with an HTML page instead of a feed. Only a
 * page that explicitly names the reason tells us anything about the
 * subreddit: old.reddit.com redirects to a generic "Welcome to Reddit" bot
 * gate for every name, real or not, so a bare HTML body is evidence that the
 * endpoint was blocked, not that the subreddit is missing.
 *
 * Returns a definitive result, { rateLimited: true }, or null when the page
 * says nothing useful.
 */
export function classifyNonFeedBody(xml, subreddit) {
  if (/quarantine/i.test(xml)) {
    return {
      success: false,
      status: 403,
      error: "This subreddit is quarantined and cannot be analyzed.",
    };
  }

  // "private" appears in Reddit's own interstitial for restricted communities.
  if (/\bthis (community|subreddit) is private\b|\bprivate community\b/i.test(xml)) {
    return {
      success: false,
      status: 403,
      error: "This subreddit is private and cannot be analyzed.",
    };
  }

  if (/has been banned|\bbanned\b.{0,40}\bcommunity\b/i.test(xml)) {
    return {
      success: false,
      status: 404,
      error: `The subreddit "${subreddit}" has been banned.`,
    };
  }

  if (/there doesn.t seem to be anything here|page not found|nothing here/i.test(xml)) {
    return {
      success: false,
      status: 404,
      error: `No subreddit named "${subreddit}" was found.`,
    };
  }

  // Reddit's over-limit page is served as HTML with a 200.
  if (/whoa there, pardner|you.ve been doing that a lot|take a break/i.test(xml)) {
    return { rateLimited: true };
  }

  return null;
}

/** True when the body actually looks like an XML/Atom/RSS document. */
export function looksLikeFeed(xml) {
  const head = xml.slice(0, 600).trimStart().toLowerCase();
  return (
    head.startsWith("<?xml") ||
    head.startsWith("<feed") ||
    head.startsWith("<rss")
  );
}

/**
 * Fetch posts using RSS feeds across multiple endpoints (www.reddit.com and old.reddit.com)
 */
async function fetchViaRSS(subreddit) {
  const endpoints = [
    `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/hot.rss?limit=50`,
    `https://old.reddit.com/r/${encodeURIComponent(subreddit)}/hot.rss?limit=50`,
  ];

  let lastStatus = 500;
  let lastError = null;
  let rateLimited = false;
  let blocked = false;
  let retryAfterSeconds = null;

  for (const url of endpoints) {
    try {
      console.log(`Attempting RSS fetch from: ${url}`);
      const userAgent = getRandomUserAgent();

      const response = await fetch(url, {
        headers: {
          "User-Agent": userAgent,
          Accept: "application/atom+xml,application/xml,text/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Cache-Control": "no-cache",
        },
        signal: AbortSignal.timeout(10000),
      });

      lastStatus = response.status;
      console.log(`Reddit RSS status (${url}):`, response.status);

      // A missing subreddit redirects to /subreddits/search.rss, which is a
      // valid feed of *other* communities. Without this check those search
      // results would be analyzed as if they were the subreddit's posts.
      if (/\/subreddits\/search/i.test(response.url)) {
        return {
          success: false,
          status: 404,
          error: `No subreddit named "${subreddit}" was found.`,
        };
      }

      if (response.status === 429) {
        rateLimited = true;
        const resetHeader =
          response.headers.get("retry-after") ||
          response.headers.get("x-ratelimit-reset");
        if (resetHeader) {
          const parsed = parseInt(resetHeader, 10);
          if (!isNaN(parsed)) retryAfterSeconds = parsed;
        }
        // Try fallback endpoint
        continue;
      }

      const xml = await response.text();

      if (response.status === 403) {
        if (/private|quarantined/i.test(xml)) {
          return {
            success: false,
            status: 403,
            error:
              "This subreddit is private or quarantined and cannot be analyzed.",
          };
        }
        lastError = "Reddit denied access to this subreddit.";
        continue;
      }

      // A 404 is definitive, so stop instead of retrying the other endpoint.
      if (response.status === 404) {
        return {
          success: false,
          status: 404,
          error: `No subreddit named "${subreddit}" was found.`,
        };
      }

      if (!response.ok) {
        lastError = `Reddit returned status ${response.status}`;
        continue;
      }

      // A 200 that is not a feed is an HTML page. Use it only when it names
      // a reason; otherwise treat this endpoint as blocked and move on.
      if (!looksLikeFeed(xml)) {
        const verdict = classifyNonFeedBody(xml, subreddit);

        if (verdict?.rateLimited) {
          rateLimited = true;
          continue;
        }

        if (verdict) return verdict;

        blocked = true;
        lastError =
          "Reddit served a web page instead of a feed, which usually means it is blocking automated requests.";
        continue;
      }

      // Parse RSS XML. Parser messages ("Invalid character in entity name")
      // mean nothing to a user, so keep them in the log only.
      let feed;
      try {
        feed = await parser.parseString(xml);
      } catch (parseError) {
        console.warn(`Failed to parse feed from ${url}:`, parseError.message);
        blocked = true;
        lastError = "Reddit returned a feed that could not be read.";
        continue;
      }

      if (!feed.items || feed.items.length === 0) {
        return {
          success: false,
          status: 404,
          error:
            "No posts found. The subreddit may not exist or may not be accessible.",
        };
      }

      const posts = feed.items.map((item, index) => ({
        id: item.id || item.guid || `${subreddit}-${index}`,
        title: item.title || "Untitled",
        // RSS feeds carry no score, so report "unknown" rather than a fake 0.
        url: item.link || "",
        upvotes: null,
      }));

      return {
        success: true,
        posts,
        status: 200,
        hasUpvotes: false,
      };
    } catch (err) {
      console.warn(`Error fetching ${url}:`, err.message);
      lastError =
        err.name === "TimeoutError" || err.name === "AbortError"
          ? "Reddit took too long to respond."
          : "Could not reach Reddit.";
    }
  }

  if (rateLimited) {
    return {
      success: false,
      status: 429,
      rateLimited: true,
      retryAfterSeconds,
      error:
        "Reddit is temporarily rate-limiting requests. Please try again in a few moments.",
    };
  }

  // Every endpoint was blocked or unparseable. That is an upstream
  // availability problem, so do not claim the subreddit does not exist.
  if (blocked) {
    return {
      success: false,
      status: 503,
      error:
        "Reddit is currently blocking automated requests for this subreddit. Adding Reddit API credentials to the server makes this reliable.",
    };
  }

  return {
    success: false,
    // Never report a failure with a 2xx status: lastStatus can still be 200
    // when the request succeeded but its body was unusable.
    status: lastStatus >= 400 ? lastStatus : 502,
    error: lastError || "Failed to fetch subreddit from Reddit",
  };
}

export const getSubreddit = async (req, res) => {
  try {
    const rawSubreddit = req.params.subreddit;

    if (!rawSubreddit || !rawSubreddit.trim()) {
      return res.status(400).json({
        error: "Subreddit name is required",
      });
    }

    // Strip optional "r/" prefix and clean whitespace
    const subreddit = rawSubreddit.trim().replace(/^\/?r\//i, "");

    // Reject names Reddit could never resolve before spending an upstream call.
    if (!SUBREDDIT_PATTERN.test(subreddit)) {
      return res.status(400).json({
        error:
          "Invalid subreddit name. Use 2-21 letters, numbers, or underscores.",
      });
    }

    const cacheKey = subreddit.toLowerCase();
    const now = Date.now();

    // 1. Check in-memory cache (fresh hit within TTL)
    const cachedEntry = cache.get(cacheKey);
    if (cachedEntry && now - cachedEntry.timestamp < CACHE_TTL_MS) {
      console.log(`Cache HIT for subreddit: ${cacheKey}`);
      return res.json({
        subreddit,
        posts: cachedEntry.posts,
        hasUpvotes: cachedEntry.hasUpvotes,
        cached: true,
      });
    }

    // 2. In-flight request deduplication to prevent hammering Reddit with concurrent duplicate queries
    let fetchPromise = inFlightRequests.get(cacheKey);
    // Only the request that started the fetch may clear the dedup entry.
    // Otherwise an early-finishing waiter lets a duplicate fetch start.
    let isOwner = false;

    if (!fetchPromise) {
      isOwner = true;
      fetchPromise = (async () => {
        // Try OAuth first if credentials are provided in .env
        const token = await getRedditOAuthToken();
        if (token) {
          const oauthResult = await fetchViaOAuth(subreddit, token);
          if (oauthResult.success) {
            return oauthResult;
          }
        }

        // Fall back to multi-endpoint RSS
        return await fetchViaRSS(subreddit);
      })();

      inFlightRequests.set(cacheKey, fetchPromise);
    } else {
      console.log(`Joining concurrent in-flight request for: ${cacheKey}`);
    }

    let result;
    try {
      result = await fetchPromise;
    } finally {
      if (isOwner) inFlightRequests.delete(cacheKey);
    }

    // 3. Fresh fetch succeeded
    if (result.success && result.posts && result.posts.length > 0) {
      cache.set(cacheKey, {
        posts: result.posts,
        hasUpvotes: Boolean(result.hasUpvotes),
        timestamp: now,
      });
      pruneCache();

      return res.json({
        subreddit,
        posts: result.posts,
        hasUpvotes: Boolean(result.hasUpvotes),
      });
    }

    // 4. Rate-limited or Reddit error: fall back to stale cache if available
    if (
      cachedEntry &&
      cachedEntry.posts &&
      cachedEntry.posts.length > 0 &&
      now - cachedEntry.timestamp < STALE_TTL_MS
    ) {
      console.warn(
        `Serving STALE cache for ${cacheKey} due to Reddit status ${result.status}`
      );
      return res.json({
        subreddit,
        posts: cachedEntry.posts,
        hasUpvotes: cachedEntry.hasUpvotes,
        cached: true,
        stale: true,
        warning:
          "Reddit is temporarily rate-limiting requests. Showing recently cached posts.",
      });
    }

    // 5. Rate limit hit without cached fallback
    if (result.rateLimited || result.status === 429) {
      const waitMessage = result.retryAfterSeconds
        ? ` Please try again in about ${result.retryAfterSeconds} seconds.`
        : " Please wait a few seconds and try again.";

      return res.status(429).json({
        error: `Reddit is temporarily rate-limiting requests.${waitMessage}`,
        retryAfter: result.retryAfterSeconds || 15,
      });
    }

    // 6. Other errors (e.g. 403 private, 404 not found)
    return res.status(result.status || 500).json({
      error: result.error || "Failed to fetch subreddit from Reddit.",
    });
  } catch (error) {
    console.error("Reddit Controller Error:", error);
    res.status(500).json({
      error: "Something went wrong while fetching Reddit data.",
    });
  }
};
