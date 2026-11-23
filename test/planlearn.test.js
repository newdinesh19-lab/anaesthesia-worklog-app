const test = global.__test, assert = global.__assert;
const P = require('../js/planner.js'); global.Planner = P; const L = require('../js/plan-learn.js'); const N = require('../js/plan-nlp.js');
const mk = (id, data) => P.normalize({ tpl_id: id, type: 'activity', data });
test('nlp: spec examples + clarification', () => {
  let r = N.parse('Study for one hour tomorrow at 7 PM.', '2026-11-23');
  assert.deepStrictEqual([r.draft.title, r.draft.date, r.draft.start, r.draft.end, r.draft.category], ['Study', '2026-11-24', '19:00', '20:00', 'study']); assert.deepStrictEqual(r.missing, []);
  r = N.parse('Remind me about the appointment next Monday.', '2026-11-23');
  assert.strictEqual(r.draft.title, 'Appointment'); assert.strictEqual(r.draft.date, '2026-11-30'); assert(r.missing.includes('time'), 'asks for time'); assert.deepStrictEqual(r.draft.reminders, [15]);
  r = N.parse('Repeat exercise three days a week.', '2026-11-23');
  assert.strictEqual(r.draft.recur.freq, 'weekly'); assert.strictEqual(r.draft.recur.days.length, 3); assert(r.missing.includes('days')); assert.strictEqual(r.draft.category, 'health');
  r = N.parse('Viva revision 25 Nov 9-11 am remind me 30 minutes before', '2026-11-23');
  assert.deepStrictEqual([r.draft.title, r.draft.date, r.draft.start, r.draft.end, r.draft.reminders[0]], ['Viva revision', '2026-11-25', '09:00', '11:00', 30]);
  r = N.parse('Gym every Mon, Wed and Fri at 6:30am for 45 minutes', '2026-11-24');
  assert.deepStrictEqual(r.draft.recur.days, [1, 3, 5]); assert.strictEqual(r.draft.date, '2026-11-25'); assert.strictEqual(r.draft.end, '07:15');
  r = N.parse('Night study 11 pm to 1 am', '2026-11-23'); assert.strictEqual(r.draft.start, '23:00'); assert.strictEqual(r.draft.end, '01:00');
  r = N.parse('Doctor appointment 2/12 at 10:30am with an alarm', '2026-11-23'); assert.strictEqual(r.draft.date, '2026-12-02'); assert(r.draft.alarm);
});
test('learn: prompts only for ended undecided items; entries replace, not duplicate', () => {
  const a = mk('a', { title: 'Study', category: 'study', date: '2026-11-23', start: '18:00', end: '19:00' });
  const occ = P.occurrences([a], '2026-11-23', '2026-11-23');
  assert.strictEqual(L.pendingPrompts(occ, P.at('2026-11-23', '18:30')).length, 0, 'not before end');
  assert.strictEqual(L.pendingPrompts(occ, P.at('2026-11-23', '19:05')).length, 1);
  assert.strictEqual(L.pendingPrompts(occ, P.at('2026-11-23', '19:05'), new Set([occ[0].key])).length, 0, 'Later snoozes');
  const done = P.occurrences([mk('a', { ...a.rec.data, status: 'completed' })], '2026-11-23', '2026-11-23'); assert.strictEqual(L.pendingPrompts(done, P.at('2026-11-24', '09:00')).length, 0, 'no re-prompt after decision');
  let es = L.addEntry([], L.entry(occ[0], 'partial', 40)); es = L.addEntry(es, L.entry(occ[0], 'completed', 70)); assert.strictEqual(es.length, 1); assert.strictEqual(es[0].aMin, 70);
});
test('learn: routine, retime, longer, clash rules need history and respect dismissals', () => {
  const now = P.at('2026-11-23', '12:00'), today = '2026-11-23';
  const ent = (k, d, st, status, pMin, aMin, extra = {}) => ({ key: k + d, eid: extra.eid || 'e-' + k, k: L.titleKey(k), title: k, cat: extra.cat || 'study', pDate: d, pStart: st, pMin, aMin, status, at: P.at(d, '23:00').toISOString(), hour: P.toMin(st), dow: P.dow(d) });
  assert.strictEqual(L.suggestions({ entries: [ent('Study', '2026-11-16', '19:00', 'completed', 60, 60)], now, today }).length, 0, 'one data point is not a pattern');
  const hist = [ent('Study', '2026-11-16', '19:00', 'completed', 60, 60), ent('Study', '2026-11-18', '19:30', 'completed', 60, 75), ent('Study', '2026-11-20', '19:00', 'completed', 60, 60)];
  const s = L.suggestions({ entries: hist, now, today }); assert.strictEqual(s[0].kind, 'routine'); assert.deepStrictEqual(s[0].action.data.recur.days, [1, 3, 5]); assert.strictEqual(s[0].action.data.start, '19:00'); assert(/3×/.test(s[0].why));
  assert.strictEqual(L.suggestions({ entries: hist, now, today, responses: { [s[0].id]: { status: 'dismissed', at: now.toISOString() } } }).filter((x) => x.kind === 'routine').length, 0, 'dismissed stays hidden');
  assert.strictEqual(L.suggestions({ entries: hist, now, today, acts: [mk('r', { title: 'Study', date: '2026-11-01', start: '19:00', end: '20:00', recur: { freq: 'weekly', days: [1] } })] }).filter((x) => x.kind === 'routine').length, 0, 'already a routine');
  // longer: 3 of last 5 ran >25 % over
  const act = mk('e-Reading', { title: 'Reading', category: 'study', date: '2026-11-01', start: '07:00', end: '07:30', recur: { freq: 'daily' } });
  const over = [1, 2, 3].map((i) => ent('Reading', `2026-11-1${i}`, '07:00', 'completed', 30, 50, { eid: 'e-Reading' }));
  const lo = L.suggestions({ entries: over, acts: [act], now, today }).find((x) => x.kind === 'longer'); assert(lo); assert.strictEqual(lo.action.patch.end, '07:45');
  // clash with duty → free slot suggestion
  const gym = mk('g', { title: 'Gym', category: 'health', date: '2026-11-24', start: '15:00', end: '16:00' });
  const up = P.occurrences([gym], today, '2026-11-30');
  const duty = P.dutyBlocks({ thanc: [{ id: 't', date: '2026-11-24', shift: 'evening', doctors: ['Me'], start: '14:00', end: '20:00' }], me: 'Me' }, today, '2026-11-30');
  const c = L.suggestions({ upcoming: up, items: [...up, ...duty], now, today, win: ['06:00', '22:00'] }).find((x) => x.kind === 'clash');
  assert(c, 'clash found'); assert.deepStrictEqual([c.action.date, c.action.start], ['2026-11-24', '13:00'], 'nearest free slot to the original time');
  // retime: postponed often, completions happen in the morning
  const morning = [ent('Run', '2026-11-10', '06:30', 'completed', 30, 30, { cat: 'health' }), ent('Swim', '2026-11-12', '06:30', 'completed', 30, 30, { cat: 'health' })];
  const late = [1, 2, 3].map((i) => ent('Yoga', `2026-11-1${i + 3}`, '20:00', 'postponed', 30, 0, { cat: 'health' }));
  const yoga = mk('y', { title: 'Yoga', category: 'health', date: '2026-11-25', start: '20:00', end: '20:30' });
  const rt = L.suggestions({ entries: [...morning, ...late], upcoming: P.occurrences([yoga], today, '2026-11-30'), now, today }).find((x) => x.kind === 'retime');
  assert(rt); assert.strictEqual(rt.action.start, '06:30');
});
test('learn: quiet hours, duty suppression, slot finder honours rest, weekly blocks avoid overbooking', () => {
  assert.strictEqual(L.suppression(P.at('2026-11-23', '23:30'), { quietStart: '22:00', quietEnd: '06:00' }), 'quiet');
  assert.strictEqual(L.suppression(P.at('2026-11-23', '23:30'), { quietStart: '22:00', quietEnd: '06:00' }, false, true), '', 'alarms may break quiet hours');
  assert.strictEqual(L.suppression(P.at('2026-11-23', '15:00'), { quietStart: '22:00', quietEnd: '06:00' }, true, false), 'duty');
  assert.strictEqual(L.suppression(P.at('2026-11-23', '15:00'), {}, false, false), '');
  const slot = L.findSlot([], '2026-11-23', 60, { win: ['05:00', '23:00'], rest: { start: '22:00', end: '07:00' } }); assert.strictEqual(slot.start, '07:00');
  const now = P.at('2026-11-23', '08:00');
  const study = [1, 2, 3].map((i) => ({ key: 's' + i, eid: 's', k: 'study', title: 'Study', cat: 'study', pMin: 60, aMin: 60, status: 'completed', at: P.at(`2026-11-1${i}`, '22:00').toISOString(), hour: 19 * 60, dow: 1 }));
  const busy = P.dutyBlocks({ thanc: [{ id: 'x', date: '2026-11-24', shift: 'morning', doctors: ['Me'], start: '07:00', end: '21:00' }], me: 'Me' }, '2026-11-23', '2026-11-29');
  const wk = L.weekPlan({ weekStart: '2026-11-23', occs: [], duty: busy, entries: study, now, win: ['06:00', '22:00'], rest: { start: '21:30', end: '06:00' } });
  assert(wk.blocks.length >= 1 && wk.blocks.length <= 3); assert(!wk.blocks.some((b) => b.date === '2026-11-24'), 'no block on the overbooked duty day'); assert(wk.blocks.every((b) => b.start === '19:00'));
  assert.strictEqual(L.weekPlan({ weekStart: '2026-11-23', entries: study, now, enabled: false }).blocks.length, 0, 'suggestions off');
});
test('planner: reminder whose time had passed when the activity was created is not announced', () => {
  const a = P.normalize({ tpl_id: 'o', type: 'activity', updated_at: new Date(2026, 10, 23, 9, 58).toISOString(), data: { title: 'Call', date: '2026-11-23', start: '10:00', end: '10:30', reminders: [10, 0] } });
  const occ = P.occurrences([a], '2026-11-23', '2026-11-23'); const due = P.dueReminders(occ, P.at('2026-11-23', '10:00'), new Set());
  assert.deepStrictEqual(due.map((d) => [d.minutes, d.obsolete]), [[10, true], [0, false]]);
});
