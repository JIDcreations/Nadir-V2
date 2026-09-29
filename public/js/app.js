// Nadir front end.
//
// Loading: the page shell paints at once. The last session's data renders in the
// first frame from local storage. /api/screen is preloaded before this script runs
// and streams rows as NDJSON; cards replace their skeletons as data lands, and the
// status line plus the thin progress bar say what is still loading. Details are
// prefetched on hover, so opening a company is instant.

import { pct, pctAbs, price, cap, signClass, shortDay, weekday, fullDate, monthYear, clock, times, esc } from './format.js';
import { cardChart, priceChart, pathsChart } from './charts.js';
import { CAUSE, headline, standfirst, scoreNote, precedentSummary } from './prose.js';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode or full */ } },
};

const CACHE_KEY = 'nadir.v2.cache';
// Every load is a true first visit for now (video demo): no local copy, and the
// server fetches all prices fresh from Yahoo. For everyday use, set ALWAYS_COLD to
// false and change the /api/screen preload in index.html back to "/api/screen".
// Then opening /?cold still shows a first visit on demand.
const ALWAYS_COLD = true;
const COLD = ALWAYS_COLD || new URLSearchParams(location.search).has('cold');
const POLL_MS = 90_000;
const DEFAULT_FILTERS = { view: 'list', drop: 0.05, growth: 0.1, region: 'ALL', sector: 'ALL' };
const ASC_FIRST = new Set(['n', 'w1', 'z']);
const HOT = new Set(['earnings', 'shock']);
const REGION = { ALL: 'World', US: 'US', EU: 'Europe', ASIA: 'Asia' };
const MONO = ['#5e5ce6', '#0a84ff', '#30b0c7', '#34a853', '#ff9f0a', '#ff6482', '#bf5af2', '#8e8e93', '#ac8e68'];

const state = {
  rows: new Map(), extra: new Map(), sectors: {}, bench: [], total: 0, asOf: 0,
  complete: false, failed: false, entered: false,
  filters: { ...DEFAULT_FILTERS, ...store.get('nadir.filters', {}) },
  sort: store.get('nadir.sort3', { key: 'score', dir: -1 }),
  watch: new Set(store.get('nadir.watch', [])),
  visible: [], cursor: -1, sheetSym: null, returnFocus: null,
};

// ── Data ─────────────────────────────────────────────────────────────────────

function ingestMeta(m) {
  if (m.sectors) state.sectors = m.sectors;
  if (m.bench?.length) state.bench = m.bench;
  if (m.total) state.total = m.total;
  fillSectorSelect();
}

function restoreCache() {
  const c = store.get(CACHE_KEY, null);
  if (!c?.rows?.length) return false;
  ingestMeta(c);
  for (const r of c.rows) state.rows.set(r.s, r);
  state.asOf = c.asOf;
  state.complete = true;
  return true;
}
const saveCache = () => store.set(CACHE_KEY, { asOf: state.asOf, sectors: state.sectors, bench: state.bench, total: state.total, rows: [...state.rows.values()] });

let streaming = false;
async function stream() {
  if (streaming) return;
  streaming = true;
  const warm = state.rows.size > 0;
  status('busy', warm ? 'Checking for new prices' : 'Connecting');
  progress(warm ? 0.3 : 0.06);
  let again = false, count = 0;
  try {
    const res = await fetch(COLD && !warm ? '/api/screen?cold' : '/api/screen');
    if (!res.ok || !res.body) throw new Error('HTTP ' + res.status);
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (!line) continue;
        const msg = JSON.parse(line);
        if (msg.type === 'meta') { ingestMeta(msg); renderMarket(); if (!warm) status('busy', `Reading prices for ${state.total} companies`); }
        else if (msg.type === 'bench') { state.bench = msg.bench; renderMarket(); }
        else if (msg.type === 'row') {
          state.rows.set(msg.row.s, msg.row);
          count++;
          if (!warm) { status('busy', `Reading prices, ${count} of ${state.total || 200}`); progress(0.06 + 0.9 * count / (state.total || 200)); }
          schedule();
        } else if (msg.type === 'done') { state.asOf = msg.asOf || Date.now(); again = msg.refreshing; }
      }
    }
    state.complete = true;
    state.failed = false;
    saveCache();
    schedule();
    progress(1);
    status('ok', `Updated ${clock(state.asOf)}`);
  } catch (e) {
    console.warn('[nadir] screen failed', e);
    state.failed = true;
    progress(null);
    status('err', state.rows.size ? `Offline, showing prices from ${clock(state.asOf)}` : 'Can’t reach the data server');
    schedule();
  } finally { streaming = false; }
  if (again) setTimeout(stream, 5000);
}

const historyCache = new Map();
function getHistory(sym) {
  const hit = historyCache.get(sym);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.p;
  const p = fetch('/api/history/' + encodeURIComponent(sym)).then(r => { if (!r.ok) throw new Error('not found'); return r.json(); });
  p.catch(() => historyCache.delete(sym));
  historyCache.set(sym, { p, at: Date.now() });
  return p;
}
const rowFor = s => state.rows.get(s) ?? state.extra.get(s);

