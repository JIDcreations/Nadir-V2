// Nadir on Netlify: the same /api routes as server.mjs, as one serverless function.
// Functions keep nothing between requests, so each screen request fetches fresh
// from Yahoo and streams rows as they land. Netlify's CDN caches the non-cold
// responses for a few minutes so repeat visits can be fast.

import { UNIVERSE, SECTORS, SECTOR_ETF } from '../../universe.mjs';
import {
  CONCURRENCY, MARKET_FOR, regionOf, fetchChart, fetchQuotes, pool, buildRow, benchRow, benchList,
  BENCH_SYMBOLS, intraday, news, search, fetchLogo,
} from '../../core.mjs';

export const config = { path: '/api/*' };

const SYM_RE = /^[A-Za-z0-9.^=\-]{1,16}$/;
const CDN = (seconds) => ({ 'Netlify-CDN-Cache-Control': `public, s-maxage=${seconds}, stale-while-revalidate=${seconds * 2}` });

const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=0, must-revalidate', ...extra },
});

function screen(cold) {
  const enc = new TextEncoder();
  const body = new ReadableStream({
    async start(ctrl) {
      const write = o => ctrl.enqueue(enc.encode(JSON.stringify(o) + '\n'));
      try {
        write({ type: 'meta', total: UNIVERSE.length, sectors: SECTORS, bench: [], asOf: Date.now() });
        const bench = {};
        const [, quotes] = await Promise.all([
          pool(BENCH_SYMBOLS, CONCURRENCY, async s => { const b = await benchRow(s); if (b) bench[s] = b; }),
          fetchQuotes(UNIVERSE.map(u => u.s)),
        ]);
        write({ type: 'bench', bench: benchList(bench) });
        await pool(UNIVERSE, CONCURRENCY, async u => {
          const built = buildRow(u, await fetchChart(u.s), quotes[u.s], bench);
          if (built) write({ type: 'row', row: built.row });
        });
        write({ type: 'done', asOf: Date.now(), refreshing: false });
      } catch (e) {
        write({ type: 'done', asOf: Date.now(), refreshing: false, error: e.message });
      }
      ctrl.close();
    },
  });
  return new Response(body, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      ...(cold ? { 'Netlify-CDN-Cache-Control': 'no-store' } : CDN(300)),
    },
  });
}

// One stock with the market and sector benchmarks it is judged against.
async function stock(sym) {
  const u = UNIVERSE.find(x => x.s === sym) ?? { s: sym };
  const reg = u.reg ?? regionOf(sym);
  const benchSyms = [MARKET_FOR[reg], u.sec && SECTOR_ETF[u.sec]].filter(Boolean);
  const bench = {};
  const [result, quotes] = await Promise.all([
    fetchChart(sym),
    fetchQuotes([sym]),
    ...benchSyms.map(s => benchRow(s).then(b => { if (b) bench[s] = b; }).catch(() => {})),
  ]);
  return buildRow(u, result, quotes[sym], bench);
}

export default async (req) => {
  const url = new URL(req.url);
  const [route, raw = ''] = url.pathname.replace(/^\/api\//, '').split('/');
  try {
    if (route === 'screen') return screen(url.searchParams.has('cold'));
    if (route === 'search') {
      const q = (url.searchParams.get('q') || '').trim().slice(0, 40);
      return json(q ? await search(q) : [], 200, CDN(3600));
    }
    const sym = decodeURIComponent(raw).toUpperCase();
    if (!SYM_RE.test(sym)) return json({ error: 'bad symbol' }, 400);

    if (route === 'logo') {
      const buf = await fetchLogo(sym);
      if (!buf) return new Response('no logo', { status: 404, headers: { 'Cache-Control': 'public, max-age=86400', ...CDN(86400) } });
      return new Response(buf, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=604800, immutable', ...CDN(604800) } });
    }
    if (route === 'stock' || route === 'history') {
      const built = await stock(sym);
      if (!built) return json({ error: 'not found' }, 404);
      if (route === 'stock') return json(built.row, 200, CDN(120));
      const { row, prec, series } = built;
      return json({ row, prec, t: series.t, c: series.c.map(x => Number(x.toPrecision(6))), v: series.v }, 200, CDN(120));
    }
    if (route === 'intraday') return json(await intraday(sym), 200, CDN(120));
    if (route === 'news') return json(await news(sym), 200, CDN(900));
    return json({ error: 'not found' }, 404);
  } catch (e) {
    return json({ error: e.message || 'upstream error' }, 502, { 'Cache-Control': 'no-store' });
  }
};
