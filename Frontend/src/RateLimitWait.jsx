import { motion } from "framer-motion";
import { Clock, RotateCw, X } from "lucide-react";

/**
 * Shown while a lookup waits for Reddit's next rate-limit slot.
 *
 * Without API keys Reddit allows the server a single lookup a minute, so a
 * second visitor (or a second click) usually has to wait for the window to
 * reset. The server reports the exact wait; this counts it down visibly and
 * the parent re-runs the lookup when it reaches zero.
 */

const RING_RADIUS = 52;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

export default function RateLimitWait({
  queued,
  now,
  autoRetry,
  onRetryNow,
  onCancel,
}) {
  const remainingMs = Math.max(0, queued.until - now);
  const seconds = Math.ceil(remainingMs / 1000);
  const progress = Math.min(1, 1 - remainingMs / (queued.total * 1000));
  const ready = remainingMs === 0;

  const explanation =
    queued.limitedBy === "oauth"
      ? "Reddit's API budget is used up for a moment."
      : "Reddit lets this server make one lookup a minute without API keys, and this minute's lookup has already been used.";

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      aria-labelledby="queued-heading"
      className="card-surface mx-auto max-w-2xl rounded-3xl p-8 text-center sm:p-10"
    >
      {/* Announced once per wait rather than every second. */}
      <p className="sr-only" aria-live="polite">
        {ready
          ? `Starting the lookup for r/${queued.name}.`
          : `Waiting for Reddit. r/${queued.name} starts in about ${queued.total} seconds.`}
      </p>

      <div className="relative mx-auto h-36 w-36" aria-hidden="true">
        <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
          <circle
            cx="60"
            cy="60"
            r={RING_RADIUS}
            fill="none"
            strokeWidth="8"
            className="stroke-slate-100"
          />
          <circle
            cx="60"
            cy="60"
            r={RING_RADIUS}
            fill="none"
            strokeWidth="8"
            strokeLinecap="round"
            className="stroke-brand-500 transition-[stroke-dashoffset] duration-300 ease-linear motion-reduce:transition-none"
            strokeDasharray={RING_LENGTH}
            strokeDashoffset={RING_LENGTH * (1 - progress)}
          />
        </svg>

        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {ready ? (
            <RotateCw
              size={30}
              className={`text-brand-600 ${autoRetry ? "animate-spin" : ""}`}
            />
          ) : (
            <>
              <span className="text-4xl font-extrabold tabular-nums tracking-tight text-slate-900">
                {seconds}
              </span>
              <span className="text-xs font-medium uppercase tracking-wider text-slate-500">
                seconds
              </span>
            </>
          )}
        </div>
      </div>

      <div className="mt-6 inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">
        <Clock size={13} aria-hidden="true" />
        Waiting for Reddit
      </div>

      <h2
        id="queued-heading"
        className="mt-3 text-xl font-bold text-slate-900 sm:text-2xl"
      >
        {ready && autoRetry ? (
          <>
            Starting <span className="text-brand-700">r/{queued.name}</span>…
          </>
        ) : (
          <>
            <span className="text-brand-700">r/{queued.name}</span> is next in
            line
          </>
        )}
      </h2>

      <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-slate-600">
        {explanation}{" "}
        {autoRetry
          ? "Your lookup starts on its own the moment the next slot opens — no need to click again."
          : "Other visitors keep taking the slot first. Try again whenever you like."}
      </p>

      {queued.attempt > 1 && autoRetry && (
        <p className="mt-2 text-xs text-slate-500">
          Someone else took the last slot, so you are first in line for the
          next one.
        </p>
      )}

      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        {!autoRetry && (
          <button
            type="button"
            onClick={onRetryNow}
            disabled={!ready}
            className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-55"
          >
            <RotateCw size={16} aria-hidden="true" />
            {ready ? "Try now" : `Try in ${seconds}s`}
          </button>
        )}

        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
        >
          <X size={15} aria-hidden="true" />
          Cancel
        </button>
      </div>

      <p className="mx-auto mt-6 max-w-md text-xs leading-relaxed text-slate-400">
        Subreddits looked up in the last few minutes load instantly, even while
        you wait — try one from the list below.
      </p>
    </motion.section>
  );
}