async function ensureWatchRows() {
  const missing = [...state.watch].filter(s => !rowFor(s));
  await Promise.all(missing.map(s => fetch('/api/stock/' + encodeURIComponent(s)).then(r => (r.ok ? r.json() : null)).then(r => { if (r) state.extra.set(r.s, r); }).catch(() => {})));
  if (missing.length) schedule();
}

// ── Status ──────────────────────────────────────────────────────────────────

function status(kind, text) {
  $('#status').className = 'status ' + kind;
  $('#status-text').textContent = text;
}
let progT = 0;
function progress(v) {
  const bar = $('#progress');
  clearTimeout(progT);
  if (v == null) { bar.classList.remove('on'); return; }
  bar.classList.add('on');
  bar.firstElementChild.style.width = Math.round(v * 100) + '%';
  if (v >= 1) progT = setTimeout(() => { bar.classList.remove('on'); progT = setTimeout(() => { bar.firstElementChild.style.width = '0'; }, 400); }, 500);
}

// ── Filtering ───────────────────────────────────────────────────────────────

const inScope = r => (state.filters.region === 'ALL' || r.reg === state.filters.region) && (state.filters.sector === 'ALL' || r.sec === state.filters.sector);
const onList = r => inScope(r) && r.w1 <= -state.filters.drop && (state.filters.growth < 0 || (r.cagr ?? -1) >= state.filters.growth);
function passes(r) {
  const v = state.filters.view;
  return v === 'watch' ? state.watch.has(r.s) : v === 'list' ? onList(r) : inScope(r);
}
function currentList() {
  const base = state.filters.view === 'watch' ? [...state.watch].map(rowFor).filter(Boolean) : [...state.rows.values()];
  const { key, dir } = state.sort;
  return base.filter(passes).sort((a, b) => {
    if (key === 'n') return dir * a.n.localeCompare(b.n);
    const x = a[key], y = b[key];
    if (x == null) return 1;
    if (y == null) return -1;
    return dir * (x - y);
  });
}

// ── Rendering ───────────────────────────────────────────────────────────────

let timer = 0, lastPaint = 0;
function schedule() {
  if (timer) return;
  const wait = state.complete ? 0 : Math.max(0, 180 - (performance.now() - lastPaint));
  timer = setTimeout(() => requestAnimationFrame(() => { timer = 0; lastPaint = performance.now(); render(); }), wait);
}
function render() { renderIntro(); renderMarket(); renderGrid(); syncControls(); }

function weekSpan() {
  const r = [...state.rows.values()].find(x => x.last10?.length >= 5);
  if (!r) return '';
  const from = r.last10[r.last10.length - 5].t, to = r.last10[r.last10.length - 1].t;
  const d = (t, o) => new Date(t * 1000).toLocaleDateString('en-GB', o);
  const same = d(from, { month: 'short' }) === d(to, { month: 'short' });
  return `${d(from, same ? { day: "numeric" } : { day: "numeric", month: "short" })} and ${d(to, { day: "numeric", month: "long" })}`;
}

function renderIntro() {
  const f = state.filters, h = $('#title'), p = $('#lead');
  if (!state.rows.size) {
    if (state.failed) {
      h.textContent = 'Nadir can’t reach its data';
      p.innerHTML = 'Start the data server with <b>node server.mjs</b> in the Nadir-V2 folder, then reload this page.';
    } else {
      h.textContent = 'Good companies, bad weeks.';
      p.textContent = 'Checking about 200 strong companies for sharp falls in the last five trading days.';
    }
    return;
  }
  const all = [...state.rows.values()];
  const span = weekSpan();
  if (f.view === 'list') {
    const n = all.filter(onList).length;
    const loading = !state.complete ? ' so far' : '';
    h.textContent = n === 0 ? (state.complete ? 'A calm week for strong companies' : 'Looking for this week’s falls') : n === 1 ? `One strong company had a bad week${loading}` : `${n} strong companies had a bad week${loading}`;
    p.textContent = f.growth > 0
      ? `Each grew at least ${pctAbs(f.growth, 0)} a year for three years, then fell ${pctAbs(f.drop, 0)} or more between ${span}. Tap one to see what happened.`
      : `Each fell ${pctAbs(f.drop, 0)} or more between ${span}. Tap one to see what happened.`;
  } else if (f.view === 'all') {
    h.textContent = `All ${all.filter(inScope).length} companies`;
    p.textContent = 'Everything Nadir follows, best match first: a strong three-year record and a sharp fall this week.';
  } else {
    h.textContent = 'Your watchlist';
    p.textContent = state.watch.size ? 'The companies you starred, wherever they are.' : 'Star a company to keep an eye on it here.';
  }
}

function renderMarket() {
  const items = state.bench.filter(b => !b.sec);
  const el = $('#market');
  if (!items.length) { if (!el.children.length) el.innerHTML = '<span class="chip sk sk-line"></span>'.repeat(5); return; }
  el.innerHTML = items.map(b => b.s === '^VIX'
    ? `<span class="chip" title="Market fear gauge">${esc(b.n)} <b>${b.px.toFixed(1)}</b></span>`
    : `<span class="chip">${esc(b.n)} <b class="${signClass(b.w1)}">${pct(b.w1)}</b></span>`).join('');
}

