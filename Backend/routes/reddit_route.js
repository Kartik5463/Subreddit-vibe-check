import express from "express";
import { getSubreddit } from "../controllers/reddit_controller.js";
const router = express.Router();
router.get("/:subreddit", getSubreddit);
export default router;