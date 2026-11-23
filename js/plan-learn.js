/**
 * plan-learn.js — activity history, completion prompts and explainable rule-based suggestions. Pure functions, no DOM.
 * History lives in ONE encrypted templates record (type 'plhist', id 'plhist-main') on this device only:
 * { entries: [...], responses: { ruleKey: { status: 'accepted'|'dismissed', at } } }.
 * Nothing here ever changes the calendar: every suggestion carries an action the UI applies only after the person confirms.
 */
const PlanLearn = (() => {
  const P = typeof Planner !== 'undefined' ? Planner : require('./planner.js');
  const MIN_HISTORY = 3, DISMISS_DAYS = 14, MAX_ENTRIES = 1500;
  const HIST_ID = 'plhist-main';
  const pad = (n) => String(n).padStart(2, '0');
  const hmOf = (min) => `${pad(Math.floor(((min % 1440) + 1440) % 1440 / 60))}:${pad(((min % 60) + 60) % 60)}`;
  const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const round15 = (m) => Math.max(15, Math.round(m / 15) * 15);
  /** Same activity across edits/series: normalised first words of the title. */
  const titleKey = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\b(the|a|an|my|session|block)\b/g, ' ').trim().split(/\s+/).slice(0, 3).join(' ');
  const histOf = (templates) => { const r = templates.find((t) => t.tpl_id === HIST_ID); return r ? { rec: r, entries: r.data.entries || [], responses: r.data.responses || {} } : { rec: null, entries: [], responses: {} }; };

  /** One history line per decision on an occurrence. */
  function entry(occ, status, actualMin, now = new Date()) {
    return { key: occ.key, eid: occ.eid, k: titleKey(occ.title), title: occ.title, cat: occ.category, pDate: occ.date, pStart: occ.start, pMin: occ.minutes, aMin: actualMin == null ? (status === 'completed' ? occ.minutes : 0) : Math.max(0, Math.round(actualMin)),
      status, at: now.toISOString(), hour: P.toMin(occ.start), dow: P.dow(occ.date), recurring: !!occ.recurring };
  }
  /** Add/replace the entry for an occurrence (a later decision on the same occurrence replaces the earlier one — no double counting). */
  function addEntry(entries, e) { const out = entries.filter((x) => x.key !== e.key); out.push(e); return out.slice(-MAX_ENTRIES); }

  // ------------------------------------------------------------------ completion prompts
  /** Occurrences that have ended in the last 3 days and still await a decision. snoozed: Set of keys put off with "Later". */
  function pendingPrompts(occs, now, snoozed = new Set()) {
    const lo = now.getTime() - 3 * 864e5;
    return occs.filter((o) => !o.readOnly && (o.status === 'pending' || o.status === 'in_progress') && o.endAt <= now && o.endAt.getTime() >= lo && !snoozed.has(o.key)).sort((a, b) => b.endAt - a.endAt);
  }

  // ------------------------------------------------------------------ free slots
  const inRest = (min, rest) => { if (!rest || !rest.start || !rest.end) return false; const s = P.toMin(rest.start), e = P.toMin(rest.end); return s < e ? min >= s && min < e : min >= s || min < e; };
  /** Earliest free slot of `minutes` from `fromDate` (not before `after`), within the day window and outside the rest period. */
  function findSlot(items, fromDate, minutes, { win = ['06:00', '22:00'], rest = null, after = null, days = 4, step = 15, near = null } = {}) {
    const busy = items.filter((o) => o.readOnly || !['skipped', 'completed', 'cancelled', 'partial'].includes(o.status));
    for (let d = 0; d < days; d++) {
      const day = P.addDays(fromDate, d); const found = [];
      for (let m = P.toMin(win[0]); m + minutes <= P.toMin(win[1]); m += step) {
        const s = P.at(day, hmOf(m)), e = new Date(s.getTime() + minutes * 60000);
        if (after && s < after) continue;
        let bad = false; for (let x = m; x < m + minutes; x += step) if (inRest(x, rest)) { bad = true; break; } if (bad) continue;
        if (busy.some((o) => o.startAt < e && o.endAt > s)) continue;
        if (near == null) return { date: day, start: hmOf(m), end: hmOf(m + minutes) };
        found.push(m);
      }
      if (found.length) { const m = found.sort((a, b) => Math.abs(a - near) - Math.abs(b - near))[0]; return { date: day, start: hmOf(m), end: hmOf(m + minutes) }; }
    }
    return null;
  }

  // ------------------------------------------------------------------ quiet hours / suppression
  const isQuiet = (now, qs, qe) => { if (!qs || !qe || qs === qe) return false; return inRest(now.getHours() * 60 + now.getMinutes(), { start: qs, end: qe }); };
  /** Should a reminder be silent now? → '' (deliver), 'quiet', 'duty'. Explicit alarms may break quiet hours if allowed. */
  function suppression(now, { quietStart, quietEnd, dutySilence = true, alarmsBreakQuiet = true } = {}, dutyNow = false, isAlarm = false) {
    if (isQuiet(now, quietStart, quietEnd) && !(isAlarm && alarmsBreakQuiet)) return 'quiet';
    if (dutySilence && dutyNow && !isAlarm) return 'duty';
    return '';
  }

  // ------------------------------------------------------------------ rule-based suggestions (explainable)
  const recent = (entries, days, now) => entries.filter((e) => now - new Date(e.at) <= days * 864e5);
  const blocked = (responses, id, now) => { const r = responses[id]; return r && (r.status === 'accepted' || now - new Date(r.at) < DISMISS_DAYS * 864e5); };
  const DAYN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  /**
   * → list of suggestions, best first: { id, kind, title, why, action }
   * action types: create {data}, update {eid, patch}, move {eid, orig, recurring, date, start, end}
   */
  function suggestions({ entries = [], responses = {}, acts = [], upcoming = [], items = [], now = new Date(), today, win, rest }) {
    const out = [], last28 = recent(entries, 28, now), last30 = recent(entries, 30, now);
    const byK = new Map(); for (const e of last28) { if (!byK.has(e.k)) byK.set(e.k, []); byK.get(e.k).push(e); }
    const recurringKeys = new Set(acts.filter((a) => a.recur.freq !== 'none').map((a) => titleKey(a.title)));
    // 1. routine — the same activity completed ≥3 times in 4 weeks, not already a repeating activity
    for (const [k, list] of byK) {
      const done = list.filter((e) => e.status === 'completed' || e.status === 'partial'); if (done.length < MIN_HISTORY || recurringKeys.has(k)) continue;
      const days = [...new Set(done.map((e) => e.dow))].sort(), start = hmOf(round15(median(done.map((e) => e.hour)))), mins = round15(median(done.map((e) => e.aMin || e.pMin)));
      const id = `routine:${k}`; if (blocked(responses, id, now)) continue;
      const pick = days.length >= 2 ? days : [done[done.length - 1].dow];
      out.push({ id, kind: 'routine', title: `Make “${done[done.length - 1].title}” a routine?`, why: `Done ${done.length}× in the last 4 weeks, usually around ${start}.`, detail: `Weekly on ${pick.map((d) => DAYN[d]).join(', ')} at ${start} for ${mins} min`,
        action: { type: 'create', data: { title: done[done.length - 1].title, category: done[done.length - 1].cat, start, end: hmOf(P.toMin(start) + mins), date: nextDow(today, pick), reminders: [10], recur: { freq: 'weekly', interval: 1, days: pick, until: '', count: 0 } } }, score: 3 + done.length / 10 });
    }
    // 2. often postponed/skipped — suggest the time of day this category usually gets done
    const byK30 = new Map(); for (const e of last30) { if (!byK30.has(e.k)) byK30.set(e.k, []); byK30.get(e.k).push(e); }
    for (const [k, list] of byK30) {
      const missed = list.filter((e) => e.status === 'postponed' || e.status === 'skipped'); if (missed.length < MIN_HISTORY) continue;
      const cat = missed[0].cat, catDone = last30.filter((e) => e.cat === cat && e.status === 'completed'); if (catDone.length < 2) continue;
      const better = round15(median(catDone.map((e) => e.hour))); if (Math.abs(better - median(missed.map((e) => e.hour))) < 60) continue;
      const next = upcoming.find((o) => titleKey(o.title) === k && P.OPEN.has(o.status)); if (!next) continue;
      const id = `retime:${k}:${hmOf(better)}`; if (blocked(responses, id, now)) continue;
      const len = next.minutes, end = hmOf(better + len);
      out.push({ id, kind: 'retime', title: `Try “${next.title}” at ${hmOf(better)}?`, why: `Postponed or skipped ${missed.length}× this month; you usually complete ${P.catOf(cat).label.toLowerCase()} activities around ${hmOf(better)}.`, detail: `${next.recurring ? 'All future occurrences' : 'Next one'} → ${hmOf(better)}–${end}`,
        action: next.recurring ? { type: 'update', eid: next.eid, patch: { start: hmOf(better), end } } : { type: 'move', eid: next.eid, orig: next.orig, recurring: false, date: next.date, start: hmOf(better), end }, score: 2.5 });
    }
    // 3. durations underestimated — ≥3 of the last 5 took 25 % longer than planned
    const byEid = new Map(); for (const e of last30.filter((x) => x.status === 'completed' || x.status === 'partial')) { if (!byEid.has(e.eid)) byEid.set(e.eid, []); byEid.get(e.eid).push(e); }
    for (const [eid, list] of byEid) {
      const l5 = list.slice(-5), over = l5.filter((e) => e.aMin > e.pMin * 1.25); if (over.length < MIN_HISTORY) continue;
      const a = acts.find((x) => x.id === eid); if (!a) continue; const want = round15(median(over.map((e) => e.aMin))); if (want <= P.duration(a.start, a.end)) continue;
      const id = `longer:${eid}:${want}`; if (blocked(responses, id, now)) continue;
      out.push({ id, kind: 'longer', title: `Give “${a.title}” ${want} min?`, why: `It ran longer than planned ${over.length} of the last ${l5.length} times (typically ${want} min, planned ${P.duration(a.start, a.end)}).`, detail: `${P.okTime(a.start) ? a.start : ''}–${hmOf(P.toMin(a.start) + want)}`,
        action: { type: 'update', eid, patch: { end: hmOf(P.toMin(a.start) + want) } }, score: 2 });
    }
    // 4. clash with a duty in the next 7 days → nearest free slot
    for (const o of upcoming) {
      if (!P.OPEN.has(o.status) || o.readOnly) continue;
      const duty = items.find((d) => d.readOnly && d.startAt < o.endAt && d.endAt > o.startAt); if (!duty) continue;
      const slot = findSlot(items.filter((x) => x.key !== o.key), o.date, o.minutes, { win, rest, after: now, days: 3, near: P.toMin(o.start) }); if (!slot) continue;
      const id = `clash:${o.key}`; if (blocked(responses, id, now)) continue;
      out.push({ id, kind: 'clash', title: `“${o.title}” clashes with ${duty.title}`, why: `Your ${duty.title.toLowerCase()} overlaps it on ${o.date}.`, detail: `Move to ${slot.date === o.date ? 'same day' : slot.date} ${slot.start}–${slot.end}`,
        action: { type: 'move', eid: o.eid, orig: o.orig, recurring: o.recurring, date: slot.date, start: slot.start, end: slot.end }, score: 4 });
    }
    return out.sort((a, b) => b.score - a.score);
  }
  function nextDow(today, days) { for (let i = 0; i < 7; i++) { const d = P.addDays(today, i); if (days.includes(P.dow(d))) return d; } return today; }

  // ------------------------------------------------------------------ weekly plan
  /** Overview of a week + up to 3 suggested blocks for an established study habit, never on overbooked days or in rest time. */
  function weekPlan({ weekStart, occs = [], duty = [], entries = [], now = new Date(), win = ['06:00', '22:00'], rest = null, enabled = true }) {
    const days = Array.from({ length: 7 }, (_, i) => P.addDays(weekStart, i));
    const inWeek = (o) => days.includes(o.date);
    const w = occs.filter(inWeek);
    const sum = { duties: duty.filter(inWeek).length, clinical: w.filter((o) => o.category === 'clinical').length, study: w.filter((o) => o.category === 'study').length, personal: w.filter((o) => ['personal', 'family', 'health', 'other'].includes(o.category)).length,
      unfinished: occs.filter((o) => P.OPEN.has(o.status) && o.endAt < now && o.endAt > new Date(now - 7 * 864e5)).length, free: 0, blocks: [] };
    const all = [...occs, ...duty];
    for (const d of days) sum.free += P.freeTime(all, d, win[0], win[1], 30).filter((f) => !inRest(P.toMin(f.start), rest)).reduce((s, f) => s + f.minutes, 0);
    const studyDone = recent(entries, 28, now).filter((e) => e.cat === 'study' && e.status === 'completed');
    if (enabled && studyDone.length >= MIN_HISTORY) {
      const len = round15(median(studyDone.map((e) => e.aMin || e.pMin))), pref = round15(median(studyDone.map((e) => e.hour)));
      for (const d of days) {
        if (sum.blocks.length >= 3) break; if (P.at(d, '23:59') < now) continue;
        if (w.some((o) => o.date === d && o.category === 'study')) continue;
        const free = P.freeTime(all, d, win[0], win[1], 30).filter((f) => !inRest(P.toMin(f.start), rest)), total = free.reduce((s, f) => s + f.minutes, 0);
        if (total < len + 120) continue; // keep at least 2 h free that day — no overbooking
        const fit = free.filter((f) => f.minutes >= len).sort((a, b) => Math.abs(P.toMin(a.start) - pref) - Math.abs(P.toMin(b.start) - pref))[0]; if (!fit) continue;
        const st = Math.max(P.toMin(fit.start), Math.min(pref, P.toMin(fit.end) - len));
        sum.blocks.push({ date: d, start: hmOf(st), end: hmOf(st + len), title: 'Study', category: 'study', why: `You complete study blocks of about ${len} min, usually around ${hmOf(pref)}.` });
      }
    }
    return sum;
  }
  return { HIST_ID, MIN_HISTORY, titleKey, histOf, entry, addEntry, pendingPrompts, findSlot, isQuiet, suppression, suggestions, weekPlan, round15, median, hmOf };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = PlanLearn;
if (typeof window !== 'undefined') window.PlanLearn = PlanLearn;
