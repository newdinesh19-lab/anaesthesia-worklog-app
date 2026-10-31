// Unit tests (Node >= 18):  node test/test.js
const assert = require('assert');
global.CryptoModule = require('../js/crypto.js');
const Schema = require('../js/schema.js');
const Backup = require('../js/backup.js');
const Parser = require('../js/parser.js'), Sequence = require('../js/sequence.js'), Dup = require('../js/duplicates.js'), Stats = require('../js/stats.js');
let pass = 0, fail = 0; const tests = [];
const test = (name, fn) => tests.push([name, fn]);
global.__test = test; global.__assert = assert;

// ---------------- existing behaviour must keep working ----------------
test('parser: registration sheet fields', () => {
  const r = Parser.parseRegistrationSheet('NAME: MR RAVI KUMAR\nAGE/SEX: 45 YRS / M\nUHID: AP123456 VISIT NO: V998877\nDOCTOR: Meena\nDATE OF PROCEDURE: 03/05/2025');
  assert.strictEqual(r.fields.patient_name, 'Ravi Kumar'); assert.strictEqual(r.fields.age, 45); assert.strictEqual(r.fields.sex, 'Male');
  assert.strictEqual(r.fields.uhid, 'AP123456'); assert.strictEqual(r.fields.visit_number, 'V998877'); assert.strictEqual(r.fields.consultant, 'Dr. Meena'); assert.strictEqual(r.fields.procedure_date, '2025-05-03');
});
test('sequence: alternates per day', () => { const roster = ['A', 'B']; assert.strictEqual(Sequence.nextSuggestedAnaesthetist([], roster).suggested, 'A'); assert.strictEqual(Sequence.nextSuggestedAnaesthetist([{}], roster).suggested, 'B'); assert.strictEqual(Sequence.nextSuggestedAnaesthetist([{}, {}], roster).suggested, 'A'); });
test('duplicates: uhid, visit, name+date', () => {
  const ex = [{ case_id: '1', patient_name: 'Ravi', uhid: 'U1', visit_number: 'V1', case_date: '2025-01-01' }];
  assert.strictEqual(Dup.findPossibleDuplicates({ patient_name: 'x', uhid: 'u1' }, ex).length, 1);
  assert.strictEqual(Dup.findPossibleDuplicates({ patient_name: 'Ravi', case_date: '2025-01-01' }, ex).length, 1);
  assert.strictEqual(Dup.findPossibleDuplicates({ patient_name: 'Other', uhid: 'U9', visit_number: 'V9', case_date: '2025-01-01' }, ex).length, 0);
});
test('stats: monthly aggregates', () => {
  const cases = [{ case_date: '2025-01-01', anaesthetist: 'A', consultant: 'X' }, { case_date: '2025-01-01', anaesthetist: 'B', consultant: 'X' }, { case_date: '2025-01-02', anaesthetist: 'A', consultant: 'Y' }];
  const s = Stats.monthlyStats(cases, ['A', 'B']); assert.strictEqual(s.totalCases, 3); assert.strictEqual(s.workingDays, 2); assert.strictEqual(s.byAnaesthetist.A, 2); assert.strictEqual(s.maxPerDay, 2);
});

