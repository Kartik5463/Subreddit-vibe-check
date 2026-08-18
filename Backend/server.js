import express from "express";
import cors from "cors";
import dotenv from "dotenv/config";
const app = express();
app.use(cors());
const PORT = process.env.PORT || 5000;
app.get("/", (req, res) => {
  res.send("Subreddit Vibe Check Backend is running!");
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});