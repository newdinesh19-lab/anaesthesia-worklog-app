/**
 * thanc.js — pure logic for the THANC duty tracker (no DOM, no storage). Records live in the encrypted
 * 'templates' store with type 'thanc' (one record per date + shift), so backup/restore/PIN change cover them
 * and no database upgrade is needed. Patient case records are never touched.
 */
const Thanc = (() => {
  const HOSPITAL = 'THANC';
  const SHIFTS = [
    { id: 'morning', label: 'Morning', start: '08:00', end: '14:00', tone: 'am' },
    { id: 'evening', label: 'Evening', start: '14:00', end: '20:00', tone: 'pm' },
    { id: 'night', label: 'Night', start: '20:00', end: '08:00', tone: 'nt' },
  ];
  const ROSTER = ['Dr. Dinesh', 'Dr. Arafath', 'Dr. Karthik', 'Dr. Vignesh'];
  const DEFAULTS = () => ({ roster: [...ROSTER], shifts: { morning: { doctors: ['Dr. Dinesh', 'Dr. Arafath'], start: '08:00', end: '14:00' }, evening: { doctors: [], start: '14:00', end: '20:00' }, night: { doctors: ['Dr. Karthik', 'Dr. Vignesh'], start: '20:00', end: '08:00' } } });
  /** Merge saved settings over the defaults (missing pieces never break). */
  const config = (saved) => { const d = DEFAULTS(); const s = saved || {}; const out = { roster: Array.isArray(s.roster) && s.roster.length ? [...s.roster] : d.roster, shifts: {} };
    for (const sh of SHIFTS) out.shifts[sh.id] = { ...d.shifts[sh.id], ...((s.shifts || {})[sh.id] || {}) };
    return out; };
  const shiftMeta = (id) => SHIFTS.find((s) => s.id === id);
  const isThanc = (t) => !!t && t.type === 'thanc';
  const idFor = (date, shift) => `thanc-${date}-${shift}`;
  const clean = (n) => String(n || '').replace(/\s+/g, ' ').trim();
  const uniq = (arr) => { const seen = new Set(), out = []; for (const x of arr.map(clean)) { const k = x.toLowerCase(); if (x && !seen.has(k)) { seen.add(k); out.push(x); } } return out; };
  const shortName = (n) => clean(n).replace(/^dr\.?\s*/i, '');
  const initials = (n) => { const p = shortName(n).split(' ').filter(Boolean); return ((p[0] || '?')[0] + (p[1] ? p[1][0] : '')).toUpperCase(); };
  const newRecord = (date, shift, cfg, now = new Date().toISOString()) => { const d = (cfg || config()).shifts[shift];
    return { tpl_id: idFor(date, shift), type: 'thanc', name: `THANC ${shift} ${date}`, created_at: now, updated_at: now, uses: 0, deleted_at: null,
      data: { dutyId: idFor(date, shift), hospital: HOSPITAL, date, shiftType: shift, assignedDoctors: [...d.doctors], startTime: d.start, endTime: d.end, notes: '' } }; };
  /** Normalised view of a stored record. */
  const norm = (rec) => { const d = rec.data || {}; return { rec, id: rec.tpl_id, hospital: d.hospital || HOSPITAL, date: d.date, shift: d.shiftType, doctors: uniq(d.assignedDoctors || []), start: d.startTime || '', end: d.endTime || '', notes: d.notes || '', createdAt: rec.created_at, updatedAt: rec.updated_at }; };
  const recordsOf = (templates) => templates.filter(isThanc).filter((t) => !t.deleted_at).map(norm).filter((r) => r.date && shiftMeta(r.shift));
  const order = (s) => SHIFTS.findIndex((x) => x.id === s);
  const sortAsc = (a, b) => a.date.localeCompare(b.date) || order(a.shift) - order(b.shift);
  const forDate = (recs, date) => recs.filter((r) => r.date === date).sort(sortAsc);
  const inMonth = (recs, ym) => recs.filter((r) => r.date.startsWith(ym));
  /** Doctor-wise duty counts. Returns {rows:[{doctor,morning,evening,night,total}], totals:{...}} */
  const summary = (recs) => { const m = new Map(); const totals = { morning: 0, evening: 0, night: 0, total: 0 };
    for (const r of recs) for (const doc of r.doctors) { const k = doc.toLowerCase(); const row = m.get(k) || { doctor: doc, morning: 0, evening: 0, night: 0, total: 0 }; row[r.shift]++; row.total++; m.set(k, row); totals[r.shift]++; totals.total++; }
    return { rows: [...m.values()].sort((a, b) => b.total - a.total || a.doctor.localeCompare(b.doctor)), totals }; };
  const monthLabelOf = (ym) => ym;
  /** Search by doctor name and/or date text (2026-11, 2026-11-05, or "5 nov"). */
  const MONS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const search = (recs, q) => { const words = clean(q).toLowerCase().split(' ').filter(Boolean); if (!words.length) return [...recs].sort(sortAsc).reverse();
    return recs.filter((r) => { const [y, mo, da] = r.date.split('-'); const hay = [r.date, `${Number(da)} ${MONS[Number(mo) - 1]}`, `${MONS[Number(mo) - 1]} ${y}`, r.shift, r.notes, ...r.doctors].join(' ').toLowerCase(); return words.every((w) => hay.includes(w)); }).sort(sortAsc).reverse(); };
  const csvCell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const HEAD = ['Date', 'Hospital', 'Shift', 'Start', 'End', 'Doctors', 'Notes'];
  const rows = (recs) => [...recs].sort(sortAsc).map((r) => [r.date, r.hospital, shiftMeta(r.shift).label, r.start, r.end, r.doctors.join('; '), r.notes]);
  const toCSV = (recs) => '﻿' + [HEAD, ...rows(recs)].map((r) => r.map(csvCell).join(',')).join('\r\n');
  const summaryCSV = (recs) => { const s = summary(recs); return '﻿' + [['Doctor', 'Morning', 'Evening', 'Night', 'Total'], ...s.rows.map((r) => [r.doctor, r.morning, r.evening, r.night, r.total]), ['TOTAL', s.totals.morning, s.totals.evening, s.totals.night, s.totals.total]].map((r) => r.map(csvCell).join(',')).join('\r\n'); };
  /** Hours between two HH:MM (end <= start means next day). */
  const hours = (s, e) => { if (!s || !e) return 0; const [a, b] = [s, e].map((t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; }); return ((b - a + 1440) % 1440 || 1440) / 60; };
  const fmtTime = (t) => { if (!t) return '—'; const [hh, mm] = t.split(':').map(Number); return `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}`; };
  return { HOSPITAL, SHIFTS, ROSTER, DEFAULTS, config, shiftMeta, isThanc, idFor, uniq, clean, shortName, initials, newRecord, norm, recordsOf, forDate, inMonth, summary, search, toCSV, summaryCSV, rows, HEAD, hours, fmtTime, sortAsc };
})();
if (typeof module !== 'undefined') module.exports = Thanc;
