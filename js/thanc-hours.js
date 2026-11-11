/**
 * thanc-hours.js — pure working-hours engine (no DOM, no storage).
 * Everything is whole minutes on a timezone-free calendar (UTC day numbers), so DST and floating-point never matter.
 * Actual start/end times are always used; a fixed shift length is never assumed.
 */
const ThancHours = (() => {
  const HM = /^([01]\d|2[0-3]):([0-5]\d)$/;
  const parseHM = (t) => { const m = HM.exec(String(t || '').trim()); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
  const dayNo = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); if (!m) return null; const [y, mo, d] = [+m[1], +m[2], +m[3]]; const t = Date.UTC(y, mo - 1, d); const c = new Date(t); return c.getUTCMonth() === mo - 1 && c.getUTCDate() === d ? t / 864e5 : null; };
  const isoOfDay = (n) => new Date(n * 864e5).toISOString().slice(0, 10);
  const ymOfDay = (n) => isoOfDay(n).slice(0, 7);
  const WARN_SHORT = 30, WARN_LONG = 16 * 60;
  /** One duty interval. status: ok | missing | invalid. End at/before start means the next day; end === start is invalid. */
  function interval(date, start, end) {
    const dn = dayNo(date); if (dn === null) return { status: 'invalid', reason: 'invalid date', minutes: 0 };
    if (!start || !end) return { status: 'missing', reason: !start && !end ? 'start and end time missing' : !start ? 'start time missing' : 'end time missing', minutes: 0 };
    const s = parseHM(start), e = parseHM(end);
    if (s === null || e === null) return { status: 'invalid', reason: 'unreadable time', minutes: 0 };
    if (s === e) return { status: 'invalid', reason: 'start equals end', minutes: 0 };
    const a = dn * 1440 + s, b = dn * 1440 + e + (e < s ? 1440 : 0);
    const minutes = b - a;
    return { status: 'ok', startMin: a, endMin: b, minutes, overnight: e < s, warn: minutes < WARN_SHORT ? 'short' : minutes > WARN_LONG ? 'long' : null };
  }
  /** Split [a,b) minutes at every local midnight and sum per calendar month → [{ym, minutes}] */
  function splitByMonth(a, b) {
    const out = new Map();
    for (let d = Math.floor(a / 1440); d * 1440 < b; d++) { const lo = Math.max(a, d * 1440), hi = Math.min(b, (d + 1) * 1440); if (hi > lo) { const k = ymOfDay(d); out.set(k, (out.get(k) || 0) + (hi - lo)); } }
    return [...out].map(([ym, minutes]) => ({ ym, minutes }));
  }
  // ---- periods: month 'YYYY-MM', quarter 'YYYY-Q1..4' (calendar), year 'YYYY', fy 'YYYY' = April YYYY – March YYYY+1
  const pad = (n) => String(n).padStart(2, '0');
  function months(kind, key) {
    if (kind === 'month') return [key];
    if (kind === 'quarter') { const [y, q] = key.split('-Q').map(Number); return [0, 1, 2].map((i) => `${y}-${pad((q - 1) * 3 + 1 + i)}`); }
    if (kind === 'year') return Array.from({ length: 12 }, (_, i) => `${key}-${pad(i + 1)}`);
    if (kind === 'fy') { const y = Number(key); return Array.from({ length: 12 }, (_, i) => { const m = ((3 + i) % 12) + 1; return `${m >= 4 ? y : y + 1}-${pad(m)}`; }); }
    return [];
  }
  function range(kind, key) { const ms = months(kind, key); const [y, m] = ms[ms.length - 1].split('-').map(Number); return { from: ms[0] + '-01', to: `${ms[ms.length - 1]}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`, months: ms }; }
  function keyOf(kind, iso) { const [y, m] = iso.split('-').map(Number); if (kind === 'month') return iso.slice(0, 7); if (kind === 'quarter') return `${y}-Q${Math.ceil(m / 3)}`; if (kind === 'year') return String(y); if (kind === 'fy') return String(m >= 4 ? y : y - 1); return ''; }
  function shiftKey(kind, key, delta) {
    if (kind === 'month') { const [y, m] = key.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1 + delta, 1)); return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}`; }
    if (kind === 'quarter') { const [y, q] = key.split('-Q').map(Number); const n = y * 4 + (q - 1) + delta; return `${Math.floor(n / 4)}-Q${(n % 4) + 1}`; }
    return String(Number(key) + delta);
  }
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function label(kind, key) {
    if (kind === 'month') { const [y, m] = key.split('-').map(Number); return `${MON[m - 1]} ${y}`; }
    if (kind === 'quarter') return key.replace('-Q', ' Q');
    if (kind === 'fy') return `FY ${key}–${String(Number(key) + 1).slice(2)}`;
    return key;
  }
  const hoursDec = (min) => Math.round((min / 60) * 100) / 100;
  const fmt = (min) => { min = Math.round(min); const h = Math.floor(min / 60), m = min % 60; return m ? `${h}h ${m}m` : `${h}h`; };
  return { parseHM, dayNo, isoOfDay, interval, splitByMonth, months, range, keyOf, shiftKey, label, hoursDec, fmt, WARN_SHORT, WARN_LONG };
})();
if (typeof module !== 'undefined') module.exports = ThancHours;
