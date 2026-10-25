# Subreddit Vibe Check

Analyze the sentiment of the hottest posts in any subreddit and see the
community's current mood at a glance.

A React frontend scores post titles locally with the AFINN-165 word list, and an
Express backend fetches posts from Reddit — preferring the official OAuth API
when credentials are configured, and falling back to public RSS feeds otherwise.

## Project layout

```
Backend/    Express API that fetches and normalizes Reddit posts
Frontend/   Vite + React + Tailwind v4 client
```

## Getting started

### Backend

```bash
cd Backend
npm install
cp .env.example .env     # then edit as needed
npm run dev              # http://localhost:5000
```

### Frontend

```bash
cd Frontend
npm install
cp .env.example .env     # point VITE_API_URL at the backend
npm run dev              # http://localhost:5173
```

## Configuration

### Backend (`Backend/.env`)

| Variable | Required | Description |
| --- | --- | --- |
| `PORT` | no | Port to listen on (default `5000`). |
| `CORS_ORIGIN` | no | Comma-separated allowlist of origins. Allows all when unset. |
| `REDDIT_CLIENT_ID` | no | Reddit app client ID. Enables the OAuth path. |
| `REDDIT_CLIENT_SECRET` | no | Reddit app client secret. |
| `REDDIT_USER_AGENT` | no | User agent sent to Reddit. |

Setting the Reddit credentials is strongly recommended: the OAuth path allows
100 requests per minute and returns real upvote counts, while the anonymous RSS
fallback is aggressively rate-limited and carries no scores.

### Frontend (`Frontend/.env`)

| Variable | Required | Description |
| --- | --- | --- |
| `VITE_API_URL` | no | Backend base URL (default `http://localhost:5000`). |

## API

### `GET /`

Health check. Returns `{ "status": "ok", "service": "subreddit-vibe-check" }`.

### `GET /api/reddit/:subreddit`

Accepts a bare name (`webdev`) or the prefixed form (`r/webdev`). Names must be
2–21 letters, digits or underscores.

```json
{
  "subreddit": "webdev",
  "hasUpvotes": false,
  "posts": [{ "id": "…", "title": "…", "url": "…", "upvotes": null }]
}
```

`hasUpvotes` is `false` when the data came from RSS, where `upvotes` is `null`
because the feed carries no scores. A response may also include `cached`,
`stale` and `warning` when Reddit is unavailable and a recent cached copy is
served instead.

Error responses are always JSON with an `error` field. A `429` also includes
`retryAfter` in seconds.

## How posts are fetched

1. Serve from the in-memory cache if the entry is under 5 minutes old.
2. Join an identical in-flight request rather than issuing a duplicate.
3. Try the official OAuth API when credentials are present.
4. Fall back to `www.reddit.com` and then `old.reddit.com` RSS feeds.
5. If Reddit fails or rate-limits, serve a stale cached copy (up to 24 hours)
   with a `warning`.

## Notes

Sentiment is scored from post titles only, so treat the result as a rough read
rather than a verdict.
