import { useCallback, useEffect, useRef, useState } from "react";
import { VITE_API_URL } from "./api.js";
import Sentiment from "sentiment";
import {
  Smile,
  Frown,
  Meh,
  BarChart3,
  Search,
  ArrowUp,
  ExternalLink,
  Loader2,
  TrendingUp,
  AlertCircle,
  Info,
  Sparkles,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import VibeLoader from "./VibeLoader.jsx";
import { TOPICS, QUICK_PICKS } from "./topics.js";
import { applySeo, pushSubredditUrl, subredditFromPath } from "./seo.js";

const sentiment = new Sentiment();

const EMPTY_STATS = {
  positive: 0,
  neutral: 0,
  negative: 0,
  avgScore: "0.00",
};

export default function App() {
  // A /r/<name> deep link seeds the input before the first paint, which also
  // keeps the mount effect from having to set state synchronously.
  const [subreddit, setSubreddit] = useState(() => subredditFromPath() || "");
  const [analyzed, setAnalyzed] = useState("");
  const [posts, setPosts] = useState([]);
  const [hasUpvotes, setHasUpvotes] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const [stats, setStats] = useState(EMPTY_STATS);

  // Tracks the newest request so a slow earlier response cannot overwrite
  // the results of a later one.
  const requestRef = useRef(null);

  // Rate-limit cooldown ticker.
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const runAnalysis = useCallback(async (rawName, { updateUrl = true } = {}) => {
    const name = String(rawName || "")
      .trim()
      .replace(/^\/?r\//i, "");

    if (!name) {
      setError("Please enter a subreddit.");
      return;
    }

    // Replace any request still running so results arrive in order.
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;

    setLoading(true);
    setError("");
    setWarning("");

    if (updateUrl) pushSubredditUrl(name);

    try {
      const response = await fetch(
        `${VITE_API_URL}api/reddit/${encodeURIComponent(name)}`,
        { signal: controller.signal }
      );

      /*
        Backend converts Reddit RSS/XML or the official OAuth API
        into a clean JSON response:

        {
          subreddit,
          hasUpvotes,
          posts: [{ id, title, url, upvotes }]
        }

        RSS is the fallback because Reddit blocks anonymous .json fetches.
      */
      let data;
      try {
        data = await response.json();
      } catch {
        // An abort can land mid-body; report it as an abort rather than as
        // a malformed response, so the handler stays silent.
        if (controller.signal.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }
        // A proxy or cold-start error page is not JSON, so surface
        // something readable instead of a parser exception.
        throw new Error(
          `The server returned an unexpected response (HTTP ${response.status}).`
        );
      }

      if (!response.ok) {
        if (response.status === 429 && data.retryAfter) {
          setCooldown(Math.min(Number(data.retryAfter) || 15, 120));
        }
        throw new Error(data.error || "Unable to fetch this subreddit.");
      }

      const rawPosts = Array.isArray(data.posts) ? data.posts : [];

      if (rawPosts.length === 0) {
        throw new Error("No posts found for this subreddit.");
      }

      let positive = 0;
      let neutral = 0;
      let negative = 0;
      let totalScore = 0;

      const analyzedPosts = rawPosts.map((post, index) => {
        const title = post.title || "Untitled";
        const result = sentiment.analyze(title);

        totalScore += result.score;

        let category = "Neutral";

        if (result.score > 0) {
          category = "Positive";
          positive++;
        } else if (result.score < 0) {
          category = "Negative";
          negative++;
        } else {
          neutral++;
        }

        return {
          id: post.id || `${name}-${index}`,
          title,
          url: post.url,
          sentimentScore: result.score,
          category,
          upvotes: typeof post.upvotes === "number" ? post.upvotes : null,
        };
      });

      // Ignore a response that was superseded while it was in flight.
      if (requestRef.current !== controller) return;

      if (data.warning) setWarning(data.warning);

      setPosts(analyzedPosts);
      setAnalyzed(data.subreddit || name);
      setSubreddit(data.subreddit || name);
      setHasUpvotes(Boolean(data.hasUpvotes));
      setStats({
        positive,
        neutral,
        negative,
        avgScore: (totalScore / analyzedPosts.length).toFixed(2),
      });
    } catch (err) {
      // An aborted request was replaced on purpose; it is not an error.
      if (err.name === "AbortError") return;

      console.error("Vibe Check Error:", err);

      setError(err.message || "Something went wrong.");
      setPosts([]);
      setAnalyzed("");
      setStats(EMPTY_STATS);
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        setLoading(false);
      }
    }
  }, []);

  // Deep links: /r/<name> analyzes that subreddit on load, and the browser's
  // back and forward buttons move between results.
  useEffect(() => {
    const fromPath = subredditFromPath();
    if (fromPath) {
      // Fetch-on-mount for a deep link: the URL is the external system being
      // synchronized from, and runAnalysis sets loading state as it starts.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      runAnalysis(fromPath, { updateUrl: false });
    }

    const onPopState = () => {
      const name = subredditFromPath();
      if (name) {
        setSubreddit(name);
        runAnalysis(name, { updateUrl: false });
      } else {
        requestRef.current?.abort();
        requestRef.current = null;
        setLoading(false);
        setPosts([]);
        setAnalyzed("");
        setStats(EMPTY_STATS);
        setError("");
      }
    };

    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
      requestRef.current?.abort();
    };
  }, [runAnalysis]);

  const totalPosts = stats.positive + stats.neutral + stats.negative;

  const getOverallVibe = () => {
    if (!totalPosts) return "—";

    if (stats.positive >= stats.neutral && stats.positive >= stats.negative) {
      return "Positive";
    }

    if (stats.negative >= stats.positive && stats.negative >= stats.neutral) {
      return "Negative";
    }

    return "Neutral";
  };

  const overallVibe = getOverallVibe();

  // Keep the document head in step with what is on screen.
  useEffect(() => {
    applySeo(
      analyzed
        ? { subreddit: analyzed, vibe: overallVibe, postCount: posts.length }
        : {}
    );
  }, [analyzed, overallVibe, posts.length]);

  const onSubmit = (e) => {
    e.preventDefault();
    if (cooldown > 0) return;
    runAnalysis(subreddit);
  };

  // Topic and quick-pick entries are real links so they can be crawled and
  // opened in a new tab, but are handled in-page on a normal click.
  const pick = (e, name) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    setSubreddit(name);
    runAnalysis(name);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const vibeTheme = {
    Positive: {
      card: "border-emerald-200 bg-gradient-to-br from-emerald-50 to-white",
      text: "text-emerald-700",
      chip: "border-emerald-200 bg-emerald-100/70 text-emerald-700",
      icon: <Smile size={26} />,
      blurb: "This community is in a good mood right now.",
    },
    Negative: {
      card: "border-rose-200 bg-gradient-to-br from-rose-50 to-white",
      text: "text-rose-700",
      chip: "border-rose-200 bg-rose-100/70 text-rose-700",
      icon: <Frown size={26} />,
      blurb: "Tempers look a little frayed in here today.",
    },
    Neutral: {
      card: "border-slate-200 bg-gradient-to-br from-slate-50 to-white",
      text: "text-slate-700",
      chip: "border-slate-200 bg-slate-100 text-slate-600",
      icon: <Meh size={26} />,
      blurb: "Mostly level-headed chatter at the moment.",
    },
    "—": {
      card: "border-slate-200 bg-white",
      text: "text-slate-700",
      chip: "border-slate-200 bg-slate-100 text-slate-600",
      icon: <Meh size={26} />,
      blurb: "",
    },
  }[overallVibe];

  const buttonLabel = cooldown > 0 ? `Retry in ${cooldown}s` : "Analyze vibe";
  const showLanding = !loading && posts.length === 0;

  return (
    <div className="relative min-h-screen overflow-hidden bg-canvas text-slate-900">
      {/* Ambient light wash */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 overflow-hidden"
      >
        <div className="absolute left-1/2 top-[-260px] h-[560px] w-[900px] -translate-x-1/2 rounded-full bg-brand-200/40 blur-[130px]" />
        <div className="absolute right-[-180px] top-[220px] h-[420px] w-[420px] rounded-full bg-indigo-200/40 blur-[120px]" />
        <div className="absolute left-[-160px] top-[520px] h-[380px] w-[380px] rounded-full bg-sky-200/35 blur-[120px]" />
      </div>

      <main className="relative mx-auto max-w-6xl px-5 pb-20 pt-12 md:px-8 md:pt-16">
        {/* Header */}
        <header className="mb-10 text-center">
          <motion.div
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <a
              href="/"
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey) return;
                e.preventDefault();
                pushSubredditUrl(null);
                setPosts([]);
                setAnalyzed("");
                setStats(EMPTY_STATS);
                setError("");
              }}
              className="mb-5 inline-flex items-center gap-2 rounded-full border border-brand-200 bg-white/80 px-4 py-1.5 text-sm font-medium text-brand-700 shadow-sm backdrop-blur transition hover:bg-brand-50"
            >
              <TrendingUp size={15} />
              Reddit sentiment analyzer
            </a>

            <h1 className="text-4xl font-extrabold tracking-tight text-slate-900 md:text-6xl">
              The{" "}
              <span className="bg-gradient-to-r from-brand-600 to-brand-500 bg-clip-text text-transparent">
                Subreddit
              </span>{" "}
              Vibe Check
            </h1>

            <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-slate-600 md:text-lg">
              Analyze the mood of any subreddit — gaming, cooking, sports,
              science, music, news or anything else Reddit argues about.
            </p>
          </motion.div>
        </header>

        {/* Search */}
        <motion.form
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          onSubmit={onSubmit}
          className="mx-auto mb-8 max-w-3xl"
          role="search"
        >
          <div className="card-surface flex flex-col gap-2.5 rounded-2xl p-2.5 sm:flex-row">
            <div className="relative flex-1">
              <Search
                size={19}
                aria-hidden="true"
                className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
              />

              <input
                type="text"
                value={subreddit}
                onChange={(e) => setSubreddit(e.target.value)}
                placeholder="Try any subreddit — AskReddit, aww, Cooking…"
                aria-label="Subreddit name"
                autoComplete="off"
                spellCheck="false"
                className="h-13 w-full rounded-xl border border-slate-200 bg-slate-50/80 py-3.5 pl-11 pr-4 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:bg-white focus:ring-4 focus:ring-brand-500/10"
              />
            </div>

            <button
              type="submit"
              disabled={loading || cooldown > 0}
              className="flex h-13 items-center justify-center gap-2 rounded-xl bg-brand-600 px-6 py-3.5 font-semibold text-white shadow-sm transition hover:bg-brand-700 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-55"
            >
              {loading ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  Analyzing…
                </>
              ) : (
                <>
                  <Sparkles size={18} />
                  {buttonLabel}
                </>
              )}
            </button>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-sm">
            <span className="text-slate-500">Popular:</span>

            {QUICK_PICKS.map((name) => (
              <a
                key={name}
                href={`/r/${name}`}
                onClick={(e) => pick(e, name)}
                className="rounded-full border border-slate-200 bg-white px-3 py-1 font-medium text-slate-600 shadow-sm transition hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700"
              >
                r/{name}
              </a>
            ))}
          </div>
        </motion.form>

        {/* Error */}
        <AnimatePresence>
          {error && (
            <motion.div
              role="alert"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="mx-auto mb-8 flex max-w-3xl items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-700"
            >
              <AlertCircle size={19} className="mt-0.5 shrink-0" />
              <p className="text-sm leading-relaxed">{error}</p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Warning / cache notice */}
        <AnimatePresence>
          {warning && (
            <motion.div
              role="status"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="mx-auto mb-8 flex max-w-3xl items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-800"
            >
              <Info size={19} className="mt-0.5 shrink-0" />
              <p className="text-sm leading-relaxed">{warning}</p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Loading */}
        {loading && (
          <VibeLoader subreddit={subreddit.trim().replace(/^\/?r\//i, "") || "reddit"} />
        )}

        {/* Dashboard */}
        <AnimatePresence>
          {!loading && posts.length > 0 && (
            <motion.section
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              aria-label={`Sentiment results for r/${analyzed}`}
            >
              {/* Current subreddit */}
              <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Analyzing
                  </p>

                  <h2 className="mt-1 text-2xl font-bold text-slate-900">
                    r/{analyzed}
                  </h2>
                </div>

                <div className="rounded-full border border-slate-200 bg-white px-4 py-1.5 text-sm font-medium text-slate-600 shadow-sm">
                  {posts.length} posts analyzed
                </div>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <StatCard
                  title="Positive"
                  value={stats.positive}
                  share={totalPosts ? stats.positive / totalPosts : 0}
                  icon={<Smile size={20} />}
                  accent="emerald"
                />

                <StatCard
                  title="Neutral"
                  value={stats.neutral}
                  share={totalPosts ? stats.neutral / totalPosts : 0}
                  icon={<Meh size={20} />}
                  accent="slate"
                />

                <StatCard
                  title="Negative"
                  value={stats.negative}
                  share={totalPosts ? stats.negative / totalPosts : 0}
                  icon={<Frown size={20} />}
                  accent="rose"
                />

                <StatCard
                  title="Avg score"
                  value={stats.avgScore}
                  icon={<BarChart3 size={20} />}
                  accent="indigo"
                  caption="Mean sentiment per title"
                />
              </div>

              {/* Overall vibe */}
              <div
                className={`mt-4 rounded-2xl border p-6 shadow-sm ${vibeTheme.card}`}
              >
                <div className="flex flex-col items-start justify-between gap-5 sm:flex-row sm:items-center">
                  <div className="flex items-center gap-4">
                    <div
                      className={`flex h-12 w-12 items-center justify-center rounded-xl border bg-white/70 ${vibeTheme.chip}`}
                    >
                      {vibeTheme.icon}
                    </div>

                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                        Overall subreddit vibe
                      </p>

                      <h3
                        className={`mt-0.5 text-3xl font-bold ${vibeTheme.text}`}
                      >
                        {overallVibe}
                      </h3>

                      {vibeTheme.blurb && (
                        <p className="mt-1 text-sm text-slate-600">
                          {vibeTheme.blurb}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="w-full rounded-xl border border-slate-200 bg-white px-6 py-3 text-center shadow-sm sm:w-auto">
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Sentiment score
                    </p>

                    <p className={`mt-1 text-2xl font-bold ${vibeTheme.text}`}>
                      {stats.avgScore}
                    </p>
                  </div>
                </div>

                {/* Distribution bar */}
                {totalPosts > 0 && (
                  <div className="mt-6">
                    <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                      <Segment
                        value={stats.positive}
                        total={totalPosts}
                        className="bg-emerald-500"
                        label="Positive"
                      />
                      <Segment
                        value={stats.neutral}
                        total={totalPosts}
                        className="bg-slate-300"
                        label="Neutral"
                      />
                      <Segment
                        value={stats.negative}
                        total={totalPosts}
                        className="bg-rose-500"
                        label="Negative"
                      />
                    </div>

                    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-slate-600">
                      <Legend className="bg-emerald-500" label="Positive" />
                      <Legend className="bg-slate-300" label="Neutral" />
                      <Legend className="bg-rose-500" label="Negative" />
                    </div>
                  </div>
                )}
              </div>

              {/* Posts */}
              <div className="mt-10">
                <div className="mb-5">
                  <h2 className="text-2xl font-bold text-slate-900">
                    Hot posts in r/{analyzed}
                  </h2>

                  <p className="mt-1 text-sm text-slate-600">
                    Sentiment analysis of the hottest post titles.
                  </p>
                </div>

                <div className="space-y-3">
                  {posts.map((post, index) => (
                    <PostCard
                      key={post.id}
                      post={post}
                      index={index}
                      showUpvotes={hasUpvotes}
                    />
                  ))}
                </div>
              </div>
            </motion.section>
          )}
        </AnimatePresence>

        {/* Landing: browse by topic */}
        {showLanding && <TopicBrowser onPick={pick} />}

        {/* Static explainer: useful to readers and to crawlers */}
        <HowItWorks />

        <footer className="mt-16 border-t border-slate-200 pt-6 text-center text-xs text-slate-500">
          Sentiment scored locally with the AFINN-165 word list. Titles only, so
          treat the result as a rough read rather than a verdict. Not affiliated
          with Reddit.
        </footer>
      </main>
    </div>
  );
}

function TopicBrowser({ onPick }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="mt-6"
      aria-labelledby="browse-heading"
    >
      <div className="mb-6 text-center">
        <h2
          id="browse-heading"
          className="text-2xl font-bold text-slate-900"
        >
          Browse by topic
        </h2>
        <p className="mx-auto mt-2 max-w-xl text-slate-600">
          Any public subreddit works. Here are a few hundred posts' worth of
          starting points across every interest.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {TOPICS.map((topic, i) => (
          <motion.div
            key={topic.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: Math.min(i * 0.03, 0.4) }}
            className="card-surface rounded-2xl p-4"
          >
            <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <span aria-hidden="true" className="text-lg">
                {topic.emoji}
              </span>
              {topic.label}
            </h3>

            <ul className="mt-3 space-y-1">
              {topic.subs.map((name) => (
                <li key={name}>
                  <a
                    href={`/r/${name}`}
                    onClick={(e) => onPick(e, name)}
                    className="block truncate rounded-lg px-2 py-1 text-sm text-slate-600 transition hover:bg-brand-50 hover:text-brand-700"
                  >
                    r/{name}
                  </a>
                </li>
              ))}
            </ul>
          </motion.div>
        ))}
      </div>
    </motion.section>
  );
}

function HowItWorks() {
  const steps = [
    {
      title: "Pick any subreddit",
      body: "Type a name or choose a topic. Every public community works — there is no fixed list and no category restriction.",
    },
    {
      title: "We read the hot posts",
      body: "The server fetches up to 50 of the subreddit's hottest posts, using Reddit's official API when credentials are configured and public feeds otherwise.",
    },
    {
      title: "Every title gets scored",
      body: "Each headline is scored against the AFINN-165 sentiment word list, then grouped as positive, neutral or negative.",
    },
    {
      title: "You get the mood",
      body: "The spread, the average score and an overall verdict show how the community is feeling right now.",
    },
  ];

  return (
    <section
      className="mt-16 border-t border-slate-200 pt-10"
      aria-labelledby="how-heading"
    >
      <h2
        id="how-heading"
        className="text-center text-2xl font-bold text-slate-900"
      >
        How the vibe check works
      </h2>

      <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((step, i) => (
          <div key={step.title}>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-sm font-bold text-brand-700">
              {i + 1}
            </div>
            <h3 className="mt-3 font-semibold text-slate-900">{step.title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
              {step.body}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Segment({ value, total, className, label }) {
  if (!value) return null;
  const percent = (value / total) * 100;

  return (
    <div
      className={className}
      style={{ width: `${percent}%` }}
      title={`${label}: ${value} (${percent.toFixed(0)}%)`}
    />
  );
}

function Legend({ className, label }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`h-2 w-2 rounded-full ${className}`} />
      {label}
    </span>
  );
}

const STAT_ACCENTS = {
  emerald: "bg-emerald-50 text-emerald-600",
  rose: "bg-rose-50 text-rose-600",
  indigo: "bg-indigo-50 text-indigo-600",
  slate: "bg-slate-100 text-slate-500",
};

function StatCard({ title, value, icon, accent, share, caption }) {
  return (
    <motion.div
      whileHover={{ y: -3 }}
      transition={{ type: "spring", stiffness: 300, damping: 22 }}
      className="card-surface rounded-2xl p-5"
    >
      <div className="flex items-center justify-between gap-2">
        <div
          className={`flex h-10 w-10 items-center justify-center rounded-xl ${STAT_ACCENTS[accent]}`}
        >
          {icon}
        </div>

        {typeof share === "number" && (
          <span className="text-xs font-semibold text-slate-400">
            {Math.round(share * 100)}%
          </span>
        )}
      </div>

      <p className="mt-4 text-sm font-medium text-slate-500">{title}</p>

      <p className="mt-0.5 text-3xl font-bold tracking-tight text-slate-900">
        {value}
      </p>

      {caption && <p className="mt-1.5 text-xs text-slate-400">{caption}</p>}
    </motion.div>
  );
}

const SENTIMENT_STYLES = {
  Positive: "border-emerald-200 bg-emerald-50 text-emerald-700",
  Negative: "border-rose-200 bg-rose-50 text-rose-700",
  Neutral: "border-slate-200 bg-slate-50 text-slate-600",
};

function PostCard({ post, index, showUpvotes }) {
  return (
    <motion.a
      href={post.url || undefined}
      target="_blank"
      rel="noopener noreferrer"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: Math.min(index * 0.02, 0.4) }}
      whileHover={{ x: 3 }}
      className="card-surface group block rounded-2xl p-5 transition hover:border-brand-200 hover:shadow-md"
    >
      <div className="flex gap-4">
        <div className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-sm font-semibold text-slate-500 transition group-hover:bg-brand-50 group-hover:text-brand-600 sm:flex">
          {index + 1}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-4">
            <h3 className="font-medium leading-6 text-slate-800 transition group-hover:text-brand-700">
              {post.title}
            </h3>

            <ExternalLink
              size={16}
              aria-hidden="true"
              className="mt-1 shrink-0 text-slate-300 transition group-hover:text-brand-500"
            />
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
            <span
              className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                SENTIMENT_STYLES[post.category]
              }`}
            >
              {post.category}
            </span>

            <span className="flex items-center gap-1 text-xs text-slate-500">
              <BarChart3 size={13} aria-hidden="true" />
              Vibe score: {post.sentimentScore}
            </span>

            {/* Reddit's RSS feed carries no score, so only show upvotes
                when the data actually came from the API. */}
            {showUpvotes && post.upvotes !== null && (
              <span className="flex items-center gap-1 text-xs text-slate-500">
                <ArrowUp size={13} aria-hidden="true" />
                {post.upvotes.toLocaleString()}
              </span>
            )}
          </div>
        </div>
      </div>
    </motion.a>
  );
}
