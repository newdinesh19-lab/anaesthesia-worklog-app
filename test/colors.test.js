const test = global.__test, assert = global.__assert; const Th = require('../js/thanc.js');
test('doctor colours: defaults, ids, auto-assign, uniqueness', () => {
  const c = Th.config(); const by = (n) => c.docs.find((d) => d.name === n);
  assert.strictEqual(by('Dr. Karthik').color, '#2563EB'); assert.strictEqual(by('Dr. Vignesh').color, '#0D9488'); assert.strictEqual(by('Dr. Dinesh').color, '#D97706'); assert.strictEqual(by('Dr. Arafath').color, '#8B5CF6');
  assert.strictEqual(Th.colorOf(c, 'dr dinesh'), '#D97706'); assert.strictEqual(Th.idOfDoctor(c, 'Dinesh'), 'doc-dinesh');
  // new doctor gets an unused, distinguishable colour; saved colours stay put
  let cfg = Th.config({ roster: [...c.roster, 'Dr. Meena'], docs: c.docs }); const m = cfg.docs.find((d) => d.name === 'Dr. Meena'); assert(Th.hexOk(m.color));
  for (const d of cfg.docs) if (d !== m) assert(Th.colorDist(d.color, m.color) >= 90, d.name);
  assert.strictEqual(Th.colorOf(cfg, 'Dr. Karthik'), '#2563EB');
  // palette exhaustion: 40 doctors, all different colours
  const names = Array.from({ length: 40 }, (_, i) => 'Dr. Name' + i); const big = Th.config({ roster: names });
  assert.strictEqual(new Set(big.docs.map((d) => d.color)).size, big.docs.length); assert(big.docs.every((d) => Th.hexOk(d.color)));
});
test('doctor colours: rename keeps id, colour and history; inactive keeps colour; conflicts flagged', () => {
  const cfg = Th.config({ docs: Th.config().docs.map((d) => (d.name === 'Dr. Dinesh' ? { ...d, color: '#FF00AA' } : d)) });
  const p = Th.renamePatch(cfg, 'doc-dinesh', 'Dr. Dinesh Kumar'); const after = Th.config({ ...cfg, ...p });
  const d = after.docs.find((x) => x.id === 'doc-dinesh'); assert.strictEqual(d.name, 'Dr. Dinesh Kumar'); assert.strictEqual(d.color, '#FF00AA');
  assert.strictEqual(Th.colorOf(after, 'Dr. Dinesh'), '#FF00AA'); assert.strictEqual(Th.idOfDoctor(after, 'Dr. Dinesh'), 'doc-dinesh');
  assert.strictEqual(Th.renamePatch(cfg, 'doc-dinesh', 'Dr. Karthik'), null);
  const off = Th.config({ ...cfg, inactive: ['Dr. Dinesh'] }); assert.strictEqual(Th.colorOf(off, 'Dr. Dinesh'), '#FF00AA');
  assert.strictEqual(Th.colorConflict(cfg, '#2564EB', 'doc-dinesh'), 'Dr. Karthik'); assert.strictEqual(Th.colorConflict(cfg, '#2564EB', 'doc-karthik'), null);
  assert(Th.colorOf(cfg, 'Dr. Unknown Visitor').startsWith('#'));
  assert.strictEqual(Th.inkOn('#FFFF00'), '#111827'); assert.strictEqual(Th.inkOn('#2563EB'), '#FFFFFF');
});
