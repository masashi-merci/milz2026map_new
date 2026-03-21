# Cloudflare deployment notes

## What was changed
- Removed the Node/Express upload server from the deployment path.
- Frontend image upload now posts to `/api/storage/upload`.
- Added a Cloudflare Pages Function at `functions/api/storage/upload.ts` that stores uploads in R2.
- Moved Gemini calls behind Cloudflare Pages Functions under `/api/ai/*`.
- Added edge caching for AI and geocoding responses.
- Added Supabase-auth verification for AI and geocoding endpoints so anonymous scraping cannot call them directly.
- Added browser-side local cache to avoid repeat calls from the same user/session.
- Reduced Gemini output size and temperature for lower cost and more stable results.

## Required Cloudflare settings
### Pages project build
- Build command: `npm run build`
- Build output directory: `dist`

### Environment variables
#### Browser env
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

#### Pages Function secrets / env
- `R2_PUBLIC_DOMAIN`
- `GEMINI_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

### R2 binding
Create an R2 binding on the Pages project:
- Variable name: `R2_BUCKET`
- Bucket: your target R2 bucket

## Security notes
- `GEMINI_API_KEY` is server-side only and should never be prefixed with `VITE_`.
- `/api/ai/query` and `/api/ai/geocode` now require a valid Supabase bearer token.
- This blocks unauthenticated public abuse and is important when daily traffic reaches tens of thousands of users.

## Cost and scale notes
- `/api/ai/query` uses `gemini-2.5-flash-lite`.
- Edge cache is shared across users for the same normalized request.
- Recommended cache behavior:
  - Recommend: 6 hours
  - Trend: 2 hours
  - Geocode: 30 days
- Browser cache avoids duplicate fetches from the same device.
- This means popular areas like `Tokyo Shibuya` will usually hit cache instead of Gemini.

## Strongly recommended Cloudflare settings for production
### WAF / rate limiting
Create rate limits for:
- `/api/ai/query`
- `/api/ai/geocode`
- `/api/storage/upload`

A practical first version:
- `POST /api/ai/query`: 20 requests / 5 minutes / IP
- `POST /api/ai/geocode`: 30 requests / 5 minutes / IP
- `POST /api/storage/upload`: 20 requests / 10 minutes / IP

### Bot protection
- Turn on Bot Fight Mode or WAF managed rules.
- Block obvious countries or ASNs only if your product region is limited.

### Caching
- Keep Pages Functions cache enabled.
- Do not bypass cache for `/api/ai/query` and `/api/ai/geocode`.

## Operational recommendations for daily tens of thousands of users
- Treat AI as an enhancement, not the only path.
- Prefer cached/shared results for broad areas.
- Avoid free geocoding providers for heavy public traffic unless usage is very low or admin-only.
- If geocoding volume grows, switch to a paid provider or precompute/cache common areas.
- Add Sentry or similar monitoring for frontend and Functions errors.
- Track API latency, cache-hit ratio, AI call count, and upload error rate.

## Important note about this ZIP
The uploaded ZIP originally contained a broken `node_modules`, and package installation was not available in this environment. The source changes are included, but you should run a fresh install in GitHub/Cloudflare CI:
- `rm -rf node_modules package-lock.json`
- `npm install`
- `npm run build`


## Trend freshness

- `Recommend` can stay cached longer because the content is stable.
- `Trend` now uses a short edge cache: `s-maxage=900` (15 minutes) and `stale-while-revalidate=300` (5 minutes).
- A new prewarm endpoint is available at `/api/ai/prewarm-trends`.
- Protect it with `PREWARM_SECRET` and call it every 10-15 minutes from an external scheduler or a Cloudflare Worker Cron trigger.
- Example payload:

```json
{
  "items": [
    { "location": "Tokyo Shibuya", "category": "food" },
    { "location": "Tokyo Shinjuku", "category": "shopping" }
  ]
}
```

Required secret/env:

- `PREWARM_SECRET`

Recommended operation:

- Keep a small curated list of the top areas/categories actually used by users.
- Prewarm only those hot combinations.
- Let less common combinations generate on demand.
