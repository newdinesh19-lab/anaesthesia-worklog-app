const test = global.__test, assert = global.__assert;
global.Schema = require('../js/schema.js');
const A = require('../js/analytics.js');
const mk = (o) => Schema.upgradeCase({ case_id: Math.random().toString(36).slice(2), case_date: '2026-03-10', patient_name: 'x', ...o });

test('analytics: ranges (month, FY, ytd, custom)', () => {
  const now = new Date(2026, 4, 17); // 17 May 2026
  assert.deepStrictEqual([A.rangeFor('month', now).from, A.rangeFor('month', now).to], ['2026-05-01', '2026-05-31']);
  assert.deepStrictEqual([A.rangeFor('fy', now).from, A.rangeFor('fy', now).to], ['2026-04-01', '2027-03-31']);
  assert.deepStrictEqual([A.rangeFor('fy', new Date(2026, 1, 3)).from, A.rangeFor('fy', new Date(2026, 1, 3)).to], ['2025-04-01', '2026-03-31']);
  assert.deepStrictEqual([A.rangeFor('ytd', now).from, A.rangeFor('ytd', now).to], ['2026-01-01', '2026-05-17']);
  assert.deepStrictEqual([A.rangeFor('7d', now).from, A.rangeFor('7d', now).to], ['2026-05-11', '2026-05-17']);
  assert.strictEqual(A.rangeFor('custom', now, { from: '2026-01-02' }).to, ''); assert(A.inRange('2026-05-01', A.rangeFor('all'))); assert(!A.inRange('2026-06-01', A.rangeFor('month', now)));
});
test('analytics: caseSummary urgency ratio, ASA, techniques, speciality, ICU/HDU, complications', () => {
  const cases = [
    mk({ urgency: 'Emergency', asa: 'III', anaesthesia_mode: 'GA', surgery: 'Lap appendicectomy', age: 30, postop: { destination: 'ICU' }, airway: { difficult: true } }),
    mk({ urgency: 'Elective', asa: 'II', anaesthesia_mode: 'SA (Spinal)', surgery: 'TKR', age: 70 }),
    mk({ urgency: 'Elective', asa: 'II', techniques: ['GA', 'Peripheral nerve block'], surgery: 'Tonsillectomy', age: 5, postop: { destination: 'HDU', complications: ['PONV'] } }),
    mk({ surgery: 'something odd' }),
  ];
  const s = A.caseSummary(cases);
  assert.strictEqual(s.total, 4); assert.strictEqual(s.emergency, 1); assert.strictEqual(s.elective, 2); assert.strictEqual(s.emergencyPct, 33);
  assert.deepStrictEqual(s.asa, { III: 1, II: 2, 'Not recorded': 1 });
  assert.strictEqual(s.techniques.GA, 2); assert.strictEqual(s.techniques.Spinal, 1); assert.strictEqual(s.techniques['Peripheral nerve block'], 1); assert.strictEqual(s.combinedCount, 1);
  assert.strictEqual(s.speciality['General surgery'], 1); assert.strictEqual(s.speciality.Orthopaedics, 1); assert.strictEqual(s.speciality.ENT, 1); assert.strictEqual(s.speciality.Unclassified, 1);
  assert.strictEqual(s.categories.Paediatric, 1); assert.strictEqual(s.categories.Geriatric, 1);
  assert.strictEqual(s.icuHdu, 2); assert.strictEqual(s.complicationCases, 2); assert.strictEqual(s.difficultAirway, 1);
  assert.strictEqual(s.coverage.asa, 75);
});
test('analytics: consultant split, series, workload', () => {
  const cases = [mk({ consultant: 'Dr. A / Dr. B', case_date: '2026-01-05' }), mk({ consultant: 'Dr. A', case_date: '2026-01-05' }), mk({ case_date: '2026-02-01' })];
  assert.deepStrictEqual(A.caseSummary(cases).consultants, { 'Dr. A': 2, 'Dr. B': 1 });
  assert.deepStrictEqual(A.monthSeries(cases, 'case_date', 2026).slice(0, 3), [2, 1, 0]);
  const w = A.workload(cases, [{ date: '2026-01-05' }], [{ date: '2026-02-01' }], A.rangeFor('year', new Date(2026, 5, 1)));
  assert.deepStrictEqual([w.cases, w.workingDays, w.avgPerWorkingDay, w.nightDuties, w.procedures, w.busiest.date], [3, 2, 1.5, 1, 1, '2026-01-05']);
  const ds = A.daySeries(cases, 'case_date', '2026-01-06', 3); assert.deepStrictEqual(ds, [['2026-01-04', 0], ['2026-01-05', 2], ['2026-01-06', 0]]);
});
test('analytics: procedure summary', () => {
  const ps = [Schema.newProcedure({ procedure: 'Spinal anaesthesia', date: '2026-01-01' }), Schema.newProcedure({ procedure: 'Spinal anaesthesia', date: '2026-01-02', success: false, complications: ['Paraesthesia'] }), Schema.newProcedure({ procedure: 'Arterial cannulation', date: '2026-02-01', us_guided: true, complications: ['None'] })];
  const s = A.procSummary(ps); assert.strictEqual(s.total, 3); assert.strictEqual(s.byProc['Spinal anaesthesia'], 2); assert.strictEqual(s.unsuccessful, 1); assert.strictEqual(s.withComplication, 1); assert.strictEqual(s.usGuided, 1);
});
test('analytics: de-identification helpers', () => {
  assert.strictEqual(A.anonCode('abc'), A.anonCode('abc')); assert.notStrictEqual(A.anonCode('abc'), A.anonCode('abd')); assert(/^C-[0-9A-Z]{6}$/.test(A.anonCode('abc')));
  assert.strictEqual(A.ageBand(7), '1–15 y'); assert.strictEqual(A.ageBand(70), '65+ y'); assert.strictEqual(A.ageBand(''), '');
});
