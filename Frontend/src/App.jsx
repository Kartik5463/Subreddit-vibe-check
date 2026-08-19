import { useState } from "react";
import { VITE_API_URL } from "api.js";
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
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const sentiment = new Sentiment();

export default function App() {
  const [subreddit, setSubreddit] = useState("reactjs");
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [stats, setStats] = useState({
    positive: 0,
    neutral: 0,
    negative: 0,
    avgScore: 0,
  });

  const fetchVibeCheck = async (e) => {
    e.preventDefault();

    const name = subreddit.trim();

    if (!name) {
      setError("Please enter a subreddit.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const response = await fetch(
        `${VITE_API_URL}/api/reddit/${encodeURIComponent(name)}`
      );

      
      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "Unable to fetch this subreddit."
        );
      }

      /*
        Backend converts Reddit RSS/XML
        into a clean JSON response:

        {
          posts: [
            {
              id,
              title,
              url,
              upvotes
            }
          ]
        }
          we fetch using rss cause reddit block fetching using json
      */

      const rawPosts = data.posts || [];

      if (rawPosts.length === 0) {
        throw new Error(
          "No posts found for this subreddit."
        );
      }

      let positive = 0;
      let neutral = 0;
      let negative = 0;
      let totalScore = 0;

      const analyzedPosts = rawPosts.map((post) => {
        const result = sentiment.analyze(post.title);

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
          id: post.id,
          title: post.title,
          url: post.url,
          sentimentScore: result.score,
          category,
          upvotes: post.upvotes || 0,
        };
      });

      setPosts(analyzedPosts);

      setStats({
        positive,
        neutral,
        negative,
        avgScore: (
          totalScore / analyzedPosts.length
        ).toFixed(2),
      });
    } catch (err) {
      console.error("Vibe Check Error:", err);

      setError(
        err.message || "Something went wrong."
      );

      setPosts([]);
    } finally {
      setLoading(false);
    }
  };

  const totalPosts =
    stats.positive +
    stats.neutral +
    stats.negative;

  const getOverallVibe = () => {
    if (!totalPosts) return "—";

    if (
      stats.positive >= stats.neutral &&
      stats.positive >= stats.negative
    ) {
      return "Positive";
    }

    if (
      stats.negative >= stats.positive &&
      stats.negative >= stats.neutral
    ) {
      return "Negative";
    }

    return "Neutral";
  };

  const overallVibe = getOverallVibe();

  return (
    <div className="min-h-screen bg-[#070b14] text-white">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-[-200px] h-[500px] w-[700px] -translate-x-1/2 rounded-full bg-blue-600/10 blur-[120px]" />
      </div>

      <main className="relative mx-auto max-w-6xl px-5 py-10 md:px-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mb-10 text-center"
        >
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-blue-500/20 bg-blue-500/10 px-4 py-2 text-sm text-blue-300">
            <TrendingUp size={16} />
            Reddit Sentiment Analyzer
          </div>

          <h1 className="text-4xl font-bold tracking-tight md:text-6xl">
            The{" "}
            <span className="text-blue-500">
              Subreddit
            </span>{" "}
            Vibe Check
          </h1>

          <p className="mx-auto mt-4 max-w-2xl text-base text-slate-400 md:text-lg">
            Discover what Reddit is feeling today by analyzing
            the sentiment of the hottest posts in any subreddit.
          </p>
        </motion.div>

        {/* Search */}
        <motion.form
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          onSubmit={fetchVibeCheck}
          className="mx-auto mb-10 max-w-3xl"
        >
          <div className="flex flex-col gap-3 rounded-2xl border border-slate-800 bg-[#0d1422] p-3 shadow-2xl shadow-black/20 sm:flex-row">
            <div className="relative flex-1">
              <Search
                size={20}
                className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500"
              />

              <input
                type="text"
                value={subreddit}
                onChange={(e) =>
                  setSubreddit(e.target.value)
                }
                placeholder="Enter subreddit..."
                className="h-14 w-full rounded-xl border border-slate-800 bg-[#080d17] pl-12 pr-4 text-white outline-none transition placeholder:text-slate-600 focus:border-blue-500"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="flex h-14 items-center justify-center gap-2 rounded-xl bg-blue-600 px-7 font-semibold transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? (
                <>
                  <Loader2
                    size={19}
                    className="animate-spin"
                  />
                  Analyzing...
                </>
              ) : (
                <>
                  <Search size={19} />
                  Analyze Vibe
                </>
              )}
            </button>
          </div>

          <div className="mt-3 flex flex-wrap justify-center gap-2 text-sm text-slate-500">
            <span>Try:</span>

            {[
              "reactjs",
              "programming",
              "webdev",
              "javascript",
            ].map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => setSubreddit(name)}
                className="transition hover:text-blue-400"
              >
                {name}
              </button>
            ))}
          </div>
        </motion.form>

        {/* Error */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="mx-auto mb-8 max-w-3xl rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-center text-red-300"
            >
              {error}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Dashboard */}
        <AnimatePresence>
          {posts.length > 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              {/* Current subreddit */}
              <div className="mb-5 flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-500">
                    Analyzing
                  </p>

                  <h2 className="text-2xl font-bold">
                    {subreddit.trim()}
                  </h2>
                </div>

                <div className="rounded-full border border-slate-800 bg-[#0d1422] px-4 py-2 text-sm text-slate-400">
                  {posts.length} posts analyzed
                </div>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard
                  title="Positive"
                  value={stats.positive}
                  icon={<Smile size={22} />}
                  description="Positive titles"
                  iconClass="text-emerald-400"
                />

                <StatCard
                  title="Neutral"
                  value={stats.neutral}
                  icon={<Meh size={22} />}
                  description="Neutral titles"
                  iconClass="text-slate-400"
                />

                <StatCard
                  title="Negative"
                  value={stats.negative}
                  icon={<Frown size={22} />}
                  description="Negative titles"
                  iconClass="text-red-400"
                />

                <StatCard
                  title="Avg Score"
                  value={stats.avgScore}
                  icon={<BarChart3 size={22} />}
                  description="Average sentiment"
                  iconClass="text-blue-400"
                />
              </div>

              {/* Overall vibe */}
              <motion.div
                className="mt-4 rounded-2xl border border-blue-500/20 bg-gradient-to-r from-blue-500/10 to-transparent p-6"
              >
                <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
                  <div>
                    <p className="text-sm text-slate-500">
                      Overall Subreddit Vibe
                    </p>

                    <h2 className="mt-1 text-3xl font-bold">
                      {overallVibe}
                    </h2>
                  </div>

                  <div className="rounded-xl border border-blue-500/20 bg-blue-500/10 px-6 py-3 text-center">
                    <p className="text-xs uppercase tracking-wider text-blue-300">
                      Sentiment Score
                    </p>

                    <p className="mt-1 text-2xl font-bold text-blue-400">
                      {stats.avgScore}
                    </p>
                  </div>
                </div>
              </motion.div>

              {/* Posts */}
              <div className="mt-10">
                <div className="mb-5">
                  <h2 className="text-2xl font-bold">
                    Hot Posts
                  </h2>

                  <p className="mt-1 text-sm text-slate-500">
                    Sentiment analysis of the hottest post
                    titles.
                  </p>
                </div>

                <div className="space-y-3">
                  {posts.map((post, index) => (
                    <PostCard
                      key={post.id}
                      post={post}
                      index={index}
                    />
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Empty state */}
        {!loading && posts.length === 0 && !error && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mx-auto mt-16 max-w-xl text-center"
          >
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-slate-800 bg-[#0d1422]">
              <BarChart3
                className="text-blue-400"
                size={28}
              />
            </div>

            <h2 className="text-xl font-semibold">
              Ready to check the vibe?
            </h2>

            <p className="mt-2 text-slate-500">
              Enter a subreddit above to analyze its
              hottest posts.
            </p>
          </motion.div>
        )}
      </main>
    </div>
  );
}

function StatCard({
  title,
  value,
  icon,
  description,
  iconClass,
}) {
  return (
    <motion.div
      whileHover={{ y: -3 }}
      className="rounded-2xl border border-slate-800 bg-[#0d1422] p-5 transition"
    >
      <div className="flex items-center justify-between">
        <div className={iconClass}>{icon}</div>

        <span className="text-xs text-slate-600">
          SENTIMENT
        </span>
      </div>

      <p className="mt-5 text-sm text-slate-500">
        {title}
      </p>

      <p className="mt-1 text-3xl font-bold">
        {value}
      </p>

      <p className="mt-2 text-xs text-slate-600">
        {description}
      </p>
    </motion.div>
  );
}

function PostCard({ post, index }) {
  const sentimentStyles = {
    Positive:
      "border-emerald-500/20 bg-emerald-500/10 text-emerald-400",
    Negative:
      "border-red-500/20 bg-red-500/10 text-red-400",
    Neutral:
      "border-slate-700 bg-slate-800/50 text-slate-400",
  };

  return (
    <motion.a
      href={post.url}
      target="_blank"
      rel="noopener noreferrer"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.3,
        delay: Math.min(index * 0.02, 0.5),
      }}
      whileHover={{ x: 4 }}
      className="group block rounded-2xl border border-slate-800 bg-[#0d1422] p-5 transition hover:border-blue-500/30 hover:bg-[#101a2b]"
    >
      <div className="flex gap-4">
        <div className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-800 text-sm font-semibold text-slate-500 sm:flex">
          {index + 1}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-4">
            <h3 className="font-medium leading-6 text-slate-200 transition group-hover:text-blue-400">
              {post.title}
            </h3>

            <ExternalLink
              size={17}
              className="mt-1 shrink-0 text-slate-600 transition group-hover:text-blue-400"
            />
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <span
              className={`rounded-full border px-3 py-1 text-xs font-medium ${
                sentimentStyles[post.category]
              }`}
            >
              {post.category}
            </span>

            <span className="flex items-center gap-1 text-xs text-slate-500">
              <BarChart3 size={14} />
              Vibe Score: {post.sentimentScore}
            </span>

            <span className="flex items-center gap-1 text-xs text-slate-500">
              <ArrowUp size={14} />
              {post.upvotes}
            </span>
          </div>
        </div>
      </div>
    </motion.a>
  );
}