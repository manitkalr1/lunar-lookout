# Mission advisor proxy (Cloudflare Worker)

The Lunar Lookout site is public, so it can't contain your Gemini API key. This
tiny Worker holds the key as a Cloudflare **secret** and passes chat questions to
Gemini, so anyone can use the advisor without a key of their own.

It only answers the Lunar Lookout site, caps message sizes, fixes the model and
answer length, and allows 20 questions per 10 minutes per connection.

## Deploy (about 5 minutes, free)

You need a free [Cloudflare account](https://dash.cloudflare.com/sign-up) and your
Gemini API key. Use a key **without billing enabled** (the free tier), so the
worst case is the free quota running out, never a bill.

From this `worker` folder:

```bash
npx wrangler login
```

```bash
npx wrangler secret put GEMINI_API_KEY
```

(paste your Gemini key when asked; it is stored encrypted by Cloudflare)

```bash
npx wrangler deploy
```

Wrangler prints the Worker's address, for example
`https://lunar-lookout-advisor.<your-subdomain>.workers.dev`.

## Connect the site

1. In `js/config.js`, set `CHAT_PROXY_URL` to that address.
2. From the repo root, run `npm run build` (refreshes the single-file copy).
3. Commit and push. GitHub Pages redeploys and the advisor works for everyone.

## Settings

In `wrangler.toml`:

- `ALLOWED_ORIGINS`: sites allowed to use the advisor.
- `GEMINI_MODEL`: the Gemini model.
- `RATE_LIMIT_PER_10_MIN`: questions per connection per 10 minutes.

Run `npx wrangler deploy` again after changing them.
