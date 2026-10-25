import express from "express";
import cors from "cors";
import "dotenv/config";
import redditRoutes from "./routes/reddit_route.js";

const app = express();

// Trust the proxy so req.ip reflects the real client behind Render/Vercel/etc.
app.set("trust proxy", 1);

// Allow a comma-separated allowlist via CORS_ORIGIN, otherwise allow all.
const allowedOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors(
    allowedOrigins.length > 0
      ? { origin: allowedOrigins }
      : {}
  )
);
app.use(express.json());

const PORT = process.env.PORT || 5000;

// Health check so hosting platforms get a 200 instead of a 404.
app.get("/", (req, res) => {
  res.json({ status: "ok", service: "subreddit-vibe-check" });
});

app.use("/api/reddit", redditRoutes);

// Unknown routes should be JSON, not Express' default HTML error page,
// because the frontend always parses the response as JSON.
app.use((req, res) => {
  res.status(404).json({ error: "Route not found." });
});

app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Something went wrong." });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