function logoHTML(r, cls = 'logo') {
  const name = r?.n ?? '?';
  const hue = MONO[[...(r?.s ?? name)].reduce((a, c) => a + c.charCodeAt(0), 0) % MONO.length];
  return `<img class="${cls}" src="/api/logo/${encodeURIComponent(r?.s ?? '')}" alt="" loading="lazy" decoding="async" data-mono="${esc(name[0])}" data-hue="${hue}">`;
}

function skeletons(n) {
  return Array.from({ length: n }, () => `
    <div class="card sk" aria-hidden="true">
      <div class="card-top"><span class="logo"></span><div><span class="sk-line" style="width:60%;height:15px"></span><span class="sk-line" style="width:38%;height:11px;margin-top:8px"></span></div></div>
      <div class="card-fig"><span class="sk-line" style="width:120px;height:32px"></span></div>
      <div class="card-chart"><span class="sk-block" style="position:absolute;inset:8px 4px;border-radius:12px"></span></div>
      <div class="card-foot-in"><span class="sk-line" style="width:110px;height:22px;border-radius:999px"></span><span class="sk-line" style="width:90px;height:12px"></span></div>
    </div>`).join('');
}

function card(r, i, feature) {
  const w = state.watch.has(r.s);
  const moves = r.z != null && r.z <= -1.3 ? `, about ${Math.abs(r.z).toFixed(1)}× a normal week` : '';
  return `
    <article class="card${feature ? ' feature' : ''}${i === state.cursor ? ' is-cursor' : ''}" data-s="${esc(r.s)}" style="--i:${i}">
      <div class="card-top">
        ${logoHTML(r)}
        <div style="min-width:0"><a class="card-name" href="#/s/${encodeURIComponent(r.s)}">${esc(r.n)}</a><p class="card-sub">${esc(r.s)} · ${esc(state.sectors[r.sec] ?? 'Other')}</p></div>
        <button type="button" class="star" data-star="${esc(r.s)}" aria-pressed="${w}" aria-label="${w ? 'Remove from' : 'Add to'} watchlist: ${esc(r.n)}"><i class="${w ? 'ph-fill' : 'ph'} ph-star" aria-hidden="true"></i></button>
      </div>
      <div class="card-fig"><span class="big ${signClass(r.w1)}">${pct(r.w1)}</span><span class="fig-note">this week${moves}</span></div>
      ${feature ? `<p class="card-story">${esc(headline(r))}</p>` : ''}
      <div class="card-chart">${cardChart(r.spark, { dir: r.w1 < 0 ? -1 : 1, level: r.px / (1 + r.w1) })}</div>
      <div class="card-foot-in">
        <span class="tag${HOT.has(r.cause) ? ' hot' : ''}">${r.cause ? CAUSE[r.cause] : 'No fall this week'}</span>
        <span class="meta">${r.cagr != null ? `Grew <b>${pctAbs(r.cagr, 0)}</b> a year` : 'New listing'}</span>
      </div>
    </article>`;
}

function renderGrid() {
  const grid = $('#grid'), empty = $('#empty');
  const list = currentList();
  state.visible = list;
  if (state.cursor >= list.length) state.cursor = list.length - 1;
  const loading = !state.complete && !state.failed;

  if (!state.rows.size && !state.extra.size) {
    grid.innerHTML = state.failed ? '' : skeletons(6);
    grid.setAttribute('aria-busy', String(!state.failed));
    empty.hidden = true;
    return;
  }
  const feature = state.filters.view === 'list' && state.sort.key === 'score' && state.complete && list.length > 2;
  grid.innerHTML = list.map((r, i) => card(r, i, feature && i === 0)).join('') + (loading ? skeletons(Math.max(2, 6 - list.length)) : '');
  grid.setAttribute('aria-busy', String(loading));
  if (!state.entered && state.complete && list.length) {
    state.entered = true;
    grid.classList.add('enter');
    setTimeout(() => grid.classList.remove('enter'), 1400);
  }
  empty.hidden = list.length > 0 || loading;
  if (!list.length && !loading) {
    const v = state.filters.view;
    empty.innerHTML = v === 'watch'
      ? '<i class="ph ph-star" aria-hidden="true"></i><h2>Nothing starred yet</h2><p>Tap the star on any company to follow it here.</p>'
      : v === 'list'
        ? `<i class="ph ph-sun" aria-hidden="true"></i><h2>No big falls with these filters</h2><p>Nothing fell ${pctAbs(state.filters.drop, 0)} or more this week. Try a smaller fall.</p><button type="button" class="pill-btn" data-loosen>Show falls of 3% or more</button>`
        : '<i class="ph ph-magnifying-glass" aria-hidden="true"></i><h2>No companies here</h2><p>Try another region or sector.</p>';
  }
}

function syncControls() {
  for (const g of $$('[data-key]')) {
    const val = String(state.filters[g.dataset.key]);
    for (const b of g.querySelectorAll('button')) b.setAttribute(b.getAttribute('role') === 'tab' ? 'aria-selected' : 'aria-checked', String(b.dataset.v === val));
  }
  $('#sector').value = state.filters.sector;
  $('#sort').value = state.sort.key;
  const f = state.filters;
  const parts = [`Fell ${pctAbs(f.drop, 0)}+`];
  if (f.growth > 0) parts.push(`grew ${pctAbs(f.growth, 0)}+`);
  if (f.region !== 'ALL') parts.push(REGION[f.region]);
  if (f.sector !== 'ALL') parts.push(state.sectors[f.sector] ?? f.sector);
  $('#filters-sum').textContent = parts.join(', ');
}

