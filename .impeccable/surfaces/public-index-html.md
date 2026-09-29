---
version: 1
slug: "public-index-html"
primary_target: "public/index.html"
related_targets: []
---

# Nadir front page + detail sheet

Scope: `public/index.html` and its detail sheet. Visitor mode: Operate. Audience: owner and a few friends, daily quick check; must impress someone who knows nothing about finance.

## Direction contract

THESIS: User-pinned (2026-09-29), replacing the Signal Bench: "clean modern, calm looking app, think like Apple would've made it, super premium, a person who knows nothing about finance would be impressed". Refuses dense screener tables, broadsheet layouts and instrument chrome.

OWN-WORLD: Apple system language. #f5f5f7 ground, white 22px-radius cards with soft two-layer shadow, SF Pro via system stack (Inter fallback), tabular numerals, one blue accent (#0071e3) for controls, red/green only for price moves, frosted-glass nav and sheet headers, iOS segmented controls, real company logos on white tiles (light logos detected and given a dark tile, monogram fallback).

STORY: Open → the page shell and plain-language title are there at once; status line and a thin progress bar say what is loading → a full-width featured pick, then a card per company → tap a card, a floating sheet slides in with stacked panels: chart, what happened, day by day, before this week, score, after earlier falls, news.

FIRST VIEWPORT: Glass nav (brand left, This week / All / Watchlist segmented centre, search right). Large title "N strong companies had a bad week", one-sentence lead, status + filters pill right. Market chips. Featured card full width: logo, name, big fall, headline left; six-month chart right.

FORM: User-pinned Apple-grade direction (overrides the rolled Signal Bench; seed key a413734c retained for history).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
