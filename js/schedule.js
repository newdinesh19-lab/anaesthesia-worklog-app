/**
 * schedule.js — planned cases: normalising, reminder timing and .ics (phone calendar) export. Pure functions, no DOM.
 * A plan is stored in the existing encrypted 'templates' store with type 'plan', so backups, PIN change and restore already cover it.
 */
const Schedule = (() => {
  const REMIND = [[0, 'At start time'], [15, '15 min before'], [60, '1 hour before'], [180, '3 hours before'], [1440, '1 day before']];
  const DEFAULT_REMIND = [60, 1440];
  const pad = (n) => String(n).padStart(2, '0');
  /** Local Date from 'YYYY-MM-DD' and 'HH:MM' (time optional -> 08:00 so all-day plans still sort and remind sensibly). */
  function startOf(d) { if (!d || !d.date) return null; const [y, m, day] = d.date.split('-').map(Number); const [hh, mm] = (d.time || '08:00').split(':').map(Number); return new Date(y, m - 1, day, hh || 0, mm || 0, 0, 0); }
  function endOf(d) { const s = startOf(d); if (!s) return null; if (d.end_time) { const [hh, mm] = d.end_time.split(':').map(Number); const e = new Date(s); e.setHours(hh, mm, 0, 0); if (e > s) return e; } return new Date(s.getTime() + 3600000); }
  function normalize(t) {
    const d = t.data || {};
    return { id: t.tpl_id, rec: t, title: t.name || d.surgery || 'Planned case', date: d.date || '', time: d.time || '', end_time: d.end_time || '', surgery: d.surgery || '', hospital: d.hospital || '', location: d.location || '', consultant: d.consultant || '', anaesthetist: d.anaesthetist || '',
      patient: d.patient || '', uhid: d.uhid || '', techniques: d.techniques || [], urgency: d.urgency || '', notes: d.notes || '', remind: Array.isArray(d.remind) ? d.remind : DEFAULT_REMIND, status: d.status || 'planned', fired: d.fired || [], case_id: d.case_id || '', deleted: !!t.deleted_at };
  }
  const isPlan = (t) => t && t.type === 'plan';
  const plansOf = (templates) => templates.filter(isPlan).map(normalize).filter((p) => !p.deleted && p.date);
  const cmp = (a, b) => (a.date + (a.time || '08:00')).localeCompare(b.date + (b.time || '08:00'));
  const upcoming = (plans, now = new Date()) => plans.filter((p) => p.status === 'planned' && endOf(p) >= new Date(now.getTime() - 3600000)).sort(cmp);
  /** Human countdown: 'in 3 h', 'in 2 days', 'now', 'started 20 min ago'. */
  function until(p, now = new Date()) {
    const ms = startOf(p) - now, a = Math.abs(ms), min = Math.round(a / 60000);
    const days = a / 864e5; const t = days >= 60 ? `${Math.round(days / 30)} months` : min < 60 ? `${min} min` : min < 1440 ? `${Math.round(min / 6) / 10} h`.replace('.0', '') : `${Math.round(min / 144) / 10} days`.replace('.0', '');
    return Math.abs(ms) < 60000 ? 'now' : ms > 0 ? `in ${t}` : `started ${t} ago`;
  }
  /** Reminders whose time has come and that have not fired yet. -> [{plan, minutes, key, late}] ; reminders >2 h overdue are returned as stale so they can be marked without alerting. */
  function due(plans, now = new Date()) {
    const out = [];
    for (const p of plans) {
      if (p.status !== 'planned') continue; const s = startOf(p); if (!s) continue;
      for (const m of p.remind) {
        const key = String(m); if (p.fired.includes(key)) continue;
        const fireAt = new Date(s.getTime() - m * 60000); if (now < fireAt) continue;
        out.push({ plan: p, minutes: m, key, stale: now - fireAt > 2 * 3600000 || now > endOf(p) });
      }
    }
    return out;
  }
  const esc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  function fold(line) { const out = []; let rest = line; while (rest.length > 74) { out.push(rest.slice(0, 74)); rest = ' ' + rest.slice(74); } out.push(rest); return out.join('\r\n'); }
  const stamp = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
  /** opts.identifiers: include patient name / UHID / notes (default false: they would sit unencrypted in your calendar). */
  function buildICS(plans, opts = {}) {
    const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Anaesthesia Log//Planned cases//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
    const now = new Date(); const utc = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}00Z`;
    for (const p of plans) {
      const s = startOf(p), e = endOf(p); if (!s) continue;
      const desc = [p.consultant && `Consultant: ${p.consultant}`, p.anaesthetist && `Anaesthetist: ${p.anaesthetist}`, p.techniques.length && `Plan: ${p.techniques.join(' + ')}`, p.urgency && p.urgency, opts.identifiers && p.patient && `Patient: ${p.patient}${p.uhid ? ' (' + p.uhid + ')' : ''}`, opts.identifiers && p.notes].filter(Boolean).join('\n');
      L.push('BEGIN:VEVENT', `UID:${p.id}@anaesthesia-log`, `DTSTAMP:${utc}`, `DTSTART:${stamp(s)}`, `DTEND:${stamp(e)}`, fold(`SUMMARY:${esc('Anaesthesia: ' + (p.surgery || 'planned case'))}`));
      const loc = [p.hospital, p.location].filter(Boolean).join(', '); if (loc) L.push(fold(`LOCATION:${esc(loc)}`));
      if (desc) L.push(fold(`DESCRIPTION:${esc(desc)}`));
      for (const m of p.remind) L.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc('Planned case' + (m ? ` in ${m >= 60 ? m / 60 + ' h' : m + ' min'}` : ' now'))}`, `TRIGGER:-PT${m}M`, 'END:VALARM');
      L.push('END:VEVENT');
    }
    L.push('END:VCALENDAR'); return L.join('\r\n') + '\r\n';
  }
  /** Plans clashing with another planned case at the same time (same start day, overlapping). */
  function overlaps(p, plans) { const s = startOf(p), e = endOf(p); return plans.filter((o) => o.id !== p.id && o.status === 'planned' && startOf(o) < e && endOf(o) > s); }
  return { REMIND, DEFAULT_REMIND, startOf, endOf, normalize, isPlan, plansOf, upcoming, until, due, buildICS, overlaps, cmp };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Schedule;
if (typeof window !== 'undefined') window.Schedule = Schedule;
