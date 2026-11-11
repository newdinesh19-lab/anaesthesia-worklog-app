/**
 * thanc.js — pure logic for the THANC duty tracker (no DOM, no storage).
 * Records live in the encrypted 'templates' store with type 'thanc' (one per date + shift), so backup / restore /
 * PIN change cover them and no database upgrade is needed. Patient case records are never touched.
 * v2 additions are all optional fields, so v1 records (no schemaV) keep working untouched:
 *   data.doctorTimes {name:{start,end}}  per-doctor timing overrides
 *   data.audit []                         change history   | record.deleted_at = soft delete (history kept)
 *   data.importedFrom {store,id,batch}    set on records copied from the old personal night-duty list
 */
const Thanc = (() => {
  const H = (typeof ThancHours !== 'undefined') ? ThancHours : require('./thanc-hours.js');
  const HOSPITAL = 'THANC';
  const SCHEMA_V = 2;
  const SHIFTS = [
    { id: 'morning', label: 'Morning', start: '08:00', end: '14:00', tone: 'am' },
    { id: 'evening', label: 'Evening', start: '14:00', end: '20:00', tone: 'pm' },
    { id: 'night', label: 'Night', start: '20:00', end: '08:00', tone: 'nt' },
  ];
  const ROSTER = ['Dr. Dinesh', 'Dr. Arafath', 'Dr. Karthik', 'Dr. Vignesh'];
  const DEFAULTS = () => ({ roster: [...ROSTER], aliases: {}, inactive: [], shifts: {
    morning: { doctors: ['Dr. Dinesh', 'Dr. Arafath'], start: '08:00', end: '14:00' },
    evening: { doctors: [], start: '14:00', end: '20:00' },
    night: { doctors: ['Dr. Karthik', 'Dr. Vignesh', 'Dr. Dinesh', 'Dr. Arafath'], start: '20:00', end: '08:00' } } });
  const clean = (n) => String(n || '').replace(/\s+/g, ' ').trim();
  /** "Dr. Dinesh", "dr dinesh", "Dinesh" → same key "dinesh" */
  const canonKey = (n) => clean(n).toLowerCase().replace(/^(dr|doctor)\b\.?\s*/, '').replace(/[.\-_']/g, ' ').replace(/\s+/g, ' ').trim();
  const display = (n) => { const s = clean(n).replace(/^(dr|doctor)\b\.?\s*/i, '').trim(); return s ? 'Dr. ' + s.split(' ').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ') : ''; };
  /** Saved settings merged over defaults; anything missing falls back, so old settings never break. */
  const config = (saved) => { const d = DEFAULTS(); const s = saved || {}; const out = { roster: Array.isArray(s.roster) && s.roster.length ? [...s.roster] : d.roster, aliases: { ...(s.aliases || {}) }, inactive: [...(s.inactive || [])], shifts: {} };
    for (const sh of SHIFTS) out.shifts[sh.id] = { ...d.shifts[sh.id], ...((s.shifts || {})[sh.id] || {}) };
    return out; };
  /** name → canonical display name (roster spelling, aliases applied). */
  const resolver = (cfg) => { const map = new Map(); for (const n of (cfg || config()).roster) map.set(canonKey(n), display(n)); for (const [a, to] of Object.entries((cfg || config()).aliases || {})) map.set(canonKey(a), display(to));
    return (name) => map.get(canonKey(name)) || display(name); };
  const uniq = (arr, resolve) => { const r = resolve || ((x) => display(x)); const seen = new Set(), out = []; for (const x of arr.map(clean)) { const n = r(x); const k = canonKey(n); if (n && !seen.has(k)) { seen.add(k); out.push(n); } } return out; };
  const shiftMeta = (id) => SHIFTS.find((s) => s.id === id);
  const isThanc = (t) => !!t && t.type === 'thanc';
  const isImportBatch = (t) => !!t && t.type === 'thanc-import';
  const isThancAny = (t) => isThanc(t) || isImportBatch(t);
  const idFor = (date, shift) => `thanc-${date}-${shift}`;
  const shortName = (n) => clean(n).replace(/^dr\.?\s*/i, '');
  const initials = (n) => { const p = shortName(n).split(' ').filter(Boolean); return ((p[0] || '?')[0] + (p[1] ? p[1][0] : '')).toUpperCase(); };
  const idOk = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '') && H.dayNo(d) !== null;

  // ------------------------------------------------------------------ records
  const newRecord = (date, shift, cfg, now = new Date().toISOString()) => { const c = (cfg || config()).shifts[shift];
    return { tpl_id: idFor(date, shift), type: 'thanc', name: `THANC ${shift} ${date}`, created_at: now, updated_at: now, uses: 0, deleted_at: null,
      data: { dutyId: idFor(date, shift), hospital: HOSPITAL, date, shiftType: shift, assignedDoctors: [...c.doctors], startTime: c.start, endTime: c.end, notes: '', doctorTimes: {}, schemaV: SCHEMA_V, audit: [] } }; };
  const timesOf = (d, name, resolve) => { const dt = d.doctorTimes || {}; const k = canonKey(name); for (const [n, v] of Object.entries(dt)) if (canonKey(n) === k && v) return { start: v.start || d.startTime || '', end: v.end || d.endTime || '', custom: true }; return { start: d.startTime || '', end: d.endTime || '', custom: false }; };
  /** Normalised view of a stored record (v1 and v2 alike). */
  const norm = (rec, resolve) => { const d = rec.data || {}; const doctors = uniq(d.assignedDoctors || [], resolve);
    return { rec, id: rec.tpl_id, schemaV: d.schemaV || 1, hospital: d.hospital || HOSPITAL, date: d.date, shift: d.shiftType, doctors, start: d.startTime || '', end: d.endTime || '', notes: d.notes || '',
      assignments: doctors.map((n) => ({ doctor: n, ...timesOf(d, n, resolve) })), audit: d.audit || [], importedFrom: d.importedFrom || null, deleted: !!rec.deleted_at, createdAt: rec.created_at, updatedAt: rec.updated_at }; };
  const wellFormed = (t) => isThanc(t) && t.data && idOk(t.data.date) && !!shiftMeta(t.data.shiftType);
  const recordsOf = (templates, resolve) => templates.filter(wellFormed).filter((t) => !t.deleted_at).map((t) => norm(t, resolve));
  const deletedOf = (templates, resolve) => templates.filter(wellFormed).filter((t) => t.deleted_at).map((t) => norm(t, resolve));
  const malformedOf = (templates) => templates.filter((t) => isThanc(t) && !wellFormed(t)).map((t) => ({ id: t.tpl_id, date: t.data && t.data.date, shift: t.data && t.data.shiftType }));
  const order = (s) => SHIFTS.findIndex((x) => x.id === s);
  const sortAsc = (a, b) => a.date.localeCompare(b.date) || order(a.shift) - order(b.shift);
  const forDate = (recs, date) => recs.filter((r) => r.date === date).sort(sortAsc);
  const inMonth = (recs, ym) => recs.filter((r) => r.date.startsWith(ym));

  // ------------------------------------------------------------------ audit / edit
  const sameSet = (a, b) => a.length === b.length && a.every((x) => b.some((y) => canonKey(x) === canonKey(y)));
  /** Field-level diff between a record's current data and the requested values. */
  const diff = (d, f, resolve) => { const ch = {}; const cur = uniq(d.assignedDoctors || [], resolve), nxt = uniq(f.doctors || [], resolve);
    if (f.date !== undefined && f.date !== d.date) ch.date = [d.date, f.date];
    if (f.shift !== undefined && f.shift !== d.shiftType) ch.shift = [d.shiftType, f.shift];
    if (!sameSet(cur, nxt)) ch.doctors = [cur.join(', '), nxt.join(', ')];
    if ((f.start || '') !== (d.startTime || '')) ch.start = [d.startTime || '', f.start || ''];
    if ((f.end || '') !== (d.endTime || '')) ch.end = [d.endTime || '', f.end || ''];
    if ((f.notes || '').trim() !== (d.notes || '')) ch.notes = [d.notes || '', (f.notes || '').trim()];
    const a = JSON.stringify(cleanTimes(d.doctorTimes, d)), b = JSON.stringify(cleanTimes(f.doctorTimes, f));
    if (a !== b) ch.doctorTimes = [a, b];
    return ch; };
  /** Only keep per-doctor times that differ from the shift times. */
  const cleanTimes = (dt, shiftTimes) => { const out = {}; const s = shiftTimes.start !== undefined ? shiftTimes.start : shiftTimes.startTime, e = shiftTimes.end !== undefined ? shiftTimes.end : shiftTimes.endTime;
    for (const [n, v] of Object.entries(dt || {})) { if (!v) continue; const st = v.start || s || '', en = v.end || e || ''; if (st !== (s || '') || en !== (e || '')) out[display(n)] = { start: st, end: en }; } return out; };
  const pushAudit = (data, action, changes, now, note) => { const a = (data.audit || []).concat([{ at: now, action, changes: changes || {}, ...(note ? { note } : {}) }]); return a.length > 500 ? a.slice(a.length - 500) : a; };
  /** Returns a NEW record with the edit applied and an audit entry (no change → same record). */
  const applyEdit = (rec, f, cfg, now = new Date().toISOString(), action) => {
    const resolve = resolver(cfg); const d = rec.data; const ch = diff(d, f, resolve); const wasDeleted = !!rec.deleted_at;
    if (!Object.keys(ch).length && !wasDeleted) return rec;
    const doctors = uniq(f.doctors || [], resolve); const st = f.start !== undefined ? f.start : d.startTime, en = f.end !== undefined ? f.end : d.endTime;
    const times = cleanTimes(Object.fromEntries(Object.entries(f.doctorTimes || {}).filter(([n]) => doctors.some((x) => canonKey(x) === canonKey(n)))), { start: st, end: en });
    const nd = { ...d, hospital: HOSPITAL, date: f.date !== undefined ? f.date : d.date, shiftType: f.shift !== undefined ? f.shift : d.shiftType, assignedDoctors: doctors, startTime: st, endTime: en, notes: (f.notes !== undefined ? f.notes : d.notes || '').trim(), doctorTimes: times, schemaV: SCHEMA_V };
    nd.dutyId = idFor(nd.date, nd.shiftType); nd.audit = pushAudit(d, action || (wasDeleted ? 'restored' : 'edited'), ch, now);
    return { ...rec, name: `THANC ${nd.shiftType} ${nd.date}`, updated_at: now, deleted_at: null, data: nd };
  };
  /** Soft delete: the record and its history stay stored. */
  const softDelete = (rec, now = new Date().toISOString(), note) => ({ ...rec, updated_at: now, deleted_at: now, data: { ...rec.data, schemaV: SCHEMA_V, audit: pushAudit(rec.data, 'deleted', {}, now, note) } });
  const restore = (rec, now = new Date().toISOString(), note) => ({ ...rec, updated_at: now, deleted_at: null, data: { ...rec.data, schemaV: SCHEMA_V, audit: pushAudit(rec.data, 'restored', {}, now, note) } });
    /** A brand-new duty with its first audit entry. */
  const createRecord = (date, shift, f, cfg, now = new Date().toISOString(), note) => { const rec = newRecord(date, shift, cfg, now); const resolve = resolver(cfg); const doctors = uniq(f.doctors || [], resolve);
    rec.data = { ...rec.data, assignedDoctors: doctors, startTime: f.start, endTime: f.end, notes: (f.notes || '').trim(), doctorTimes: cleanTimes(Object.fromEntries(Object.entries(f.doctorTimes || {}).filter(([n]) => doctors.some((x) => canonKey(x) === canonKey(n)))), { start: f.start, end: f.end }), audit: [{ at: now, action: 'created', changes: {}, ...(note ? { note } : {}) }] };
    return rec; };
  /** Change a duty's date and/or shift: the history moves with it, the old id is kept as a restorable tombstone. `target` = an existing tombstone at the new id (history is kept). */
  const moveRecord = (old, f, cfg, now = new Date().toISOString(), target) => { const newId = idFor(f.date, f.shift);
    let base = { ...old, tpl_id: newId, deleted_at: null, data: { ...old.data, dutyId: newId } };
    if (target && target.data && target.data.audit) base = { ...base, created_at: target.created_at, data: { ...base.data, audit: target.data.audit.concat(base.data.audit || []) } };
    return { rec: applyEdit(base, f, cfg, now, 'moved'), tomb: softDelete(old, now, `moved to ${f.date} ${f.shift}`) }; };

  // ------------------------------------------------------------------ lines, hours, issues
  /** One line per doctor per duty, with the interval and its month split. */
  const lines = (recs, resolve) => { const out = [];
    for (const r of recs) for (const a of r.assignments) { const iv = H.interval(r.date, a.start, a.end); out.push({ id: r.id, date: r.date, shift: r.shift, doctor: a.doctor, start: a.start, end: a.end, custom: a.custom, iv, split: iv.status === 'ok' ? H.splitByMonth(iv.startMin, iv.endMin) : [], notes: r.notes }); }
    return out; };
  const emptyShiftMap = () => ({ morning: 0, evening: 0, night: 0 });
  /** Counts + hours for a period (month/quarter/year/fy), all doctors or one. A duty counts in the month it STARTS; hours are split at midnight. */
  const analyse = (recs, cfg, { kind = 'month', key, doctor = 'ALL' } = {}) => {
    const resolve = resolver(cfg), rg = H.range(kind, key), ms = new Set(rg.months), L = lines(recs, resolve);
    const want = doctor === 'ALL' ? null : canonKey(doctor); const inactive = new Set((cfg.inactive || []).map(canonKey));
    const rows = new Map(); const row = (name) => { const k = canonKey(name); if (!rows.has(k)) rows.set(k, { doctor: name, key: k, morning: 0, evening: 0, night: 0, total: 0, minutes: { ...emptyShiftMap(), total: 0 }, fullMinutes: 0, valid: 0, max: 0, invalid: 0, active: !inactive.has(k) }); return rows.get(k); };
    if (!want) for (const n of cfg.roster) if (!inactive.has(canonKey(n))) row(resolve(n));
    const shiftWise = Object.fromEntries(SHIFTS.map((s) => [s.id, { shift: s.id, duties: new Set(), assignments: 0, minutes: 0, valid: 0, fullMinutes: 0 }]));
    for (const l of L) {
      if (want && canonKey(l.doctor) !== want) continue;
      const inRange = l.date >= rg.from && l.date <= rg.to;
      if (inRange) { const r = row(l.doctor); r[l.shift]++; r.total++; const sw = shiftWise[l.shift]; sw.duties.add(l.id); sw.assignments++;
        if (l.iv.status === 'ok') { r.valid++; r.fullMinutes += l.iv.minutes; r.max = Math.max(r.max, l.iv.minutes); sw.valid++; sw.fullMinutes += l.iv.minutes; } else r.invalid++; }
      for (const p of l.split) if (ms.has(p.ym)) { const r = row(l.doctor); r.minutes[l.shift] += p.minutes; r.minutes.total += p.minutes; shiftWise[l.shift].minutes += p.minutes; }
    }
    const list = [...rows.values()].map((r) => ({ ...r, avg: r.valid ? Math.round(r.fullMinutes / r.valid) : 0 })).sort((a, b) => b.total - a.total || b.minutes.total - a.minutes.total || a.doctor.localeCompare(b.doctor));
    const totals = list.reduce((t, r) => { for (const s of ['morning', 'evening', 'night', 'total']) t[s] += r[s]; for (const s of ['morning', 'evening', 'night', 'total']) t.minutes[s] += r.minutes[s]; t.valid += r.valid; t.fullMinutes += r.fullMinutes; t.invalid += r.invalid; t.max = Math.max(t.max, r.max); return t; }, { morning: 0, evening: 0, night: 0, total: 0, minutes: { ...emptyShiftMap(), total: 0 }, valid: 0, fullMinutes: 0, invalid: 0, max: 0 });
    totals.avg = totals.valid ? Math.round(totals.fullMinutes / totals.valid) : 0;
    const pool = list.filter((r) => r.active || r.total > 0);
    const extreme = (f, pick) => { if (!pool.length || !pool.some((r) => f(r) > 0)) return null; const best = pick(...pool.map(f)); return { value: best, doctors: pool.filter((r) => f(r) === best).map((r) => r.doctor) }; };
    return { kind, key, label: H.label(kind, key), from: rg.from, to: rg.to, doctor, rows: list, totals,
      highest: extreme((r) => r.total, Math.max), lowest: pool.length ? { value: Math.min(...pool.map((r) => r.total)), doctors: pool.filter((r) => r.total === Math.min(...pool.map((x) => x.total))).map((r) => r.doctor) } : null,
      highestHours: extreme((r) => r.minutes.total, Math.max),
      shiftWise: SHIFTS.map((s) => { const w = shiftWise[s.id]; return { shift: s.id, label: s.label, duties: w.duties.size, assignments: w.assignments, minutes: w.minutes, avg: w.valid ? Math.round(w.fullMinutes / w.valid) : 0 }; }) };
  };
  /** Last n months ending at endYm: duties (by start month) and hours (split by month) – for the workload chart. */
  const trend = (recs, cfg, { endYm, n = 6, doctor = 'ALL' } = {}) => { const resolve = resolver(cfg), L = lines(recs, resolve), want = doctor === 'ALL' ? null : canonKey(doctor);
    const out = []; for (let i = n - 1; i >= 0; i--) out.push({ ym: H.shiftKey('month', endYm, -i), duties: emptyShiftMap(), minutes: 0 });
    const at = new Map(out.map((o) => [o.ym, o]));
    for (const l of L) { if (want && canonKey(l.doctor) !== want) continue; const o = at.get(l.date.slice(0, 7)); if (o) o.duties[l.shift]++; for (const p of l.split) { const m = at.get(p.ym); if (m) m.minutes += p.minutes; } }
    return out; };
  /** Incomplete / invalid / suspicious entries. */
  const issues = (recs, cfg, templates) => { const resolve = resolver(cfg), out = []; const L = lines(recs, resolve);
    for (const r of recs) { if (!r.doctors.length) out.push({ id: r.id, date: r.date, shift: r.shift, type: 'no_doctor', text: 'No doctor assigned' });
      const raw = (r.rec.data.assignedDoctors || []).map((x) => canonKey(resolve(x))); if (raw.length !== new Set(raw).size) out.push({ id: r.id, date: r.date, shift: r.shift, type: 'duplicate_doctor', text: 'Same doctor listed twice (counted once)' }); }
    for (const l of L) { if (l.iv.status === 'missing') out.push({ id: l.id, date: l.date, shift: l.shift, doctor: l.doctor, type: 'missing_time', text: l.iv.reason }); else if (l.iv.status === 'invalid') out.push({ id: l.id, date: l.date, shift: l.shift, doctor: l.doctor, type: 'invalid_time', text: l.iv.reason }); else if (l.iv.warn) out.push({ id: l.id, date: l.date, shift: l.shift, doctor: l.doctor, type: l.iv.warn === 'short' ? 'short_duty' : 'long_duty', text: `${H.fmt(l.iv.minutes)} — please confirm` }); }
    const byDoc = new Map(); for (const l of L) if (l.iv.status === 'ok') { const k = canonKey(l.doctor); (byDoc.get(k) || byDoc.set(k, []).get(k)).push(l); }
    for (const arr of byDoc.values()) { arr.sort((a, b) => a.iv.startMin - b.iv.startMin); let prev = null; for (const l of arr) { if (prev && l.iv.startMin < prev.iv.endMin && l.id !== prev.id) out.push({ id: l.id, date: l.date, shift: l.shift, doctor: l.doctor, type: 'overlap', text: `Overlaps ${prev.shift} on ${prev.date}` }); if (!prev || l.iv.endMin > prev.iv.endMin) prev = l; } }
    for (const m of malformedOf(templates || [])) out.push({ id: m.id, date: m.date || '?', shift: m.shift || '?', type: 'malformed', text: 'Unreadable duty record (not counted)' });
    return out.sort((a, b) => String(a.date).localeCompare(String(b.date))); };
  /** Independent recomputation: counts and minutes must equal what analytics reports. */
  const selfCheck = (recs, cfg) => { const resolve = resolver(cfg), L = lines(recs, resolve); const checks = [];
    const dates = recs.map((r) => r.date).sort(); if (!dates.length) return { ok: true, checks: [{ name: 'No duty records yet', expected: 0, actual: 0, ok: true }] };
    const y0 = Number(dates[0].slice(0, 4)), y1 = Number(dates[dates.length - 1].slice(0, 4)); let cnt = 0, mins = 0;
    for (let y = y0; y <= y1; y++) { const a = analyse(recs, cfg, { kind: 'year', key: String(y) }); cnt += a.totals.total; mins += a.totals.minutes.total; }
    const expectCnt = recs.reduce((n, r) => n + r.assignments.length, 0), expectMin = L.reduce((n, l) => n + (l.iv.status === 'ok' ? l.iv.minutes : 0), 0);
    checks.push({ name: 'Doctor duties (all years) = assignments in records', expected: expectCnt, actual: cnt, ok: cnt === expectCnt });
    checks.push({ name: 'Worked minutes (all years) = sum of recorded intervals', expected: expectMin, actual: mins, ok: mins === expectMin });
    return { ok: checks.every((c) => c.ok), checks }; };

  // ------------------------------------------------------------------ search + exports
  const MONS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const search = (recs, q, issueIds) => { const words = clean(q).toLowerCase().split(' ').filter(Boolean); if (!words.length) return [...recs].sort(sortAsc).reverse();
    return recs.filter((r) => { const [y, mo, da] = r.date.split('-'); const bad = issueIds && issueIds.has(r.id) ? 'issue invalid incomplete' : ''; const imp = r.importedFrom ? 'imported' : '';
      const hay = [r.date, `${Number(da)} ${MONS[Number(mo) - 1]}`, `${MONS[Number(mo) - 1]} ${y}`, r.shift, r.notes, bad, imp, ...r.doctors].join(' ').toLowerCase(); return words.every((w) => hay.includes(w)); }).sort(sortAsc).reverse(); };
  const csvCell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const toCSVTable = (head, rows) => '﻿' + [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
  const HEAD = ['Date', 'Hospital', 'Shift', 'Start', 'End', 'Doctors', 'Notes'];
  const rows = (recs) => [...recs].sort(sortAsc).map((r) => [r.date, r.hospital, shiftMeta(r.shift).label, r.start, r.end, r.doctors.join('; '), r.notes]);
  const toCSV = (recs) => toCSVTable(HEAD, rows(recs));
  /** Summary used by older screens: counts only (same doctor-identity rules as analytics). */
  const summary = (recs, resolve) => { const r = resolve || ((x) => display(x)); const m = new Map(); const totals = { morning: 0, evening: 0, night: 0, total: 0 };
    for (const rec of recs) for (const doc of rec.doctors) { const name = r(doc), k = canonKey(name); const row = m.get(k) || { doctor: name, morning: 0, evening: 0, night: 0, total: 0 }; row[rec.shift]++; row.total++; m.set(k, row); totals[rec.shift]++; totals.total++; }
    return { rows: [...m.values()].sort((a, b) => b.total - a.total || a.doctor.localeCompare(b.doctor)), totals }; };
  const summaryCSV = (recs) => { const s = summary(recs); return toCSVTable(['Doctor', 'Morning', 'Evening', 'Night', 'Total'], [...s.rows.map((r) => [r.doctor, r.morning, r.evening, r.night, r.total]), ['TOTAL', s.totals.morning, s.totals.evening, s.totals.night, s.totals.total]]); };
  const statusText = (iv) => (iv.status === 'ok' ? (iv.warn ? 'Check (' + iv.warn + ')' : 'OK') : iv.status === 'missing' ? 'Incomplete: ' + iv.reason : 'Invalid: ' + iv.reason);
  /** All report tables for one analysed period (used by CSV / Excel / PDF). */
  const tableSet = (recs, cfg, a, templates) => { const resolve = resolver(cfg), L = lines(recs, resolve).filter((l) => l.date >= a.from && l.date <= a.to && (a.doctor === 'ALL' || canonKey(l.doctor) === canonKey(a.doctor)));
    const hd = (m) => H.hoursDec(m);
    const T = [];
    T.push({ name: 'Doctor-wise', head: ['Doctor', 'Morning', 'Evening', 'Night', 'Total duties', 'Total hours', 'Morning h', 'Evening h', 'Night h', 'Avg h / duty', 'Max h', 'Invalid entries'],
      rows: [...a.rows.map((r) => [r.doctor, r.morning, r.evening, r.night, r.total, hd(r.minutes.total), hd(r.minutes.morning), hd(r.minutes.evening), hd(r.minutes.night), hd(r.avg), hd(r.max), r.invalid]),
        ['TOTAL', a.totals.morning, a.totals.evening, a.totals.night, a.totals.total, hd(a.totals.minutes.total), hd(a.totals.minutes.morning), hd(a.totals.minutes.evening), hd(a.totals.minutes.night), hd(a.totals.avg), hd(a.totals.max), a.totals.invalid]] });
    T.push({ name: 'Shift-wise', head: ['Shift', 'Duties', 'Doctor assignments', 'Hours (in period)', 'Avg h / assignment'], rows: a.shiftWise.map((s) => [s.label, s.duties, s.assignments, hd(s.minutes), hd(s.avg)]) });
    T.push({ name: 'Duty lines', head: ['Date', 'Hospital', 'Shift', 'Doctor', 'Start', 'End', 'Hours', 'Overnight', 'Individual time', 'Status', 'Notes'],
      rows: L.sort((x, y) => x.date.localeCompare(y.date) || order(x.shift) - order(y.shift) || x.doctor.localeCompare(y.doctor)).map((l) => [l.date, HOSPITAL, shiftMeta(l.shift).label, l.doctor, l.start, l.end, l.iv.status === 'ok' ? hd(l.iv.minutes) : '', l.iv.overnight ? 'Yes' : '', l.custom ? 'Yes' : '', statusText(l.iv), l.notes]) });
    T.push({ name: 'Issues', head: ['Date', 'Shift', 'Doctor', 'Problem'], rows: issues(recs, cfg, templates).filter((i) => i.date >= a.from && i.date <= a.to).map((i) => [i.date, i.shift, i.doctor || '', i.text]) });
    return T; };
  const auditRows = (recs) => { const out = []; for (const r of recs) for (const e of r.audit) out.push([e.at, r.date, shiftMeta(r.shift).label, e.action, Object.entries(e.changes || {}).map(([k, v]) => `${k}: ${v[0]} → ${v[1]}`).join(' | '), e.note || '']);
    return out.sort((a, b) => String(a[0]).localeCompare(String(b[0]))); };
  const AUDIT_HEAD = ['Changed at', 'Duty date', 'Shift', 'Action', 'Changes', 'Note'];

  // ------------------------------------------------------------------ one-time copy of the old personal night duties
  const isThancLegacy = (d) => !!d && !d.deleted_at && /thanc/i.test(`${d.hospital || ''}`);
  /** Preview rows. status: new | exists (night record already there) | imported (already copied) | invalid. Nothing is written here. */
  const legacyCandidates = (legacyDuties, templates, cfg, doctorName = 'Dr. Dinesh') => { const resolve = resolver(cfg), me = resolve(doctorName);
    const all = templates.filter(wellFormed); const importedIds = new Set(); for (const t of templates) { if (isThanc(t) && !t.deleted_at && t.data && t.data.importedFrom) importedIds.add(t.data.importedFrom.id); if (isImportBatch(t) && !(t.data || {}).rolledBackAt) for (const it of (t.data.items || [])) importedIds.add(it.legacyId); }
    return legacyDuties.filter(isThancLegacy).sort((a, b) => String(a.date).localeCompare(String(b.date))).map((d) => {
      const start = d.start || '20:00', end = d.end || '08:00'; const iv = H.interval(d.date, start, end);
      const base = { legacyId: d.duty_id, date: d.date, start, end, notes: d.notes || '', hospital: d.hospital || '', hours: iv.status === 'ok' ? H.hoursDec(iv.minutes) : null, doctor: me };
      if (!idOk(d.date) || iv.status !== 'ok') return { ...base, status: 'invalid', why: !idOk(d.date) ? 'invalid date' : iv.reason };
      if (importedIds.has(d.duty_id)) return { ...base, status: 'imported', why: 'already imported' };
      const ex = all.find((t) => t.tpl_id === idFor(d.date, 'night'));
      if (ex && !ex.deleted_at) { const has = uniq(ex.data.assignedDoctors || [], resolve).some((n) => canonKey(n) === canonKey(me)); return { ...base, status: 'exists', why: has ? `${me} is already on that night duty` : 'a THANC night duty already exists on this date', hasDoctor: has, existingId: ex.tpl_id }; }
      return { ...base, status: 'new' }; }); };
  /** Build the records + batch for the rows the user chose. `addToExisting` = ids of rows (legacyId) allowed to add the doctor to an existing night. */
  const buildImport = (rowsSel, templates, cfg, { batchId, now = new Date().toISOString(), addToExisting = new Set() } = {}) => { const resolve = resolver(cfg); const upserts = [], items = [];
    for (const r of rowsSel) {
      if (r.status === 'new') { const rec = newRecord(r.date, 'night', cfg, now); rec.data = { ...rec.data, assignedDoctors: [r.doctor], startTime: r.start, endTime: r.end, notes: r.notes, doctorTimes: {}, importedFrom: { store: 'duties', id: r.legacyId, batch: batchId }, audit: [{ at: now, action: 'imported', changes: {}, note: `copied from earlier night-duty list (${r.legacyId})` }] };
        const ex = templates.find((t) => t.tpl_id === rec.tpl_id); if (ex && ex.deleted_at) { rec.created_at = ex.created_at; rec.data.audit = (ex.data.audit || []).concat(rec.data.audit); }
        upserts.push(rec); items.push({ recId: rec.tpl_id, legacyId: r.legacyId, date: r.date, action: 'created', revive: !!(ex && ex.deleted_at) }); }
      else if (r.status === 'exists' && !r.hasDoctor && addToExisting.has(r.legacyId)) { const ex = templates.find((t) => t.tpl_id === r.existingId); const cur = uniq(ex.data.assignedDoctors || [], resolve);
        const nd = applyEdit(ex, { doctors: [...cur, r.doctor], start: ex.data.startTime, end: ex.data.endTime, notes: ex.data.notes, doctorTimes: { ...(ex.data.doctorTimes || {}), [r.doctor]: { start: r.start, end: r.end } } }, cfg, now, 'imported');
        nd.data.audit[nd.data.audit.length - 1].note = `added ${r.doctor} from earlier night-duty list (${r.legacyId})`; nd.data.importedFrom = ex.data.importedFrom; upserts.push(nd); items.push({ recId: ex.tpl_id, legacyId: r.legacyId, date: r.date, action: 'added-doctor', doctor: r.doctor }); } }
    const batch = { tpl_id: batchId, type: 'thanc-import', name: 'THANC import ' + now.slice(0, 10), created_at: now, updated_at: now, uses: 0, deleted_at: null, data: { batchId, at: now, source: 'personal night duties marked THANC', items } };
    return { upserts, batch, count: items.length }; };
  /** Undo one batch: created records are soft-deleted (restorable); added doctors are removed again. Legacy list is never touched. */
  const buildRollback = (batchRec, templates, cfg, now = new Date().toISOString()) => { const resolve = resolver(cfg); const upserts = [];
    for (const it of batchRec.data.items) { const rec = templates.find((t) => t.tpl_id === it.recId); if (!rec || !isThanc(rec)) continue;
      if (it.action === 'created') { if (!rec.deleted_at && rec.data.importedFrom && rec.data.importedFrom.batch === batchRec.data.batchId) upserts.push(softDelete(rec, now, 'rolled back import ' + batchRec.data.batchId)); }
      else if (it.action === 'added-doctor') { const cur = uniq(rec.data.assignedDoctors || [], resolve).filter((n) => canonKey(n) !== canonKey(it.doctor)); const dt = { ...(rec.data.doctorTimes || {}) }; for (const k of Object.keys(dt)) if (canonKey(k) === canonKey(it.doctor)) delete dt[k];
        const nd = applyEdit(rec, { doctors: cur, start: rec.data.startTime, end: rec.data.endTime, notes: rec.data.notes, doctorTimes: dt }, cfg, now, 'rollback'); nd.data.audit[nd.data.audit.length - 1].note = 'rolled back import ' + batchRec.data.batchId; upserts.push(nd); } }
    const nb = { ...batchRec, updated_at: now, data: { ...batchRec.data, rolledBackAt: now } }; return { upserts, batch: nb }; };

  const hours = (s, e) => { const iv = H.interval('2000-01-01', s, e); return iv.status === 'ok' ? iv.minutes / 60 : 0; };
  const fmtTime = (t) => { if (!t || !/^\d{2}:\d{2}$/.test(t)) return '—'; const [hh, mm] = t.split(':').map(Number); return `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}`; };
  return { HOSPITAL, SCHEMA_V, SHIFTS, ROSTER, DEFAULTS, config, resolver, canonKey, display, shiftMeta, isThanc, isImportBatch, isThancAny, idFor, uniq, clean, shortName, initials, idOk, newRecord, norm, recordsOf, deletedOf, malformedOf, wellFormed,
    forDate, inMonth, sortAsc, applyEdit, softDelete, restore, createRecord, moveRecord, cleanTimes, diff, lines, analyse, trend, issues, selfCheck, search, summary, summaryCSV, toCSV, toCSVTable, rows, HEAD, tableSet, auditRows, AUDIT_HEAD, statusText,
    legacyCandidates, buildImport, buildRollback, hours, fmtTime, order };
})();
if (typeof module !== 'undefined') module.exports = Thanc;