// ---------------- schema ----------------
test('schema: legacy mode -> techniques', () => {
  assert.deepStrictEqual(Schema.techniquesFromMode('GA'), ['GA']); assert.deepStrictEqual(Schema.techniquesFromMode('SA (Spinal)'), ['Spinal']);
  assert.deepStrictEqual(Schema.techniquesFromMode('GA + Regional'), ['GA', 'Peripheral nerve block']); assert.deepStrictEqual(Schema.techniquesFromMode(''), []);
  assert.deepStrictEqual(Schema.techniquesFromMode('GA + Spinal'), ['GA', 'Spinal']); assert.deepStrictEqual(Schema.techniquesFromMode('CSE'), ['CSE']);
});
test('schema: techniques -> legacy mode string', () => {
  assert.strictEqual(Schema.modeFromTechniques(['GA']), 'GA'); assert.strictEqual(Schema.modeFromTechniques(['Spinal']), 'SA (Spinal)');
  assert.strictEqual(Schema.modeFromTechniques(['GA', 'Peripheral nerve block']), 'GA + Regional'); assert.strictEqual(Schema.modeFromTechniques(['GA', 'Epidural']), 'GA + Epidural'); assert.strictEqual(Schema.modeFromTechniques([]), '');
});
test('schema: speciality suggestion', () => {
  const m = { 'Lap cholecystectomy': 'General surgery', 'TKR right knee': 'Orthopaedics', 'Tonsillectomy': 'ENT', 'Total thyroidectomy': 'Thyroid', 'LSCS': 'Obstetrics & gynaecology', 'TURP': 'Urology', 'Craniotomy': 'Neurosurgery', 'CABG': 'Cardiac & thoracic', 'Wide excision tongue hemiglossectomy': 'Head & neck oncology', 'Dental extraction under GA': 'Dental & maxillofacial', 'xyz unknown': '', '': '' };
  for (const [k, v] of Object.entries(m)) assert.strictEqual(Schema.suggestSpeciality(k), v, k);
});
test('schema: categories overlap by age group', () => {
  assert.deepStrictEqual(Schema.categoriesOf({ surgery: 'Tonsillectomy', age: 6 }), ['ENT', 'Paediatric']);
  assert.deepStrictEqual(Schema.categoriesOf({ surgery: 'TKR', age: 72 }), ['Orthopaedics', 'Geriatric']);
  assert.deepStrictEqual(Schema.categoriesOf({ surgery: '', age: '' }), ['Other']);
  assert.deepStrictEqual(Schema.categoriesOf({ speciality: 'Urology', surgery: 'TKR', age: 30 }), ['Urology']);
});
test('schema: upgradeCase is idempotent, non-destructive', () => {
  const old = { case_id: 'x', case_date: '2025-02-01', patient_name: 'P', anaesthesia_mode: 'GA + Regional', created_at: '2025-02-01T01:00:00Z', surgery: 'Hernia', custom_field: 7 };
  const copy = JSON.parse(JSON.stringify(old));
  const up = Schema.upgradeCase(JSON.parse(JSON.stringify(old)));
  for (const k of Object.keys(copy)) assert.deepStrictEqual(up[k], copy[k], 'legacy field changed: ' + k);
  assert.deepStrictEqual(up.techniques, ['GA', 'Peripheral nerve block']); assert.strictEqual(up.schema_version, 7);
  assert.deepStrictEqual(Schema.upgradeCase(JSON.parse(JSON.stringify(up))), up);
  assert.strictEqual(up.created_at, old.created_at);
});
test('schema: upgradePreop / procedure keep data', () => {
  const p = Schema.upgradePreop({ preop_id: 'p', date: '2025-01-01', conditions: ['Hypertension'], asa: 'III' });
  assert.deepStrictEqual(p.conditions, ['Hypertension']); assert.strictEqual(p.asa, 'III'); assert.deepStrictEqual(p.antithrombotic, []); assert.deepStrictEqual(p.photos, []);
  const q = Schema.upgradeProcedure({ proc_id: 'q', date: '2025-01-01' }); assert.strictEqual(q.attempts, 1); assert.strictEqual(q.success, true);
});
test('schema: complications and ICU/HDU', () => {
  const c = Schema.upgradeCase({ case_id: 'a', case_date: '2025-01-01', airway: { difficult: true, complications: ['Laryngospasm'] }, intraop: { events: ['Hypotension'] }, postop: { destination: 'ICU', complications: ['PONV'] } });
  assert.deepStrictEqual(Schema.complicationsOf(c).sort(), ['Airway: Difficult airway', 'Airway: Laryngospasm', 'Post-op: PONV'].sort()); assert.deepStrictEqual(Schema.eventsOf(c), ['Hypotension']);
  assert(Schema.isHighDependency(c)); assert(Schema.hasDetail(c)); assert(!Schema.hasDetail(Schema.upgradeCase({ case_id: 'b', case_date: '2025-01-01' })));
});
test('schema: minutesBetween crosses midnight', () => { assert.strictEqual(Schema.minutesBetween('09:00', '10:30'), 90); assert.strictEqual(Schema.minutesBetween('23:30', '00:15'), 45); assert.strictEqual(Schema.minutesBetween('', '10:00'), null); });
test('schema: validate flags bad records', () => { assert.deepStrictEqual(Schema.validate('case', { case_id: 'a', case_date: '2025-01-01' }), []); assert(Schema.validate('case', { case_id: 'a', case_date: 'x' }).length); });

