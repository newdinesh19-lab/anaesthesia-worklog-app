/** stats.js — factual aggregates only. */
function byDay(cases) { const m = new Map(); for (const c of cases) { if (!m.has(c.case_date)) m.set(c.case_date, []); m.get(c.case_date).push(c); } return m; }
function dailySummary(day, roster) {
  const by = {}; for (const n of roster) by[n] = 0;
  for (const c of day) by[c.anaesthetist] = (by[c.anaesthetist] || 0) + 1;
  return { total: day.length, byAnaesthetist: by };
}
function monthlyStats(cases, roster) {
  const days = byDay(cases);
  const counts = [...days.values()].map((a) => a.length);
  const by = {}; for (const n of roster) by[n] = 0;
  const byConsultant = {}, byHospital = {}, byLocation = {}, byDateCount = {}, byMode = {}, bySurgery = {};
  let notableCount = 0;
  const bump = (o, k) => { o[k] = (o[k] || 0) + 1; };
  for (const c of cases) {
    bump(by, c.anaesthetist);
    if (c.consultant) bump(byConsultant, c.consultant);
    if (c.hospital) bump(byHospital, c.hospital);
    if (c.location) bump(byLocation, c.location);
    if (c.anaesthesia_mode) bump(byMode, c.anaesthesia_mode);
    if (c.surgery && c.surgery.trim()) bump(bySurgery, c.surgery.trim());
    if (c.notable) notableCount++;
    bump(byDateCount, c.case_date);
  }
  return {
    totalCases: cases.length, workingDays: days.size,
    avgPerDay: days.size ? Math.round((cases.length / days.size) * 100) / 100 : 0,
    maxPerDay: counts.length ? Math.max(...counts) : 0, minPerDay: counts.length ? Math.min(...counts) : 0,
    byAnaesthetist: by, byConsultant, byHospital, byLocation, byDateCount, byMode, bySurgery, notableCount,
    consultantCount: Object.keys(byConsultant).length,
  };
}
function consultantByAnaesthetist(cases) {
  const o = {};
  for (const c of cases) { if (!c.consultant) continue; o[c.consultant] = o[c.consultant] || {}; o[c.consultant][c.anaesthetist] = (o[c.consultant][c.anaesthetist] || 0) + 1; }
  return o;
}
function buildInsights(st, label, nightDuties) {
  const l = [];
  l.push(`${st.totalCases} total cases recorded${label ? ' in ' + label : ''}.`);
  for (const [n, c] of Object.entries(st.byAnaesthetist)) l.push(`${c} case${c === 1 ? '' : 's'} assigned to ${n}.`);
  l.push(`Cases were recorded on ${st.workingDays} working day${st.workingDays === 1 ? '' : 's'}.`);
  l.push(`Average recorded cases per working day: ${st.avgPerDay}.`);
  l.push(`Highest number of cases on a single day: ${st.maxPerDay}.`);
  l.push(`Lowest number of cases on a single day: ${st.minPerDay}.`);
  const top = Object.entries(st.byConsultant).sort((a, b) => b[1] - a[1])[0];
  if (top) l.push(`${top[0]} was associated with the most cases (${top[1]}).`);
  l.push(`Number of different consultants/surgeons: ${st.consultantCount}.`);
  if (st.notableCount) l.push(`${st.notableCount} case${st.notableCount === 1 ? '' : 's'} marked as notable.`);
  if (nightDuties) l.push(`Night duties recorded: ${nightDuties}.`);
  return l;
}
const StatsModule = { byDay, dailySummary, monthlyStats, consultantByAnaesthetist, buildInsights };
if (typeof module !== 'undefined' && module.exports) module.exports = StatsModule;
if (typeof window !== 'undefined') window.Stats = StatsModule;
