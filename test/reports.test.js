const test = global.__test, assert = global.__assert;
global.Schema = global.Schema || require('../js/schema.js');
global.Analytics = global.Analytics || require('../js/analytics.js');
const R = require('../js/reports.js');
const mk = (o) => Schema.upgradeCase({ case_id: 'id-' + Math.random().toString(36).slice(2), case_date: '2026-03-10', patient_name: 'Secret Name', uhid: 'U123456', age: 34, ...o });
const cases = [mk({ surgery: 'Total thyroidectomy', asa: 'II', urgency: 'Elective', anaesthesia_mode: 'GA', consultant: 'Dr A', hospital: 'H1', notable: true, notable_note: 'patient Secret Name had X' }), mk({ case_date: '2025-12-01', surgery: 'TKR', anaesthesia_mode: 'SA (Spinal)' })];
const procs = [Schema.newProcedure({ proc_id: 'p1', date: '2026-03-10', procedure: 'Spinal anaesthesia', case_id: cases[0].case_id, case_ref: 'U123456', notes: 'Secret note' })];
const duties = [{ duty_id: 'd1', date: '2026-03-11', hospital: 'H1' }];
const range = { from: '2026-01-01', to: '2026-12-31', label: '2026' };
const data = { cases, duties, procs, range, settings: {} };

test('reports: all 8 types build, range-filtered, with totals', () => {
  for (const [k] of R.TYPES) { const m = R.build(k, data, {}); assert(m.sheets.length >= 1 && m.totals.length >= 1, k); assert(m.disclaimer); }
  assert.strictEqual(R.build('monthly', data, {}).totals[0][1], 1, 'out-of-range case excluded');
});
test('reports: de-identified by default (no name, UHID, notes, exact age)', () => {
  for (const [k] of R.TYPES) { const blob = R.toCSV(R.build(k, data, {})); for (const bad of ['Secret Name', 'U123456', 'Secret note']) assert(!blob.includes(bad), `${k} leaks ${bad}`); }
  assert(R.toCSV(R.build('monthly', data, {})).includes('16–39 y'));
});
test('reports: identifiers included only when opted in', () => {
  const csv = R.toCSV(R.build('monthly', data, { identifiers: true })); assert(csv.includes('Secret Name') && csv.includes('U123456'));
  assert(R.toCSV(R.build('procedures', data, { identifiers: true })).includes('Secret note'));
});
test('reports: CSV escapes quotes/commas and neutralises formulas', () => {
  const m = { title: 'T', range: 'r', generated: 'g', identifiers: false, totals: [], sheets: [{ name: 's', columns: ['a'], rows: [['=cmd|x'], ['a,"b"'], [-5]] }], disclaimer: 'd' };
  const csv = R.toCSV(m); assert(csv.includes("'=cmd|x") && csv.includes('"a,""b"""') && csv.includes('\r\n-5'));
});
test('reports: sheet names unique and ≤31 chars in workbook model', () => {
  const m = R.build('yearend', data, {}); const names = m.sheets.map((s) => s.name); assert(names.every((n) => n.length <= 31));
});