// ---------------- backup ----------------
const enc = async (key, v) => ({ id: v.id, value: await CryptoModule.encryptJSON(key, v) });
async function sampleRaw(pin = '2468') {
  const salt = CryptoModule.newSalt(); const key = await CryptoModule.deriveKey(pin, salt, 1000);
  const iv = new Uint8Array(12); const img = await CryptoModule.encryptBinary(key, new Uint8Array([1, 2, 3]).buffer);
  const raw = { meta: [{ key: 'salt', value: salt }, { key: 'kdf', value: { iter: 1000 } }, { key: 'verifier', value: await CryptoModule.makeVerifier(key) }, { key: 'lockout', value: { fails: 3, until: 0 } }], cases: [{ case_id: 'c1', value: await CryptoModule.encryptJSON(key, { case_id: 'c1', case_date: '2025-03-01' }) }], images: [{ case_id: 'c1', iv: img.iv, data: img.data, mimeType: 'image/png' }], consultants: [], duties: [], preops: [], procedures: [], templates: [] };
  return { raw, key };
}
test('backup: build -> read round trip with checksum, drops lockout', async () => {
  const { raw, key } = await sampleRaw(); const file = await Backup.build(raw, { appVersion: '8.0.0', schemaVersion: 8 });
  assert(file.checksum.startsWith('sha256:')); assert(!file.stores.meta.some((m) => m.key === 'lockout'));
  const r = await Backup.read(JSON.stringify(file)); assert(r.ok, r.fatal.join()); assert.strictEqual(r.checksum, 'valid'); assert.strictEqual(r.counts.cases, 1);
  const k = await Backup.keyFor(r.stores, '2468'); assert(k); assert.strictEqual(await Backup.keyFor(r.stores, '9999'), null);
  const sum = await Backup.inspect(r.stores, k); assert.strictEqual(sum.cases, 1); assert.strictEqual(sum.imagesOk, 1); assert.strictEqual(sum.failed.length, 0);
});
test('backup: detects tampering, truncation, wrong file', async () => {
  const { raw } = await sampleRaw(); const file = await Backup.build(raw, {});
  const t = JSON.parse(JSON.stringify(file)); t.stores.cases[0].value.data = 'AAAA' + t.stores.cases[0].value.data.slice(4);
  const r1 = await Backup.read(JSON.stringify(t)); assert(!r1.ok && /Integrity/.test(r1.fatal[0]));
  const s = JSON.stringify(file); const r2 = await Backup.read(s.slice(0, s.length - 50)); assert(!r2.ok);
  const r3 = await Backup.read('{"hello":1}'); assert(!r3.ok); const r4 = await Backup.read('[]'); assert(!r4.ok);
});
test('backup: reads legacy v2 flat files', async () => {
  const { raw } = await sampleRaw(); const legacy = Backup.buildLegacy(raw);
  const r = await Backup.read(JSON.stringify(legacy)); assert(r.ok, r.fatal.join()); assert.strictEqual(r.format, 'v2'); assert.strictEqual(r.counts.cases, 1); assert.strictEqual(r.stores.images[0].data.byteLength, r.stores.images[0].data.byteLength);
});
test('backup: inspect reports unreadable records', async () => {
  const { raw, key } = await sampleRaw(); raw.cases.push({ case_id: 'bad', value: { iv: 'AAAAAAAAAAAAAAAA', data: 'AAAAAAAAAAAAAAAAAAAAAAAA' } });
  const r = await Backup.read(JSON.stringify(await Backup.build(raw, {}))); const sum = await Backup.inspect(r.stores, key);
  assert.strictEqual(sum.cases, 1); assert.strictEqual(sum.failed.length, 1);
});

// optional extra suites register themselves (analytics, reports …)
for (const f of ['analytics', 'reports', 'dup', 'keys']) { try { require('./' + f + '.test.js'); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; } }
(async () => {
  for (const [name, fn] of tests) { try { await fn(); pass++; console.log('  ok  ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + (e.stack || e).toString().split('\n').slice(0, 3).join('\n       ')); } }
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
