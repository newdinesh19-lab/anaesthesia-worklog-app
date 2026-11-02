const test = global.__test, assert = global.__assert;
const T = require('../js/thanc.js');
const mk = (date, shift, docs, extra = {}) => { const r = T.newRecord(date, shift, T.config()); r.data.assignedDoctors = docs; Object.assign(r.data, extra); return r; };
test('thanc: defaults and config merge never lose shifts', () => {
  const c = T.config({ roster: ['Dr. X'], shifts: { night: { doctors: ['Dr. X'] } } });
  assert.deepStrictEqual(c.roster, ['Dr. X']); assert.deepStrictEqual(c.shifts.morning.doctors, ['Dr. Dinesh', 'Dr. Arafath']); assert.strictEqual(c.shifts.night.start, '20:00'); assert.deepStrictEqual(c.shifts.night.doctors, ['Dr. X']);
  assert.strictEqual(T.config(null).shifts.evening.end, '20:00');
});
test('thanc: record shape, id and isolation from other templates', () => {
  const r = T.newRecord('2026-11-02', 'night', T.config()); assert.strictEqual(r.tpl_id, 'thanc-2026-11-02-night'); assert.strictEqual(r.data.hospital, 'THANC'); assert.strictEqual(r.data.startTime, '20:00');
  const recs = T.recordsOf([r, { tpl_id: 'p', type: 'plan', data: { date: '2026-11-02' } }, { tpl_id: 's', type: 'surgery', name: 'x' }, { ...mk('2026-11-03', 'morning', ['Dr. A']), deleted_at: 'x' }]); assert.strictEqual(recs.length, 1);
});
test('thanc: changing defaults does not alter saved records', () => {
  const r = mk('2026-11-02', 'morning', ['Dr. Dinesh']); const cfg = T.config({ shifts: { morning: { doctors: ['Dr. Z'] } } }); assert.deepStrictEqual(cfg.shifts.morning.doctors, ['Dr. Z']); assert.deepStrictEqual(T.norm(r).doctors, ['Dr. Dinesh']);
});
test('thanc: summary counts per doctor and shift, case-insensitive names', () => {
  const recs = T.recordsOf([mk('2026-11-01', 'morning', ['Dr. Dinesh', 'Dr. Arafath']), mk('2026-11-01', 'night', ['Dr. Karthik', 'dr. dinesh']), mk('2026-11-02', 'evening', ['Dr. Dinesh']), mk('2026-12-01', 'night', ['Dr. Dinesh'])]);
  const s = T.summary(T.inMonth(recs, '2026-11')); const d = s.rows.find((r) => r.doctor === 'Dr. Dinesh');
  assert.deepStrictEqual([d.morning, d.evening, d.night, d.total], [1, 1, 1, 3]); assert.deepStrictEqual(s.totals, { morning: 2, evening: 1, night: 2, total: 5 }); assert.strictEqual(s.rows[0].doctor, 'Dr. Dinesh');
});
test('thanc: search by doctor and by date text', () => {
  const recs = T.recordsOf([mk('2026-11-05', 'morning', ['Dr. Arafath']), mk('2026-11-06', 'night', ['Dr. Karthik'], { notes: 'swap' }), mk('2026-10-05', 'evening', ['Dr. Arafath'])]);
  assert.strictEqual(T.search(recs, 'arafath').length, 2); assert.strictEqual(T.search(recs, '2026-11').length, 2); assert.strictEqual(T.search(recs, '5 nov').length, 1); assert.strictEqual(T.search(recs, 'arafath oct').length, 1); assert.strictEqual(T.search(recs, 'swap').length, 1); assert.strictEqual(T.search(recs, '')[0].date, '2026-11-06');
});
test('thanc: csv export escapes and orders', () => {
  const recs = T.recordsOf([mk('2026-11-06', 'night', ['Dr. A', 'Dr. B'], { notes: 'said "hi", ok' }), mk('2026-11-05', 'morning', ['Dr. A'])]);
  const lines = T.toCSV(recs).slice(1).split('\r\n'); assert.strictEqual(lines[0], 'Date,Hospital,Shift,Start,End,Doctors,Notes'); assert(lines[1].startsWith('2026-11-05,THANC,Morning')); assert(lines[2].includes('"said ""hi"", ok"')); assert(T.summaryCSV(recs).includes('TOTAL'));
});
test('thanc: hours across midnight, initials, time format', () => {
  assert.strictEqual(T.hours('20:00', '08:00'), 12); assert.strictEqual(T.hours('08:00', '14:00'), 6); assert.strictEqual(T.initials('Dr. Dinesh Kumar'), 'DK'); assert.strictEqual(T.initials('Dr. Arafath'), 'A'); assert.strictEqual(T.fmtTime('14:05'), '2:05 PM'); assert.strictEqual(T.fmtTime('00:00'), '12:00 AM');
});
