import Parser from "rss-parser";

const parser = new Parser();

// In-memory cache for subreddits: key -> { posts, hasUpvotes, timestamp }
const cache = new Map();
// 10 minutes fresh cache. Configurable so the stale-serving path is testable.
const CACHE_TTL_MS =
  process.env.CACHE_TTL_MS !== undefined
    ? Number(process.env.CACHE_TTL_MS)
    : 10 * 60 * 1000;
const STALE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours stale fallback cache
const CACHE_MAX_ENTRIES = 500; // hard cap so the map cannot grow without bound

// Deduplicate concurrent in-flight requests for the same subreddit
const inFlightRequests = new Map();

// Serialize outbound calls with a small gap so concurrent lookups are sent one
// at a time. That matters less for spacing than for ordering: each response
// updates the budget below before the next call checks it.
const MIN_UPSTREAM_GAP_MS = Number(process.env.REDDIT_MIN_GAP_MS) || 250;

let upstreamChain = Promise.resolve();
let lastUpstreamAt = 0;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Reddit's rate-limit budget, as Reddit itself reports it.
 *
 * Every Reddit response carries x-ratelimit-remaining and x-ratelimit-reset,
 * successful ones included. Measured anonymously, the RSS budget is a single
 * request per ~60s window: a 200 comes back with "remaining: 0, reset: 57",
 * so the very next lookup is guaranteed to 429. Reading the headers on every
 * response lets the server know when the next slot opens instead of finding
 * out by failing, and lets it tell the client the exact wait.
 *
 * OAuth and RSS have separate budgets, so they are tracked separately.
 */
const blockedUntil = { rss: 0, oauth: 0 };
// Never trust a reset longer than this; a bad header must not lock us out.
const MAX_BLOCK_MS = 10 * 60 * 1000;
// Arrive just after the window resets rather than racing it.
const RESET_SAFETY_MS = 1000;

function blockFor(kind, seconds, reason) {
  const ms = Math.min(Math.max(seconds, 0) * 1000 + RESET_SAFETY_MS, MAX_BLOCK_MS);
  const until = Date.now() + ms;
  if (until > blockedUntil[kind]) {
    blockedUntil[kind] = until;
    console.warn(
      `Reddit ${kind} budget ${reason}; next slot in ${Math.ceil(ms / 1000)}s`
    );
  }
}

/** Records the budget Reddit reports on any response, success or failure. */
function noteRateHeaders(kind, response) {
  const remaining = parseFloat(response.headers.get("x-ratelimit-remaining"));
  const reset = parseFloat(response.headers.get("x-ratelimit-reset"));

  if (response.status === 429) {
    const retryAfter = parseFloat(response.headers.get("retry-after"));
    const seconds = Number.isFinite(reset)
      ? reset
      : Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter
        : 60;
    blockFor(kind, seconds, "exceeded (429)");
    return;
  }

  if (Number.isFinite(remaining) && remaining < 1 && Number.isFinite(reset)) {
    blockFor(kind, reset, "used up");
  }
}

/** Seconds until `kind` may call Reddit again, or 0 when a slot is free. */
function secondsUntilSlot(kind) {
  const left = blockedUntil[kind] - Date.now();
  return left > 0 ? Math.ceil(left / 1000) : 0;
}

/** A result that says "no slot yet" without touching Reddit. */
function noSlot(seconds) {
  return {
    success: false,
    status: 429,
    rateLimited: true,
    retryAfterSeconds: seconds,
  };
}

/**
 * Runs `task` on a single queue, leaving at least MIN_UPSTREAM_GAP_MS between
 * consecutive outbound Reddit calls.
 */
function scheduleUpstream(task) {
  const scheduled = upstreamChain.then(async () => {
    const waitFor = lastUpstreamAt + MIN_UPSTREAM_GAP_MS - Date.now();
    if (waitFor > 0) await sleep(waitFor);
    lastUpstreamAt = Date.now();
    return task();
  });

  // Keep the chain alive even when a task rejects.
  upstreamChain = scheduled.then(
    () => undefined,
    () => undefined
  );

  return scheduled;
}

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

  const wait = secondsUntilSlot("oauth");
  if (wait > 0) return noSlot(wait);

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
  noteRateHeaders("oauth", response);

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
 * Fetch posts via RSS (www.reddit.com, then old.reddit.com for non-rate-limit
 * failures). There is deliberately no in-request retry: the budget resets
 * about a minute after it is spent, so the right move is to report the exact
 * wait and let the client come back, not to hold the connection open.
 */
