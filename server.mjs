// Nadir V2 — local data server. Zero dependencies, Node 18+.
//
// Why a server at all: V1 fetched every ticker from the browser through a chain of
// public CORS proxies (up to 3 × 10s timeouts each) behind a blocking loading screen.
// Here the server talks to Yahoo directly, fans out 16 requests at a time, keeps
// everything in memory and on disk, and streams rows to the page as they land.
// A returning visitor gets the whole market in one response, in milliseconds.

import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { UNIVERSE, BENCHMARKS, SECTORS, SECTOR_ETF } from './universe.mjs';
import { analyze, classify, cleanSeries } from './analyze.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const CACHE_FILE = path.join(ROOT, 'cache', 'store.json');
const PORT = Number(process.env.PORT) || 5178;
const TTL = 10 * 60_000;          // full-universe refresh interval
const CONCURRENCY = 16;
const UA = 'Mozilla/5.0'; // Yahoo rate-limits full browser UA strings from non-browser clients

// ─── Yahoo client ─────────────────────────────────────────────────────────────

let auth = null; // { cookie, crumb, at } — only needed for the batch quote endpoint

async function yget(pathAndQuery, { timeout = 8000, withCrumb = false } = {}) {
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

async function fetchChart(sym, range = '5y', interval = '1d') {
  const j = await yget(`/v8/finance/chart/${encodeURIComponent(sym)}?range=${range}&interval=${interval}&includePrePost=false`);
  const r = j?.chart?.result?.[0];
  if (!r) throw new Error(j?.chart?.error?.description || 'no data');
  return r;
}

// Batch quotes add market cap, P/E, earnings date and analyst view. Optional:
// if Yahoo refuses the crumb, Nadir still works on price data alone.
async function fetchQuotes(symbols) {
  const out = {};
  try { await ensureCrumb(); } catch { return out; }
  for (let i = 0; i < symbols.length; i += 60) {
    const chunk = symbols.slice(i, i + 60);
    try {
      const j = await yget(`/v7/finance/quote?symbols=${chunk.map(encodeURIComponent).join(',')}`, { withCrumb: true });
      for (const q of j?.quoteResponse?.result ?? []) out[q.symbol] = q;
    } catch { /* enrichment is best-effort */ }
  }
  return out;
}

async function pool(items, n, fn) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => {
    while (queue.length) { const it = queue.shift(); try { await fn(it); } catch { /* one bad ticker never sinks the batch */ } }
  }));
}

// ─── Store ───────────────────────────────────────────────────────────────────

const store = new Map();   // symbol → { row, series, at }
const bench = {};          // symbol → { s, n, px, d1, w1, spark }
let lastFull = 0;
let refreshing = null;
const bus = new EventEmitter();
bus.setMaxListeners(200);

const regionOf = s => /\.(AS|PA|DE|BR|L|SW|CO|MI|MC|ST|HE|OL|LS|VI|IR)$/.test(s) ? 'EU' : /\.(T|HK|KS|KQ|TW|SS|SZ|SI|AX|NS|BO)$/.test(s) ? 'ASIA' : 'US';
const MARKET_FOR = { US: '^GSPC', EU: '^STOXX50E', ASIA: '^N225' };

function buildRow(u, result, quote) {
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
  return { row, series, full: a };
}

async function loadStock(u, quote) {
  const result = await fetchChart(u.s);
  const built = buildRow(u, result, quote);
  if (!built) return null;
  store.set(u.s, { row: built.row, series: built.series, prec: built.full.prec, at: Date.now() });
  return built.row;
}

async function loadBench(s) {
  const result = await fetchChart(s, '1y', '1d');
  const { c } = cleanSeries(result);
  const n = c.length;
  if (n < 10) return;
  const name = BENCHMARKS.find(b => b.s === s)?.n ?? s;
  bench[s] = {
    s, n: name, px: c[n - 1], d1: c[n - 1] / c[n - 2] - 1, w1: c[n - 1] / c[n - 6] - 1,
    spark: c.slice(-60).map(x => Number(x.toPrecision(5))),
  };
}

function refreshAll() {
  if (refreshing) return refreshing;
  const t0 = Date.now();
  refreshing = (async () => {
    const benchSyms = [...BENCHMARKS.map(b => b.s), ...new Set(Object.values(SECTOR_ETF))];
    const [, quotes] = await Promise.all([
      pool(benchSyms, CONCURRENCY, loadBench),
      fetchQuotes(UNIVERSE.map(u => u.s)),
    ]);
    bus.emit('bench', benchOut());
    let ok = 0;
    await pool(UNIVERSE, CONCURRENCY, async u => {
      const row = await loadStock(u, quotes[u.s]);
      if (row) { ok++; bus.emit('row', row); }
    });
    lastFull = Date.now();
    console.log(`[nadir] refreshed ${ok}/${UNIVERSE.length} in ${((Date.now() - t0) / 1000).toFixed(1)}s${Object.keys(quotes).length ? '' : ' (price data only — quote enrichment unavailable)'}`);
    bus.emit('done');
    saveDisk().catch(e => console.warn('[nadir] cache write failed:', e.message));
  })().finally(() => { refreshing = null; });
  return refreshing;
}

