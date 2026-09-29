// Number and date formatting. Negative numbers use a true minus sign (−),
// every change carries its sign, so direction never depends on colour alone.

const MINUS = '−';
const nf = new Map();
const fmtr = (key, opts) => { if (!nf.has(key)) nf.set(key, new Intl.NumberFormat('en-US', opts)); return nf.get(key); };

export function pct(x, dp = 1, { sign = true } = {}) {
  if (x == null || !isFinite(x)) return 'n/a';
  const v = Math.abs(x * 100);
  const s = v.toFixed(dp);
  if (+s === 0) return (0).toFixed(dp) + '%';
  return (x < 0 ? MINUS : sign ? '+' : '') + s + '%';
}

export const pctAbs = (x, dp = 1) => pct(Math.abs(x), dp, { sign: false });

export function signClass(x) { return x == null ? '' : x < 0 ? 'down' : x > 0 ? 'up' : ''; }

export function price(v, cur = 'USD') {
  if (v == null || !isFinite(v)) return 'n/a';
  if (cur === 'GBp' || cur === 'GBX') return fmtr('gbp', { maximumFractionDigits: 1 }).format(v) + 'p';
  const dp = ['JPY', 'KRW'].includes(cur) ? 0 : v >= 1000 ? 0 : 2;
  try {
    return fmtr('p' + cur + dp, { style: 'currency', currency: cur, currencyDisplay: 'narrowSymbol', minimumFractionDigits: dp, maximumFractionDigits: dp })
      .format(v).replace('-', MINUS);
  } catch {
    return v.toFixed(dp);
  }
}

export function cap(v, cur = 'USD') {
  if (!v) return 'n/a';
  const c = cur === 'GBp' ? 'GBP' : cur;
  try {
    return fmtr('cap' + c, { style: 'currency', currency: c, currencyDisplay: 'narrowSymbol', notation: 'compact', maximumFractionDigits: 1 }).format(v);
  } catch { return fmtr('capn', { notation: 'compact' }).format(v); }
}

export const times = (x, dp = 1) => (x == null || !isFinite(x) ? 'n/a' : x.toFixed(dp) + '×');
export const sigma = z => (z == null || !isFinite(z) ? 'n/a' : (z < 0 ? MINUS : '+') + Math.abs(z).toFixed(1) + 'σ');

const d = (t, opts) => new Date(t * 1000).toLocaleDateString('en-GB', opts);
export const weekday = t => d(t, { weekday: 'long' });
export const shortDay = t => d(t, { weekday: 'short' });
export const dayMonth = t => d(t, { day: 'numeric', month: 'short' });
export const fullDate = t => d(t, { day: 'numeric', month: 'short', year: 'numeric' });
export const monthYear = t => d(t, { month: 'long', year: 'numeric' });
export const clock = t => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

export function ago(ms) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 45) return 'just now';
  if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + ' h ago';
  return Math.round(s / 86400) + ' d ago';
}

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function yearsLabel(y) {
  if (y == null) return '';
  if (y >= 2.9) return 'three years';
  if (y >= 1.9) return 'two years';
  return 'the past year';
}