function fillSectorSelect() {
  const sel = $('#sector');
  if (sel.options.length > 1 || !Object.keys(state.sectors).length) return;
  for (const [k, v] of Object.entries(state.sectors)) sel.add(new Option(v, k));
  sel.value = state.filters.sector;
}

// Cards that no longer match fade out first, so you can see what a filter did.
let settle = 0;
function setFilter(key, value) {
  state.filters[key] = value;
  store.set('nadir.filters', state.filters);
  state.cursor = -1;
  syncControls();
  renderIntro();
  clearTimeout(settle);
  let leaving = 0;
  if (key !== 'view') {
    for (const el of $$('#grid .card[data-s]')) {
      const r = rowFor(el.dataset.s);
      if (r && !passes(r)) { el.classList.add('is-out'); leaving++; }
    }
  }
  if (leaving) settle = setTimeout(renderGrid, 260); else renderGrid();
}

// ── Popover & sheet ─────────────────────────────────────────────────────────

const scrim = $('#scrim');
function showScrim(on) {
  if (on) { scrim.hidden = false; requestAnimationFrame(() => scrim.classList.add('on')); }
  else { scrim.classList.remove('on'); setTimeout(() => { if (!scrim.classList.contains('on')) scrim.hidden = true; }, 300); }
}
function openFilters() { $('#filters').hidden = false; showScrim(true); $('#filters').querySelector('button[aria-checked="true"]')?.focus(); }
function closeFilters() { if ($('#filters').hidden) return; $('#filters').hidden = true; if (!state.sheetSym) showScrim(false); $('#filters-btn').focus(); }

let sheetToken = 0;
const RANGES = { '1W': 5, '1M': 21, '3M': 63, '1Y': 252, '5Y': Infinity };

function openSheet(sym) {
  const token = ++sheetToken;
  const sheet = $('#sheet');
  if (!state.sheetSym) state.returnFocus = document.activeElement;
  state.sheetSym = sym;
  closeFilters();
  const r = rowFor(sym);
  sheet.innerHTML = sheetHTML(sym, r);
  sheet.classList.remove('scrolled');
  showScrim(true);
  requestAnimationFrame(() => sheet.classList.add('on'));
  sheet.setAttribute('aria-hidden', 'false');
  document.body.classList.add('locked');
  sheet.scrollTop = 0;
  sheet.focus({ preventScroll: true });
  document.title = `${r?.n ?? sym} · Nadir`;
  wireSheet(sym);

  getHistory(sym).then(h => {
    if (token !== sheetToken) return;
    const row = h.row;
    if (!state.rows.has(row.s)) state.extra.set(row.s, row);
    if (!r) { sheet.innerHTML = sheetHTML(sym, row); wireSheet(sym); document.title = `${row.n} · Nadir`; }
    fillSheet(sym, row, h, token);
  }).catch(() => {
    if (token !== sheetToken) return;
    sheet.querySelector('.sh-body').innerHTML = `<div class="panel"><h3>We couldn’t find ${esc(sym)}</h3><p class="sub">The ticker may be misspelled, delisted, or not covered by the data source. Try searching by company name.</p></div>`;
  });

  fetch('/api/news/' + encodeURIComponent(sym)).then(x => x.json()).then(news => {
    if (token !== sheetToken) return;
    const box = sheet.querySelector('#s-news');
    if (!box) return;
    const pre = rowFor(sym)?.preT ?? 0;
    const list = (Array.isArray(news) ? news : []).slice(0, 8);
    box.innerHTML = list.length
      ? `<ol class="news">${list.map(n => `<li><a href="${esc(n.link)}" target="_blank" rel="noopener noreferrer"><span class="news-t">${esc(n.title)}</span><span class="news-m">${esc(n.publisher)}, ${fullDate(n.t)}${n.t >= pre ? '<span class="badge down">During the fall</span>' : ''}</span></a></li>`).join('')}</ol>`
      : '<p class="sub">No recent news found for this company.</p>';
  }).catch(() => { const b = sheet.querySelector('#s-news'); if (b) b.innerHTML = '<p class="sub">News isn’t available right now. Try again in a minute.</p>'; });
}

function closeSheet() {
  sheetToken++;
  const sheet = $('#sheet');
  sheet.classList.remove('on');
  sheet.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('locked');
  state.sheetSym = null;
  showScrim(false);
  setTimeout(() => { if (!state.sheetSym) sheet.innerHTML = ''; }, 500);
  document.title = 'Nadir';
  state.returnFocus?.focus?.({ preventScroll: true });
}

const skRows = n => `<div class="sk-rows">${'<span class="sk-line"></span>'.repeat(n)}</div>`;

