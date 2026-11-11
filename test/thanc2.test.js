const test = global.__test, assert = global.__assert;
const T = require('../js/thanc.js'), H = require('../js/thanc-hours.js');
const cfg = T.config();
const mk = (date, shift, docs, st, en, dt) => { const r = T.newRecord(date, shift, cfg); r.data.assignedDoctors = docs; if (st !== undefined) r.data.startTime = st; if (en !== undefined) r.data.endTime = en; if (dt) r.data.doctorTimes = dt; return r; };
const recsOf = (...a) => T.recordsOf(a);
const row = (an, name) => an.rows.find((r) => r.doctor === name);

test('hours: overnight, month-end, year-end and leap-day splits', () => {
  let i = H.interval('2026-11-02', '20:00', '08:00'); assert.strictEqual(i.minutes, 720); assert(i.overnight);
  i = H.interval('2026-10-31', '20:00', '08:00'); assert.deepStrictEqual(H.splitByMonth(i.startMin, i.endMin), [{ ym: '2026-10', minutes: 240 }, { ym: '2026-11', minutes: 480 }]);
  i = H.interval('2026-12-31', '19:30', '07:45'); assert.deepStrictEqual(H.splitByMonth(i.startMin, i.endMin), [{ ym: '2026-12', minutes: 270 }, { ym: '2027-01', minutes: 465 }]);
  i = H.interval('2028-02-29', '20:00', '08:00'); assert.deepStrictEqual(H.splitByMonth(i.startMin, i.endMin), [{ ym: '2028-02', minutes: 240 }, { ym: '2028-03', minutes: 480 }]);
  i = H.interval('2027-02-28', '20:00', '08:00'); assert.deepStrictEqual(H.splitByMonth(i.startMin, i.endMin), [{ ym: '2027-02', minutes: 240 }, { ym: '2027-03', minutes: 480 }]);
});
test('hours: invalid / incomplete entries are flagged, never assumed', () => {
  assert.strictEqual(H.interval('2026-11-01', '', '08:00').status, 'missing'); assert.strictEqual(H.interval('2026-11-01', '08:00', '08:00').status, 'invalid');
  assert.strictEqual(H.interval('2026-11-01', 'xx', '10:00').status, 'invalid'); assert.strictEqual(H.interval('2026-02-30', '08:00', '10:00').status, 'invalid'); assert.strictEqual(H.interval('2026-11-01', '8:00', '10:00').status, 'invalid');
  assert.strictEqual(H.interval('2026-11-01', '08:00', '08:10').warn, 'short'); assert.strictEqual(H.interval('2026-11-01', '06:00', '23:00').warn, 'long');
  assert.strictEqual(T.hours('08:00', '08:00'), 0);
});
test('periods: month, quarter, calendar year, financial year', () => {
  assert.deepStrictEqual(H.months('quarter', '2026-Q4'), ['2026-10', '2026-11', '2026-12']); assert.strictEqual(H.months('year', '2026').length, 12);
  const fy = H.months('fy', '2026'); assert.strictEqual(fy[0], '2026-04'); assert.strictEqual(fy[11], '2027-03'); assert.strictEqual(H.keyOf('fy', '2027-03-31'), '2026'); assert.strictEqual(H.keyOf('fy', '2026-04-01'), '2026');
  assert.deepStrictEqual(H.range('month', '2028-02'), { from: '2028-02-01', to: '2028-02-29', months: ['2028-02'] }); assert.strictEqual(H.shiftKey('quarter', '2026-Q1', -1), '2025-Q4'); assert.strictEqual(H.label('fy', '2026'), 'FY 2026–27');
});
test('doctor identity: name variants are one doctor', () => {
  const r = T.resolver(T.config({ aliases: { 'D. Kumar': 'Dr. Dinesh' } }));
  assert.strictEqual(r('dinesh'), 'Dr. Dinesh'); assert.strictEqual(r('Dr Dinesh'), 'Dr. Dinesh'); assert.strictEqual(r('dr. ARAFATH'), 'Dr. Arafath'); assert.strictEqual(r('d kumar'), 'Dr. Dinesh'); assert.strictEqual(r('priya'), 'Dr. Priya');
  const a = T.analyse(recsOf(mk('2026-11-01', 'morning', ['Dr. Dinesh', 'Dinesh', 'dr dinesh'])), cfg, { kind: 'month', key: '2026-11' }); assert.strictEqual(row(a, 'Dr. Dinesh').total, 1);
});
test('defaults: night preselects all four, morning two', () => {
  assert.deepStrictEqual(cfg.shifts.night.doctors, ['Dr. Karthik', 'Dr. Vignesh', 'Dr. Dinesh', 'Dr. Arafath']); assert.deepStrictEqual(cfg.shifts.morning.doctors, ['Dr. Dinesh', 'Dr. Arafath']);
});
test('analytics: counts, hours, avg, max, month-boundary hours, independent doctors', () => {
  const recs = recsOf(
    mk('2026-10-31', 'night', ['Dr. Karthik', 'Dr. Dinesh'], '20:00', '08:00', { 'Dr. Dinesh': { start: '21:00', end: '07:00' } }),
    mk('2026-11-01', 'morning', ['Dr. Dinesh', 'Dr. Arafath'], '08:00', '14:00'), mk('2026-11-02', 'evening', ['Dr. Dinesh'], '14:00', '20:00'), mk('2026-11-03', 'morning', ['Dr. Arafath'], '08:00', ''));
  const nov = T.analyse(recs, cfg, { kind: 'month', key: '2026-11' }), oct = T.analyse(recs, cfg, { kind: 'month', key: '2026-10' });
  const din = row(nov, 'Dr. Dinesh'); assert.deepStrictEqual([din.morning, din.evening, din.night, din.total], [1, 1, 0, 2]);
  assert.strictEqual(din.minutes.total, 7 * 60 + 360 + 360); // Oct 31 21:00-07:00: 3h in Oct, 7h in Nov; plus 6h + 6h
  const dOct = row(oct, 'Dr. Dinesh'); assert.deepStrictEqual([dOct.night, dOct.total, dOct.minutes.total], [1, 1, 180]);
  const kar = row(nov, 'Dr. Karthik'); assert.deepStrictEqual([kar.total, kar.minutes.total], [0, 480]); assert.strictEqual(row(oct, 'Dr. Karthik').minutes.total, 240);
  const ara = row(nov, 'Dr. Arafath'); assert.deepStrictEqual([ara.total, ara.valid, ara.invalid, ara.minutes.total, ara.avg, ara.max], [2, 1, 1, 360, 360, 360]);
  assert.strictEqual(nov.totals.total, 4); assert.strictEqual(nov.highest.doctors[0], 'Dr. Dinesh'); assert.strictEqual(nov.lowest.value, 0); assert(nov.lowest.doctors.includes('Dr. Vignesh'));
  const q = T.analyse(recs, cfg, { kind: 'quarter', key: '2026-Q4' }); assert.strictEqual(row(q, 'Dr. Karthik').minutes.total, 720); assert.strictEqual(row(q, 'Dr. Dinesh').minutes.total, 180 + 420 + 720);
  const one = T.analyse(recs, cfg, { kind: 'month', key: '2026-11', doctor: 'dr dinesh' }); assert.strictEqual(one.rows.length, 1); assert.strictEqual(one.totals.total, 2);
  assert.strictEqual(nov.shiftWise.find((s) => s.shift === 'morning').duties, 2);
});
test('analytics: financial year runs April to March', () => {
  const recs = recsOf(mk('2026-03-31', 'morning', ['Dr. Dinesh'], '08:00', '14:00'), mk('2026-04-01', 'morning', ['Dr. Dinesh'], '08:00', '14:00'), mk('2027-03-31', 'night', ['Dr. Dinesh'], '20:00', '08:00'), mk('2027-04-01', 'morning', ['Dr. Dinesh'], '08:00', '14:00'));
  const fy = T.analyse(recs, cfg, { kind: 'fy', key: '2026' }), cy = T.analyse(recs, cfg, { kind: 'year', key: '2026' });
  assert.strictEqual(row(fy, 'Dr. Dinesh').total, 2); assert.strictEqual(row(fy, 'Dr. Dinesh').minutes.total, 360 + 240); assert.strictEqual(row(cy, 'Dr. Dinesh').total, 2);
});
test('issues: missing, invalid, overlap, duplicate, malformed', () => {
  const t = [mk('2026-11-01', 'morning', ['Dr. Dinesh'], '08:00', ''), mk('2026-11-02', 'evening', ['Dr. Dinesh'], '10:00', '10:00'), mk('2026-11-03', 'morning', ['Dr. Dinesh'], '08:00', '14:00'), mk('2026-11-03', 'evening', ['Dr. Dinesh', 'dinesh'], '13:00', '20:00'),
    { tpl_id: 'thanc-x', type: 'thanc', data: { date: 'bad', shiftType: 'night' } }];
  const is = T.issues(T.recordsOf(t), cfg, t).map((i) => i.type).sort(); ['missing_time', 'invalid_time', 'overlap', 'duplicate_doctor', 'malformed'].forEach((k) => assert(is.includes(k), k + ' in ' + is));
});
test('self-check reconciles counts and minutes', () => {
  const recs = recsOf(mk('2026-12-31', 'night', ['Dr. Karthik', 'Dr. Dinesh'], '20:00', '08:00'), mk('2027-01-01', 'morning', ['Dr. Dinesh'], '08:00', '14:00'), mk('2026-11-01', 'morning', ['Dr. Arafath'], '', ''));
  const c = T.selfCheck(recs, cfg); assert(c.ok, JSON.stringify(c.checks)); assert.strictEqual(c.checks[0].expected, 4);
});
test('audit: edit records old/new, soft delete keeps history, per-doctor times cleaned', () => {
  const r = mk('2026-11-02', 'morning', ['Dr. Dinesh'], '08:00', '14:00'); const now = '2026-11-02T10:00:00Z';
  const e = T.applyEdit(r, { doctors: ['Dr. Dinesh', 'Dr. Priya'], start: '08:00', end: '15:00', notes: 'cover' }, cfg, now);
  assert.strictEqual(e.data.audit.length, 1); assert.deepStrictEqual(e.data.audit[0].changes.end, ['14:00', '15:00']); assert(e.data.audit[0].changes.doctors[1].includes('Priya')); assert.strictEqual(T.applyEdit(e, { doctors: ['Dr. Dinesh', 'dr priya'], start: '08:00', end: '15:00', notes: 'cover' }, cfg, now), e);
  const d = T.softDelete(e, now); assert(d.deleted_at); assert.strictEqual(T.recordsOf([d]).length, 0); assert.strictEqual(T.deletedOf([d]).length, 1); assert.strictEqual(d.data.audit.length, 2);
  const back = T.restore(d, now); assert.strictEqual(T.recordsOf([back]).length, 1); assert.strictEqual(back.data.audit.length, 3);
  const ind = T.applyEdit(r, { doctors: ['Dr. Dinesh'], start: '08:00', end: '14:00', notes: '', doctorTimes: { 'dr dinesh': { start: '09:00', end: '14:00' }, 'Dr. Gone': { start: '1:00', end: '2:00' } } }, cfg, now);
  assert.deepStrictEqual(ind.data.doctorTimes, { 'Dr. Dinesh': { start: '09:00', end: '14:00' } }); assert.strictEqual(T.norm(ind).assignments[0].start, '09:00');
  const same = T.applyEdit(ind, { doctors: ['Dr. Dinesh'], start: '08:00', end: '14:00', notes: '', doctorTimes: { 'Dr. Dinesh': { start: '08:00', end: '14:00' } } }, cfg, now); assert.deepStrictEqual(same.data.doctorTimes, {});
});
test('v1 records (no schemaV / audit / doctorTimes) still read and edit', () => {
  const v1 = { tpl_id: 'thanc-2026-10-05-night', type: 'thanc', name: 'x', created_at: 'a', updated_at: 'a', deleted_at: null, data: { dutyId: 'thanc-2026-10-05-night', hospital: 'THANC', date: '2026-10-05', shiftType: 'night', assignedDoctors: ['Dr. Karthik'], startTime: '20:00', endTime: '08:00', notes: '' } };
  const n = T.recordsOf([v1])[0]; assert.strictEqual(n.schemaV, 1); assert.strictEqual(n.assignments[0].start, '20:00'); const e = T.applyEdit(v1, { doctors: ['Dr. Karthik'], start: '20:00', end: '07:00', notes: '' }, cfg, 'now'); assert.strictEqual(e.data.schemaV, 2); assert.deepStrictEqual(e.data.audit[0].changes.end, ['08:00', '07:00']);
});
test('legacy import: only THANC-marked, preview statuses, no duplicates, rollback restores', () => {
  const legacy = [{ duty_id: 'a', date: '2026-10-01', hospital: 'THANC Hospital', start: '20:00', end: '08:00', notes: 'x' }, { duty_id: 'b', date: '2026-10-02', hospital: 'Apollo Spectra Hospital', start: '20:00', end: '08:00' },
    { duty_id: 'c', date: '2026-10-03', hospital: 'THANC Hospital', start: '20:00', end: '20:00' }, { duty_id: 'd', date: '2026-10-04', hospital: 'THANC Hospital', start: '19:00', end: '07:00' }, { duty_id: 'e', date: '2026-10-05', hospital: 'THANC Hospital', start: '20:00', end: '08:00' }, { duty_id: 'f', date: '2026-10-06', hospital: 'thanc', start: '', end: '' }];
  const existing = [mk('2026-10-04', 'night', ['Dr. Karthik'], '20:00', '08:00'), mk('2026-10-05', 'night', ['Dr. Dinesh'], '20:00', '08:00')];
  let c = T.legacyCandidates(legacy, existing, cfg); const st = Object.fromEntries(c.map((x) => [x.legacyId, x.status]));
  assert.deepStrictEqual(st, { a: 'new', c: 'invalid', d: 'exists', e: 'exists', f: 'new' }); assert(!st.b); assert.strictEqual(c.find((x) => x.legacyId === 'e').hasDoctor, true); assert.strictEqual(c.find((x) => x.legacyId === 'f').start, '20:00');
  const batch = 'thanc-import-1'; const sel = c.filter((x) => x.status === 'new' || x.legacyId === 'd');
  const built = T.buildImport(sel, existing, cfg, { batchId: batch, now: 'T1', addToExisting: new Set(['d']) }); assert.strictEqual(built.count, 3);
  const merge = (base, ups) => { const m = new Map(base.map((t) => [t.tpl_id, t])); for (const u of ups) m.set(u.tpl_id, u); return [...m.values()]; };
  const after = merge(existing, [...built.upserts, built.batch]);
  assert.strictEqual(T.recordsOf(after).length, 4); assert(T.recordsOf(after).find((r) => r.date === '2026-10-04').doctors.includes('Dr. Dinesh'));
  c = T.legacyCandidates(legacy, after, cfg); assert.strictEqual(c.find((x) => x.legacyId === 'a').status, 'imported'); assert.strictEqual(c.find((x) => x.legacyId === 'f').status, 'imported');
  assert.strictEqual(T.recordsOf(after).find((r) => r.date === '2026-10-01').importedFrom.id, 'a');
  const rb = T.buildRollback(built.batch, after, cfg, 'T2'); const after2 = merge(after, [...rb.upserts, rb.batch]);
  const live = T.recordsOf(after2); assert.strictEqual(live.length, 2); const d4 = live.find((r) => r.date === '2026-10-04'); assert(!d4.doctors.includes('Dr. Dinesh')); assert(d4.doctors.includes('Dr. Karthik')); assert.strictEqual(live.find((r) => r.date === '2026-10-05').doctors.length, 1);
  c = T.legacyCandidates(legacy, after2, cfg); assert.strictEqual(c.find((x) => x.legacyId === 'a').status, 'new');
  const again = T.buildImport(c.filter((x) => x.status === 'new'), after2, cfg, { batchId: 'thanc-import-2', now: 'T3' }); const after3 = merge(after2, [...again.upserts, again.batch]);
  assert.strictEqual(T.recordsOf(after3).filter((r) => r.importedFrom).length, 2); assert.strictEqual(T.recordsOf(after3).find((r) => r.date === '2026-10-01').audit.length, 3);
});
test('tables: exports use actual intervals and reconcile with analytics', () => {
  const recs = recsOf(mk('2026-10-31', 'night', ['Dr. Karthik'], '20:00', '08:00'), mk('2026-11-01', 'morning', ['Dr. Dinesh'], '08:00', '14:30'));
  const a = T.analyse(recs, cfg, { kind: 'month', key: '2026-11' }); const ts = T.tableSet(recs, cfg, a, []); assert.deepStrictEqual(ts.map((t) => t.name), ['Doctor-wise', 'Shift-wise', 'Duty lines', 'Issues']);
  const dw = ts[0]; assert.strictEqual(dw.rows[dw.rows.length - 1][6], 14.5); assert.strictEqual(ts[2].rows.length, 1); assert.strictEqual(ts[2].rows[0][7], 6.5);
  assert(T.toCSVTable(ts[0].head, ts[0].rows).includes('Total hours'));
});
