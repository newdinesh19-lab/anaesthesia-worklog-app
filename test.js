const assert = require('assert');
const { parseRegistrationSheet, overallConfidence } = require('../js/parser.js');
const { nextSuggestedAnaesthetist, resetSequenceFrom } = require('../js/sequence.js');
const { findPossibleDuplicates } = require('../js/duplicates.js');
const { monthlyStats, consultantByAnaesthetist, buildInsights } = require('../js/stats.js');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('ok -', name);
  } catch (e) {
    console.error('FAIL -', name);
    console.error(e);
    process.exitCode = 1;
  }
}

// ---- parser: the exact sample sheet from the spec ----
const SAMPLE = `NAME: Mr. JAYKANTH A
AGE/SEX: 26 YRS / MALE
UHID NO: SMRC.0000102777
VISIT NO: SMRCPV20703
DOCTOR: Dr. SRIVATHSAN RAMANI / Dr. ARUN KARTHIK D
DOA: 28-09-2026 12:10 PM
PAYMENT MODE: INSURANCE`;

test('parses sample registration sheet into structured fields', () => {
  const { fields, confidence } = parseRegistrationSheet(SAMPLE);
  assert.strictEqual(fields.patient_name, 'Jaykanth A');
  assert.strictEqual(fields.age, 26);
  assert.strictEqual(fields.sex, 'Male');
  assert.strictEqual(fields.uhid, 'SMRC.0000102777');
  assert.strictEqual(fields.visit_number, 'SMRCPV20703');
  assert.strictEqual(fields.consultant, 'Dr. SRIVATHSAN RAMANI / Dr. ARUN KARTHIK D');
  assert.strictEqual(fields.doa, '2026-09-28');
  assert.strictEqual(fields.payment_mode, 'Insurance');
  assert.strictEqual(confidence.patient_name, 'high');
  assert.strictEqual(confidence.uhid, 'high');
});

test('overallConfidence is 1.0 for a fully-matched clean sheet', () => {
  const { confidence } = parseRegistrationSheet(SAMPLE);
  assert.strictEqual(overallConfidence(confidence), 1);
});

test('flags missing/garbled fields as low confidence', () => {
  const noisy = `NAM3: J###\nAGE/SEX: ??\nDOA: not-a-date`;
  const { fields, confidence } = parseRegistrationSheet(noisy);
  assert.strictEqual(fields.uhid, null);
  assert.strictEqual(confidence.uhid, 'low');
  assert.strictEqual(confidence.doa, 'low');
});

test('does not confuse consultant/surgeon with anaesthetist field', () => {
  const { fields } = parseRegistrationSheet(SAMPLE);
  assert.ok(fields.consultant.includes('SRIVATHSAN'));
  assert.ok(!('anaesthetist' in fields)); // parser never sets this; app assigns separately
});

// ---- sequencing ----
const ROSTER = ['Dr. Me', 'Dr. Jagadeesh'];

test('alternates strictly within a single day', () => {
  let day = [];
  const expect = ['Dr. Me', 'Dr. Jagadeesh', 'Dr. Me', 'Dr. Jagadeesh', 'Dr. Me', 'Dr. Jagadeesh'];
  for (let i = 0; i < 6; i++) {
    const { suggested, sequence_index } = nextSuggestedAnaesthetist(day, ROSTER);
    assert.strictEqual(suggested, expect[i]);
    day.push({ case_id: 'c' + i, anaesthetist: suggested, is_override: false, sequence_index });
  }
});

test('sequence restarts independently for a new day', () => {
  const day28 = [
    { case_id: 'a', anaesthetist: 'Dr. Me' },
    { case_id: 'b', anaesthetist: 'Dr. Jagadeesh' },
    { case_id: 'c', anaesthetist: 'Dr. Me' },
    { case_id: 'd', anaesthetli: 'Dr. Jagadeesh' },
  ];
  const day29 = []; // separate day, separate counter
  const suggestion28 = nextSuggestedAnaesthetist(day28, ROSTER);
  const suggestion29 = nextSuggestedAnaesthetist(day29, ROSTER);
  assert.strictEqual(suggestion28.suggested, 'Dr. Me'); // case 5
  assert.strictEqual(suggestion29.suggested, 'Dr. Me'); // case 1 of a fresh day
});

test('manual override does not shift the underlying sequence for later cases', () => {
  // Case 1 auto->Dr. Me, Case 2 manually overridden to Dr. Me too (not Dr. Jagadeesh),
  // Case 3 should STILL suggest based on position (index 2 -> Dr. Me), not on what
  // was actually chosen for case 2.
  const day = [
    { case_id: '1', anaesthetist: 'Dr. Me', is_override: false, sequence_index: 0 },
    { case_id: '2', anaesthetist: 'Dr. Me', is_override: true, sequence_index: 1 }, // overridden
  ];
  const { suggested, sequence_index } = nextSuggestedAnaesthetist(day, ROSTER);
  assert.strictEqual(sequence_index, 2);
  assert.strictEqual(suggested, 'Dr. Me'); // index 2 % 2 == 0 -> Dr. Me, unaffected by override
});