function sheetHTML(sym, r) {
  const w = state.watch.has(sym);
  const top = `<div class="sh-top">
      <button type="button" class="round" data-close aria-label="Close"><i class="ph ph-x" aria-hidden="true"></i></button>
      <span class="sh-top-name">${esc(r?.n ?? sym)}</span>
      <div class="sh-actions">
        <button type="button" class="sh-btn" id="s-watch" aria-pressed="${w}"><i class="${w ? 'ph-fill' : 'ph'} ph-star" aria-hidden="true"></i><span>${w ? 'Watching' : 'Watch'}</span></button>
        <a class="round" href="https://finance.yahoo.com/quote/${encodeURIComponent(sym)}" target="_blank" rel="noopener noreferrer" aria-label="Open on Yahoo Finance"><i class="ph ph-arrow-up-right" aria-hidden="true"></i></a>
      </div></div>`;
  const head = r ? `
      <div class="sh-head">${logoHTML(r)}<div style="min-width:0"><h2 class="sh-name" id="s-name">${esc(r.n)}</h2><p class="sh-sub">${esc(r.s)}${r.exch ? ' · ' + esc(r.exch) : ''}</p></div></div>
      <div class="sh-price"><div class="big">${price(r.px, r.cur)}</div>
        <div class="sh-change">
          <span class="badge ${signClass(r.w1) || 'plain'}">${pct(r.w1)} this week</span>
          <span class="badge plain">${pct(r.d1)} today</span>
          ${r.z != null && r.z <= -1.3 ? `<span class="badge plain">About ${Math.abs(r.z).toFixed(1)}× a normal week</span>` : ''}
        </div></div>`
    : `<div class="sh-head"><span class="logo sk-block"></span><div><h2 class="sh-name" id="s-name">${esc(sym)}</h2><span class="sk-line" style="width:120px"></span></div></div>`;
  return top + `<div class="sh-body">${head}
      <section class="panel">
        <div class="seg ranges" role="radiogroup" aria-label="Chart range">${Object.keys(RANGES).map(k => `<button type="button" role="radio" data-v="${k}">${k}</button>`).join('')}</div>
        <div class="chart chart-main" id="s-chart"><span class="chart-wait sk-block"></span></div>
        <div class="legend" id="s-legend"></div>
      </section>
      ${r ? storyPanel(r) : `<section class="panel">${skRows(3)}</section>`}
      <section class="panel" id="s-days">${r ? daysPanel(r) : skRows(3)}</section>
      <section class="panel" id="s-record">${r ? recordPanel(r) : skRows(5)}</section>
      <section class="panel" id="s-score">${r ? scorePanel(r) : skRows(3)}</section>
      <section class="panel" id="s-past"><h3>After earlier falls</h3><p class="sub">Looking through five years of prices…</p>${skRows(3)}</section>
      <section class="panel"><h3>In the news</h3><div id="s-news">${skRows(4)}</div></section>
      <p class="fine" style="padding:0 4px">Research, not investment advice. Prices are delayed.</p>
    </div>`;
}

function storyPanel(r) {
  if (r.w1 >= 0) return `<section class="panel"><h3>This week</h3><p class="story">${esc(r.n)} is ${pct(r.w1)} over the past five trading days. It isn’t on this week’s list, but its record is below.</p></section>`;
  return `<section class="panel"><h3>What happened</h3><p class="story-h">${esc(headline(r))}</p><p class="story">${standfirst(r)}</p>
    <p style="margin-top:12px"><span class="tag${HOT.has(r.cause) ? ' hot' : ''}">${CAUSE[r.cause] ?? ''}</span></p></section>`;
}

function daysPanel(r) {
  const s = (r.last10 ?? []).slice(-5);
  if (!s.length) return '';
  const max = Math.max(0.01, ...s.map(x => Math.abs(x.r)));
  const downs = s.filter(x => x.r < 0).length;
  const w = r.worst;
  let sub = `${downs === 5 ? 'All five' : downs === 0 ? 'None' : downs === 1 ? 'One' : downs} of the last five trading days ended lower.`;
  if (w && w.r < 0) sub += ` ${weekday(w.t)} was the hardest, ${pct(w.r)}${w.vr >= 1.5 ? `, with ${times(w.vr)} the usual trading` : ''}.`;
  if (r.since && Date.now() / 1000 - r.since > 180 * 86400) sub += ` Its worst week since ${monthYear(r.since)}.`;
  return `<h3>Day by day</h3><p class="sub">${sub}</p>
    <div class="days" role="img" aria-label="Change on each of the last five trading days">${s.map(x => {
      const hgt = (Math.abs(x.r) / max) * 100;
      return `<div class="day" title="${fullDate(x.t)}: ${pct(x.r)}"><span class="day-r ${signClass(x.r)}">${pct(x.r)}</span>
        <span class="day-up">${x.r > 0 ? `<span style="height:calc(${hgt}% - 2px)"></span>` : ''}</span>
        <span class="day-dn">${x.r < 0 ? `<span style="height:calc(${hgt}% - 2px)"></span>` : ''}</span>
        <span class="day-d">${shortDay(x.t)}</span></div>`;
    }).join('')}</div>`;
}

