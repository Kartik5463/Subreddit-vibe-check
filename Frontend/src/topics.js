/**
 * Browsable subreddit catalog.
 *
 * The app works with any public subreddit; this list only exists so the
 * landing page suggests somewhere to start. It deliberately spans many
 * interests rather than only tech.
 */
export const TOPICS = [
  {
    id: "ask",
    label: "Ask & discuss",
    emoji: "💬",
    subs: ["AskReddit", "NoStupidQuestions", "explainlikeimfive", "todayilearned"],
  },
  {
    id: "funny",
    label: "Funny",
    emoji: "😂",
    subs: ["funny", "memes", "Jokes", "ContagiousLaughter"],
  },
  {
    id: "animals",
    label: "Animals",
    emoji: "🐾",
    subs: ["aww", "cats", "dogs", "likeus"],
  },
  {
    id: "food",
    label: "Food",
    emoji: "🍜",
    subs: ["Cooking", "food", "recipes", "Baking"],
  },
  {
    id: "gaming",
    label: "Gaming",
    emoji: "🎮",
    subs: ["gaming", "pcgaming", "NintendoSwitch", "truegaming"],
  },
  {
    id: "screen",
    label: "Movies & TV",
    emoji: "🎬",
    subs: ["movies", "television", "MovieSuggestions", "anime"],
  },
  {
    id: "music",
    label: "Music",
    emoji: "🎧",
    subs: ["Music", "listentothis", "hiphopheads", "indieheads"],
  },
  {
    id: "sports",
    label: "Sports",
    emoji: "🏀",
    subs: ["nba", "soccer", "nfl", "formula1"],
  },
  {
    id: "news",
    label: "News & world",
    emoji: "🌍",
    subs: ["worldnews", "news", "UpliftingNews", "geopolitics"],
  },
  {
    id: "science",
    label: "Science & space",
    emoji: "🔬",
    subs: ["science", "space", "askscience", "Futurology"],
  },
  {
    id: "life",
    label: "Life & advice",
    emoji: "🧭",
    subs: ["LifeProTips", "personalfinance", "relationship_advice", "getdisciplined"],
  },
  {
    id: "health",
    label: "Fitness & health",
    emoji: "🏃",
    subs: ["Fitness", "running", "yoga", "nutrition"],
  },
  {
    id: "creative",
    label: "Art & creative",
    emoji: "🎨",
    subs: ["Art", "photography", "writing", "DIY"],
  },
  {
    id: "travel",
    label: "Travel & places",
    emoji: "🧳",
    subs: ["travel", "EarthPorn", "backpacking", "solotravel"],
  },
  {
    id: "wholesome",
    label: "Wholesome",
    emoji: "🌱",
    subs: ["MadeMeSmile", "wholesomememes", "CasualConversation", "offmychest"],
  },
  {
    id: "tech",
    label: "Tech",
    emoji: "💻",
    subs: ["webdev", "programming", "javascript", "reactjs"],
  },
];

/** A handful of varied starting points for the quick-pick row. */
export const QUICK_PICKS = [
  "AskReddit",
  "aww",
  "Cooking",
  "movies",
  "nba",
  "space",
  "MadeMeSmile",
  "gaming",
];

/** Every subreddit in the catalog, de-duplicated, for the sitemap. */
export const ALL_SUBS = [
  ...new Set(TOPICS.flatMap((topic) => topic.subs)),
];
