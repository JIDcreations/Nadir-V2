// Hand-drawn SVG charts in a calm, Apple Stocks-like style: thin lines,
// soft gradient fills, a quiet grid, and a floating tooltip. No library.

import { price, pct, dayMonth, fullDate, esc } from './format.js';

const tip = () => document.getElementById('tip');
const f1 = n => Math.round(n * 10) / 10;
let gid = 0;

export function showTip(html, x, y) {
  const el = tip();
  el.innerHTML = html;
  el.hidden = false;
  const w = el.offsetWidth;
  el.style.left = Math.max(w / 2 + 10, Math.min(window.innerWidth - w / 2 - 10, x)) + 'px';
  el.style.top = Math.max(el.offsetHeight + 24, y) + 'px';
}
export const hideTip = () => { tip().hidden = true; };

function niceTicks(lo, hi, count) {
  const raw = (hi - lo) / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const f = raw / mag;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;
  const ticks = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) ticks.push(+v.toPrecision(12));
  return { ticks, step };
}
const axisNum = (v, step) => v.toLocaleString('en-US', { maximumFractionDigits: step >= 1 ? 0 : step >= 0.1 ? 1 : 2, minimumFractionDigits: step >= 1 ? 0 : step >= 0.1 ? 1 : 2 });

function mount(el, draw) {
  el._cleanup?.();
  let raf = 0;
  const ro = new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(draw); });
  ro.observe(el);
  draw();
  el._cleanup = () => { ro.disconnect(); cancelAnimationFrame(raf); el.onpointermove = el.onpointerleave = null; hideTip(); };
}

const gradient = (id, color, top = 0.22) =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:${color};stop-opacity:${top}"/><stop offset="1" style="stop-color:${color};stop-opacity:0"/></linearGradient>`;

// ── Card chart (string) ────────────────────────────────────────────────────
// Six months in quiet grey; the past week drawn in red with a soft red fill.
export function cardChart(values, { level = null, hl = 3, span = 63, dir = -1 } = {}) {
  const v = (values || []).filter(x => x != null).slice(-span);
  if (v.length < 3) return '';
  const W = 320, H = 84, padT = 6, padB = 4;
  let lo = Math.min(...v), hi = Math.max(...v);
  if (level != null) { lo = Math.min(lo, level); hi = Math.max(hi, level); }
  const pad = (hi - lo) * 0.08 || hi * 0.01;
  lo -= pad; hi += pad;
  const X = i => f1((i / (v.length - 1)) * (W - 8) + 2);
  const Y = x => f1(padT + (1 - (x - lo) / (hi - lo)) * (H - padT - padB));
  const cut = Math.max(0, v.length - 1 - hl);
  const pts = v.map((x, i) => [X(i), Y(x)]);
  const line = a => a.map((p, i) => (i ? 'L' : 'M') + p[0] + ',' + p[1]).join('');
  const hot = pts.slice(cut);
  const color = dir < 0 ? 'var(--red-line)' : 'var(--green-line)';
  const id = 'cg' + (++gid);
  const last = pts[pts.length - 1];
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><defs>${gradient(id, color, 0.28)}${gradient(id + 'g', 'var(--text-3)', 0.14)}</defs>`
    + `<path d="${line(pts.slice(0, cut + 1))}L${pts[cut][0]},${H}L${pts[0][0]},${H}Z" fill="url(#${id}g)"/>`
    + `<path d="${line(hot)}L${last[0]},${H}L${hot[0][0]},${H}Z" fill="url(#${id})"/>`
    + (level != null ? `<path d="M0,${Y(level)}H${W}" stroke="var(--text-3)" stroke-width="1" stroke-dasharray="2 4" opacity="0.6" vector-effect="non-scaling-stroke"/>` : '')
    + `<path d="${line(pts.slice(0, cut + 1))}" fill="none" stroke="var(--text-3)" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`
    + `<path d="${line(hot)}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`
    + `</svg><span class="end-dot" style="left:${(last[0] / W) * 100}%;top:${(last[1] / H) * 100}%;background:${color}"></span>`;
}