function recordPanel(r) {
  const steady = r.r2 == null ? 'n/a' : r.r2 >= 0.85 ? 'Very steady' : r.r2 >= 0.6 ? 'Steady' : r.r2 >= 0.4 ? 'Some ups and downs' : 'Bumpy';
  const earn = r.earn ? `${fullDate(r.earn)}${r.earn * 1000 > Date.now() ? '' : ' (last)'}` : 'n/a';
  const rows = [
    ['Growth per year, 3 years before', r.cagr != null ? pct(r.cagr) : 'n/a'],
    ['How steady that climb was', steady],
    ['Normal move in a week', r.sigma5 != null ? '±' + pctAbs(r.sigma5) : 'n/a'],
    ['Below its high of the past year', r.fromHigh != null ? pctAbs(r.fromHigh) : 'n/a'],
    ['Company value', cap(r.mcap, r.cur)],
    ['Price to earnings', r.pe ? r.pe.toFixed(1) : 'n/a'],
    ['What analysts say', r.rating ? esc(r.rating.replace(/^([\d.]+) - (.*)$/, '$2')) : 'n/a'],
    ['Earnings report', earn],
  ];
  return `<h3>Before this week</h3><p class="sub">The track record Nadir judged it on.</p><div class="rows">${rows.map(([k, v]) => `<div class="row"><span>${k}</span><span>${v}</span></div>`).join('')}</div>`;
}

function scorePanel(r) {
  const q = Math.round((r.qual ?? 0) * 100), b = Math.round((r.shock ?? 0) * 100);
  return `<h3>Nadir score</h3>
    <div class="score-line"><span class="big">${r.score}</span><small>out of 100</small></div>
    <div class="meter"><span>Strong record</span><span class="meter-t"><span style="width:${q}%"></span></span><b>${q}</b></div>
    <div class="meter"><span>Sharp fall</span><span class="meter-t"><span style="width:${b}%"></span></span><b>${b}</b></div>
    <p class="note">${scoreNote(r)}</p>`;
}

function wireSheet(sym) {
  const sheet = $('#sheet');
  sheet.querySelector('[data-close]').onclick = () => { location.hash = '#/'; };
  sheet.querySelector('#s-watch').onclick = e => {
    toggleWatch(sym);
    const on = state.watch.has(sym), b = e.currentTarget;
    b.setAttribute('aria-pressed', String(on));
    b.querySelector('i').className = `${on ? 'ph-fill' : 'ph'} ph-star`;
    b.querySelector('span').textContent = on ? 'Watching' : 'Watch';
  };
  sheet.onscroll = () => sheet.classList.toggle('scrolled', sheet.scrollTop > 90);
}

function fillSheet(sym, r, h, token) {
  const sheet = $('#sheet');
  const chartEl = sheet.querySelector('#s-chart'), legend = sheet.querySelector('#s-legend');
  const draw = async range => {
    sheet.querySelectorAll('.ranges button').forEach(b => b.setAttribute('aria-checked', String(b.dataset.v === range)));
    store.set('nadir.range2', range);
    if (range === '1W') {
      legend.innerHTML = '<span><i class="ma"></i>Price before the week</span>';
      chartEl._cleanup?.();
      chartEl.innerHTML = '<span class="chart-wait sk-block"></span>';
      try {
        const d = await (await fetch('/api/intraday/' + encodeURIComponent(sym))).json();
        if (token !== sheetToken) return;
        priceChart(chartEl, { t: d.t, c: d.c, intraday: true, base: d.prev ?? d.c[0], showBase: true, cur: r.cur, label: `${r.n}, past week` });
      } catch { chartEl.innerHTML = '<p class="sub">This chart isn’t available right now.</p>'; }
      return;
    }
    const k = RANGES[range];
    const from = Math.max(0, h.c.length - (k === Infinity ? h.c.length : k + 1));
    legend.innerHTML = '<span><i class="band"></i>This week</span>';
    priceChart(chartEl, { t: h.t.slice(from), c: h.c.slice(from), band: r.preT, cur: r.cur, label: `${r.n}, ${range}` });
  };
  sheet.querySelector('.ranges').onclick = e => { const b = e.target.closest('button'); if (b) draw(b.dataset.v); };
  draw(store.get('nadir.range2', '3M'));
  renderPast(sheet.querySelector('#s-past'), r, h);
}

function renderPast(box, r, h) {
  if (r.w1 >= -0.03) { box.innerHTML = '<h3>After earlier falls</h3><p class="sub">This week’s move is too small to compare with earlier falls.</p>'; return; }
  const prec = h.prec ?? [];
  const sum = precedentSummary(prec, r.w1);
  const thr = pctAbs(Math.min(r.w1 * 0.75, -0.04), 0);
  if (!prec.length) {
    box.innerHTML = `<h3>After earlier falls</h3><p class="sub">In ${Math.round(r.yrs)} years, ${esc(r.n)} never fell this hard in a week before. There is nothing to compare with.</p>`;
    return;
  }
  const idx = new Map(h.t.map((t, i) => [t, i]));
  const limit = h.c.length - 6;
  const paths = prec.map(p => {
    const j = idx.get(p.t);
    if (j == null) return null;
    const path = [];
    for (let d = 0; d <= 126 && j + d <= limit; d++) path.push(h.c[j + d] / h.c[j] - 1);
    return { path };
  }).filter(p => p && p.path.length > 5);
  const stat = (v, l, cls = '') => `<div class="stat"><div class="stat-v ${cls}">${v}</div><div class="stat-l">${l}</div></div>`;
  box.innerHTML = `<h3>After earlier falls</h3>
    <p class="sub">${esc(r.n)} fell ${thr} or more in a week ${prec.length === 1 ? 'once' : prec.length + ' times'} in the past ${Math.round(r.yrs)} years.${sum ? ` Three months later it was higher ${sum.up63} of ${sum.n63} times.` : ''}</p>
    ${sum ? `<div class="stats">${stat(`${sum.up63} of ${sum.n63}`, 'times it was higher three months later')}${stat(pct(sum.med21), 'typical change after one month', signClass(sum.med21))}${stat(pct(sum.med63), 'typical change after three months', signClass(sum.med63))}</div>` : ''}
    <div class="chart chart-paths" id="s-paths"></div>
    <div class="legend"><span><i class="faint"></i>Each earlier fall</span><span><i></i>Typical path</span></div>
    <div class="rows plist">${[...prec].reverse().slice(0, 6).map(p => `<div class="row"><span>${fullDate(p.t)}</span><span><span class="down">${pct(p.r)}</span><span class="${signClass(p.f63)}">${p.f63 == null ? 'n/a' : pct(p.f63) + ' after 3 months'}</span></span></div>`).join('')}</div>
    <p class="note">The past is a small sample and markets change. This shows how the stock behaved before, not what it will do.</p>`;
  pathsChart(box.querySelector('#s-paths'), paths);
}

