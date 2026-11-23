/**
 * planner.js — personal 24-hour planner engine. Pure functions, no DOM.
 * Activities live in the existing encrypted 'templates' store as type 'activity' (no IndexedDB version change),
 * so PIN change, backup/restore and the recycle bin already cover them.
 *
 * Times are local wall-clock ('YYYY-MM-DD' + 'HH:MM'), like a phone calendar: Date objects are only built when
 * needed, so daylight-saving and timezone changes are handled by the device clock at that moment.
 * An end time at or before the start time means the activity runs past midnight (overnight).
 */
const Planner = (() => {
  const CATEGORIES = [
    { id: 'clinical', label: 'Clinical', color: '#2563EB' },
    { id: 'study', label: 'Study', color: '#7C3AED' },
    { id: 'personal', label: 'Personal', color: '#0D9488' },
    { id: 'family', label: 'Family', color: '#DB2777' },
    { id: 'health', label: 'Health', color: '#16A34A' },
    { id: 'other', label: 'Other', color: '#64748B' },
  ];
  /** Lifecycle. 'pending' is stored for Planned (kept for compatibility); 'in_progress' is also derived while an activity is running. */
  const STATUSES = [['pending', 'Planned'], ['in_progress', 'In progress'], ['completed', 'Completed'], ['partial', 'Partly done'], ['skipped', 'Skipped'], ['postponed', 'Postponed'], ['cancelled', 'Cancelled']];
  const statusLabel = (s) => (STATUSES.find((x) => x[0] === s) || STATUSES[0])[1];
  const OPEN = new Set(['pending', 'in_progress', 'postponed']);
  /** Status shown now: planned items that are running are 'in progress'. */
  const liveStatus = (o, now = new Date()) => (o.status === 'pending' && o.startAt <= now && o.endAt > now ? 'in_progress' : o.status);
  const REMINDERS = [0, 5, 10, 15, 30, 60];
  const FREQS = [['none', 'Does not repeat'], ['daily', 'Every day'], ['weekdays', 'Weekdays (Mon–Fri)'], ['weekly', 'Weekly'], ['monthly', 'Monthly (same date)']];
  const catOf = (id) => CATEGORIES.find((c) => c.id === id) || CATEGORIES[5];
  const pad = (n) => String(n).padStart(2, '0');
  const okDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
  const okTime = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s || ''));
  const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const parse = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
  const iso = (dt) => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
  const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
  const at = (date, time) => { const [y, m, d] = date.split('-').map(Number); const [hh, mm] = time.split(':').map(Number); return new Date(y, m - 1, d, hh, mm, 0, 0); };
  const dow = (s) => parse(s).getDay();
  const daysBetween = (a, b) => Math.round((Date.UTC(...b.split('-').map((x, i) => (i === 1 ? x - 1 : +x))) - Date.UTC(...a.split('-').map((x, i) => (i === 1 ? x - 1 : +x)))) / 864e5);
  /** Duration in minutes; end <= start rolls into the next day. */
  const duration = (start, end) => { const d = toMin(end) - toMin(start); return d > 0 ? d : d + 1440; };
  const isOvernight = (start, end) => toMin(end) <= toMin(start);

  // ------------------------------------------------------------------ records
  const isActivity = (t) => t && t.type === 'activity';
  function normalize(t) {
    const d = t.data || {};
    const recur = d.recur || {};
    return {
      id: t.tpl_id, rec: t, title: d.title || t.name || 'Untitled', desc: d.desc || '', location: d.location || '', notes: d.notes || '',
      category: catOf(d.category).id, date: d.date || '', start: d.start || '', end: d.end || '',
      recur: { freq: recur.freq || 'none', interval: Math.max(1, +recur.interval || 1), days: Array.isArray(recur.days) ? recur.days.map(Number) : [], until: recur.until || '', count: +recur.count || 0 },
      reminders: Array.isArray(d.reminders) ? [...new Set(d.reminders.map(Number).filter((m) => m >= 0))].sort((a, b) => b - a) : [], alarm: !!d.alarm,
      status: d.status || 'pending', overrides: d.overrides || {}, gcal: d.gcal || null, dirty: !!d.dirty,
      created_at: t.created_at, updated_at: t.updated_at, deleted: !!t.deleted_at,
    };
  }
  const activitiesOf = (templates) => templates.filter(isActivity).map(normalize).filter((a) => !a.deleted && okDate(a.date) && okTime(a.start) && okTime(a.end));

  /** Validate the editable fields of the quick form. Returns an error string or ''. */
  function validate(f) {
    if (!String(f.title || '').trim()) return 'Enter a title';
    if (!okDate(f.date)) return 'Choose a date';
    if (!okTime(f.start) || !okTime(f.end)) return 'Enter start and end times';
    if (f.start === f.end) return 'End time must differ from start time';
    const r = f.recur || {};
    if (r.freq === 'weekly' && r.days && !r.days.length) return 'Pick at least one weekday';
    if (r.until && okDate(r.until) && r.until < f.date) return 'Repeat-until date is before the first date';
    return '';
  }

  // ------------------------------------------------------------------ recurrence
  /** Original (series) dates of an activity between from..to inclusive. Guarded against runaway series. */
  function seriesDates(a, from, to) {
    const r = a.recur, out = [];
    if (r.freq === 'none') { if (a.date >= from && a.date <= to) out.push(a.date); return out; }
    const end = r.until && r.until < to ? r.until : to;
    let n = 0, d = a.date, guard = 0;
    const take = (x) => { n++; if (r.count && n > r.count) return false; if (x >= from && x <= end) out.push(x); return true; };
    if (r.freq === 'daily') { for (; d <= end && guard < 20000; d = addDays(d, r.interval), guard++) if (!take(d)) break; return out; }
    if (r.freq === 'weekdays') { for (; d <= end && guard < 20000; d = addDays(d, 1), guard++) { const w = dow(d); if (w === 0 || w === 6) continue; if (!take(d)) break; } return out; }
    if (r.freq === 'weekly') {
      const days = r.days.length ? r.days : [dow(a.date)];
      for (; d <= end && guard < 20000; d = addDays(d, 1), guard++) {
        const wk = Math.floor((daysBetween(a.date, d) + dow(a.date)) / 7); if (wk % r.interval !== 0) continue;
        if (!days.includes(dow(d))) continue; if (!take(d)) break;
      }
      return out;
    }
    if (r.freq === 'monthly') {
      const [y0, m0, d0] = a.date.split('-').map(Number);
      for (let k = 0; guard < 2400; k += r.interval, guard++) {
        const t = new Date(y0, m0 - 1 + k, 1); const dim = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
        if (d0 > dim) continue; // e.g. 31st in a 30-day month: skipped, like most calendars
        const x = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(d0)}`; if (x > end) break; if (!take(x)) break;
      }
      return out;
    }
    return out;
  }

  /** Concrete occurrences overlapping [from 00:00, to+1 00:00). Overrides (per original date) can skip, move, retime or set status. */
  function occurrences(acts, from, to) {
    const out = [], lo = at(from, '00:00'), hi = at(addDays(to, 1), '00:00');
    for (const a of acts) {
      for (const orig of seriesDates(a, addDays(from, -1), to)) {
        const o = a.overrides[orig] || {};
        if (o.skip) continue;
        const date = okDate(o.date) ? o.date : orig, start = okTime(o.start) ? o.start : a.start, end = okTime(o.end) ? o.end : a.end;
        const startAt = at(date, start), endAt = new Date(startAt.getTime() + duration(start, end) * 60000);
        if (endAt <= lo || startAt >= hi) continue;
        out.push({ key: `${a.id}@${orig}`, eid: a.id, orig, date, start, end, startAt, endAt, overnight: isOvernight(start, end), minutes: duration(start, end),
          title: o.title || a.title, category: a.category, color: catOf(a.category).color, status: o.status || (a.recur.freq === 'none' ? a.status : 'pending'),
          recurring: a.recur.freq !== 'none', moved: !!(o.date || o.start || o.end), act: a, src: a.gcal && a.gcal.origin === 'google' ? 'google' : 'activity' });
      }
    }
    return out.sort((x, y) => x.startAt - y.startAt || x.title.localeCompare(y.title));
  }
  /** Occurrences touching one calendar day, clipped minutes for the day grid. */
  function forDay(items, day) {
    const lo = at(day, '00:00'), hi = at(addDays(day, 1), '00:00');
    return items.filter((o) => o.endAt > lo && o.startAt < hi).map((o) => ({ ...o, top: Math.max(0, (o.startAt - lo) / 60000), bottom: Math.min(1440, (o.endAt - lo) / 60000), contFrom: o.startAt < lo, contTo: o.endAt > hi }));
  }

  // ------------------------------------------------------------------ overlap + free time
  const ACTIVE = (o) => !['skipped', 'completed', 'cancelled', 'partial'].includes(o.status) || o.readOnly;
  /** Pairs of overlapping items (activities and/or read-only duty blocks). → Map key → [other titles]. */
  function overlaps(items) {
    const list = items.filter(ACTIVE).sort((a, b) => a.startAt - b.startAt), m = new Map();
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length && list[j].startAt < list[i].endAt; j++) {
      const a = list[i], b = list[j]; if (b.startAt >= a.endAt) continue;
      if (!m.has(a.key)) m.set(a.key, []); if (!m.has(b.key)) m.set(b.key, []);
      m.get(a.key).push(b.title); m.get(b.key).push(a.title);
    }
    return m;
  }
  /** Clash check for a proposed slot (used while editing). */
  function clashes(items, date, start, end, ignoreEid) {
    const s = at(date, start), e = new Date(s.getTime() + duration(start, end) * 60000);
    return items.filter((o) => o.eid !== ignoreEid && ACTIVE(o) && o.startAt < e && o.endAt > s);
  }
  /** Free gaps (≥ minGap minutes) inside the day window, around active items. */
  function freeTime(items, day, winStart = '06:00', winEnd = '22:00', minGap = 30) {
    const lo = at(day, winStart).getTime(), hi = at(day, winEnd).getTime(); if (hi <= lo) return [];
    const busy = items.filter(ACTIVE).map((o) => [Math.max(lo, o.startAt.getTime()), Math.min(hi, o.endAt.getTime())]).filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
    const out = []; let cur = lo;
    for (const [a, b] of busy) { if (a - cur >= minGap * 60000) out.push([cur, a]); cur = Math.max(cur, b); }
    if (hi - cur >= minGap * 60000) out.push([cur, hi]);
    const hm = (ms) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
    return out.map(([a, b]) => ({ start: hm(a), end: hm(b), minutes: Math.round((b - a) / 60000) }));
  }

  // ------------------------------------------------------------------ reminders
  /** Reminders whose time has come. firedKeys: Set of already-fired keys (device-local, so nothing fires twice). Stale = more than 2 h late or after the end. */
  function dueReminders(occs, now, firedKeys) {
    const out = [];
    for (const o of occs) {
      if (!OPEN.has(o.status)) continue;
      for (const m of o.act.reminders) {
        const key = `${o.key}|${m}|${o.date}T${o.start}`; if (firedKeys.has(key)) continue;
        const fireAt = new Date(o.startAt.getTime() - m * 60000); if (now < fireAt) continue;
        const setAt = o.act.updated_at ? new Date(o.act.updated_at) : null; // reminder time had already passed when the activity was created/edited → nothing to announce
        out.push({ occ: o, minutes: m, key, fireAt, stale: now - fireAt > 2 * 3600000 || now > o.endAt, obsolete: !!(setAt && fireAt < setAt && m > 0) });
      }
    }
    return out.sort((a, b) => a.fireAt - b.fireAt);
  }
  /** Next reminder moment after now (to schedule a precise timer instead of polling only). */
  function nextReminderAt(occs, now, firedKeys) {
    let best = null;
    for (const o of occs) { if (!OPEN.has(o.status)) continue; for (const m of o.act.reminders) { const key = `${o.key}|${m}|${o.date}T${o.start}`; if (firedKeys.has(key)) continue; const t = new Date(o.startAt.getTime() - m * 60000); if (t > now && (!best || t < best)) best = t; } }
    return best;
  }
  const reminderLabel = (m) => (m === 0 ? 'At start time' : m >= 60 ? `${m / 60} h before` : `${m} min before`);
  /** Notification text: title, time and category only — never descriptions/notes (they could contain patient details). */
  function notificationText(o, minutes) {
    const t12 = (t) => { const [h, mm] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${pad(mm)} ${h < 12 ? 'am' : 'pm'}`; };
    return { title: minutes === 0 ? `Now: ${o.title}` : `In ${minutes >= 60 ? minutes / 60 + ' h' : minutes + ' min'}: ${o.title}`, body: `${t12(o.start)}–${t12(o.end)} · ${catOf(o.category).label}` };
  }

  // ------------------------------------------------------------------ editing helpers (recurrence-aware)
  /** Change one occurrence only. */
  const overrideOne = (a, orig, patch) => ({ ...a.overrides, [orig]: { ...(a.overrides[orig] || {}), ...patch } });
  /** Split a series at an occurrence: the old series ends the day before, the returned data starts a new series from that date. */
  function splitSeries(a, orig) {
    const before = { ...a.recur, until: addDays(orig, -1), count: 0 };
    const keep = {}, move = {};
    for (const [k, v] of Object.entries(a.overrides)) (k < orig ? keep : move)[k] = v;
    return { oldRecur: before, oldOverrides: keep, newOverrides: move };
  }

  // ------------------------------------------------------------------ search
  function search(acts, q, cats) {
    const s = String(q || '').trim().toLowerCase(); const cs = cats && cats.length ? new Set(cats) : null;
    return acts.filter((a) => (!cs || cs.has(a.category)) && (!s || [a.title, a.desc, a.location, a.notes, catOf(a.category).label].join(' ').toLowerCase().includes(s)))
      .sort((x, y) => (y.date + y.start).localeCompare(x.date + x.start));
  }

  // ------------------------------------------------------------------ duty + OT feed (read-only)
  /** Read-only blocks from THANC records, personal night duties and planned OT cases. Never written back. */
  function dutyBlocks({ thanc = [], legacy = [], plans = [], me = '', canon = (x) => x, allThanc = false }, from, to) {
    const out = [], lo = at(from, '00:00'), hi = at(addDays(to, 1), '00:00'), meK = canon(me);
    const push = (o) => { if (o.endAt > lo && o.startAt < hi) out.push(o); };
    const LBL = { morning: 'Morning', evening: 'Evening', night: 'Night' };
    for (const r of thanc) {
      if (!okDate(r.date) || r.date < addDays(from, -1) || r.date > to) continue;
      const mine = (r.doctors || []).some((n) => canon(n) === meK); if (!mine && !allThanc) continue;
      let s = r.start, e = r.end; const own = r.myTimes; if (own && okTime(own.start) && okTime(own.end)) { s = own.start; e = own.end; }
      if (!okTime(s) || !okTime(e) || s === e) continue;
      const startAt = at(r.date, s);
      push({ key: `duty:${r.id}`, src: 'thanc', readOnly: true, date: r.date, start: s, end: e, startAt, endAt: new Date(startAt.getTime() + duration(s, e) * 60000), overnight: isOvernight(s, e), title: `THANC ${LBL[r.shift] || 'Duty'} duty`, sub: (r.doctors || []).join(', '), mine, color: '#F59E0B', status: 'pending', shift: r.shift });
    }
    for (const d of legacy) {
      if (!okDate(d.date) || !okTime(d.start) || !okTime(d.end) || d.start === d.end) continue;
      const startAt = at(d.date, d.start);
      push({ key: `night:${d.duty_id}`, src: 'night', readOnly: true, date: d.date, start: d.start, end: d.end, startAt, endAt: new Date(startAt.getTime() + duration(d.start, d.end) * 60000), overnight: isOvernight(d.start, d.end), title: `Night duty${d.hospital ? ' · ' + d.hospital : ''}`, sub: d.location || '', mine: true, color: '#4F46E5', status: 'pending' });
    }
    for (const p of plans) {
      if (p.status !== 'planned' || !okDate(p.date)) continue;
      const s = okTime(p.time) ? p.time : '08:00', e = okTime(p.end_time) && p.end_time !== s ? p.end_time : `${pad((toMin(s) / 60 + 1) % 24 | 0)}:${pad(toMin(s) % 60)}`;
      const startAt = at(p.date, s);
      push({ key: `plan:${p.id}`, src: 'plan', readOnly: true, date: p.date, start: s, end: e, startAt, endAt: new Date(startAt.getTime() + duration(s, e) * 60000), overnight: isOvernight(s, e), title: `OT: ${p.surgery || 'Planned case'}`, sub: [p.hospital, p.location].filter(Boolean).join(' · '), mine: true, color: '#0EA5E9', status: 'pending' });
    }
    return out.sort((a, b) => a.startAt - b.startAt);
  }

  // ------------------------------------------------------------------ .ics export (guaranteed phone alarms)
  const esc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  const fold = (line) => { const out = []; let rest = line; while (rest.length > 74) { out.push(rest.slice(0, 74)); rest = ' ' + rest.slice(74); } out.push(rest); return out.join('\r\n'); };
  const stamp = (date, time) => `${date.replace(/-/g, '')}T${time.replace(':', '')}00`;
  const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
  function rrule(a) {
    const r = a.recur; if (r.freq === 'none') return '';
    const parts = [];
    if (r.freq === 'daily') parts.push('FREQ=DAILY', r.interval > 1 && `INTERVAL=${r.interval}`);
    if (r.freq === 'weekdays') parts.push('FREQ=WEEKLY', 'BYDAY=MO,TU,WE,TH,FR');
    if (r.freq === 'weekly') parts.push('FREQ=WEEKLY', r.interval > 1 && `INTERVAL=${r.interval}`, `BYDAY=${(r.days.length ? r.days : [dow(a.date)]).sort().map((d) => BYDAY[d]).join(',')}`);
    if (r.freq === 'monthly') parts.push('FREQ=MONTHLY', r.interval > 1 && `INTERVAL=${r.interval}`, `BYMONTHDAY=${+a.date.slice(8)}`);
    if (r.until) parts.push(`UNTIL=${r.until.replace(/-/g, '')}T235959`); else if (r.count) parts.push(`COUNT=${r.count}`);
    return 'RRULE:' + parts.filter(Boolean).join(';');
  }
  function buildICS(acts, opts = {}) {
    const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Anaesthesia Log//Planner//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
    const now = opts.now || new Date(); const dts = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}00Z`;
    const ev = (a, date, start, end, extra) => {
      const endDate = isOvernight(start, end) ? addDays(date, 1) : date;
      L.push('BEGIN:VEVENT', `UID:${a.id}@anaesthesia-log-planner`, `DTSTAMP:${dts}`, `DTSTART:${stamp(date, start)}`, `DTEND:${stamp(endDate, end)}`, fold(`SUMMARY:${esc(a.title)}`), `CATEGORIES:${catOf(a.category).label.toUpperCase()}`);
      if (a.location) L.push(fold(`LOCATION:${esc(a.location)}`));
      if (opts.details && a.desc) L.push(fold(`DESCRIPTION:${esc(a.desc)}`));
      extra.forEach((x) => L.push(x));
      for (const m of a.reminders) L.push('BEGIN:VALARM', `ACTION:${a.alarm ? 'AUDIO' : 'DISPLAY'}`, `DESCRIPTION:${esc(a.title)}`, `TRIGGER:-PT${m}M`, 'END:VALARM');
      L.push('END:VEVENT');
    };
    for (const a of acts) {
      const rr = rrule(a), ex = [], moved = [];
      for (const [k, o] of Object.entries(a.overrides)) { if (o.skip) ex.push(`EXDATE:${stamp(k, a.start)}`); else if (o.date || o.start || o.end) moved.push([k, o]); }
      ev(a, a.date, a.start, a.end, [rr, ...ex].filter(Boolean));
      if (rr) for (const [k, o] of moved) ev(a, o.date || k, o.start || a.start, o.end || a.end, [`RECURRENCE-ID:${stamp(k, a.start)}`]);
    }
    L.push('END:VCALENDAR'); return L.join('\r\n') + '\r\n';
  }

  // ------------------------------------------------------------------ privacy guard for external sync
  /** True if text looks like it carries patient identifiers (UHID/IP/MRN numbers, 'patient', long digit runs). Such activities are never uploaded. */
  const looksIdentifiable = (...texts) => texts.some((t) => /\b(uhid|ip\s*no|mrn|patient|pt\.?\s*name|bed\s*no)\b/i.test(String(t || '')) || /\d{6,}/.test(String(t || '')));

  return { CATEGORIES, STATUSES, statusLabel, OPEN, liveStatus, REMINDERS, FREQS, catOf, okDate, okTime, toMin, parse, iso, addDays, at, dow, duration, isOvernight, isActivity, normalize, activitiesOf, validate,
    seriesDates, occurrences, forDay, overlaps, clashes, freeTime, dueReminders, nextReminderAt, reminderLabel, notificationText, overrideOne, splitSeries, search, dutyBlocks, rrule, buildICS, looksIdentifiable };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Planner;
if (typeof window !== 'undefined') window.Planner = Planner;