// ── Price chart ─────────────────────────────────────────────────────────────
export function priceChart(el, o) {
  const { t, c } = o;
  const n = c.length;
  if (n < 2) { el.innerHTML = '<p class="note">Not enough data for this range.</p>'; return; }
  const base = o.base ?? c[0];
  const up = c[n - 1] >= base;
  const color = up ? 'var(--green-line)' : 'var(--red-line)';
  const bandFrom = o.band != null ? t.findIndex(x => x >= o.band) : -1;
  const id = 'pg' + (++gid);
  let geom = null;

  const draw = () => {
    const W = el.clientWidth, H = el.clientHeight;
    if (!W || !H) return;
    const padR = 44, padT = 18, padB = 24;
    const plotW = W - padR, plotH = H - padT - padB;
    let lo = Math.min(...c, o.showBase ? base : Infinity), hi = Math.max(...c, o.showBase ? base : -Infinity);
    const pv = (hi - lo) * 0.1 || hi * 0.02;
    lo -= pv; hi += pv;
    const { ticks, step } = niceTicks(lo, hi, Math.max(2, Math.round(plotH / 64)));
    const X = i => (i / (n - 1)) * plotW;
    const Y = v => padT + (1 - (v - lo) / (hi - lo)) * plotH;

    let s = `<svg width="${W}" height="${H}" role="img" aria-label="${esc(o.label || 'Price chart')}"><defs>${gradient(id, color, 0.2)}</defs>`;
    for (const tk of ticks) {
      const y = f1(Y(tk));
      if (y < padT - 2 || y > padT + plotH + 2) continue;
      s += `<line x1="0" x2="${plotW}" y1="${y}" y2="${y}" stroke="var(--sep)" stroke-width="1"/>`;
      s += `<text x="${plotW + 8}" y="${y + 4}" class="tick-label">${axisNum(tk, step)}</text>`;
    }
    if (bandFrom >= 0) {
      const bx = X(bandFrom);
      s += `<rect x="${f1(bx)}" y="${padT - 14}" width="${f1(plotW - bx + 4)}" height="${f1(plotH + 14)}" rx="8" fill="var(--red-soft)"/>`;
      s += `<text x="${f1(plotW - 4)}" y="${padT - 3}" text-anchor="end" class="axis-label">This week</text>`;
    }
    if (o.showBase) s += `<line x1="0" x2="${plotW}" y1="${f1(Y(base))}" y2="${f1(Y(base))}" stroke="var(--text-3)" stroke-dasharray="2 4"/>`;

    const spanDays = (t[n - 1] - t[0]) / 86400;
    const key = ts => {
      const d = new Date(ts * 1000);
      if (o.intraday) return d.toDateString();
      if (spanDays > 800) return d.getFullYear();
      if (spanDays > 70) return d.getFullYear() * 12 + d.getMonth();
      return Math.floor((ts / 86400 + 3) / 7);
    };
    const label = ts => {
      const d = new Date(ts * 1000);
      if (o.intraday) return d.toLocaleDateString('en-GB', { weekday: 'short' });
      if (spanDays > 800) return String(d.getFullYear());
      if (spanDays > 70) return d.toLocaleDateString('en-GB', { month: 'short' });
      return dayMonth(ts);
    };
    let marks = [];
    for (let i = 1; i < n; i++) if (key(t[i]) !== key(t[i - 1])) marks.push(i);
    const maxT = Math.max(2, Math.floor(plotW / 70));
    if (marks.length > maxT) { const k = Math.ceil(marks.length / maxT); marks = marks.filter((_, j) => j % k === 0); }
    for (const i of marks) s += `<text x="${f1(X(i))}" y="${H - 5}" text-anchor="middle" class="tick-label">${label(t[i])}</text>`;

    const pts = c.map((v, i) => f1(X(i)) + ',' + f1(Y(v)));
    s += `<path d="M${pts.join('L')}L${f1(X(n - 1))},${padT + plotH}L0,${padT + plotH}Z" fill="url(#${id})"/>`;
    s += `<path d="M${pts.join('L')}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    s += `<circle cx="${f1(X(n - 1))}" cy="${f1(Y(c[n - 1]))}" r="4" fill="${color}" stroke="var(--surface)" stroke-width="2"/>`;
    s += `<g class="xh" visibility="hidden"><line y1="${padT}" y2="${padT + plotH}" stroke="var(--text-3)" stroke-width="1"/><circle r="5.5" fill="${color}" stroke="var(--surface)" stroke-width="2.5"/></g></svg>`;
    el.innerHTML = s;
    geom = { X, Y, plotW, svg: el.firstChild };
  };
  mount(el, draw);

  el.onpointermove = e => {
    if (!geom) return;
    const rect = geom.svg.getBoundingClientRect();
    const px = e.clientX - rect.left;
    if (px < 0 || px > geom.plotW + 2) { el.onpointerleave(); return; }
    const i = Math.max(0, Math.min(n - 1, Math.round((px / geom.plotW) * (n - 1))));
    const x = geom.X(i), y = geom.Y(c[i]);
    const g = geom.svg.querySelector('.xh');
    g.setAttribute('visibility', 'visible');
    g.firstChild.setAttribute('x1', x); g.firstChild.setAttribute('x2', x);
    g.lastChild.setAttribute('cx', x); g.lastChild.setAttribute('cy', y);
    const when = o.intraday
      ? new Date(t[i] * 1000).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' })
      : fullDate(t[i]);
    const chg = c[i] / base - 1;
    showTip(`<b>${price(c[i], o.cur)}</b><span class="${chg < 0 ? 't-down' : 't-up'}">${pct(chg)}</span> <span class="muted">${when}</span>`, rect.left + x, rect.top + y);
  };
  el.onpointerleave = () => { geom?.svg.querySelector('.xh')?.setAttribute('visibility', 'hidden'); hideTip(); };
}

// ── After earlier falls: each path from its fall, plus the median ──────────
export function pathsChart(el, paths, { days = 126 } = {}) {
  if (!paths.length) { el.innerHTML = ''; return; }
  const median = [];
  for (let d = 0; d <= days; d++) {
    const vals = paths.map(p => p.path[d]).filter(x => x != null).sort((a, b) => a - b);
    if (vals.length < Math.max(2, Math.ceil(paths.length / 2))) break;
    const m = vals.length >> 1;
    median.push({ d, m: vals.length % 2 ? vals[m] : (vals[m - 1] + vals[m]) / 2, n: vals.length });
  }
  const all = paths.flatMap(p => p.path);
  let lo = Math.min(0, ...all), hi = Math.max(0, ...all);
  const pv = (hi - lo) * 0.06; lo -= pv; hi += pv;
  let geom = null;

  const draw = () => {
    const W = el.clientWidth, H = el.clientHeight;
    if (!W || !H) return;
    const padL = 40, padR = 6, padT = 8, padB = 24;
    const pw = W - padL - padR, ph = H - padT - padB;
    const X = d => padL + (d / days) * pw;
    const Y = v => padT + (1 - (v - lo) / (hi - lo)) * ph;
    let s = `<svg width="${W}" height="${H}" role="img" aria-label="Price paths after ${paths.length} earlier falls">`;
    const { ticks } = niceTicks(lo, hi, Math.max(2, Math.round(ph / 50)));
    for (const tk of ticks) {
      const y = f1(Y(tk));
      s += `<line x1="${padL}" x2="${padL + pw}" y1="${y}" y2="${y}" stroke="${tk === 0 ? 'var(--text-3)' : 'var(--sep)'}" ${tk === 0 ? 'stroke-dasharray="2 4"' : ''}/>`;
      s += `<text x="${padL - 8}" y="${y + 4}" text-anchor="end" class="tick-label">${pct(tk, 0, { sign: tk > 0 })}</text>`;
    }
    for (const [d, lab] of [[0, 'Fall'], [21, '1 month'], [63, '3 months'], [126, '6 months']]) {
      s += `<text x="${f1(X(d))}" y="${H - 5}" text-anchor="${d === 0 ? 'start' : d === days ? 'end' : 'middle'}" class="tick-label">${lab}</text>`;
    }
    for (const p of paths) s += `<path d="M${p.path.map((v, i) => f1(X(i)) + ',' + f1(Y(v))).join('L')}" fill="none" stroke="var(--text-3)" stroke-width="1.2" opacity="0.35"/>`;
    if (median.length > 1) {
      const up = median[median.length - 1].m >= 0;
      s += `<path d="M${median.map(p => f1(X(p.d)) + ',' + f1(Y(p.m))).join('L')}" fill="none" stroke="${up ? 'var(--green-line)' : 'var(--red-line)'}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
    }
    s += `<g class="xh" visibility="hidden"><line y1="${padT}" y2="${padT + ph}" stroke="var(--text-3)"/><circle r="5" fill="var(--accent)" stroke="var(--surface)" stroke-width="2"/></g></svg>`;
    el.innerHTML = s;
    geom = { X, Y, pw, padL, svg: el.firstChild };
  };
  mount(el, draw);

  el.onpointermove = e => {
    if (!geom || !median.length) return;
    const rect = geom.svg.getBoundingClientRect();
    const d = Math.round(((e.clientX - rect.left - geom.padL) / geom.pw) * days);
    const p = median[Math.max(0, Math.min(median.length - 1, d))];
    const g = geom.svg.querySelector('.xh');
    const x = geom.X(p.d), y = geom.Y(p.m);
    g.setAttribute('visibility', 'visible');
    g.firstChild.setAttribute('x1', x); g.firstChild.setAttribute('x2', x);
    g.lastChild.setAttribute('cx', x); g.lastChild.setAttribute('cy', y);
    showTip(`<b class="${p.m < 0 ? 't-down' : 't-up'}">${pct(p.m)}</b><span class="muted">typical change ${p.d} trading days later</span>`, rect.left + x, rect.top + y);
  };
  el.onpointerleave = () => { geom?.svg.querySelector('.xh')?.setAttribute('visibility', 'hidden'); hideTip(); };
}
