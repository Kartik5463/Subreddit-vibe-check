import { useEffect, useReducer, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";

/**
 * The analysis usually takes a couple of seconds, and longer when Reddit is
 * slow, so the wait gets a little show instead of a bare spinner: a scanning
 * radar, orbiting sentiment faces, staged progress and a rotating ticker.
 */

const STAGES = [
  { label: "Knocking on Reddit's door", emoji: "🚪" },
  { label: "Pulling the hottest posts", emoji: "🔥" },
  { label: "Reading every headline", emoji: "👀" },
  { label: "Weighing the words", emoji: "⚖️" },
  { label: "Scoring the mood", emoji: "🧮" },
  { label: "Bottling the vibe", emoji: "🧪" },
];

const QUIPS = [
  "Counting exclamation marks…",
  "Separating hot takes from warm ones…",
  "Asking the algorithm how it feels…",
  "Checking for passive aggression…",
  "Measuring enthusiasm per capita…",
  "Detecting sarcasm (hard mode)…",
  "Tallying caps lock usage…",
  "Looking for the drama…",
  "Sniffing out wholesome energy…",
  "Consulting the vibe oracle…",
];

const FACES = ["😊", "😐", "😡", "🤩", "😬", "🥳"];

export default function VibeLoader({ subreddit }) {
  const reduceMotion = useReducedMotion();
  const [stage, setStage] = useState(0);
  const [quip, setQuip] = useState(0);
  // Drives the progress bar without re-rendering the whole tree per frame.
  const [tick, bump] = useReducer((n) => n + 1, 0);

  // Walk through the stages, slowing down as it goes so the last stage holds
  // while a genuinely slow request finishes.
  useEffect(() => {
    if (stage >= STAGES.length - 1) return;
    const delay = 700 + stage * 250;
    const timer = setTimeout(() => setStage((s) => s + 1), delay);
    return () => clearTimeout(timer);
  }, [stage]);

  useEffect(() => {
    const timer = setInterval(
      () => setQuip((q) => (q + 1) % QUIPS.length),
      1800
    );
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = setInterval(bump, 400);
    return () => clearInterval(timer);
  }, []);

  // Approaches 95% and never completes: the real result replaces it.
  const progress = Math.min(95, 8 + tick * 7 + stage * 6);

  if (reduceMotion) {
    return (
      <section
        aria-live="polite"
        className="card-surface mx-auto max-w-xl rounded-2xl p-8 text-center"
      >
        <p className="text-lg font-semibold text-slate-900">
          Analyzing r/{subreddit}
        </p>
        <p className="mt-2 text-sm text-slate-600">
          {STAGES[stage].label}…
        </p>
        <div className="mt-5 h-2 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-brand-600 transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      </section>
    );
  }

  return (
    <section
      aria-live="polite"
      aria-busy="true"
      className="card-surface relative mx-auto max-w-2xl overflow-hidden rounded-3xl p-8 text-center sm:p-10"
    >
      {/* Drifting background glow */}
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-0 h-72 w-72 -translate-x-1/2 rounded-full bg-brand-200/50 blur-[90px]"
        animate={{ scale: [1, 1.25, 1], opacity: [0.5, 0.85, 0.5] }}
        transition={{ duration: 3.5, repeat: Infinity, ease: "easeInOut" }}
      />

      {/* Radar */}
      <div className="relative mx-auto mb-8 h-44 w-44">
        {/* Expanding sonar rings */}
        {[0, 1, 2].map((ring) => (
          <motion.span
            key={ring}
            aria-hidden="true"
            className="absolute inset-0 rounded-full border-2 border-brand-400/40"
            animate={{ scale: [0.45, 1.15], opacity: [0.75, 0] }}
            transition={{
              duration: 2.4,
              repeat: Infinity,
              delay: ring * 0.8,
              ease: "easeOut",
            }}
          />
        ))}

        {/* Sweeping beam */}
        <motion.div
          aria-hidden="true"
          className="absolute inset-0 rounded-full"
          style={{
            background:
              "conic-gradient(from 0deg, transparent 0deg, transparent 300deg, rgba(240,78,0,0.28) 350deg, transparent 360deg)",
          }}
          animate={{ rotate: 360 }}
          transition={{ duration: 2.2, repeat: Infinity, ease: "linear" }}
        />

        {/* Orbiting sentiment faces */}
        {FACES.map((face, i) => (
          <motion.span
            key={face}
            aria-hidden="true"
            className="absolute left-1/2 top-1/2 text-xl"
            style={{ marginLeft: -12, marginTop: -12 }}
            animate={{
              x: [
                Math.cos((i / FACES.length) * Math.PI * 2) * 76,
                Math.cos((i / FACES.length) * Math.PI * 2 + Math.PI * 2) * 76,
              ],
              y: [
                Math.sin((i / FACES.length) * Math.PI * 2) * 76,
                Math.sin((i / FACES.length) * Math.PI * 2 + Math.PI * 2) * 76,
              ],
            }}
            transition={{
              duration: 7,
              repeat: Infinity,
              ease: "linear",
              delay: i * 0.1,
            }}
          >
            <motion.span
              className="inline-block"
              animate={{ scale: [1, 1.3, 1], rotate: [0, 12, -12, 0] }}
              transition={{
                duration: 1.6,
                repeat: Infinity,
                delay: i * 0.22,
              }}
            >
              {face}
            </motion.span>
          </motion.span>
        ))}

        {/* Core */}
        <motion.div
          className="absolute left-1/2 top-1/2 flex h-20 w-20 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-3xl shadow-lg"
          animate={{ scale: [1, 1.08, 1] }}
          transition={{ duration: 1.3, repeat: Infinity, ease: "easeInOut" }}
        >
          <motion.span
            key={stage}
            initial={{ scale: 0.3, opacity: 0, rotate: -40 }}
            animate={{ scale: 1, opacity: 1, rotate: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 16 }}
          >
            {STAGES[stage].emoji}
          </motion.span>
        </motion.div>
      </div>

      <h2 className="relative text-xl font-bold text-slate-900 sm:text-2xl">
        Reading the room in{" "}
        <span className="text-brand-700">r/{subreddit}</span>
      </h2>

      {/* Current stage */}
      <div className="relative mt-3 h-6">
        <motion.p
          key={stage}
          initial={{ y: 12, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="text-sm font-medium text-slate-700"
        >
          {STAGES[stage].label}…
        </motion.p>
      </div>

      {/* Progress bar */}
      <div className="relative mx-auto mt-5 h-2.5 w-full max-w-md overflow-hidden rounded-full bg-slate-100">
        <motion.div
          className="h-full rounded-full bg-gradient-to-r from-brand-500 via-brand-600 to-amber-500"
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        />
      </div>

      {/* Stage dots */}
      <div className="relative mt-5 flex justify-center gap-2">
        {STAGES.map((s, i) => (
          <motion.span
            key={s.label}
            className={`h-1.5 rounded-full ${
              i <= stage ? "bg-brand-500" : "bg-slate-200"
            }`}
            animate={{ width: i === stage ? 26 : 8 }}
            transition={{ type: "spring", stiffness: 300, damping: 24 }}
          />
        ))}
      </div>

      {/* Rotating quip */}
      <div className="relative mt-6 h-5">
        <motion.p
          key={quip}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          className="text-xs text-slate-500"
        >
          {QUIPS[quip]}
        </motion.p>
      </div>
    </section>
  );
}
