import Parser from "rss-parser";

const parser = new Parser();

// In-memory cache for subreddits: key -> { posts, timestamp }
const cache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes fresh cache
const STALE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours stale fallback cache

// Deduplicate concurrent in-flight requests for the same subreddit
const inFlightRequests = new Map();

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
    upvotes: child.data.ups || 0,
  }));

  return {
    success: true,
    posts,
    status: 200,
  };
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
        if (xml.includes(": private</title>")) {
          return {
            success: false,
            status: 403,
            error: "This subreddit is private and cannot be analyzed.",
          };
        }
        lastError = "Reddit denied access to this subreddit.";
        continue;
      }

      if (!response.ok) {
        lastError = `Reddit returned status ${response.status}`;
        continue;
      }

      // Parse RSS XML
      const feed = await parser.parseString(xml);

      if (!feed.items || feed.items.length === 0) {
        return {
          success: false,
          status: 404,
          error:
            "No posts found. The subreddit may not exist or may not be accessible.",
        };
      }

      const posts = feed.items.map((item, index) => ({
        id: item.id || item.guid || String(index),
        title: item.title || "Untitled",
        url: item.link || "",
        upvotes: 0,
      }));

      return {
        success: true,
        posts,
        status: 200,
      };
    } catch (err) {
      console.warn(`Error fetching ${url}:`, err.message);
      lastError = err.message;
    }
  }

  return {
    success: false,
    status: rateLimited ? 429 : lastStatus,
    rateLimited,
    retryAfterSeconds,
    error: rateLimited
      ? "Reddit is temporarily rate-limiting requests. Please try again in a few moments."
      : lastError || "Failed to fetch subreddit from Reddit",
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
    const subreddit = rawSubreddit.trim().replace(/^r\//i, "");
    const cacheKey = subreddit.toLowerCase();
    const now = Date.now();

    // 1. Check in-memory cache (fresh hit within TTL)
    const cachedEntry = cache.get(cacheKey);
    if (cachedEntry && now - cachedEntry.timestamp < CACHE_TTL_MS) {
      console.log(`Cache HIT for subreddit: ${cacheKey}`);
      return res.json({
        posts: cachedEntry.posts,
        cached: true,
      });
    }

    // 2. In-flight request deduplication to prevent hammering Reddit with concurrent duplicate queries
    let fetchPromise = inFlightRequests.get(cacheKey);

    if (!fetchPromise) {
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
      inFlightRequests.delete(cacheKey);
    }

    // 3. Fresh fetch succeeded
    if (result.success && result.posts && result.posts.length > 0) {
      cache.set(cacheKey, {
        posts: result.posts,
        timestamp: now,
      });

      return res.json({
        posts: result.posts,
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
        posts: cachedEntry.posts,
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