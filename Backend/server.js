import express from "express";
import cors from "cors";
import dotenv from "dotenv/config";
import redditRoutes from "./routes/reddit_route.js";
const app = express();
app.use(cors());
app.use(express.json());
const PORT = process.env.PORT || 5000;
app.use("/api/reddit", redditRoutes);
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});