// Writes the copy. Every sentence is derived from the numbers, and a sentence
// is dropped rather than padded when the data can't support it.

import { pct, pctAbs, price, weekday, monthYear, fullDate, times, yearsLabel, esc } from './format.js';

export const CAUSE = {
  earnings: "After its results",
  market:   "Whole market fell",
  sector:   "Its industry fell",
  shock:    "One sharp drop day",
  drift:    "Company-specific",
};

export const MARKET_NAME = { US: 'S&P 500', EU: 'Euro Stoxx 50', ASIA: 'Nikkei 225' };

const yearsAgo = t => (Date.now() / 1000 - t) / (365.25 * 86400);

function sinceClause(r) {
  if (r.since && yearsAgo(r.since) >= 0.5) return `its worst week since ${monthYear(r.since)}`;
  if (!r.since && r.w1 < 0 && r.yrs >= 4.5) return 'its worst week in five years';
  return null;
}

export function headline(r) {
  const n = r.n;
  const drop = pctAbs(r.w1);
  const since = sinceClause(r);
  const span = Math.min(3, Math.floor(r.yrs || 0));
  const run = span >= 2 ? `${['', 'one', 'two', 'three'][span]}-year` : 'year-long';
  if (r.w1 >= 0) return `${n} holds its ground`;
  if (since && r.cause === 'earnings') return `${n} has ${since} after results`;
  if (since) return `${n} suffers ${since}`;
  if (r.cause === 'earnings') return `${n} slides ${drop} after its latest results`;
  if (r.cause === 'shock') return `${n} loses ${drop}, most of it in a single session`;
  if (r.cause === 'market') return `${n} falls ${drop} as the market retreats`;
  if (r.cause === 'sector') return `${n} gives back ${drop} in a sector-wide pullback`;
  if (r.cagr >= 0.15) return `${n} gives back ${drop}, denting a ${run} climb`;
  return `${n} falls ${drop} in five sessions`;
}

// One-line summary for lists.
export function oneLiner(r) {
  const parts = [];
  if (r.cagr != null) parts.push(`${pct(r.cagr, 0)} a year before this`);
  if (r.cause) parts.push(CAUSE[r.cause].toLowerCase());
  return parts.join('; ');
}

export function standfirst(r, bench) {
  const out = [];
  const drop = pctAbs(r.w1);
  out.push(`Shares fell <b>${drop}</b> over the past five sessions to ${price(r.px, r.cur)}.`);

  if (r.worst && r.worst.r < 0 && Math.abs(r.worst.r) >= Math.abs(r.w1) * 0.45) {
    const vol = r.worst.vr >= 1.6 ? ` on ${times(r.worst.vr)} normal volume` : '';
    out.push(`The heaviest blow came on ${weekday(r.worst.t)}, a ${pctAbs(r.worst.r)} drop${vol}.`);
  }

  if (r.earningsInWindow && r.earn) out.push(`The company reported results on ${fullDate(r.earn)}.`);

  if (r.z != null && r.z <= -1.5) {
    out.push(`That is about ${Math.abs(r.z).toFixed(1)} times what it normally moves in a week.`);
  }

  const mw = r.marketW1;
  if (mw != null) {
    const mname = MARKET_NAME[r.reg] ?? 'the market';
    const moved = Math.abs(mw) < 0.005 ? 'barely moved' : mw < 0 ? `fell ${pctAbs(mw)}` : `rose ${pctAbs(mw)}`;
    const verdict = r.w1 - mw <= -0.03
      ? 'so this one is mostly about the company.'
      : 'so the broader market did much of the damage.';
    out.push(`The ${mname} ${moved} over the same stretch, ${verdict}`);
  }

  if (r.cagr != null) {
    const steady = r.r2 >= 0.85 ? ', in an unusually steady climb' : r.r2 < 0.45 ? ', though the path was choppy' : '';
    const hi = r.fromHigh != null && r.fromHigh < -0.01 ? ` It now sits ${pctAbs(r.fromHigh)} below its 52-week high.` : '';
    out.push(`Before this week it had grown about <b>${pctAbs(r.cagr, 0)} a year</b> for ${yearsLabel(Math.min(3, r.yrs))}${steady}.${hi}`);
  }
  return out.join(' ');
}

export function kicker(r, sectors) {
  const parts = [esc(sectors[r.sec] ?? 'Watchlist'), esc(r.exch || r.reg)];
  if (r.cause) parts.push(`<span class="cause">${CAUSE[r.cause]}</span>`);
  return parts.join('<span class="sep">/</span>');
}

export function scoreNote(r) {
  if (r.score >= 45) return 'Both halves are strong: a real record, and a real break from it.';
  if (r.qual >= 0.6 && r.shock < 0.3) return 'A strong record, but the fall is modest for this stock so far.';
  if (r.shock >= 0.6 && r.qual < 0.35) return 'A sharp fall, but the record going in is thin. Treat with care.';
  if (r.w1 >= 0) return 'No fall this week, so there is nothing to score yet.';
  return 'A partial match: one half of the story is weaker than the other.';
}

export function precedentSummary(prec, w1) {
  const done = prec.filter(p => p.f63 != null);
  if (!done.length) return null;
  const med = arr => { const s = [...arr].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const f21 = done.filter(p => p.f21 != null).map(p => p.f21);
  const f63 = done.map(p => p.f63);
  return {
    n: prec.length,
    thr: Math.min(w1 * 0.75, -0.04),
    up63: f63.filter(x => x > 0).length,
    n63: f63.length,
    med21: f21.length ? med(f21) : null,
    med63: med(f63),
  };
}
