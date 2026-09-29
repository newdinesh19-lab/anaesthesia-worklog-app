/**
 * stats.js — daily / monthly aggregation and plain-factual insights.
 * Pure functions over an array of case objects (already filtered to
 * non-deleted). No invented clinical conclusions — everything here is a
 * direct count/aggregate of stored fields.
 */

function byDay(cases) {
  const map = new Map();
  for (const c of cases) {
    if (!map.has(c.case_date)) map.set(c.case_date, []);
    map.get(c.case_date).push(c);
  }
  return map;
}

function dailySummary(casesForDay, roster) {
  const total = casesForDay.length;
  const byAnaesthetist = {};
  for (const name of roster) byAnaesthetist[name] = 0;
  for (const c of casesForDay) {
    byAnaesthetist[c.anaesthetist] = (byAnaesthetist[c.anaesthetist] || 0) + 1;
  }
  return { total, byAnaesthetist };
}

function monthlyStats(cases, roster) {
  const days = byDay(cases);
  const dayCounts = [...days.values()].map((arr) => arr.length);
  const workingDays = days.size;
  const totalCases = cases.length;
  const avgPerDay = workingDays ? Math.round((totalCases / workingDays) * 100) / 100 : 0;

  const byAnaesthetist = {};
  for (const name of roster) byAnaesthetist[name] = 0;
  const byConsultant = {};
  const byHospital = {};
  const byLocation = {};
  const byDateCount = {};

  for (const c of cases) {
    byAnaesthetist[c.anaesthetist] = (byAnaesthetist[c.anaesthetist] || 0) + 1;
    if (c.consultant) byConsultant[c.consultant] = (byConsultant[c.consultant] || 0) + 1;
    if (c.hospital) byHospital[c.hospital] = (byHospital[c.hospital] || 0) + 1;
    if (c.location) byLocation[c.location] = (byLocation[c.location] || 0) + 1;
    byDateCount[c.case_date] = (byDateCount[c.case_date] || 0) + 1;
  }

  return {
    totalCases,
    workingDays,
    avgPerDay,
    maxPerDay: dayCounts.length ? Math.max(...dayCounts) : 0,
    minPerDay: dayCounts.length ? Math.min(...dayCounts) : 0,
    byAnaesthetist,
    byConsultant,
    byHospital,
    byLocation,
    byDateCount,
    consultantCount: Object.keys(byConsultant).length,
  };
}

/** Consultant x anaesthetist cross-tab, e.g. stats.byConsultantAndAnaesthetist['Dr. X']['MY NAME'] = 5 */
function consultantByAnaesthetist(cases) {
  const out = {};
  for (const c of cases) {
    if (!c.consultant) continue;
    out[c.consultant] = out[c.consultant] || {};
    out[c.consultant][c.anaesthetist] = (out[c.consultant][c.anaesthetist] || 0) + 1;
  }
  return out;
}

/** Plain factual insight sentences, strictly derived from the stats object. */
function buildInsights(stats, monthLabel) {
  const lines = [];
  lines.push(`${stats.totalCases} total cases recorded${monthLabel ? ' in ' + monthLabel : ''}.`);
  for (const [name, count] of Object.entries(stats.byAnaesthetist)) {
    lines.push(`${count} case${count === 1 ? '' : 's'} assigned to ${name}.`);
  }
  lines.push(`Cases were recorded on ${stats.workingDays} working day${stats.workingDays === 1 ? '' : 's'}.`);
  lines.push(`Average recorded cases per working day: ${stats.avgPerDay}.`);
  lines.push(`Highest number of cases on a single day: ${stats.maxPerDay}.`);
  lines.push(`Lowest number of cases on a single day: ${stats.minPerDay}.`);
  const topConsultants = Object.entries(stats.byConsultant).sort((a, b) => b[1] - a[1]);
  if (topConsultants.length) {
    const [name, count] = topConsultants[0];
    lines.push(`${name} was associated with the most cases (${count}).`);
  }
  lines.push(`Number of different consultants/surgeons: ${stats.consultantCount}.`);
  return lines;
}

const StatsModule = { byDay, dailySummary, monthlyStats, consultantByAnaesthetist, buildInsights };
if (typeof module !== 'undefined' && module.exports) {
  module.exports = StatsModule;
}
if (typeof window !== 'undefined') {
  window.Stats = StatsModule;
}
