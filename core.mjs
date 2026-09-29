// Shared data layer: Yahoo client and row building. Used by the local server
// (server.mjs) and by the Netlify function (netlify/functions/api.mjs).

import { BENCHMARKS, SECTOR_ETF } from './universe.mjs';
import { analyze, classify, cleanSeries } from './analyze.mjs';

export const CONCURRENCY = 16;
export const UA = 'Mozilla/5.0'; // Yahoo rate-limits full browser UA strings from non-browser clients

// ─── Yahoo client ─────────────────────────────────────────────────────────────

let auth = null; // { cookie, crumb, at }: only needed for the batch quote endpoint

export async function yget(pathAndQuery, { timeout = 8000, withCrumb = false } = {}) {
  let q = pathAndQuery;
  const headers = { 'User-Agent': UA, Accept: 'application/json' };
  if (withCrumb) {
    if (!auth) throw new Error('no crumb');
    headers.Cookie = auth.cookie;
    q += (q.includes('?') ? '&' : '?') + 'crumb=' + encodeURIComponent(auth.crumb);
  }
  let lastErr;
  for (const host of ['query1', 'query2']) {
    try {
      const res = await fetch(`https://${host}.finance.yahoo.com${q}`, { headers, signal: AbortSignal.timeout(timeout) });
      if (res.ok) return await res.json();
      lastErr = new Error(`HTTP ${res.status}`);
      if (res.status === 404) break;
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

async function ensureCrumb() {
  if (auth && Date.now() - auth.at < 6 * 3600_000) return auth;
  const r1 = await fetch('https://fc.yahoo.com/', { headers: { 'User-Agent': UA }, redirect: 'manual', signal: AbortSignal.timeout(5000) });
  const setCookies = r1.headers.getSetCookie?.() ?? [r1.headers.get('set-cookie')].filter(Boolean);
  const cookie = setCookies.map(c => c.split(';')[0]).join('; ');
  const r2 = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', { headers: { 'User-Agent': UA, Cookie: cookie }, signal: AbortSignal.timeout(5000) });
  const crumb = (await r2.text()).trim();
  if (!r2.ok || !crumb || crumb.length > 24 || crumb.includes('<')) throw new Error('crumb refused');
  auth = { cookie, crumb, at: Date.now() };
  return auth;
}

export async function fetchChart(sym, range = '5y', interval = '1d') {
  const j = await yget(`/v8/finance/chart/${encodeURIComponent(sym)}?range=${range}&interval=${interval}&includePrePost=false`);
  const r = j?.chart?.result?.[0];
  if (!r) throw new Error(j?.chart?.error?.description || 'no data');
  return r;
}

// Batch quotes add market cap, P/E, earnings date and analyst view. Optional:
// if Yahoo refuses the crumb, Nadir still works on price data alone.
export async function fetchQuotes(symbols) {
  const out = {};
  try { await ensureCrumb(); } catch { return out; }
  await Promise.all(Array.from({ length: Math.ceil(symbols.length / 60) }, async (_, k) => {
    const chunk = symbols.slice(k * 60, k * 60 + 60);
    try {
      const j = await yget(`/v7/finance/quote?symbols=${chunk.map(encodeURIComponent).join(',')}`, { withCrumb: true });
      for (const q of j?.quoteResponse?.result ?? []) out[q.symbol] = q;
    } catch { /* enrichment is best-effort */ }
  }));
  return out;
}

export async function pool(items, n, fn) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => {
    while (queue.length) { const it = queue.shift(); try { await fn(it); } catch { /* one bad ticker never sinks the batch */ } }
  }));
}

// ─── Rows ────────────────────────────────────────────────────────────────────

export const regionOf = s => /\.(AS|PA|DE|BR|L|SW|CO|MI|MC|ST|HE|OL|LS|VI|IR)$/.test(s) ? 'EU' : /\.(T|HK|KS|KQ|TW|SS|SZ|SI|AX|NS|BO)$/.test(s) ? 'ASIA' : 'US';
export const MARKET_FOR = { US: '^GSPC', EU: '^STOXX50E', ASIA: '^N225' };

