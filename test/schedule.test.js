const test = global.__test, assert = global.__assert;
const Sc = require('../js/schedule.js');
const mk = (id, date, time, data = {}) => ({ tpl_id: id, type: 'plan', name: data.surgery || 'x', data: { date, time, ...data } });
test('schedule: upcoming ordering, status and past filtering', () => {
  const now = new Date(2026, 10, 1, 10, 0); const plans = Sc.plansOf([mk('a', '2026-11-02', '08:00', { surgery: 'B' }), mk('b', '2026-11-01', '14:00', { surgery: 'A' }), mk('c', '2026-10-20', '08:00'), mk('d', '2026-11-03', '08:00', { status: 'cancelled' }), { tpl_id: 'z', type: 'surgery', name: 'tpl' }]);
  assert.strictEqual(plans.length, 4); assert.deepStrictEqual(Sc.upcoming(plans, now).map((p) => p.id), ['b', 'a']);
});
test('schedule: countdown text', () => {
  const p = Sc.normalize(mk('a', '2026-11-01', '13:00')); assert.strictEqual(Sc.until(p, new Date(2026, 10, 1, 10, 0)), 'in 3 h'); assert.strictEqual(Sc.until(p, new Date(2026, 9, 30, 13, 0)), 'in 2 days'); assert(/started/.test(Sc.until(p, new Date(2026, 10, 1, 13, 20))));
});
test('schedule: reminders fire once, at the right time, stale ones are silent', () => {
  const p = Sc.normalize(mk('a', '2026-11-02', '08:00', { remind: [60, 1440] }));
  assert.strictEqual(Sc.due([p], new Date(2026, 10, 1, 7, 59)).length, 0);
  assert.deepStrictEqual(Sc.due([p], new Date(2026, 10, 1, 8, 0)).map((d) => d.minutes), [1440]);
  const p2 = Sc.normalize(mk('a', '2026-11-02', '08:00', { remind: [60, 1440], fired: ['1440'] }));
  assert.deepStrictEqual(Sc.due([p2], new Date(2026, 10, 2, 7, 30)).map((d) => d.minutes), [60]);
  assert(Sc.due([p], new Date(2026, 10, 1, 20, 0)).find((d) => d.minutes === 1440).stale, 'a 12 h late reminder is stale');
  assert.strictEqual(Sc.due([Sc.normalize(mk('a', '2026-11-02', '08:00', { status: 'done' }))], new Date(2026, 10, 3)).length, 0);
});
test('schedule: ICS has alarms, escapes text and hides identifiers by default', () => {
  const p = Sc.normalize(mk('a', '2026-11-02', '08:30', { surgery: 'Thyroid; total, left', hospital: 'Apollo Spectra', location: 'OT 2', patient: 'Secret Name', uhid: 'U9', notes: 'private', remind: [15, 1440] }));
  const ics = Sc.buildICS([p]); assert(ics.includes('DTSTART:20261102T083000') && ics.includes('TRIGGER:-PT15M') && ics.includes('TRIGGER:-PT1440M') && ics.includes('Thyroid\; total\\, left') && ics.includes('LOCATION:Apollo Spectra\\, OT 2'));
  assert(!/Secret Name|U9|private/.test(ics)); assert(/Secret Name/.test(Sc.buildICS([p], { identifiers: true })));
  assert(ics.split('\r\n').every((l) => l.length <= 75));
});
test('schedule: overlap detection', () => {
  const a = Sc.normalize(mk('a', '2026-11-02', '08:00', { end_time: '10:00' })), b = Sc.normalize(mk('b', '2026-11-02', '09:30')), c = Sc.normalize(mk('c', '2026-11-02', '11:00'));
  assert.deepStrictEqual(Sc.overlaps(a, [a, b, c]).map((p) => p.id), ['b']);
});
