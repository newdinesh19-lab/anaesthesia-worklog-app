const test = global.__test, assert = global.__assert;
const Dup = require('../js/duplicates.js');
test('duplicates: strong vs weak grading', () => {
  const ex = [{ case_id: 'a', patient_name: 'A', uhid: 'U1', case_date: '2026-01-01' }];
  assert.strictEqual(Dup.findPossibleDuplicates({ patient_name: 'Z', uhid: 'U1', case_date: '2026-02-02' }, ex)[0].strength, 'weak');
  assert.strictEqual(Dup.findPossibleDuplicates({ patient_name: 'Z', uhid: 'U1', case_date: '2026-01-01' }, ex)[0].strength, 'strong');
  assert.strictEqual(Dup.findPossibleDuplicates({ patient_name: 'a', case_date: '2026-01-01' }, ex)[0].strength, 'strong');
});