// bench: symbol → { w1, ... } for the market and sector benchmarks.
export function buildRow(u, result, quote, bench) {
  const series = cleanSeries(result);
  const meta = result.meta ?? {};
  const a = analyze(series, { earningsTs: quote?.earningsTimestamp ?? null });
  if (!a) return null;
  const reg = u.reg ?? regionOf(u.s);
  const marketW1 = bench[MARKET_FOR[reg]]?.w1 ?? null;
  const sectorW1 = u.sec && SECTOR_ETF[u.sec] ? bench[SECTOR_ETF[u.sec]]?.w1 ?? null : null;
  const row = {
    s: u.s,
    n: u.n || quote?.longName || meta.longName || meta.shortName || u.s,
    sec: u.sec || 'OTHER', reg,
    cur: meta.currency || quote?.currency || 'USD',
    exch: quote?.fullExchangeName || meta.fullExchangeName || meta.exchangeName || '',
    mcap: quote?.marketCap ?? null,
    pe: quote?.trailingPE ?? null,
    fpe: quote?.forwardPE ?? null,
    rating: quote?.averageAnalystRating ?? null,
    ...a,
    marketW1, sectorW1,
    cause: classify(a, marketW1, sectorW1),
  };
  delete row.prec;
  return { row, series, prec: a.prec };
}

export async function benchRow(s) {
  const { c } = cleanSeries(await fetchChart(s, '1y', '1d'));
  const n = c.length;
  if (n < 10) return null;
  return {
    s, n: BENCHMARKS.find(b => b.s === s)?.n ?? s, px: c[n - 1], d1: c[n - 1] / c[n - 2] - 1, w1: c[n - 1] / c[n - 6] - 1,
    spark: c.slice(-60).map(x => Number(x.toPrecision(5))),
  };
}

export const BENCH_SYMBOLS = [...BENCHMARKS.map(b => b.s), ...new Set(Object.values(SECTOR_ETF))];

export const benchList = bench => BENCHMARKS.map(b => bench[b.s]).filter(Boolean)
  .concat(Object.entries(SECTOR_ETF).map(([sec, s]) => bench[s] && { ...bench[s], sec }).filter(Boolean));

// ─── Detail endpoints ───────────────────────────────────────────────────────

export async function intraday(sym) {
  const r = await fetchChart(sym, '5d', '15m');
  const { t, c, v } = cleanSeries(r);
  return { t, c, v, prev: r.meta?.chartPreviousClose ?? null, tz: r.meta?.exchangeTimezoneName ?? null };
}

export async function news(sym) {
  const j = await yget(`/v1/finance/search?q=${encodeURIComponent(sym)}&quotesCount=0&newsCount=14&enableFuzzyQuery=false`);
  return (j?.news ?? []).map(x => ({ title: x.title, publisher: x.publisher, link: x.link, t: x.providerPublishTime, related: x.relatedTickers ?? [] }))
    .sort((a, b) => b.t - a.t);
}

export async function search(q) {
  const j = await yget(`/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0`, { timeout: 5000 });
  return (j?.quotes ?? []).filter(x => x.symbol && ['EQUITY', 'ETF'].includes(x.quoteType))
    .map(x => ({ s: x.symbol, n: x.longname || x.shortname || x.symbol, exch: x.exchDisp || x.exchange, type: x.quoteType }));
}

const LOGO_SOURCES = [
  s => `https://financialmodelingprep.com/image-stock/${encodeURIComponent(s)}.png`,
  s => `https://assets.parqet.com/logos/symbol/${encodeURIComponent(s)}?format=png`,
];
export async function fetchLogo(sym) {
  for (const src of LOGO_SOURCES) {
    try {
      const res = await fetch(src(sym), { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(5000) });
      if (!res.ok || !/image/.test(res.headers.get('content-type') || '')) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length >= 200) return buf;
    } catch { /* try the next source */ }
  }
  return null;
}