test('resetSequenceFrom recomputes forward from a chosen case without touching earlier ones', () => {
  const day = [
    { case_id: '1', anaesthetist: 'Dr. Me', is_override: false, sequence_index: 0 },
    { case_id: '2', anaesthetist: 'Dr. Jagadeesh', is_override: false, sequence_index: 1 },
    { case_id: '3', anaesthetist: 'Dr. Me', is_override: true, sequence_index: 2 },
    { case_id: '4', anaesthetist: 'Dr. Jagadeesh', is_override: false, sequence_index: 3 },
  ];
  const result = resetSequenceFrom(day, ROSTER, '3');
  assert.strictEqual(result[0].anaesthetist, 'Dr. Me'); // untouched
  assert.strictEqual(result[1].anaesthetist, 'Dr. Jagadeesh'); // untouched
  assert.strictEqual(result[2].anaesthetist, 'Dr. Me'); // reset point = fresh index 0
  assert.strictEqual(result[3].anaesthetist, 'Dr. Jagadeesh'); // fresh index 1
});

// ---- duplicate detection ----
test('detects duplicate by UHID', () => {
  const existing = [{ case_id: 'x1', uhid: 'SMRC.0000102777', visit_number: 'V1', patient_name: 'A', case_date: '2026-09-28' }];
  const candidate = { uhid: 'SMRC.0000102777', visit_number: 'V2', patient_name: 'B', case_date: '2026-09-29' };
  const dups = findPossibleDuplicates(candidate, existing);
  assert.strictEqual(dups.length, 1);
  assert.deepStrictEqual(dups[0].matchedOn, ['UHID']);
});

test('detects duplicate by name+date, case-insensitive', () => {
  const existing = [{ case_id: 'x1', uhid: 'U1', visit_number: 'V1', patient_name: 'Jaykanth A', case_date: '2026-09-28' }];
  const candidate = { uhid: 'U2', visit_number: 'V2', patient_name: 'jaykanth   a', case_date: '2026-09-28' };
  const dups = findPossibleDuplicates(candidate, existing);
  assert.strictEqual(dups.length, 1);
});

test('no false positive for different patients on different dates', () => {
  const existing = [{ case_id: 'x1', uhid: 'U1', visit_number: 'V1', patient_name: 'A', case_date: '2026-09-28' }];
  const candidate = { uhid: 'U2', visit_number: 'V2', patient_name: 'B', case_date: '2026-09-29' };
  assert.strictEqual(findPossibleDuplicates(candidate, existing).length, 0);
});

test('editing an existing case does not flag itself as a duplicate', () => {
  const existing = [{ case_id: 'x1', uhid: 'U1', visit_number: 'V1', patient_name: 'A', case_date: '2026-09-28' }];
  const candidate = { case_id: 'x1', uhid: 'U1', visit_number: 'V1', patient_name: 'A', case_date: '2026-09-28' };
  assert.strictEqual(findPossibleDuplicates(candidate, existing).length, 0);
});

// ---- stats ----
function mkCase(date, anaesthetist, consultant) {
  return { case_date: date, anaesthetist, consultant, hospital: 'Apollo Spectra', location: 'MRC Nagar' };
}

test('monthlyStats computes totals, per-anaesthetist counts, avg/max/min', () => {
  const cases = [
    ...Array(4).fill(0).map((_, i) => mkCase('2026-09-28', i % 2 === 0 ? 'Dr. Me' : 'Dr. Jagadeesh', 'Dr. X')),
    ...Array(2).fill(0).map(() => mkCase('2026-09-29', 'Dr. Me', 'Dr. Y')),
  ];
  const stats = monthlyStats(cases, ROSTER);
  assert.strictEqual(stats.totalCases, 6);
  assert.strictEqual(stats.workingDays, 2);
  assert.strictEqual(stats.byAnaesthetist['Dr. Me'], 4);
  assert.strictEqual(stats.byAnaesthetist['Dr. Jagadeesh'], 2);
  assert.strictEqual(stats.maxPerDay, 4);
  assert.strictEqual(stats.minPerDay, 2);
  assert.strictEqual(stats.avgPerDay, 3);
  assert.strictEqual(stats.consultantCount, 2);
});

test('consultantByAnaesthetist cross-tab', () => {
  const cases = [mkCase('2026-09-01', 'Dr. Me', 'Dr. X'), mkCase('2026-09-02', 'Dr. Jagadeesh', 'Dr. X'), mkCase('2026-09-03', 'Dr. Me', 'Dr. X')];
  const tab = consultantByAnaesthetist(cases);
  assert.strictEqual(tab['Dr. X']['Dr. Me'], 2);
  assert.strictEqual(tab['Dr. X']['Dr. Jagadeesh'], 1);
});

test('insights are plain factual sentences derived only from stats', () => {
  const cases = Array(3).fill(0).map(() => mkCase('2026-09-28', 'Dr. Me', 'Dr. X'));
  const stats = monthlyStats(cases, ROSTER);
  const insights = buildInsights(stats, 'September 2026');
  assert.ok(insights[0].includes('3 total cases recorded in September 2026.'));
  assert.ok(insights.some((l) => l.includes('assigned to Dr. Me')));
});

console.log(`\n${passed} test(s) passed.`);