const benchOut = () => BENCHMARKS.map(b => bench[b.s]).filter(Boolean)
  .concat(Object.entries(SECTOR_ETF).map(([sec, s]) => bench[s] && { ...bench[s], sec }).filter(Boolean));

async function saveDisk() {
  await mkdir(path.dirname(CACHE_FILE), { recursive: true });
  const entries = [...store].filter(([s]) => UNIVERSE.some(u => u.s === s));
  await writeFile(CACHE_FILE, JSON.stringify({ lastFull, bench, entries }));
}

async function loadDisk() {
  if (!existsSync(CACHE_FILE)) return;
  try {
    const d = JSON.parse(await readFile(CACHE_FILE, 'utf8'));
    lastFull = d.lastFull || 0;
    Object.assign(bench, d.bench || {});
    for (const [s, e] of d.entries || []) store.set(s, e);
    console.log(`[nadir] warm start: ${store.size} stocks from disk (${Math.round((Date.now() - lastFull) / 60000)} min old)`);
  } catch (e) { console.warn('[nadir] ignoring unreadable cache:', e.message); }
}

// ─── Small TTL cache for on-demand endpoints ─────────────────────────────────

const memo = new Map();
async function cached(key, ttl, fn) {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value;
  if (hit?.pending) return hit.pending;
  const pending = fn().then(value => { memo.set(key, { value, at: Date.now() }); return value; })
    .catch(e => { memo.delete(key); throw e; });
  memo.set(key, { ...hit, pending });
  return pending;
}

// ─── HTTP ────────────────────────────────────────────────────────────────────

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};

function send(req, res, status, body, type = 'application/json', extraHeaders = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  const headers = { 'Content-Type': type, 'Cache-Control': 'no-cache', ...extraHeaders };
  if (/gzip/.test(req.headers['accept-encoding'] || '') && buf.length > 1024 && !/image\/png/.test(type)) {
    headers['Content-Encoding'] = 'gzip';
    res.writeHead(status, headers);
    return res.end(zlib.gzipSync(buf, { level: 6 }));
  }
  res.writeHead(status, headers);
  res.end(buf);
}

const SYM_RE = /^[A-Za-z0-9.^=\-]{1,16}$/;

async function handleScreen(req, res, _m, url) {
  // ?cold: demo a true first load. Skip every cache and stream a fresh fetch from Yahoo.
  const cold = url?.searchParams.has('cold');
  const gzip = /gzip/.test(req.headers['accept-encoding'] || '');
  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Accel-Buffering': 'no',
    ...(gzip ? { 'Content-Encoding': 'gzip' } : {}),
  });
  const out = gzip ? zlib.createGzip({ level: 5 }) : res;
  if (gzip) out.pipe(res);
  // Flush per message only while streaming a cold start; a warm answer compresses as one block.
  let live = false;
  const write = obj => { out.write(JSON.stringify(obj) + '\n'); if (gzip && live) out.flush(); };

  write({ type: 'meta', total: UNIVERSE.length, sectors: SECTORS, bench: cold ? [] : benchOut(), asOf: lastFull });
  let have = 0;
  if (!cold) {
    for (const u of UNIVERSE) {
      const e = store.get(u.s);
      if (e?.row) { write({ type: 'row', row: e.row }); have++; }
    }
  }

  const stale = Date.now() - lastFull > TTL;
  if (stale || cold) refreshAll();

  // Warm (or mostly warm): answer now; the page polls again when the refresh lands.
  if (!cold && (have >= UNIVERSE.length * 0.8 || !refreshing)) {
    write({ type: 'done', asOf: lastFull, refreshing: !!refreshing });
    return out.end();
  }

  // Cold start: keep the stream open and push each row the moment it's computed.
  live = true;
  if (gzip) out.flush();
  const onBench = b => write({ type: 'bench', bench: b });
  const sent = new Set();
  const onRow = row => { sent.add(row.s); write({ type: 'row', row }); };
  const onDone = () => {
    cleanup();
    // Rows computed before this request joined the refresh: send them now.
    for (const u of UNIVERSE) { const e = store.get(u.s); if (e?.row && !sent.has(u.s) && (cold || have === 0)) write({ type: 'row', row: e.row }); }
    write({ type: 'bench', bench: benchOut() });
    write({ type: 'done', asOf: lastFull, refreshing: false });
    out.end();
  };
  const cleanup = () => { bus.off('row', onRow); bus.off('done', onDone); bus.off('bench', onBench); };
  bus.on('bench', onBench); bus.on('row', onRow); bus.once('done', onDone);
  req.on('close', cleanup);
}

async function stockEntry(sym) {
  const e = store.get(sym);
  if (e && Date.now() - e.at < TTL) return e;
  const u = UNIVERSE.find(x => x.s === sym) ?? { s: sym };
  const quotes = await fetchQuotes([sym]);
  await loadStock(u, quotes[sym]);
  return store.get(sym);
}

