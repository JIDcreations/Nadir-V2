# Nadir V2

*Good companies, bad weeks.* Nadir finds stocks with a strong multi-year record that just had a sharp fall, and explains the fall.

## Run it

```bash
cd Nadir-V2
node server.mjs        # or: npm start
```

Open http://localhost:5178. It needs Node 18.17 or newer and has no dependencies, so there's nothing to install. Set `PORT=8080` to use another port.

## What's in it

- **This week**: a plain-language title ("16 strong companies had a bad week"), a featured top pick, then one card per company with its logo, this week's fall, a six-month chart with the week in red, the likely reason, and its growth per year before the fall.
- **Filters** (the pill on the right): how far it fell, how strong the record must be, region, sector and sort. Cards that drop out fade away first.
- **Loading** never blocks: the page is there immediately, a status line and thin progress bar show what is still coming, and cards fill in their placeholders as prices stream in.
- **Company sheet** (`#/s/TICKER`): price, a chart (1W intraday to 5Y), what happened in plain words, day by day, the record before this week, the Nadir score, what happened after earlier falls like this one, and news marked "During the fall".
- **Search** covers every listed company. Star any company for your watchlist.
- Real company logos, fetched once and cached by the server. Light mode by default; dark mode on the moon button.
- Keyboard: `/` search, `j`/`k` move, `Enter` open, `w` watch, `Esc` close.

## Why it's fast

V1 fetched each ticker from the browser through public CORS proxies, behind a loading screen. V2 does this instead:

1. A small Node server calls Yahoo directly, 16 requests at a time (~3 s for 196 stocks), and keeps the results in memory and in `cache/store.json`.
2. The page shell is plain HTML and paints immediately. The data request starts from a `<link rel=preload>` before any JS runs.
3. Rows are streamed as NDJSON, so on a cold start the ledger fills in live instead of waiting.
4. The browser keeps the last data locally, so returning visitors see the full page in the first frame, then refresh quietly.

Measured locally: full front page in about 0.16 s for a new visitor (warm server). From a cold server with no cache, the shell paints in 0.2 s, rows start at 1.1 s, and the lead is ready at 2.6 s.

## The score

All long-term figures are frozen at the close *before* the last five sessions.

- **Record** (0–1): 3-year CAGR (maxes out at 40%/yr) × 0.5, plus trend steadiness (R² of log price) × 0.3, plus closeness to the 52-week high going in × 0.2.
- **Break** (0–1): size of the 5-day fall (2% to 20%) × 0.55, plus the fall in units of the stock's usual weekly swing (σ) × 0.45.
- **Nadir score** = 100 × √(record × break). A stock needs both to rank.

## Files

| File | Role |
|---|---|
| `server.mjs` | HTTP server, Yahoo client, caching, NDJSON streaming |
| `analyze.mjs` | All the maths: returns, σ, trend fit, score, precedents, cause label |
| `universe.mjs` | The followed stocks (US, Europe incl. Brussels, Asia) and benchmarks |
| `public/` | Front end: `index.html`, `css/nadir.css`, `js/{app,charts,prose,format}.js` |

To follow more stocks, add lines to `universe.mjs`. Data comes from Yahoo Finance's unofficial endpoints, and this is a research tool, not investment advice.
