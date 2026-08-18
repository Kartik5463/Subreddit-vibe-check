import Parser from "rss-parser";

const parser = new Parser();

export const getSubreddit = async (req, res) => {
  try {
    const subreddit = req.params.subreddit.trim();

    if (!subreddit) {
      return res.status(400).json({
        error: "Subreddit name is required",
      });
    }

    const response = await fetch(
      `https://www.reddit.com/r/${encodeURIComponent(
        subreddit
      )}/hot.rss?limit=50`,
      {
        headers: {
          "User-Agent":
            "web:vibe-check-app:v1.0 (by /u/Human_Point_4829)",
        },
      }
    );

    console.log("Reddit status:", response.status);

    // Read the response body first
    const xml = await response.text();

    // Handle 403
    if (response.status === 403) {
      // Check if the subreddit is private
      if (xml.includes(": private</title>")) {
        return res.status(403).json({
          error:
            "This subreddit is private and cannot be analyzed.",
        });
      }

      return res.status(403).json({
        error: "Reddit denied access to this subreddit.",
      });
    }

    // Handle rate limiting
    if (response.status === 429) {
      return res.status(429).json({
        error:
          "Reddit is temporarily rate-limiting requests. Please try again later.",
      });
    }

    // Handle other errors
    if (!response.ok) {
      return res.status(response.status).json({
        error: "Failed to fetch subreddit from Reddit",
      });
    }

    // Parse RSS XML
    const feed = await parser.parseString(xml);

    // No posts
    if (!feed.items || feed.items.length === 0) {
      return res.status(404).json({
        error:
          "No posts found. The subreddit may not exist or may not be accessible.",
      });
    }

    // Convert RSS data into clean JSON
    const posts = feed.items.map((item, index) => ({
      id: item.id || item.guid || String(index),
      title: item.title || "Untitled",
      url: item.link || "",
      upvotes: 0,
    }));

    res.json({
      posts,
    });
  } catch (error) {
    console.error("Reddit API Error:", error);

    res.status(500).json({
      error:
        "Something went wrong while fetching Reddit data.",
    });
  }
};