// Company logos: fetched once from public logo CDNs, cached on disk, served same-origin.
const LOGO_DIR = path.join(ROOT, 'cache', 'logos');
const LOGO_SOURCES = [
  s => `https://financialmodelingprep.com/image-stock/${encodeURIComponent(s)}.png`,
  s => `https://assets.parqet.com/logos/symbol/${encodeURIComponent(s)}?format=png`,
];
async function logo(sym) {
  const file = path.join(LOGO_DIR, sym.replace(/[^A-Z0-9.\-]/gi, '_') + '.png');
  try { return await readFile(file); } catch { /* not cached yet */ }
  for (const src of LOGO_SOURCES) {
    try {
      const res = await fetch(src(sym), { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(5000) });
      if (!res.ok || !/image/.test(res.headers.get('content-type') || '')) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 200) continue;
      await mkdir(LOGO_DIR, { recursive: true });
      await writeFile(file, buf);
      return buf;
    } catch { /* try the next source */ }
  }
  return null;
}

const routes = [
  [/^\/api\/screen$/, handleScreen],

  [/^\/api\/logo\/([^/]+)$/, async (req, res, [, sym]) => {
    const buf = await cached('logo:' + sym, 24 * 3600_000, () => logo(sym));
    if (!buf) return send(req, res, 404, 'no logo', 'text/plain', { 'Cache-Control': 'public, max-age=86400' });
    send(req, res, 200, buf, 'image/png', { 'Cache-Control': 'public, max-age=604800, immutable' });
  }],

  [/^\/api\/stock\/([^/]+)$/, async (req, res, [, sym]) => {
    const e = await cached('stock:' + sym, 60_000, () => stockEntry(sym));
    send(req, res, e?.row ? 200 : 404, e?.row ?? { error: 'not found' });
  }],

  [/^\/api\/history\/([^/]+)$/, async (req, res, [, sym]) => {
    const e = await cached('stock:' + sym, 60_000, () => stockEntry(sym));
    if (!e) return send(req, res, 404, { error: 'not found' });
    send(req, res, 200, { row: e.row, prec: e.prec, t: e.series.t, c: e.series.c.map(x => Number(x.toPrecision(6))), v: e.series.v });
  }],

  [/^\/api\/intraday\/([^/]+)$/, async (req, res, [, sym]) => {
    const data = await cached('intra:' + sym, 3 * 60_000, async () => {
      const r = await fetchChart(sym, '5d', '15m');
      const { t, c, v } = cleanSeries(r);
      return { t, c, v, prev: r.meta?.chartPreviousClose ?? null, tz: r.meta?.exchangeTimezoneName ?? null };
    });
    send(req, res, 200, data);
  }],

  [/^\/api\/news\/([^/]+)$/, async (req, res, [, sym]) => {
    const news = await cached('news:' + sym, 15 * 60_000, async () => {
      const j = await yget(`/v1/finance/search?q=${encodeURIComponent(sym)}&quotesCount=0&newsCount=14&enableFuzzyQuery=false`);
      return (j?.news ?? []).map(x => ({
        title: x.title, publisher: x.publisher, link: x.link, t: x.providerPublishTime,
        related: x.relatedTickers ?? [],
      })).sort((a, b) => b.t - a.t);
    });
    send(req, res, 200, news);
  }],

  [/^\/api\/search$/, async (req, res, _m, url) => {
    const q = (url.searchParams.get('q') || '').trim().slice(0, 40);
    if (!q) return send(req, res, 200, []);
    const list = await cached('search:' + q.toLowerCase(), 3600_000, async () => {
      const j = await yget(`/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0`, { timeout: 5000 });
      return (j?.quotes ?? []).filter(x => x.symbol && ['EQUITY', 'ETF'].includes(x.quoteType))
        .map(x => ({ s: x.symbol, n: x.longname || x.shortname || x.symbol, exch: x.exchDisp || x.exchange, type: x.quoteType }));
    });
    send(req, res, 200, list);
  }],
];

async function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC)) return send(req, res, 403, 'Forbidden', 'text/plain');
  try {
    const body = await readFile(file);
    send(req, res, 200, body, TYPES[path.extname(file)] || 'application/octet-stream');
  } catch {
    send(req, res, 404, 'Not found', 'text/plain');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    for (const [re, handler] of routes) {
      const m = url.pathname.match(re);
      if (!m) continue;
      if (m[1] && !SYM_RE.test(decodeURIComponent(m[1]))) return send(req, res, 400, { error: 'bad symbol' });
      if (m[1]) m[1] = decodeURIComponent(m[1]).toUpperCase();
      return await handler(req, res, m, url);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(req, res, 405, 'Method not allowed', 'text/plain');
    await serveStatic(req, res, url);
  } catch (e) {
    if (!res.headersSent) send(req, res, 502, { error: e.message || 'upstream error' });
    else res.end();
  }
});

await loadDisk();
server.listen(PORT, () => {
  console.log(`\n  NADIR  ·  http://localhost:${PORT}\n`);
  refreshAll(); // start warming before the first visitor arrives
});
setInterval(() => { if (Date.now() - lastFull > TTL) refreshAll(); }, 60_000);
