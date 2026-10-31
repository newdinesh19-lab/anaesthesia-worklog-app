const test = global.__test, assert = global.__assert;
const C = require('../js/crypto.js'); const K = require('../js/keys.js'); const Backup = require('../js/backup.js');
const legacyMeta = async (pin) => { const salt = C.newSalt(); const key = await C.deriveKey(pin, salt, C.ITER); return { salt, kdf: null, verifier: await C.makeVerifier(key), keywrap: null }; };
const wrappedMeta = async (pin) => { const D = K.newDataKey(); const w = await K.pinWrapper(D, pin); return { D, m: { salt: w.salt, kdf: w.kdf, verifier: await C.makeVerifier(await K.aesKey(D)), keywrap: { v: 1, pin: w.pin, rec: null, q: null, bio: null } } }; };
const same = (a, b) => Buffer.from(a).equals(Buffer.from(b));

test('keys: legacy PIN database still opens; wrong PIN rejected', async () => {
  const m = await legacyMeta('4821'); assert(await K.rawWithPin('4821', m)); assert.strictEqual(await K.rawWithPin('4822', m), null); assert(!K.isWrapped(m));
});
test('keys: wrapped mode - PIN change keeps the data key; old PIN stops working', async () => {
  const { D, m } = await wrappedMeta('4821'); assert(same(await K.rawWithPin('4821', m), D));
  const w = await K.pinWrapper(D, '7391'); const m2 = { ...m, salt: w.salt, kdf: w.kdf, keywrap: { ...m.keywrap, pin: w.pin } };
  assert(same(await K.rawWithPin('7391', m2), D)); assert.strictEqual(await K.rawWithPin('4821', m2), null);
});
test('keys: recovery code opens, survives PIN change, wrong/mistyped code fails', async () => {
  const { D, m } = await wrappedMeta('4821'); const code = K.newRecoveryCode(); assert(/^([A-Z2-9]{4}-){4}[A-Z2-9]{4}$/.test(code));
  const rec = await K.recoveryWrapper(D, code);
  assert(same(await K.rawWithRecovery(code, rec, m.verifier), D)); assert(same(await K.rawWithRecovery(code.toLowerCase().replace(/-/g, ' '), rec, m.verifier), D), 'case/spacing ignored');
  const bad = code.slice(0, -1) + (code.endsWith('A') ? 'B' : 'A'); assert.strictEqual(await K.rawWithRecovery(bad, rec, m.verifier), null);
});
test('keys: security answers need both, ignore case/punctuation, wrong fails', async () => {
  const { D, m } = await wrappedMeta('4821'); const q = await K.questionWrapper(D, ['q1', 'q2'], ['St. Mary’s', 'Madurai']);
  assert(same(await K.rawWithAnswers(['st marys', 'MADURAI'], q, m.verifier), D)); assert.strictEqual(await K.rawWithAnswers(['st marys', 'chennai'], q, m.verifier), null);
  assert(K.answersOk(['abcd', 'efgh'])); assert(!K.answersOk(['abc', 'efgh'])); assert(!K.answersOk(['abcd', 'ABCD']));
});
test('keys: backup keyFor opens wrapped and legacy backups; biometric wrapper never leaves the device', async () => {
  const { D, m } = await wrappedMeta('4821'); const metaRec = (k, v) => ({ key: k, value: v });
  const stores = { meta: [metaRec('salt', m.salt), metaRec('kdf', m.kdf), metaRec('verifier', m.verifier), metaRec('keywrap', { ...m.keywrap, bio: { mode: 'prf', credId: 'x' } })] };
  assert(await Backup.keyFor(stores, '4821')); assert.strictEqual(await Backup.keyFor(stores, '0000'), null);
  const built = await Backup.build({ meta: stores.meta, cases: [], images: [], consultants: [], duties: [], preops: [], procedures: [], templates: [] }); assert.strictEqual(built.stores.meta.find((x) => x.key === 'keywrap').value.bio, null);
  const lm = await legacyMeta('4821'); assert(await Backup.keyFor({ meta: [metaRec('salt', lm.salt), metaRec('verifier', lm.verifier)] }, '4821'));
});
