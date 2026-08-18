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
      )}/hot.json?limit=50`,
      {
        headers: {
          "User-Agent":
            "web:vibe-check-app:v1.0 (by /u/Human_Point_4829)",
        },
      }
    );

    if (!response.ok) {
      return res.status(response.status).json({
        error: "Failed to fetch subreddit from Reddit",
      });
    }

    const data = await response.json();

    res.json(data);
  } catch (error) {
    console.error("Reddit API Error:", error);

    res.status(500).json({
      error: "Something went wrong while fetching Reddit data",
    });
  }
};