// ── Routing & watchlist ─────────────────────────────────────────────────────

const open = sym => { location.hash = '#/s/' + encodeURIComponent(sym); };
function route() {
  const m = location.hash.match(/^#\/s\/(.+)$/);
  if (m) openSheet(decodeURIComponent(m[1]).toUpperCase());
  else if (state.sheetSym) closeSheet();
}

function toggleWatch(sym) {
  if (state.watch.has(sym)) state.watch.delete(sym); else state.watch.add(sym);
  store.set('nadir.watch', [...state.watch]);
  const b = $(`#grid .star[data-star="${CSS.escape(sym)}"]`);
  if (b) {
    const on = state.watch.has(sym);
    b.setAttribute('aria-pressed', String(on));
    b.setAttribute('aria-label', `${on ? 'Remove from' : 'Add to'} watchlist: ${rowFor(sym)?.n ?? sym}`);
    b.querySelector('i').className = `${on ? 'ph-fill' : 'ph'} ph-star`;
  }
  if (state.filters.view === 'watch') schedule();
}

// ── Search ──────────────────────────────────────────────────────────────────

function setupSearch() {
  const input = $('#q'), list = $('#q-list'), wrap = input.closest('.search');
  let items = [], sel = 0, ctrl = null, t = 0;
  const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); };
  const paint = (note = '') => {
    list.innerHTML = items.map((it, i) => {
      const r = rowFor(it.s);
      return `<li role="option" id="opt-${i}" data-s="${esc(it.s)}" aria-selected="${i === sel}">${logoHTML({ s: it.s, n: it.n })}
        <span class="q-name">${esc(it.n)}</span><span class="q-sym">${esc(it.s)}${it.exch ? ' · ' + esc(it.exch) : ''}</span>
        ${r ? `<span class="q-val ${signClass(r.w1)}">${pct(r.w1)}</span>` : ''}</li>`;
    }).join('') + (note ? `<li class="q-note">${note}</li>` : '');
    list.hidden = !items.length && !note;
    input.setAttribute('aria-expanded', String(!list.hidden));
    input.setAttribute('aria-activedescendant', items.length ? 'opt-' + sel : '');
  };
  const choose = s => { if (!s) return; input.value = ''; close(); input.blur(); open(s); };
  input.addEventListener('focus', () => wrap.classList.add('open'));
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    clearTimeout(t);
    if (!q) { items = []; close(); return; }
    const all = [...state.rows.values(), ...state.extra.values()];
    items = all.filter(r => r.s.toLowerCase().startsWith(q) || r.n.toLowerCase().includes(q))
      .sort((a, b) => (b.s.toLowerCase() === q) - (a.s.toLowerCase() === q) || b.n.toLowerCase().startsWith(q) - a.n.toLowerCase().startsWith(q))
      .slice(0, 5).map(r => ({ s: r.s, n: r.n, exch: r.exch }));
    sel = 0;
    paint(q.length >= 2 ? 'Searching all listed companies…' : '');
    if (q.length < 2) return;
    t = setTimeout(async () => {
      ctrl?.abort(); ctrl = new AbortController();
      try {
        const remote = await (await fetch('/api/search?q=' + encodeURIComponent(q), { signal: ctrl.signal })).json();
        const seen = new Set(items.map(i => i.s));
        items = items.concat(remote.filter(x => !seen.has(x.s))).slice(0, 8);
        paint(items.length ? '' : 'No company found with that name.');
      } catch (e) { if (e.name !== 'AbortError') paint(items.length ? '' : 'Search isn’t available right now.'); }
    }, 180);
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!items.length) return;
      sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      paint();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(items[sel]?.s ?? (input.value.trim() ? input.value.trim().toUpperCase() : null));
    } else if (e.key === 'Escape') { input.value = ''; close(); input.blur(); }
  });
  list.addEventListener('mousedown', e => { const li = e.target.closest('li[data-s]'); if (li) { e.preventDefault(); choose(li.dataset.s); } });
  input.addEventListener('blur', () => setTimeout(() => { close(); if (!input.value) wrap.classList.remove('open'); }, 120));
}

