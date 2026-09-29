# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The owner and a small circle of friends and family who invest privately. They open Nadir roughly once a day for a quick check: scan which strong companies fell this week, then dig into one or two of them before deciding whether to look further or buy.

## Product Purpose

Nadir finds stocks with a strong multi-year record that just had a sharp fall (the past five trading sessions), and explains the fall. Success is a user spotting a genuinely interesting candidate within a minute of opening the page, and understanding why it fell before acting.

## Positioning

Most screeners rank by distance from a high or by daily losers. Nadir judges every stock on its record frozen *before* the fall, measures the fall against that stock's own normal weekly swing, and pairs each candidate with what happened after its earlier comparable falls. The Nadir score is 100 × √(record × break), so a stock needs both halves to rank.

## Operating Context

- Personal daily ritual, usually on a laptop, sometimes a phone.
- A local zero-dependency Node server (`server.mjs`) fetches Yahoo Finance data, caches in memory and on disk, and streams rows as NDJSON; the page must be usable before that data arrives.
- Nadir V1 (`../Nadir-V1`) is the predecessor: card grid plus slide-in detail panel. Users found it cleaner and easier than V2's first broadsheet version, but its loading screen made people leave.

## Capabilities and Constraints

- ~196 followed stocks (US, Europe incl. Brussels, Asia) plus search across every listed company; watchlist stored in the browser.
- Per stock: price, day/week change, weekly swing (σ), 3-yr CAGR before the fall, trend steadiness, off 52-week high, 200-day average, volume ratio, cause label (earnings, market-wide, sector-wide, single-day shock, company slide), precedents with 1/3/6-month forward returns, headlines, market cap, P/E, analyst rating, earnings date.
- Charts: 5-day intraday through 5-year daily.
- Plain HTML/CSS/JS front end, no framework, no build step.
- Must open instantly and show per-section loading progress, never a blocking loader.

## Brand Commitments

- Name: Nadir. Tagline in use: "Good companies, bad weeks."
- Light (white) mode is the default; a dark mode may exist as an option.
- The owner likes an editorial feel but explicitly wants it clean and UX-first over decorative; no generic AI-looking design.

## Evidence on Hand

Live market data only. No testimonials, users, performance track record or returns claims exist; none may be invented.

## Product Principles

1. Clarity over atmosphere: every screen answers "what fell, how good was it before, why did it fall".
2. Never make the user wait on a blank or blocking screen; show structure immediately and state what is still loading.
3. Honest numbers: signs on every change, labelled heuristics, no investment advice.
4. One quick scan, then depth on demand (the detail panel), never both at once.