async function fetchViaRSS(subreddit) {
  const endpoints = [
    `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/hot.rss?limit=50`,
    `https://old.reddit.com/r/${encodeURIComponent(subreddit)}/hot.rss?limit=50`,
  ];

  let lastStatus = 500;
  let lastError = null;
  let blocked = false;

  for (const url of endpoints) {
    try {
      console.log(`Attempting RSS fetch from: ${url}`);
      const userAgent = getRandomUserAgent();

      // The slot check runs inside the queue, right before the call, so a
      // response that just used up the budget is seen by the next caller.
      const response = await scheduleUpstream(async () => {
        const wait = secondsUntilSlot("rss");
        if (wait > 0) return { noSlotFor: wait };

        const res = await fetch(url, {
          headers: {
            "User-Agent": userAgent,
            Accept:
              "application/atom+xml,application/xml,text/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Cache-Control": "no-cache",
          },
          signal: AbortSignal.timeout(10000),
        });
        noteRateHeaders("rss", res);
        return res;
      });

      if (response.noSlotFor) return noSlot(response.noSlotFor);

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

      // noteRateHeaders has already recorded when the window resets. Do not
      // fall through to old.reddit.com: in every measured case it answered a
      // rate-limited request with its generic bot-gate page, so the extra
      // call only adds latency.
      if (response.status === 429) {
        return noSlot(secondsUntilSlot("rss") || 60);
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

        // Reddit's over-limit HTML page carries no budget headers to read.
        if (verdict?.rateLimited) {
          blockFor("rss", 60, "exceeded (over-limit page)");
          return noSlot(secondsUntilSlot("rss"));
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

/**
 * 429 with the exact wait, in a shape the client can count down and retry
 * from. `limitedBy` lets the client explain why: the anonymous budget is a
 * single lookup a minute for the whole server.
 */
function sendRateLimited(res, seconds, usingOAuth) {
  const retryAfter = Math.max(1, Math.ceil(seconds));
  res.set("Retry-After", String(retryAfter));
  return res.status(429).json({
    error: usingOAuth
      ? `Reddit's API budget is used up for the moment. The next lookup opens in about ${retryAfter} seconds.`
      : `Reddit allows this server one lookup a minute without API keys. The next one opens in about ${retryAfter} seconds.`,
    retryAfter,
    reason: "reddit_rate_limit",
    limitedBy: usingOAuth ? "oauth" : "anonymous",
  });
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

    // 2. No free slot: when Reddit has already said the budget is spent, a
    // call can only fail, so answer from cache or with the exact wait without
    // queueing behind other upstream calls.
    const usingOAuth = Boolean(
      process.env.REDDIT_CLIENT_ID && process.env.REDDIT_CLIENT_SECRET
    );
    const slotWait = usingOAuth
      ? Math.min(secondsUntilSlot("oauth"), secondsUntilSlot("rss"))
      : secondsUntilSlot("rss");

    if (slotWait > 0 && !inFlightRequests.has(cacheKey)) {
      if (
        cachedEntry &&
        cachedEntry.posts?.length > 0 &&
        now - cachedEntry.timestamp < STALE_TTL_MS
      ) {
        console.log(`Breaker open; serving cached posts for ${cacheKey}`);
        return res.json({
          subreddit,
          posts: cachedEntry.posts,
          hasUpvotes: cachedEntry.hasUpvotes,
          cached: true,
          stale: true,
          warning:
            "Reddit is rate-limiting this server right now, so these are recently cached posts.",
        });
      }

      return sendRateLimited(res, slotWait, usingOAuth);
    }

    // 3. In-flight request deduplication to prevent hammering Reddit with concurrent duplicate queries
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

    // 4. Fresh fetch succeeded
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

    // 5. Rate-limited or Reddit error: fall back to stale cache if available
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

    // 6. Rate limit hit without cached fallback
    if (result.rateLimited || result.status === 429) {
      return sendRateLimited(
        res,
        result.retryAfterSeconds || secondsUntilSlot("rss") || 60,
        usingOAuth
      );
    }

    // 7. Other errors (e.g. 403 private, 404 not found)
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
