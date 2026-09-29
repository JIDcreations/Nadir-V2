// Turns a raw daily price history into the numbers Nadir reasons with.
// Everything "long-term" is measured up to the close *before* the crash window,
// so a stock is judged on the years it had, not on the week it's having.

const DAY = 86400;
export const WINDOW = 5; // the crash window, in trading sessions

const clamp = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
const mean = a => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const std = a => { const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))); };
const sig = x => (x == null || !isFinite(x) ? null : Number(x.toPrecision(5)));

// Drop null bars Yahoo sometimes returns (halts, holidays in partial data).
export function cleanSeries(result) {
  const ts = result?.timestamp ?? [];
  const q = result?.indicators?.quote?.[0] ?? {};
  const t = [], c = [], v = [];
  for (let i = 0; i < ts.length; i++) {
    const close = q.close?.[i];
    if (close == null || !(close > 0)) continue;
    t.push(ts[i]); c.push(close); v.push(q.volume?.[i] ?? 0);
  }
  return { t, c, v };
}

// Least-squares fit of ln(price) over time: slope sign + R² tell us whether the
// climb was a steady trend or a lottery ticket.
function trendFit(c, from, to) {
  const ys = [], xs = [];
  for (let i = from; i <= to; i++) { xs.push(i - from); ys.push(Math.log(c[i])); }
  const mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  const slope = sxy / (sxx || 1);
  const r2 = syy ? (sxy * sxy) / (sxx * syy) : 0;
  return { slope, r2 };
}

export function analyze(series, extra = {}) {
  const { t, c, v } = series;
  const n = c.length;
  if (n < 60) return null;

  const last = c[n - 1];
  const pre = n - 1 - WINDOW;
  const R = k => (n - 1 - k >= 0 ? last / c[n - 1 - k] - 1 : null);

  const lr = [0];
  for (let i = 1; i < n; i++) lr.push(Math.log(c[i] / c[i - 1]));

  // Typical weekly swing, measured on the two years before the crash window.
  const sd = std(lr.slice(Math.max(1, pre - 504), pre + 1));
  const sigma5 = sd * Math.sqrt(WINDOW);
  const w1 = R(WINDOW);
  const z = sigma5 ? Math.log(1 + w1) / sigma5 : 0;

  // Long-term record, frozen at the close before the fall.
  const k3 = Math.min(756, pre);
  const yrs = k3 / 252;
  const cagr = yrs >= 1 ? (c[pre] / c[pre - k3]) ** (1 / yrs) - 1 : null;
  const fit = trendFit(c, pre - k3, pre);
  const y1pre = pre >= 252 ? c[pre] / c[pre - 252] - 1 : null;
  const hiPre = Math.max(...c.slice(Math.max(0, pre - 252), pre + 1));
  const nearHighPre = c[pre] / hiPre;

  const hi52 = Math.max(...c.slice(Math.max(0, n - 252)));
  const lo52 = Math.min(...c.slice(Math.max(0, n - 252)));
  const ma200 = n >= 200 ? mean(c.slice(n - 200)) : null;
  const ma50 = n >= 50 ? mean(c.slice(n - 50)) : null;

  const volNow = mean(v.slice(n - WINDOW));
  const volBase = mean(v.slice(Math.max(0, n - 65), n - WINDOW));
  const volR = volBase ? volNow / volBase : null;

  // Session-by-session anatomy of the last two weeks.
  const last10 = [];
  for (let i = Math.max(1, n - 10); i < n; i++) {
    last10.push({ t: t[i], c: sig(c[i]), r: sig(c[i] / c[i - 1] - 1), v: v[i], vr: volBase ? sig(v[i] / volBase) : null });
  }
  let worst = null;
  for (let i = n - WINDOW; i < n; i++) {
    const r = c[i] / c[i - 1] - 1;
    if (!worst || r < worst.r) worst = { t: t[i], r: sig(r), vr: volBase ? sig(v[i] / volBase) : null };
  }

  // "Worst week since ..." — last time a 5-session return was this bad.
  let since = null;
  if (w1 < 0) {
    for (let j = pre; j >= WINDOW; j--) {
      if (c[j] / c[j - WINDOW] - 1 <= w1) { since = t[j]; break; }
    }
  }

  // Precedents: earlier falls of comparable size, and what happened next.
  const prec = [];
  if (w1 < -0.03) {
    const thr = Math.min(w1 * 0.75, -0.04);
    for (let j = WINDOW; j < n - WINDOW - 1; j++) {
      const r = c[j] / c[j - WINDOW] - 1;
      if (r > thr) continue;
      const fwd = k => (j + k < n - WINDOW ? sig(c[j + k] / c[j] - 1) : null);
      prec.push({ t: t[j], r: sig(r), f21: fwd(21), f63: fwd(63), f126: fwd(126) });
      j += 20; // one episode per month, so a single crash isn't counted five times
    }
  }

  // Nadir score: geometric mean of "was it good?" and "did it just break?".
  const cq = clamp((cagr ?? 0) / 0.4);
  const q = cagr != null && cagr > 0
    ? 0.5 * cq + 0.3 * (fit.slope > 0 ? fit.r2 : 0) + 0.2 * clamp((nearHighPre - 0.7) / 0.3)
    : 0.1 * clamp((nearHighPre - 0.7) / 0.3);
  const s = w1 < 0 ? 0.55 * clamp((-w1 - 0.02) / 0.18) + 0.45 * clamp((-z - 0.5) / 2.5) : 0;
  const score = Math.round(100 * Math.sqrt(q * s));

  // 1-year sparkline, every other session, ending on the latest close.
  const spark = [];
  for (let i = n - 1; i >= Math.max(0, n - 252); i -= 2) spark.unshift(sig(c[i]));

  const earn = extra.earningsTs ?? null;
  const earningsInWindow = earn != null && earn >= t[pre] - DAY && earn <= t[n - 1] + DAY;

  return {
    px: sig(last), asOf: t[n - 1], preT: t[pre],
    d1: sig(R(1)), w1: sig(w1), m1: sig(R(21)), m3: sig(R(63)), y1: sig(R(252)),
    y3: sig(R(756)), y5: sig(c[n - 1] / c[0] - 1), yrs: sig((t[n - 1] - t[0]) / (365.25 * DAY)),
    cagr: sig(cagr), y1pre: sig(y1pre), r2: sig(fit.r2), slope: sig(fit.slope),
    sigma5: sig(sigma5), z: sig(z), nearHighPre: sig(nearHighPre),
    hi52: sig(hi52), lo52: sig(lo52), fromHigh: sig(last / hi52 - 1),
    ma200: sig(ma200), ma50: sig(ma50), volR: sig(volR),
    worst, since, prec, last10, spark,
    qual: sig(q), shock: sig(s), score,
    earn, earningsInWindow,
  };
}

// Why did it fall? A best-effort read of the week from price data alone.
export function classify(a, marketW1, sectorW1) {
  if (!a || a.w1 >= 0) return null;
  if (a.earningsInWindow) return 'earnings';
  const rel = a.w1 - (marketW1 ?? 0);
  if (marketW1 != null && marketW1 <= -0.035 && rel > -0.04) return 'market';
  if (sectorW1 != null && sectorW1 <= -0.045 && a.w1 - sectorW1 > -0.04) return 'sector';
  if (a.worst && a.worst.r <= -0.06 && (a.worst.vr ?? 0) >= 2) return 'shock';
  return 'drift';
}
