/**
 * analytics.js — factual aggregates for the dashboard, portfolio, procedure logbook and reports.
 * Pure functions (no DOM, no database). Counts describe YOUR OWN workload and exposure; they are not
 * quality-of-care indicators and the UI says so wherever they are shown.
 */
const Analytics = (() => {
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
  const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const PRESETS = [['today', 'Today'], ['7d', '7 days'], ['month', 'This month'], ['ytd', 'Year to date'], ['year', 'This year'], ['fy', 'This FY'], ['all', 'All time'], ['custom', 'Custom']];
  /** -> { from, to, label } with '' meaning open-ended. Financial year = 1 Apr – 31 Mar (India). */
  function rangeFor(preset, now = new Date(), custom = {}) {
    const t = iso(now), y = now.getFullYear(), m = now.getMonth();
    switch (preset) {
      case 'today': return { from: t, to: t, label: 'Today' };
      case '7d': return { from: addDays(t, -6), to: t, label: 'Last 7 days' };
      case 'month': return { from: `${y}-${pad(m + 1)}-01`, to: iso(new Date(y, m + 1, 0)), label: `${MONTH_ABBR[m]} ${y}` };
      case 'ytd': return { from: `${y}-01-01`, to: t, label: `Year to date ${y}` };
      case 'year': return { from: `${y}-01-01`, to: `${y}-12-31`, label: String(y) };
      case 'fy': { const sy = m >= 3 ? y : y - 1; return { from: `${sy}-04-01`, to: `${sy + 1}-03-31`, label: `FY ${sy}–${String(sy + 1).slice(2)}` }; }
      case 'custom': return { from: custom.from || '', to: custom.to || '', label: custom.from || custom.to ? `${custom.from || '…'} → ${custom.to || '…'}` : 'All time' };
      default: return { from: '', to: '', label: 'All time' };
    }
  }
  const inRange = (d, r) => !!d && (!r || ((!r.from || d >= r.from) && (!r.to || d <= r.to)));

  function count(items, keyFn) { const o = {}; for (const it of items) { const ks = [].concat(keyFn(it)).filter((k) => k !== '' && k != null && k !== false); for (const k of ks) o[k] = (o[k] || 0) + 1; } return o; }
  const entries = (o) => Object.entries(o).sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
  const ORDERED = (keys, o) => keys.filter((k) => o[k]).map((k) => [k, o[k]]);
  const splitNames = (s) => String(s || '').split('/').map((x) => x.trim()).filter(Boolean);

  /** The one place that turns cases into the numbers shown on the dashboard and in reports. */
  function caseSummary(cases, opts = {}) {
    const S = Schema;
    const total = cases.length;
    const urgency = count(cases, (c) => c.urgency || 'Not recorded');
    const asaCount = count(cases, (c) => c.asa || 'Not recorded');
    const tech = count(cases, (c) => S.techniquesOf(c));
    const combined = cases.filter((c) => S.techniquesOf(c).length > 1).length;
    const specSurg = count(cases, (c) => S.specialityOf(c).value || 'Unclassified');
    const cats = count(cases, (c) => S.categoriesOf(c, opts));
    const age = count(cases, (c) => { const a = Number(c.age); if (c.age === '' || c.age == null || !Number.isFinite(a)) return 'Age not recorded'; return a < (opts.paedAgeMax ?? 16) ? 'Paediatric' : a >= (opts.geriatricAgeMin ?? 65) ? 'Geriatric' : 'Adult'; });
    const complexity = count(cases, (c) => c.complexity || 'Not recorded');
    const consultants = count(cases, (c) => splitNames(c.consultant));
    const hospitals = count(cases, (c) => c.hospital || 'Not recorded');
    const destinations = count(cases, (c) => (c.postop || {}).destination || '');
    const icuHdu = cases.filter(S.isHighDependency).length;
    const withComp = cases.filter((c) => S.complicationsOf(c).length);
    const compTypes = count(cases, (c) => S.complicationsOf(c));
    const eventTypes = count(cases, (c) => S.eventsOf(c));
    const known = (urgency.Elective || 0) + (urgency.Emergency || 0);
    const cov = (fn) => (total ? Math.round((cases.filter(fn).length / total) * 100) : 0);
    return {
      total, urgency, emergency: urgency.Emergency || 0, elective: urgency.Elective || 0, urgencyKnown: known,
      emergencyPct: known ? Math.round(((urgency.Emergency || 0) / known) * 100) : null,
      asa: asaCount, techniques: tech, combinedCount: combined, speciality: specSurg, categories: cats, ageGroups: age, complexity, consultants, hospitals, destinations, icuHdu,
      complicationCases: withComp.length, complicationTypes: compTypes, eventTypes, notable: cases.filter((c) => c.notable).length, difficultAirway: cases.filter((c) => (c.airway || {}).difficult).length,
      coverage: { asa: cov((c) => c.asa), urgency: cov((c) => c.urgency), technique: cov((c) => S.techniquesOf(c).length), speciality: cov((c) => S.specialityOf(c).value), detailed: cov(S.hasDetail) },
    };
  }

  function procSummary(procs) {
    const byProc = count(procs, (p) => p.procedure);
    const byRole = count(procs, (p) => p.role);
    const usGuided = procs.filter((p) => p.us_guided || p.procedure === 'Ultrasound-guided procedure').length;
    const unsuccessful = procs.filter((p) => p.success === false).length;
    const withComp = procs.filter((p) => (p.complications || []).some((x) => x !== 'None')).length;
    return { total: procs.length, byProc, byRole, usGuided, unsuccessful, withComplication: withComp };
  }
  /** Monthly counts for one calendar year -> array of 12. */
  function monthSeries(items, dateKey, year) {
    const out = Array(12).fill(0);
    for (const it of items) { const d = it[dateKey] || ''; if (d.slice(0, 4) === String(year)) out[Number(d.slice(5, 7)) - 1]++; }
    return out;
  }
  /** Daily counts for the n days ending at `end` (inclusive). */
  function daySeries(items, dateKey, end, n) {
    const days = []; for (let i = n - 1; i >= 0; i--) days.push(addDays(end, -i));
    const m = {}; for (const it of items) m[it[dateKey]] = (m[it[dateKey]] || 0) + 1;
    return days.map((d) => [d, m[d] || 0]);
  }
  function workload(cases, duties, procs, range) {
    const c = cases.filter((x) => inRange(x.case_date, range)), d = duties.filter((x) => inRange(x.date, range)), p = procs.filter((x) => inRange(x.date, range));
    const byDay = count(c, (x) => x.case_date); const days = Object.keys(byDay).length;
    const busiest = entries(byDay)[0] || null;
    return { cases: c.length, workingDays: days, avgPerWorkingDay: days ? Math.round((c.length / days) * 10) / 10 : 0, busiest: busiest ? { date: busiest[0], count: busiest[1] } : null, nightDuties: d.length, procedures: p.length };
  }
  /** Years that have any data (descending), always including the current one. */
  function yearsWithData(items, dateKey, now = new Date()) {
    const s = new Set([String(now.getFullYear())]); for (const it of items) if ((it[dateKey] || '').length >= 4) s.add(it[dateKey].slice(0, 4));
    return [...s].sort().reverse();
  }
  /** Short stable code for a case in de-identified exports (does not reveal the id or any patient detail). */
  function anonCode(id, prefix = 'C') { let h = 2166136261; for (const ch of String(id)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return `${prefix}-${h.toString(36).toUpperCase().padStart(6, '0').slice(0, 6)}`; }
  const ageBand = (a) => { const n = Number(a); if (a === '' || a == null || !Number.isFinite(n)) return ''; if (n < 1) return '<1 y'; if (n < 16) return '1–15 y'; if (n < 40) return '16–39 y'; if (n < 65) return '40–64 y'; return '65+ y'; };

  return { PRESETS, MONTH_ABBR, rangeFor, inRange, count, entries, ORDERED, splitNames, caseSummary, procSummary, monthSeries, daySeries, workload, yearsWithData, anonCode, ageBand, addDays, iso };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Analytics;
if (typeof window !== 'undefined') window.Analytics = Analytics;