// ── Wiring ──────────────────────────────────────────────────────────────────

function setup() {
  // White logos vanish on white tiles: sample the image and give light ones a dark tile.
  document.addEventListener('load', e => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || !img.classList.contains('logo') || img.dataset.checked) return;
    img.dataset.checked = '1';
    try {
      const c = document.createElement('canvas'); c.width = c.height = 24;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0, 24, 24);
      const d = g.getImageData(0, 0, 24, 24).data;
      let sum = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 40) { sum += (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11); n++; }
      if (n > 20 && sum / n > 225) img.classList.add('on-dark');
    } catch { /* cross-origin or decode issue: leave as is */ }
  }, true);

  // Logos that fail fall back to a coloured monogram.
  document.addEventListener('error', e => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || !img.classList.contains('logo')) return;
    const span = document.createElement('span');
    span.className = img.className + ' mono';
    span.style.background = img.dataset.hue;
    span.textContent = img.dataset.mono || '?';
    span.setAttribute('aria-hidden', 'true');
    img.replaceWith(span);
  }, true);

  document.addEventListener('click', e => {
    const b = e.target.closest('[data-key] button');
    if (b) {
      const key = b.closest('[data-key]').dataset.key, v = b.dataset.v;
      setFilter(key, ['drop', 'growth'].includes(key) ? Number(v) : v);
      if (key === 'view' && v === 'watch') ensureWatchRows();
      return;
    }
    if (e.target.closest('[data-loosen]')) setFilter('drop', 0.03);
  });
  $('#sector').addEventListener('change', e => setFilter('sector', e.target.value));
  $('#sort').addEventListener('change', e => {
    const key = e.target.value;
    state.sort = { key, dir: ASC_FIRST.has(key) ? 1 : -1 };
    store.set('nadir.sort3', state.sort);
    renderGrid();
  });
  $('#filters-btn').addEventListener('click', openFilters);
  $('#filters-done').addEventListener('click', closeFilters);
  $('#filters-reset').addEventListener('click', () => {
    state.sort = { key: 'score', dir: -1 };
    store.set('nadir.sort3', state.sort);
    for (const k of ['drop', 'growth', 'region', 'sector']) state.filters[k] = DEFAULT_FILTERS[k];
    setFilter('drop', DEFAULT_FILTERS.drop);
  });
  scrim.addEventListener('click', () => { if (!$('#filters').hidden) closeFilters(); else if (state.sheetSym) location.hash = '#/'; });

  const grid = $('#grid');
  grid.addEventListener('click', e => {
    const star = e.target.closest('[data-star]');
    if (star) { toggleWatch(star.dataset.star); return; }
    const c = e.target.closest('.card[data-s]');
    if (c) { e.preventDefault(); open(c.dataset.s); }
  });
  let hoverT = 0;
  grid.addEventListener('pointerover', e => {
    const c = e.target.closest('.card[data-s]');
    if (!c) return;
    clearTimeout(hoverT);
    hoverT = setTimeout(() => getHistory(c.dataset.s).catch(() => {}), 80);
  });

  const themeBtn = $('#theme');
  const syncTheme = () => {
    const dark = document.documentElement.dataset.theme === 'dark';
    themeBtn.innerHTML = `<i class="ph ${dark ? 'ph-sun' : 'ph-moon'}" aria-hidden="true"></i>`;
    themeBtn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
    document.querySelector('meta[name="theme-color"]').content = dark ? '#000000' : '#f5f5f7';
  };
  syncTheme();
  themeBtn.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('nadir.theme', next); } catch {}
    syncTheme();
    if (state.sheetSym) openSheet(state.sheetSym);
  });

  document.addEventListener('keydown', e => {
    const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName);
    if (e.key === '/' && !typing) { e.preventDefault(); $('#q').focus(); return; }
    if (e.key === 'Escape') { if (!$('#filters').hidden) { closeFilters(); return; } if (state.sheetSym) { location.hash = '#/'; return; } }
    if (typing || e.metaKey || e.ctrlKey || e.altKey || state.sheetSym || !$('#filters').hidden) return;
    const n = state.visible.length;
    if ((e.key === 'j' || e.key === 'k') && n) {
      state.cursor = Math.max(0, Math.min(n - 1, state.cursor + (e.key === 'j' ? 1 : -1)));
      const cards = $$('#grid .card[data-s]');
      cards.forEach((c, i) => c.classList.toggle('is-cursor', i === state.cursor));
      cards[state.cursor]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      if (cards[state.cursor]) getHistory(cards[state.cursor].dataset.s).catch(() => {});
    } else if ((e.key === 'Enter' || e.key === 'o') && state.visible[state.cursor]) open(state.visible[state.cursor].s);
    else if (e.key === 'w' && state.visible[state.cursor]) toggleWatch(state.visible[state.cursor].s);
  });

  window.addEventListener('hashchange', route);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && Date.now() - state.asOf > POLL_MS) stream(); });
  setInterval(() => { if (document.visibilityState === 'visible') stream(); }, POLL_MS);
}

// ── Boot ────────────────────────────────────────────────────────────────────

setup();
setupSearch();
if (!COLD && restoreCache()) state.entered = true;
render();
route();
if (state.watch.size) ensureWatchRows();
stream();
