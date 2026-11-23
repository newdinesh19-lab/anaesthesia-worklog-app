/**
 * gcal.js — OPTIONAL Google Calendar connection for the personal planner (off by default).
 * - Explicit consent required; your own Google OAuth Client ID (see README) — nothing is sent anywhere until you connect.
 * - Access token is kept in memory only (never stored); sign in again after the app restarts.
 * - Import: events from ONE chosen calendar (−30 … +120 days) become read/write planner activities (origin 'google'),
 *   matched by Google event id → never duplicated.
 * - Export / two-way: only planner activities in the categories you allow, only title + time + location
 *   (never descriptions or notes), and never anything that looks like patient information. Clinical logbook data is never touched.
 * - Offline edits are flagged 'dirty' and pushed on the next sync; a change on both sides is kept as a conflict for you to resolve.
 */
const GCal = (() => {
  const API = 'https://www.googleapis.com/calendar/v3';
  const SCOPE = 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly';
  let token = null, tokenExp = 0, gisLoading = null;
  const P = typeof Planner !== 'undefined' ? Planner : null;
  const pad = (n) => String(n).padStart(2, '0');
  const DEFAULTS = { clientId: '', consent: false, calendarId: '', calendarName: '', mode: 'import', pushCats: ['study', 'personal', 'family', 'health', 'other'], lastSync: '', lastError: '', lastCounts: null };
  const cfgOf = (settings) => ({ ...DEFAULTS, ...((settings && settings.gcal) || {}) });
  const signedIn = () => !!token && Date.now() < tokenExp;

  function loadGIS() {
    if (window.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
    if (gisLoading) return gisLoading;
    gisLoading = new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.onload = () => res(); s.onerror = () => { gisLoading = null; rej(new Error('Could not load Google sign-in (offline?)')); }; document.head.appendChild(s); });
    return gisLoading;
  }
  async function signIn(clientId, interactive = true) {
    if (!clientId) throw new Error('Add your Google OAuth Client ID first');
    if (!navigator.onLine) throw new Error('You are offline');
    await loadGIS();
    return new Promise((res, rej) => {
      const tc = google.accounts.oauth2.initTokenClient({ client_id: clientId, scope: SCOPE, callback: (r) => { if (r && r.access_token) { token = r.access_token; tokenExp = Date.now() + ((+r.expires_in || 3600) - 60) * 1000; res(true); } else rej(new Error((r && r.error) || 'Sign-in cancelled')); }, error_callback: (e) => rej(new Error((e && e.message) || 'Sign-in failed')) });
      tc.requestAccessToken({ prompt: interactive ? 'consent' : '' });
    });
  }
  function signOut() { if (token && window.google && google.accounts && google.accounts.oauth2) try { google.accounts.oauth2.revoke(token, () => {}); } catch (e) { /* ignore */ } token = null; tokenExp = 0; }
  async function api(path, { method = 'GET', body, headers = {} } = {}) {
    if (!signedIn()) { const e = new Error('Sign in to Google to sync'); e.code = 'auth'; throw e; }
    const r = await fetch(API + path, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
    if (r.status === 401) { token = null; const e = new Error('Google sign-in expired — sign in again'); e.code = 'auth'; throw e; }
    if (r.status === 412) { const e = new Error('changed on Google'); e.code = 'conflict'; throw e; }
    if (r.status === 204 || r.status === 410) return null;
    if (!r.ok) { let msg = r.statusText; try { msg = (await r.json()).error.message || msg; } catch (x) { /* keep */ } const e = new Error(`Google: ${msg}`); e.code = r.status; throw e; }
    return r.json();
  }
  const listCalendars = async () => ((await api('/users/me/calendarList?minAccessRole=writer')).items || []).map((c) => ({ id: c.id, name: c.summaryOverride || c.summary, primary: !!c.primary }));

  // ------------------------------------------------------------------ mapping
  const localParts = (dt) => ({ date: `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`, time: `${pad(dt.getHours())}:${pad(dt.getMinutes())}` });
  /** Google event → planner activity fields (converted to this phone's time zone). */
  function fromEvent(ev) {
    if (ev.start && ev.start.date && !ev.start.dateTime) return { title: ev.summary || '(no title)', location: ev.location || '', date: ev.start.date, start: '00:00', end: '23:59', allDay: true };
    const s = localParts(new Date(ev.start.dateTime)), e = localParts(new Date(ev.end.dateTime));
    return { title: ev.summary || '(no title)', location: ev.location || '', date: s.date, start: s.time, end: e.time === s.time ? (e.time === '23:59' ? '00:00' : e.time) : e.time };
  }
  /** Planner activity → Google event body. Only title, time, location, recurrence. */
  function toEvent(a) {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const endDate = P.isOvernight(a.start, a.end) ? P.addDays(a.date, 1) : a.date;
    const ev = { summary: a.title, location: a.location || undefined, start: { dateTime: `${a.date}T${a.start}:00`, timeZone: tz }, end: { dateTime: `${endDate}T${a.end}:00`, timeZone: tz }, extendedProperties: { private: { alogId: a.id } }, reminders: { useDefault: false, overrides: a.reminders.slice(0, 5).map((m) => ({ method: 'popup', minutes: m })) } };
    const rr = P.rrule(a); if (rr) ev.recurrence = [rr];
    return ev;
  }
  /** May this activity leave the phone? */
  function canUpload(a, cfg) {
    if (a.gcal && a.gcal.origin === 'google') return cfg.mode === 'twoway';
    if (cfg.mode === 'import') return false;
    if (!cfg.pushCats.includes(a.category)) return false;
    if (P.looksIdentifiable(a.title, a.location)) return false;
    return true;
  }

  // ------------------------------------------------------------------ sync
  /**
   * io: { templates, newId(), save(rec), now }  → { imported, updated, removed, pushed, skipped, conflicts, errors }
   * Never deletes remote events except those this app created (or Google events in two-way mode) that you deleted here.
   */
  async function sync(settings, io) {
    const cfg = cfgOf(settings); const res = { imported: 0, updated: 0, removed: 0, pushed: 0, skipped: 0, conflicts: 0, errors: [] };
    if (!cfg.consent) throw new Error('Turn on consent for Google Calendar first');
    if (!cfg.calendarId) throw new Error('Choose a calendar first');
    if (!navigator.onLine) throw new Error('Offline — changes will sync when you are back online');
    const cal = encodeURIComponent(cfg.calendarId), now = io.now || new Date();
    const tmin = new Date(now.getTime() - 30 * 864e5).toISOString(), tmax = new Date(now.getTime() + 120 * 864e5).toISOString();
    const mine = io.templates.filter((t) => t.type === 'activity');
    const byGid = new Map(mine.filter((t) => t.data.gcal && t.data.gcal.id).map((t) => [t.data.gcal.id, t]));
    const byId = new Map(mine.map((t) => [t.tpl_id, t]));
    // 1. import (expanded instances; our own pushed events are recognised by alogId and not re-imported)
    let pageToken = '', guard = 0;
    do {
      const q = `/calendars/${cal}/events?singleEvents=true&showDeleted=true&maxResults=500&timeMin=${encodeURIComponent(tmin)}&timeMax=${encodeURIComponent(tmax)}${pageToken ? '&pageToken=' + pageToken : ''}`;
      const page = await api(q); pageToken = page.nextPageToken || '';
      for (const ev of page.items || []) {
        const alog = ev.extendedProperties && ev.extendedProperties.private && ev.extendedProperties.private.alogId;
        if (alog) continue; // an event this app created — it already exists here
        const local = byGid.get(ev.id);
        if (ev.status === 'cancelled') { if (local && !local.deleted_at) { local.deleted_at = now.toISOString(); await io.save(local); res.removed++; } continue; }
        const f = fromEvent(ev);
        if (!local) {
          const rec = { tpl_id: io.newId(), type: 'activity', name: f.title, created_at: now.toISOString(), updated_at: now.toISOString(),
            data: { ...f, desc: '', notes: '', category: 'other', reminders: [10], alarm: false, recur: { freq: 'none', interval: 1, days: [], until: '', count: 0 }, status: 'pending', overrides: {}, gcal: { id: ev.id, calId: cfg.calendarId, etag: ev.etag, updated: ev.updated, origin: 'google' } } };
          await io.save(rec); byGid.set(ev.id, rec); res.imported++; continue;
        }
        if (local.deleted_at) continue;
        if (local.data.gcal.updated === ev.updated) continue;
        if (local.data.dirty) { local.data.conflict = { remote: f, updated: ev.updated, etag: ev.etag }; await io.save(local); res.conflicts++; continue; }
        Object.assign(local.data, f); local.name = f.title; local.data.gcal = { ...local.data.gcal, etag: ev.etag, updated: ev.updated }; await io.save(local); res.updated++;
      }
    } while (pageToken && ++guard < 20);
    // 2. push local changes (export / two-way)
    for (const t of mine) {
      const a = P.normalize(t); const g = t.data.gcal || null;
      try {
        if (t.deleted_at) { if (g && g.id && (g.origin === 'local' || cfg.mode === 'twoway') && !g.removed) { await api(`/calendars/${cal}/events/${encodeURIComponent(g.id)}`, { method: 'DELETE' }); t.data.gcal = { ...g, removed: true }; await io.save(t); res.removed++; } continue; }
        if (t.data.conflict) continue;
        if (!canUpload(a, cfg)) { if (!g && cfg.mode !== 'import') res.skipped++; continue; }
        if (g && g.id && !t.data.dirty) continue;
        const body = toEvent(a);
        if (g && g.origin === 'google') { delete body.extendedProperties; delete body.recurrence; }
        const r = g && g.id ? await api(`/calendars/${cal}/events/${encodeURIComponent(g.id)}`, { method: 'PATCH', body, headers: g.etag ? { 'If-Match': g.etag } : {} }) : await api(`/calendars/${cal}/events`, { method: 'POST', body });
        t.data.gcal = { id: r.id, calId: cfg.calendarId, etag: r.etag, updated: r.updated, origin: g ? g.origin : 'local' }; t.data.dirty = false; await io.save(t); res.pushed++;
      } catch (e) {
        if (e.code === 'conflict') { t.data.conflict = { remote: null, note: 'Changed on Google since your last sync' }; await io.save(t); res.conflicts++; } else if (e.code === 'auth') throw e; else res.errors.push(`${a.title}: ${e.message}`);
      }
    }
    return res;
  }
  /** Resolve a conflict: keep the phone version (pushed next sync) or take Google's. */
  function resolve(rec, keep) {
    const c = rec.data.conflict; if (!c) return rec;
    if (keep === 'google' && c.remote) { Object.assign(rec.data, c.remote); rec.name = c.remote.title; rec.data.gcal = { ...rec.data.gcal, etag: c.etag, updated: c.updated }; rec.data.dirty = false; }
    else { rec.data.dirty = true; if (c.etag) rec.data.gcal = { ...rec.data.gcal, etag: c.etag, updated: c.updated }; }
    delete rec.data.conflict; return rec;
  }
  return { DEFAULTS, cfgOf, signedIn, signIn, signOut, listCalendars, sync, resolve, fromEvent, toEvent, canUpload, _setToken: (t) => { token = t; tokenExp = Date.now() + 3600e3; } };
})();
if (typeof window !== 'undefined') window.GCal = GCal;
