const test = global.__test, assert = global.__assert; const P = require('../js/planner.js');
const mk = (id, data) => P.normalize({ tpl_id: id, type: 'activity', data });
test('planner: overnight, durations, day clipping', () => {
  assert.strictEqual(P.duration('22:00', '06:00'), 480); assert(P.isOvernight('22:00', '06:00')); assert.strictEqual(P.duration('08:00', '09:30'), 90);
  const a = mk('a1', { title: 'Night study', date: '2026-11-30', start: '22:00', end: '02:00', category: 'study' });
  const occ = P.occurrences([a], '2026-11-30', '2026-12-01'); assert.strictEqual(occ.length, 1); assert(occ[0].overnight); assert.strictEqual(occ[0].minutes, 240);
  const dec1 = P.forDay(occ, '2026-12-01'); assert.strictEqual(dec1.length, 1); assert.strictEqual(dec1[0].top, 0); assert.strictEqual(dec1[0].bottom, 120); assert(dec1[0].contFrom);
  const nov30 = P.forDay(occ, '2026-11-30'); assert.strictEqual(nov30[0].top, 1320); assert.strictEqual(nov30[0].bottom, 1440); assert(nov30[0].contTo);
  // seen from the next day's range only (starts the previous evening)
  assert.strictEqual(P.occurrences([a], '2026-12-01', '2026-12-01').length, 1);
  assert.strictEqual(P.validate({ title: 'x', date: '2026-11-30', start: '08:00', end: '08:00' }), 'End time must differ from start time');
  assert.strictEqual(P.validate({ title: '', date: '2026-11-30', start: '08:00', end: '09:00' }), 'Enter a title');
});
test('planner: recurrence rules, until/count, exceptions', () => {
  const d = mk('d', { title: 'Gym', date: '2026-11-02', start: '06:00', end: '07:00', recur: { freq: 'daily', interval: 2, until: '2026-11-10' } });
  assert.deepStrictEqual(P.seriesDates(d, '2026-11-01', '2026-11-30'), ['2026-11-02', '2026-11-04', '2026-11-06', '2026-11-08', '2026-11-10']);
  const wd = mk('w', { title: 'Rounds', date: '2026-11-06', start: '07:30', end: '08:00', recur: { freq: 'weekdays', count: 4 } }); // Fri
  assert.deepStrictEqual(P.seriesDates(wd, '2026-11-01', '2026-11-30'), ['2026-11-06', '2026-11-09', '2026-11-10', '2026-11-11']);
  const wk = mk('k', { title: 'Journal club', date: '2026-11-03', start: '18:00', end: '19:00', recur: { freq: 'weekly', interval: 2, days: [2, 4] } }); // Tue+Thu fortnightly
  assert.deepStrictEqual(P.seriesDates(wk, '2026-11-01', '2026-11-30'), ['2026-11-03', '2026-11-05', '2026-11-17', '2026-11-19']);
  const mo = mk('m', { title: 'Rent', date: '2026-01-31', start: '09:00', end: '09:15', recur: { freq: 'monthly' } });
  assert.deepStrictEqual(P.seriesDates(mo, '2026-01-01', '2026-06-30'), ['2026-01-31', '2026-03-31', '2026-05-31']);
  // exceptions: skip one, move one, status on one
  const ex = mk('x', { title: 'Study', date: '2026-11-02', start: '20:00', end: '21:00', recur: { freq: 'daily' }, overrides: { '2026-11-03': { skip: true }, '2026-11-04': { date: '2026-11-05', start: '21:30', end: '22:30' }, '2026-11-02': { status: 'completed' } } });
  const occ = P.occurrences([ex], '2026-11-02', '2026-11-05');
  assert.deepStrictEqual(occ.map((o) => `${o.orig}>${o.date} ${o.start} ${o.status}`), ['2026-11-02>2026-11-02 20:00 completed', '2026-11-05>2026-11-05 20:00 pending', '2026-11-04>2026-11-05 21:30 pending']);
  const sp = P.splitSeries(ex, '2026-11-05'); assert.strictEqual(sp.oldRecur.until, '2026-11-04'); assert(sp.oldOverrides['2026-11-03'] && !sp.newOverrides['2026-11-03']);
});
test('planner: overlaps, clashes, free time (incl. duty blocks)', () => {
  const a = mk('a', { title: 'A', date: '2026-11-23', start: '09:00', end: '10:00' }), b = mk('b', { title: 'B', date: '2026-11-23', start: '09:30', end: '11:00' }), c = mk('c', { title: 'C', date: '2026-11-23', start: '11:00', end: '12:00', status: 'completed' });
  const occ = P.occurrences([a, b, c], '2026-11-23', '2026-11-23'); const m = P.overlaps(occ);
  assert.deepStrictEqual(m.get('a@2026-11-23'), ['B']); assert(!m.has('c@2026-11-23'));
  assert.strictEqual(P.clashes(occ, '2026-11-23', '10:30', '10:45', 'zz').length, 1); assert.strictEqual(P.clashes(occ, '2026-11-23', '11:00', '11:30', 'zz').length, 0, 'completed items do not clash');
  const duty = P.dutyBlocks({ thanc: [{ id: 't1', date: '2026-11-23', shift: 'evening', doctors: ['Dr. Dinesh'], start: '14:00', end: '20:00' }], me: 'Dr. Dinesh' }, '2026-11-23', '2026-11-23');
  const free = P.freeTime([...occ, ...duty], '2026-11-23', '06:00', '22:00', 30);
  assert.deepStrictEqual(free.map((f) => `${f.start}-${f.end}`), ['06:00-09:00', '11:00-14:00', '20:00-22:00']);
});
test('planner: reminders fire once, stale detection, notification has no notes', () => {
  const a = mk('r', { title: 'Viva prep', desc: 'UHID 1234567 patient X', date: '2026-11-23', start: '10:00', end: '11:00', reminders: [15, 0, 15] });
  assert.deepStrictEqual(a.reminders, [15, 0]);
  const occ = P.occurrences([a], '2026-11-23', '2026-11-23'), fired = new Set();
  let due = P.dueReminders(occ, P.at('2026-11-23', '09:50'), fired); assert.strictEqual(due.length, 1); assert.strictEqual(due[0].minutes, 15); fired.add(due[0].key);
  due = P.dueReminders(occ, P.at('2026-11-23', '09:55'), fired); assert.strictEqual(due.length, 0, 'no duplicate');
  due = P.dueReminders(occ, P.at('2026-11-23', '10:00'), fired); assert.strictEqual(due.length, 1); assert(!due[0].stale);
  assert.deepStrictEqual(P.nextReminderAt(occ, P.at('2026-11-23', '09:00'), new Set()), P.at('2026-11-23', '09:45'));
  const n = P.notificationText(occ[0], 15); assert(!/UHID|1234567|patient/.test(n.title + n.body)); assert(/Viva prep/.test(n.title));
  // edited time → new key, fires again
  const moved = mk('r', { ...a.rec.data, start: '10:30', end: '11:30' }); const occ2 = P.occurrences([moved], '2026-11-23', '2026-11-23');
  assert.strictEqual(P.dueReminders(occ2, P.at('2026-11-23', '10:20'), fired).length, 1);
  // late reminders are stale
  assert(P.dueReminders(occ, P.at('2026-11-23', '12:30'), new Set())[0].stale);
});
test('planner: duty feed is read-only and mine-only by default; ICS has RRULE/EXDATE/VALARM; privacy guard', () => {
  const thanc = [{ id: 't1', date: '2026-11-23', shift: 'night', doctors: ['Dr. Karthik', 'Dr. Dinesh'], start: '20:00', end: '08:00' }, { id: 't2', date: '2026-11-23', shift: 'morning', doctors: ['Dr. Arafath'], start: '08:00', end: '14:00' }];
  const canon = (s) => s.replace(/^dr\.?\s*/i, '').toLowerCase();
  const mine = P.dutyBlocks({ thanc, me: 'Dinesh', canon }, '2026-11-23', '2026-11-24'); assert.strictEqual(mine.length, 1); assert(mine[0].readOnly && mine[0].overnight); assert.strictEqual((mine[0].endAt - mine[0].startAt) / 36e5, 12);
  assert.strictEqual(P.dutyBlocks({ thanc, me: 'Dinesh', canon, allThanc: true }, '2026-11-23', '2026-11-23').length, 2);
  const a = mk('ics1', { title: 'Study, block', date: '2026-11-02', start: '22:00', end: '01:00', recur: { freq: 'weekly', days: [1, 3] , until: '2026-12-31' }, reminders: [10], alarm: true, overrides: { '2026-11-04': { skip: true }, '2026-11-09': { start: '23:00' } } });
  const ics = P.buildICS([a], { now: new Date(Date.UTC(2026, 10, 23)) });
  assert(/RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261231T235959/.test(ics)); assert(/EXDATE:20261104T220000/.test(ics)); assert(/RECURRENCE-ID:20261109T220000/.test(ics));
  assert(/DTEND:20261103T010000/.test(ics), 'overnight end next day'); assert(/ACTION:AUDIO/.test(ics)); assert(/SUMMARY:Study\\, block/.test(ics));
  assert(P.looksIdentifiable('Review UHID for bed 4')); assert(P.looksIdentifiable('call 9876543210')); assert(!P.looksIdentifiable('Gym', 'Library 2nd floor'));
});
