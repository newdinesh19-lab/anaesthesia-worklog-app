/**
 * ui-planner.js — Personal Planner: 24-hour day timeline, week and month views, quick activity entry, recurrence-aware
 * editing, statuses, search, free time, duty overlay (read-only) and reminders/alarms.
 * Route: planner. Activities are 'activity' records in the encrypted templates store.
 *
 * Reminder architecture (honest about PWA limits):
 *  - While the app is open (or recently backgrounded and the browser keeps it alive): precise timer → in-app alarm sheet
 *    (optional sound + vibration) and a system notification with Snooze / Dismiss.
 *  - When the app is closed, a web app cannot wake itself. Reminders that were missed are shown when you next open it.
 *  - For guaranteed alarms, "Add to phone calendar" exports an .ics file with alarms that the phone's Calendar app rings.
 */
(window.V8Ext = window.V8Ext || []).push((ctx) => {
  const { state, h, ic, go, toast, openSheet, confirmSheet, todayISO, fmtDay, monthLabel, uid } = ctx;
  const P = Planner, X = ctx.X;
  const ui = { view: 'day', date: '', q: '', cats: [], duty: 'mine', drag: null };
  const HOUR = 52; // px per hour in the day timeline
  const t12 = (t) => { const [hh, mm] = t.split(':').map(Number); return `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'am' : 'pm'}`; };
  const hm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const durTxt = (m) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ' ' + (m % 60) + ' min' : ''}` : `${m} min`);
  const ls = { get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage blocked */ } } };
  const me = () => (state.settings.anaesthetists || [])[0] || '';
  const PCFG = { quietStart: '22:00', quietEnd: '06:00', dutySilence: true, alarmsBreakQuiet: true, notifyFreq: 'all', suggest: true, prompts: true, dayStart: '06:00', dayEnd: '22:00', restStart: '22:30', restEnd: '06:00' };
  const pcfg = () => ({ ...PCFG, ...(state.settings.planner || {}) });
  const win = () => [pcfg().dayStart, pcfg().dayEnd];
  const rest = () => ({ start: pcfg().restStart, end: pcfg().restEnd });

  // ------------------------------------------------------------------ data
  const acts = () => P.activitiesOf(state.templates);
  const recOf = (id) => state.templates.find((t) => t.tpl_id === id);
  const occsIn = (from, to) => { let o = P.occurrences(acts(), from, to); if (ui.cats.length) o = o.filter((x) => ui.cats.includes(x.category)); return o; };
  function dutyIn(from, to) {
    if (ui.duty === 'off') return [];
    const th = Thanc.config(state.settings.thanc), resolve = Thanc.resolver(th);
    const thanc = Thanc.recordsOf(state.templates, resolve).map((r) => { const mine = Object.entries(r.rec.data.doctorTimes || {}).find(([n]) => Thanc.canonKey(n) === Thanc.canonKey(me())); return { ...r, myTimes: mine ? mine[1] : null }; });
    const plans = typeof Schedule !== 'undefined' ? Schedule.plansOf(state.templates) : [];
    return P.dutyBlocks({ thanc, legacy: state.duties || [], plans, me: me(), canon: (n) => Thanc.canonKey(resolve(n)), allThanc: ui.duty === 'all' }, from, to);
  }
  async function saveRec(rec) { rec.updated_at = new Date().toISOString(); if (!state.templates.includes(rec)) state.templates.push(rec); await ctx.putTemplate(rec); scheduleNext(); }
  async function patchData(rec, patch) { rec.data = { ...rec.data, ...patch, dirty: !!(rec.data.gcal && rec.data.gcal.id) || !!rec.data.dirty }; await saveRec(rec); }

  // ------------------------------------------------------------------ reminders engine
  const FIRED = 'pl-fired', SNOOZE = 'pl-snooze', MISSED = 'pl-missed';
  const firedSet = () => new Set(Object.keys(ls.get(FIRED, {})));
  const markFired = (keys) => { const f = ls.get(FIRED, {}), now = Date.now(); for (const k of keys) f[k] = now; for (const [k, t] of Object.entries(f)) if (now - t > 14 * 864e5) delete f[k]; ls.set(FIRED, f); };
  const notifState = () => ('Notification' in window ? Notification.permission : 'unsupported');
  let timer = null, poll = null, tz = '';
  async function sysNotify(title, body, tag, actions) {
    if (notifState() !== 'granted') return false;
    try { const reg = await navigator.serviceWorker.getRegistration(); if (reg) { await reg.showNotification(title, { body, tag, renotify: true, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { route: 'planner', key: tag }, actions: actions || [], requireInteraction: !!actions }); return true; } } catch (e) { /* fall through */ }
    try { new Notification(title, { body, tag }); return true; } catch (e) { return false; }
  }
  // audible alarm: generated tone (no sound file needed, works offline). Browsers allow sound only after the person has used the app.
  let audio = null;
  function startAlarmSound() {
    stopAlarmSound();
    try {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return; const ac = new AC(); let n = 0;
      const beep = () => { if (n++ > 40) return stopAlarmSound(); [0, 0.25].forEach((dt) => { const o = ac.createOscillator(), g = ac.createGain(); o.type = 'sine'; o.frequency.value = 880; g.gain.setValueAtTime(0.0001, ac.currentTime + dt); g.gain.exponentialRampToValueAtTime(0.35, ac.currentTime + dt + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dt + 0.2); o.connect(g).connect(ac.destination); o.start(ac.currentTime + dt); o.stop(ac.currentTime + dt + 0.22); }); };
      beep(); audio = { ac, iv: setInterval(beep, 1500) };
    } catch (e) { audio = null; }
    try { navigator.vibrate && navigator.vibrate([400, 200, 400, 200, 400]); } catch (e) { /* no vibration */ }
  }
  function stopAlarmSound() { if (audio) { clearInterval(audio.iv); try { audio.ac.close(); } catch (e) { /* closed */ } audio = null; } try { navigator.vibrate && navigator.vibrate(0); } catch (e) { /* none */ } }

  function snooze(item, min) { const s = ls.get(SNOOZE, {}); s[item.key] = { at: Date.now() + min * 60000, title: item.title, body: item.body, alarm: item.alarm }; ls.set(SNOOZE, s); stopAlarmSound(); toast(`Snoozed ${min} min`); scheduleNext(); }
  let alarmOpen = null;
  function ring(item) {
    // item: {key, title, body, alarm}
    sysNotify(item.title, item.body, item.key, [{ action: 'snooze', title: 'Snooze 10 min' }, { action: 'dismiss', title: 'Dismiss' }]);
    if (!item.alarm) { toast(item.title, 'Open', () => { ui.view = 'day'; go('planner'); }); return; }
    if (alarmOpen) alarmOpen();
    startAlarmSound();
    const close = openSheet('', h('div', { class: 'pl-alarm', id: 'plAlarm' }, [
      h('div', { class: 'pl-alarm-ic' }, ic('bell')), h('h2', {}, item.title), h('p', { class: 'muted' }, item.body),
      h('div', { class: 'btn-row' }, [h('button', { class: 'btn', id: 'plSnooze5', onclick: () => { snooze(item, 5); done(); } }, 'Snooze 5 min'), h('button', { class: 'btn', id: 'plSnooze10', onclick: () => { snooze(item, 10); done(); } }, 'Snooze 10 min')]),
      h('button', { class: 'btn btn-primary btn-block', id: 'plDismiss', style: 'margin-top:8px', onclick: () => done() }, 'Dismiss'),
    ]));
    const done = () => { stopAlarmSound(); close(); alarmOpen = null; };
    alarmOpen = done; setTimeout(() => { if (alarmOpen === done) stopAlarmSound(); }, 90000);
  }
  async function tick() {
    if (!state.key || !state.templates) return;
    const now = new Date(), today = todayISO();
    // timezone change → recalc (wall-clock times keep their local meaning)
    const zone = (Intl.DateTimeFormat().resolvedOptions().timeZone || '') + new Date().getTimezoneOffset();
    if (tz && zone !== tz) toast('Time zone changed — reminders recalculated'); tz = zone;
    const occ = P.occurrences(acts(), P.addDays(today, -1), P.addDays(today, 1));
    const due = P.dueReminders(occ, now, firedSet());
    if (due.length) markFired(due.map((d) => d.key));
    const missed = ls.get(MISSED, []), pc = pcfg();
    const dutyNow = dutyIn(P.addDays(today, -1), today).some((b) => b.mine && b.startAt <= now && b.endAt > now);
    const firstOf = new Map(); for (const d of due) { const k = d.occ.key; if (!firstOf.has(k) || d.minutes > firstOf.get(k)) firstOf.set(k, d.minutes); }
    for (const d of due) {
      const n = P.notificationText(d.occ, d.minutes), isAlarm = d.occ.act.alarm;
      if (d.obsolete) continue;
      if (d.stale) { missed.push({ key: d.key, title: d.occ.title, when: `${d.occ.date} ${d.occ.start}` }); continue; }
      if (pc.notifyFreq === 'alarms' && !isAlarm) continue;
      if (pc.notifyFreq === 'first' && firstOf.get(d.occ.key) !== d.minutes && !isAlarm && d.occ.act.reminders.length > 1 && d.minutes !== Math.max(...d.occ.act.reminders)) continue;
      const why = PlanLearn.suppression(now, pc, dutyNow, isAlarm);
      if (why) { missed.push({ key: d.key, title: d.occ.title, when: `${d.occ.date} ${d.occ.start}`, why }); continue; } // held silently; shown later
      ring({ key: d.key, title: n.title, body: n.body, alarm: isAlarm });
    }
    // completion confirmation: one notification at the end, one follow-up 2 h later — never more
    if (pc.prompts) {
      const fired = firedSet(), ask = [];
      for (const o of PlanLearn.pendingPrompts(P.occurrences(acts(), P.addDays(today, -1), today), now)) {
        for (const [tag, delay] of [['end', 0], ['follow', 120]]) { const k = `ask|${o.key}|${tag}`; if (fired.has(k)) continue; if (now - o.endAt >= delay * 60000 && now - o.endAt < (delay + 60) * 60000) { ask.push(k); if (!PlanLearn.suppression(now, pc, dutyNow, false)) sysNotify(`Done? ${o.title}`, 'Tap to mark completed, partly done or skipped', k); } else if (now - o.endAt >= (delay + 60) * 60000) ask.push(k); }
      }
      if (ask.length) markFired(ask);
    }
    ls.set(MISSED, missed.slice(-20));
    const s = ls.get(SNOOZE, {}); let changed = false;
    for (const [k, v] of Object.entries(s)) if (v.at <= Date.now()) { delete s[k]; changed = true; ring({ key: k + '|snz', title: v.title, body: v.body, alarm: v.alarm }); }
    if (changed) ls.set(SNOOZE, s);
    if ((due.length || changed) && (state.route === 'home' || state.route === 'planner')) ctx.render();
    scheduleNext();
  }
  function scheduleNext() {
    clearTimeout(timer); if (!state.key) return;
    const today = todayISO(), occ = P.occurrences(acts(), today, P.addDays(today, 2));
    const nxt = P.nextReminderAt(occ, new Date(), firedSet()), snz = Object.values(ls.get(SNOOZE, {})).map((v) => v.at).sort()[0];
    const t = Math.min(nxt ? nxt.getTime() : Infinity, snz || Infinity); if (!isFinite(t)) return;
    timer = setTimeout(tick, Math.max(500, Math.min(t - Date.now() + 200, 2 ** 31 - 1)));
  }
  function startPlanner() {
    clearInterval(poll); poll = setInterval(tick, 20000); setTimeout(tick, 1500);
    if (!startPlanner.wired) {
      startPlanner.wired = true;
      document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
      window.addEventListener('focus', () => tick()); window.addEventListener('online', () => { tick(); if (X.gcalAutoSync) X.gcalAutoSync(); });
      if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', (e) => { const m = e.data && e.data.planner; if (!m) return; if (m.action === 'snooze') { const v = { key: m.key, title: m.title || 'Reminder', body: m.body || '', alarm: false }; snooze(v, 10); } else if (m.action === 'dismiss') stopAlarmSound(); });
    }
  }
  function plannerAlerts() {
    const out = [], missed = ls.get(MISSED, []);
    if (missed.length) out.push({ tone: 'warn', icon: 'bell', title: `${missed.length} missed reminder${missed.length === 1 ? '' : 's'}`, text: missed.slice(-2).map((m) => m.title).join(', ') + ' — the app was closed.', action: 'Clear', go: () => { ls.set(MISSED, []); ctx.render(); } });
    return out;
  }

  // ------------------------------------------------------------------ notification onboarding
  async function askPermission() {
    if (notifState() === 'unsupported') return toast('This browser cannot show notifications. Use “Add to phone calendar” for alarms.');
    if (notifState() === 'denied') return toast('Notifications are blocked. Allow them in the phone’s site settings for this app.');
    const r = await Notification.requestPermission(); toast(r === 'granted' ? 'Notifications are on' : 'Notifications not allowed — in-app alerts only'); ctx.render();
  }
  function remindersCard() {
    const ns = notifState(); if (ls.get('pl-onboarded', false) && ns === 'granted') return null;
    const body = ns === 'granted' ? 'Notifications are on.' : ns === 'denied' ? 'Notifications are blocked for this app. You will still get in-app alerts while it is open.' : ns === 'unsupported' ? 'This browser cannot show notifications; in-app alerts only.' : 'Allow notifications so reminders can appear even while you use other apps.';
    return h('div', { class: 'card pl-onb', id: 'plOnboard' }, [
      h('h3', {}, [ic('bell', 'inl'), ' Reminders & alarms']),
      h('p', { class: 'muted' }, body),
      h('details', { class: 'pl-more' }, [h('summary', {}, 'Notification vs alarm, and limits'), h('ul', { class: 'pl-list' }, [
        h('li', {}, [h('b', {}, 'Notification: '), 'a silent banner at the reminder time (title and time only — never notes).']),
        h('li', {}, [h('b', {}, 'Alarm: '), 'per activity — a full-screen alert with sound and vibration, Snooze / Dismiss.']),
        h('li', {}, [h('b', {}, 'Limit: '), 'a web app cannot ring when it is fully closed or after a phone restart. Missed reminders show when you reopen it. For guaranteed alarms use ', h('b', {}, 'Add to phone calendar'), ' (⤓ button).']),
      ])]),
      h('div', { class: 'btn-row' }, [ns === 'default' ? h('button', { class: 'btn btn-primary', id: 'plAllow', onclick: askPermission }, 'Allow notifications') : null, h('button', { class: 'btn', id: 'plOnbOk', onclick: () => { ls.set('pl-onboarded', true); ctx.render(); } }, 'Got it')]),
    ]);
  }

  // ------------------------------------------------------------------ quick entry / edit sheet
  function editSheet({ rec = null, date, start, end, occ = null, draft = null } = {}) {
    const a = rec ? P.normalize(rec) : null; const isNew = !a;
    const f = a ? { title: a.title, date: occ ? occ.date : a.date, start: occ ? occ.start : a.start, end: occ ? occ.end : a.end, category: a.category, reminders: [...a.reminders], alarm: a.alarm, desc: a.desc, location: a.location, notes: a.notes, recur: { ...a.recur } }
      : { title: '', date: date || ui.date || todayISO(), start: start || '09:00', end: end || '', category: 'personal', reminders: [10], alarm: false, desc: '', location: '', notes: '', recur: { freq: 'none', interval: 1, days: [], until: '', count: 0 } };
    if (draft) Object.assign(f, { title: draft.title || '', category: draft.category, reminders: [...draft.reminders], alarm: !!draft.alarm, recur: { ...draft.recur } });
    if (!f.end) { const m = (P.toMin(f.start) + 60) % 1440; f.end = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; }
    const inp = (id, type, val, on, extra = {}) => h('input', { class: 'input', id, type, value: val, oninput: (e) => { on(e.target.value); live(); }, ...extra });
    const warn = h('div', { class: 'pl-warn', id: 'plWarn' });
    function live() {
      const msgs = [];
      if (P.okTime(f.start) && P.okTime(f.end) && f.start !== f.end && P.isOvernight(f.start, f.end)) msgs.push(`Ends next day · ${durTxt(P.duration(f.start, f.end))}`);
      if (P.okDate(f.date) && P.okTime(f.start) && P.okTime(f.end) && f.start !== f.end) {
        const items = [...occsIn(P.addDays(f.date, -1), P.addDays(f.date, 1)), ...dutyIn(P.addDays(f.date, -1), P.addDays(f.date, 1))];
        const c = P.clashes(items, f.date, f.start, f.end, a ? a.id : null); if (c.length) msgs.push(`⚠ Overlaps ${c.slice(0, 2).map((x) => x.title).join(', ')}${c.length > 2 ? '…' : ''}`);
      }
      warn.innerHTML = ''; msgs.forEach((m) => warn.appendChild(h('div', { class: m.startsWith('⚠') ? 'pl-clash' : 'muted' }, m)));
    }
    const catRow = h('div', { class: 'chips', id: 'plCats' }); const paintCats = () => { catRow.innerHTML = ''; P.CATEGORIES.forEach((c) => catRow.appendChild(h('button', { type: 'button', class: 'chip pl-cat' + (f.category === c.id ? ' on' : ''), 'data-cat': c.id, style: `--cc:${c.color}`, onclick: () => { f.category = c.id; paintCats(); } }, [h('i', { class: 'pl-dot', style: `background:${c.color}` }), c.label]))); }; paintCats();
    const remSel = h('select', { class: 'input', id: 'plRemind', onchange: (e) => { const v = e.target.value; f.reminders = v === '' ? [] : [Number(v)]; multi.clear(); f.reminders.forEach((m) => multi.add(m)); multiRow.querySelectorAll('[data-rem]').forEach((b) => b.classList.toggle('on', multi.has(Number(b.dataset.rem)))); } }, [h('option', { value: '' }, 'No reminder'), ...P.REMINDERS.map((m) => h('option', { value: m, ...(f.reminders[0] === m || (f.reminders.length && Math.min(...f.reminders) === m && !f.reminders.includes(f.reminders[0])) ? { selected: true } : {}) }, P.reminderLabel(m)))]);
    if (f.reminders.length) remSel.value = String(f.reminders[f.reminders.length - 1] === undefined ? '' : Math.max(...f.reminders)); if (!f.reminders.length) remSel.value = '';
    // advanced
    const multi = new Set(f.reminders);
    const multiRow = h('div', { class: 'chips', id: 'plMulti' }, P.REMINDERS.map((m) => { const b = h('button', { type: 'button', class: 'chip' + (multi.has(m) ? ' on' : ''), 'data-rem': m, onclick: () => { multi.has(m) ? multi.delete(m) : multi.add(m); b.classList.toggle('on'); f.reminders = [...multi]; remSel.value = f.reminders.length ? String(Math.max(...f.reminders)) : ''; } }, P.reminderLabel(m)); return b; }));
    const alarm = h('input', { type: 'checkbox', id: 'plAlarmOn', ...(f.alarm ? { checked: true } : {}), onchange: (e) => (f.alarm = e.target.checked) });
    const freq = h('select', { class: 'input', id: 'plFreq', onchange: (e) => { f.recur.freq = e.target.value; paintRecur(); } }, P.FREQS.map(([v, l]) => h('option', { value: v, ...(f.recur.freq === v ? { selected: true } : {}) }, l)));
    const recurBox = h('div', { id: 'plRecurBox' });
    function paintRecur() {
      recurBox.innerHTML = ''; if (f.recur.freq === 'none') return;
      if (f.recur.freq !== 'weekdays') recurBox.appendChild(h('div', { class: 'field' }, [h('label', {}, `Every … ${f.recur.freq === 'daily' ? 'days' : f.recur.freq === 'weekly' ? 'weeks' : 'months'}`), inp('plInterval', 'number', f.recur.interval, (v) => (f.recur.interval = Math.max(1, +v || 1)), { min: 1, max: 30 })]));
      if (f.recur.freq === 'weekly') { if (!f.recur.days.length) f.recur.days = [P.dow(f.date)]; recurBox.appendChild(h('div', { class: 'chips', id: 'plDays' }, ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((l, i) => { const b = h('button', { type: 'button', class: 'chip' + (f.recur.days.includes(i) ? ' on' : ''), 'data-day': i, onclick: () => { f.recur.days = f.recur.days.includes(i) ? f.recur.days.filter((x) => x !== i) : [...f.recur.days, i]; b.classList.toggle('on'); } }, l); return b; }))); }
      recurBox.appendChild(h('div', { class: 'field' }, [h('label', {}, 'Repeat until (optional)'), inp('plUntil', 'date', f.recur.until, (v) => (f.recur.until = v))]));
    }
    paintRecur();
    const scopeBox = h('div');
    const adv = h('details', { class: 'pl-adv', id: 'plAdv' }, [h('summary', {}, 'More options — repeat, place, notes, extra reminders, alarm'),
      h('div', { class: 'field' }, [h('label', {}, 'Repeat'), freq]), recurBox,
      h('div', { class: 'field' }, [h('label', {}, 'Location'), inp('plLoc', 'text', f.location, (v) => (f.location = v), { placeholder: 'e.g. Library, OT 3' })]),
      h('div', { class: 'field' }, [h('label', {}, 'Description'), h('textarea', { class: 'input', id: 'plDesc', rows: 2, oninput: (e) => (f.desc = e.target.value) }, f.desc)]),
      h('div', { class: 'field' }, [h('label', {}, 'Notes'), h('textarea', { class: 'input', id: 'plNotes', rows: 2, oninput: (e) => (f.notes = e.target.value) }, f.notes)]),
      h('div', { class: 'field' }, [h('label', {}, 'Reminders (choose several for important events)'), multiRow]),
      h('label', { class: 'pl-check' }, [alarm, h('span', {}, [h('b', {}, 'Alarm'), ' — sound + vibration and a full-screen alert (needs the app open or recently used)'])]),
      h('p', { class: 'muted pl-small' }, 'Planner notes are never put into notifications. Google Calendar sync is set up from the Planner’s ⚙ button.'),
    ]);
    const body = h('div', { class: 'pl-form' }, [
      h('div', { class: 'field' }, [h('label', {}, 'Title'), inp('plTitle', 'text', f.title, (v) => (f.title = v), { placeholder: 'e.g. Viva revision, Gym, School pickup', maxlength: 120, autocomplete: 'off' })]),
      h('div', { class: 'pl-row3' }, [h('div', { class: 'field' }, [h('label', {}, 'Date'), inp('plDate', 'date', f.date, (v) => (f.date = v))]), h('div', { class: 'field' }, [h('label', {}, 'Start'), inp('plStart', 'time', f.start, (v) => (f.start = v))]), h('div', { class: 'field' }, [h('label', {}, 'End'), inp('plEnd', 'time', f.end, (v) => (f.end = v))])]),
      warn,
      h('div', { class: 'field' }, [h('label', {}, 'Category'), catRow]),
      h('div', { class: 'field' }, [h('label', {}, 'Reminder'), remSel]),
      adv, scopeBox,
      h('div', { class: 'btn-row' }, [h('button', { class: 'btn', onclick: () => close() }, 'Cancel'), h('button', { class: 'btn btn-primary', id: 'plSave', onclick: () => submit() }, isNew ? 'Save activity' : 'Save changes')]),
      !isNew ? h('button', { class: 'btn btn-danger btn-block', id: 'plDelete', style: 'margin-top:8px', onclick: () => { close(); deleteFlow(rec, occ); } }, a.recur.freq !== 'none' ? 'Delete…' : 'Delete activity') : null,
    ]);
    const close = openSheet(isNew ? 'New activity' : 'Edit activity', body);
    live(); setTimeout(() => { const t = document.getElementById('plTitle'); if (t && isNew) t.focus(); }, 60);

    async function submit() {
      f.reminders = [...new Set(f.reminders)];
      const err = P.validate(f); if (err) return toast(err);
      const data = { title: f.title.trim(), desc: f.desc.trim(), location: f.location.trim(), notes: f.notes.trim(), category: f.category, start: f.start, end: f.end, reminders: f.reminders, alarm: f.alarm,
        recur: { freq: f.recur.freq, interval: f.recur.interval, days: f.recur.freq === 'weekly' ? [...f.recur.days].sort() : [], until: f.recur.until || '', count: 0 }, tz: Intl.DateTimeFormat().resolvedOptions().timeZone || '' };
      if (isNew) {
        const now = new Date().toISOString();
        await saveRec({ tpl_id: 'act-' + uid(), type: 'activity', name: data.title, data: { ...data, date: f.date, status: 'pending', overrides: {} }, created_at: now, updated_at: now });
        close(); toast('Activity saved'); ui.date = f.date; ctx.render(); return;
      }
      if (a.recur.freq !== 'none' && occ) return chooseScope(data);
      await patchData(rec, { ...data, date: f.date }); rec.name = data.title; await saveRec(rec); close(); toast('Saved'); ctx.render();
    }
    function chooseScope(data) {
      scopeBox.innerHTML = '';
      const go1 = async () => { // this occurrence only
        const patch = { title: data.title !== a.title ? data.title : undefined, date: f.date !== occ.orig ? f.date : undefined, start: f.start !== a.start ? f.start : undefined, end: f.end !== a.end ? f.end : undefined };
        Object.keys(patch).forEach((k) => patch[k] === undefined && delete patch[k]);
        await patchData(rec, { overrides: P.overrideOne(a, occ.orig, patch) }); close(); toast('This occurrence updated'); ctx.render();
      };
      const goAll = async () => { await patchData(rec, { ...data, date: a.date }); rec.name = data.title; await saveRec(rec); close(); toast('All occurrences updated'); ctx.render(); };
      const goFollow = async () => {
        if (occ.orig === a.date) return goAll();
        const sp = P.splitSeries(a, occ.orig); const now = new Date().toISOString();
        await patchData(rec, { recur: sp.oldRecur, overrides: sp.oldOverrides });
        await saveRec({ tpl_id: 'act-' + uid(), type: 'activity', name: data.title, data: { ...data, date: f.date, status: 'pending', overrides: sp.newOverrides }, created_at: now, updated_at: now });
        close(); toast('This and following updated'); ctx.render();
      };
      scopeBox.appendChild(h('div', { class: 'pl-scope card', id: 'plScope' }, [h('b', {}, 'Repeating activity — apply changes to:'),
        h('div', { class: 'btn-row' }, [h('button', { class: 'btn', id: 'plScopeOne', onclick: go1 }, 'This one'), h('button', { class: 'btn', id: 'plScopeFollow', onclick: goFollow }, 'This & following'), h('button', { class: 'btn btn-primary', id: 'plScopeAll', onclick: goAll }, 'All')])]));
      scopeBox.scrollIntoView({ block: 'nearest' });
    }
  }
  function deleteFlow(rec, occ) {
    const a = P.normalize(rec);
    const softDelete = async () => { rec.deleted_at = new Date().toISOString(); await saveRec(rec); ctx.render(); toast('Activity deleted', 'Undo', async () => { delete rec.deleted_at; await saveRec(rec); ctx.render(); }); };
    if (a.recur.freq === 'none' || !occ) return confirmSheet({ title: 'Delete this activity?', text: a.title, okLabel: 'Delete', danger: true, onOk: softDelete });
    const close = openSheet('Delete repeating activity', h('div', {}, [h('p', {}, a.title),
      h('button', { class: 'btn btn-block', id: 'plDelOne', onclick: async () => { close(); await patchData(rec, { overrides: P.overrideOne(a, occ.orig, { skip: true }) }); ctx.render(); toast('Occurrence removed', 'Undo', async () => { const o = { ...rec.data.overrides }; delete o[occ.orig].skip; await patchData(rec, { overrides: o }); ctx.render(); }); } }, 'Only this occurrence'),
      h('button', { class: 'btn btn-danger btn-block', id: 'plDelAll', style: 'margin-top:8px', onclick: () => { close(); softDelete(); } }, 'All occurrences'),
    ]));
  }
  function occSheet(o) {
    if (o.readOnly) {
      const close = openSheet(o.title, h('div', {}, [h('p', {}, `${fmtDay(o.date)} · ${t12(o.start)}–${t12(o.end)}${o.overnight ? ' (next day)' : ''}`), o.sub ? h('p', { class: 'muted' }, o.sub) : null,
        h('p', { class: 'muted pl-small' }, o.src === 'plan' ? 'From the OT schedule. Edit it there.' : 'Departmental duty — read-only here so your planner never changes the roster.'),
        h('button', { class: 'btn btn-primary btn-block', id: 'plOpenDuty', onclick: () => { close(); go(o.src === 'plan' ? 'schedule' : o.src === 'thanc' ? 'thanc' : 'cases'); } }, o.src === 'plan' ? 'Open OT schedule' : o.src === 'thanc' ? 'Open THANC duty' : 'Open duty calendar')]));
      return;
    }
    const rec = recOf(o.eid); if (!rec) return; const a = P.normalize(rec);
    const setStatus = async (st) => { close(); if (o.endAt <= new Date() && (st === 'completed' || st === 'partial' || st === 'skipped')) return promptSheet(o) ; await decide(o, st); ctx.render(); toast(`Marked ${P.statusLabel(st).toLowerCase()}`); };
    const close = openSheet(o.title, h('div', {}, [
      h('p', {}, [h('span', { class: 'pl-dot', style: `background:${o.color}` }), ` ${P.catOf(o.category).label} · ${fmtDay(o.date)} · ${t12(o.start)}–${t12(o.end)}${o.overnight ? ' (next day)' : ''} · ${durTxt(o.minutes)}`]),
      a.location ? h('p', { class: 'muted' }, [ic('folder', 'inl'), ' ', a.location]) : null, a.desc ? h('p', {}, a.desc) : null, a.notes ? h('p', { class: 'muted' }, a.notes) : null,
      a.reminders.length ? h('p', { class: 'muted pl-small' }, `Reminders: ${a.reminders.map(P.reminderLabel).join(', ')}${a.alarm ? ' · alarm on' : ''}`) : null,
      o.recurring ? h('p', { class: 'muted pl-small' }, 'Repeating activity') : null,
      h('div', { class: 'pl-status', id: 'plStatus' }, P.STATUSES.map(([k, l]) => h('button', { class: 'chip' + (P.liveStatus(o) === k ? ' on' : ''), 'data-status': k, onclick: () => setStatus(k) }, l))),
      h('div', { class: 'btn-row', style: 'margin-top:10px' }, [h('button', { class: 'btn', id: 'plIcs', onclick: () => { close(); exportICS([a]); } }, [ic('calendar'), 'Phone calendar']), h('button', { class: 'btn btn-primary', id: 'plEdit', onclick: () => { close(); editSheet({ rec, occ: o }); } }, [ic('edit'), 'Edit'])]),
    ]));
  }
  function exportICS(list) {
    if (!list.length) return toast('Nothing to export');
    const det = h('input', { type: 'checkbox', id: 'plIcsDet' });
    const close = openSheet('Add to phone calendar', h('div', {}, [
      h('p', {}, 'Creates a calendar file with your reminders as alarms. Open it on the phone and choose your Calendar app — it will ring even when this app is closed.'),
      h('label', { class: 'pl-check' }, [det, h('span', {}, 'Include descriptions (stored unencrypted in the calendar)')]),
      h('div', { class: 'btn-row' }, [h('button', { class: 'btn', onclick: () => close() }, 'Cancel'), h('button', { class: 'btn btn-primary', id: 'plIcsGo', onclick: () => { ExportModule.downloadBlob(new Blob([P.buildICS(list, { details: det.checked })], { type: 'text/calendar' }), `planner-${todayISO()}.ics`); close(); toast('Calendar file ready'); } }, 'Download .ics')]),
    ]));
  }

  // ------------------------------------------------------------------ history, completion prompts, suggestions
  const hist = () => PlanLearn.histOf(state.templates);
  async function saveHist(mut) {
    let h0 = hist().rec; const now = new Date().toISOString();
    if (!h0) h0 = { tpl_id: PlanLearn.HIST_ID, type: 'plhist', name: 'Planner history', data: { entries: [], responses: {} }, created_at: now, updated_at: now };
    mut(h0.data); await saveRec(h0);
  }
  /** Apply a lifecycle status to one occurrence and log it once (re-deciding replaces the log line). */
  async function decide(o, status, actualMin) {
    const rec = recOf(o.eid); if (!rec) return; const a = P.normalize(rec);
    if (a.recur.freq === 'none') await patchData(rec, { status }); else await patchData(rec, { overrides: P.overrideOne(a, o.orig, { status }) });
    if (['completed', 'partial', 'skipped', 'postponed', 'cancelled'].includes(status)) await saveHist((d) => { d.entries = PlanLearn.addEntry(d.entries || [], PlanLearn.entry(o, status, actualMin)); });
    else if (hist().entries.some((e) => e.key === o.key)) await saveHist((d) => { d.entries = (d.entries || []).filter((e) => e.key !== o.key); }); // undo removes the log line
  }
  async function respond(id, status) { await saveHist((d) => { d.responses = { ...(d.responses || {}), [id]: { status, at: new Date().toISOString() } }; }); }
  const allItems = (from, to) => [...occsIn(from, to), ...dutyIn(from, to)];
  async function createFrom(data, toastMsg) {
    const now = new Date().toISOString();
    await saveRec({ tpl_id: 'act-' + uid(), type: 'activity', name: data.title, data: { desc: '', location: '', notes: '', alarm: false, reminders: [10], recur: { freq: 'none', interval: 1, days: [], until: '', count: 0 }, ...data, status: 'pending', overrides: {} }, created_at: now, updated_at: now });
    toast(toastMsg || 'Activity added');
  }
  /** Follow-up after a decision: offered once, inline in the same sheet. */
  function promptSheet(o) {
    const box = h('div', { class: 'pl-prompt' });
    const close = openSheet(`Did you do “${o.title}”?`, box);
    const fin = (msg) => { close(); ctx.render(); if (msg) toast(msg); };
    const step1 = () => { box.innerHTML = ''; box.append(h('p', { class: 'muted' }, `${fmtDay(o.date)} · ${t12(o.start)}–${t12(o.end)}`), h('div', { class: 'pl-choice' }, [
      h('button', { class: 'btn btn-primary', id: 'pcDone', onclick: async () => { await decide(o, 'completed'); afterDone(); } }, '✓ Completed'),
      h('button', { class: 'btn', id: 'pcPartial', onclick: () => afterPartial() }, 'Partly done'),
      h('button', { class: 'btn', id: 'pcSkip', onclick: async () => { await decide(o, 'skipped'); afterSkip(); } }, 'Skipped'),
      h('button', { class: 'btn', id: 'pcCancel', onclick: async () => { await decide(o, 'cancelled'); fin('Marked cancelled'); } }, 'Cancelled'),
      h('button', { class: 'btn btn-sm', id: 'pcLater', onclick: () => { const s = new Set(ls.get('pl-later', [])); s.add(o.key); ls.set('pl-later', [...s]); fin(); } }, 'Ask later'),
    ])); };
    const afterDone = () => {
      if (o.recurring) return fin('Completed ✓');
      box.innerHTML = '';
      const days = new Set([P.dow(o.date)]);
      const dayRow = h('div', { class: 'chips', id: 'pcDays' }, ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((l, i) => { const b = h('button', { type: 'button', class: 'chip' + (days.has(i) ? ' on' : ''), onclick: () => { days.has(i) ? days.delete(i) : days.add(i); b.classList.toggle('on'); } }, l); return b; }));
      const base = { title: o.title, category: o.category, start: o.start, end: o.end, reminders: o.act.reminders, location: o.act.location };
      box.append(h('p', {}, 'Nice. Do you want to do it again?'), h('div', { class: 'pl-choice' }, [
        h('button', { class: 'btn', id: 'pcTomorrow', onclick: async () => { await createFrom({ ...base, date: P.addDays(todayISO() > o.date ? todayISO() : o.date, 1) }, 'Added for tomorrow'); fin(); } }, 'Repeat tomorrow'),
        h('button', { class: 'btn', id: 'pcSlot', onclick: async () => { const sl = PlanLearn.findSlot(allItems(todayISO(), P.addDays(todayISO(), 7)), todayISO(), o.minutes, { win: win(), rest: rest(), after: new Date(), days: 7, near: P.toMin(o.start) }); if (!sl) return toast('No free slot in the next week'); confirmSheet({ title: 'Add in this free slot?', text: `${fmtDay(sl.date)} · ${t12(sl.start)}–${t12(sl.end)}`, okLabel: 'Add', onOk: async () => { await createFrom({ ...base, ...sl }, 'Added'); fin(); } }); } }, 'Find a free slot'),
        h('button', { class: 'btn btn-sm', id: 'pcOnce', onclick: () => fin('Completed ✓ — one-time') }, 'One-time activity'),
      ]), h('div', { class: 'pl-sub' }, [h('small', { class: 'muted' }, 'Or repeat weekly on:'), dayRow, h('button', { class: 'btn btn-sm btn-primary', id: 'pcWeekly', onclick: async () => { if (!days.size) return toast('Pick days'); const d0 = (() => { for (let i = 1; i < 8; i++) { const d = P.addDays(o.date, i); if (days.has(P.dow(d))) return d; } return o.date; })(); await createFrom({ ...base, date: d0, recur: { freq: 'weekly', interval: 1, days: [...days].sort(), until: '', count: 0 } }, 'Weekly routine added'); fin(); } }, 'Repeat on these days')]));
    };
    const afterPartial = () => {
      box.innerHTML = ''; const mins = h('input', { class: 'input', id: 'pcMins', type: 'number', min: 5, max: o.minutes, value: Math.round(o.minutes / 2) });
      box.append(h('div', { class: 'field' }, [h('label', {}, `How many minutes did you do? (planned ${o.minutes})`), mins]), h('button', { class: 'btn btn-primary btn-block', id: 'pcPartSave', onclick: async () => {
        const done = Math.max(0, Math.min(o.minutes, +mins.value || 0)), left = o.minutes - done; await decide(o, 'partial', done);
        if (left < 15) return fin('Saved');
        const sl = PlanLearn.findSlot(allItems(todayISO(), P.addDays(todayISO(), 7)), todayISO(), PlanLearn.round15(left), { win: win(), rest: rest(), after: new Date(), days: 7, near: P.toMin(o.start) });
        box.innerHTML = ''; box.append(h('p', {}, `${left} min left.`), sl ? h('button', { class: 'btn btn-primary btn-block', id: 'pcRemain', onclick: async () => { await createFrom({ title: `${o.title} (remaining)`, category: o.category, ...sl, reminders: o.act.reminders }, 'Remaining time scheduled'); fin(); } }, `Schedule ${fmtDay(sl.date)} ${t12(sl.start)}–${t12(sl.end)}`) : h('p', { class: 'muted' }, 'No free slot found this week.'), h('button', { class: 'btn btn-block', style: 'margin-top:8px', onclick: () => fin('Saved') }, 'No thanks'));
      } }, 'Save'));
    };
    const afterSkip = () => {
      box.innerHTML = ''; const sl = PlanLearn.findSlot(allItems(todayISO(), P.addDays(todayISO(), 7)), todayISO(), o.minutes, { win: win(), rest: rest(), after: new Date(), days: 7, near: P.toMin(o.start) });
      box.append(h('p', {}, 'Reschedule it?'), sl ? h('button', { class: 'btn btn-primary btn-block', id: 'pcResched', onclick: async () => { if (o.recurring) await createFrom({ title: o.title, category: o.category, ...sl, reminders: o.act.reminders }, 'Rescheduled'); else { const rec = recOf(o.eid); await patchData(rec, { date: sl.date, start: sl.start, end: sl.end, status: 'pending' }); toast('Rescheduled'); } fin(); } }, `Move to ${fmtDay(sl.date)} ${t12(sl.start)}`) : null,
        h('button', { class: 'btn btn-block', id: 'pcPick', style: 'margin-top:8px', onclick: () => { close(); editSheet({ date: todayISO() }); } }, 'Pick a time'), h('button', { class: 'btn btn-block', id: 'pcDismiss', style: 'margin-top:8px', onclick: () => fin('Dismissed') }, 'Dismiss'));
    };
    step1();
  }
  function promptCard() {
    if (!pcfg().prompts) return null;
    const now = new Date(), list = PlanLearn.pendingPrompts(P.occurrences(acts(), P.addDays(todayISO(), -3), todayISO()), now, new Set(ls.get('pl-later', [])));
    if (!list.length) return null; const o = list[0];
    return h('button', { class: 'card pl-ask', id: 'plAsk', onclick: () => promptSheet(o) }, [h('span', { class: 'pl-ask-ic' }, ic('check')), h('span', { class: 'pl-ask-t' }, [h('b', {}, `Did you do “${o.title}”?`), h('small', {}, `${o.date === todayISO() ? 'Today' : fmtDay(o.date)} · ${t12(o.start)}${list.length > 1 ? ` · +${list.length - 1} more` : ''}`)]), h('span', { class: 'pl-ask-go' }, 'Answer')]);
  }
  function topSuggestion() {
    if (!pcfg().suggest) return null;
    const today = todayISO(), H = hist(); const now = new Date();
    const upcoming = occsIn(today, P.addDays(today, 7)).filter((o) => o.startAt > now), items = allItems(today, P.addDays(today, 7));
    return PlanLearn.suggestions({ entries: H.entries, responses: H.responses, acts: acts(), upcoming, items, now, today, win: win(), rest: rest() })[0] || null;
  }
  async function applySuggestion(sg) {
    const a = sg.action;
    if (a.type === 'create') await createFrom(a.data, 'Routine added');
    else if (a.type === 'update') { const rec = recOf(a.eid); if (rec) { await patchData(rec, a.patch); toast('Updated'); } }
    else if (a.type === 'move') { const rec = recOf(a.eid); if (rec) { const ac = P.normalize(rec); if (a.recurring) await patchData(rec, { overrides: P.overrideOne(ac, a.orig, { date: a.date, start: a.start, end: a.end }) }); else await patchData(rec, { date: a.date, start: a.start, end: a.end }); toast('Moved'); } }
    await respond(sg.id, 'accepted'); ctx.render();
  }
  function suggestionCard(compact) {
    const sg = topSuggestion(); if (!sg) return null;
    const why = h('small', { class: 'pl-why', hidden: true }, sg.why);
    return h('div', { class: 'card pl-sug' + (compact ? ' compact' : ''), id: 'plSuggest', 'data-kind': sg.kind }, [
      h('div', { class: 'pl-sug-h' }, [h('span', { class: 'pl-sug-ic' }, ic('bolt')), h('div', { class: 'pl-sug-t' }, [h('b', {}, sg.title), h('small', {}, sg.detail)])]),
      why,
      h('div', { class: 'pl-sug-b' }, [h('button', { class: 'btn btn-sm btn-primary', id: 'sgYes', onclick: () => confirmSheet({ title: 'Apply this suggestion?', text: `${sg.title} ${sg.detail}`, okLabel: 'Yes, apply', onOk: () => applySuggestion(sg) }) }, 'Apply…'), h('button', { class: 'btn btn-sm', id: 'sgWhy', onclick: () => { why.hidden = !why.hidden; } }, 'Why?'), h('button', { class: 'btn btn-sm', id: 'sgNo', onclick: async () => { await respond(sg.id, 'dismissed'); ctx.render(); toast('Suggestion hidden'); } }, 'Dismiss')]),
    ]);
  }

  // ------------------------------------------------------------------ natural-language entry
  function nlBar() {
    const inp = h('input', { class: 'input', id: 'plNL', type: 'text', placeholder: 'Type: “Study 1 h tomorrow 7 pm”', autocomplete: 'off', enterkeyhint: 'go', onkeydown: (e) => { if (e.key === 'Enter') go1(); } });
    const go1 = () => { const t = inp.value.trim(); if (!t) return inp.focus(); nlPreview(t); };
    return h('div', { class: 'pl-nl' }, [inp, h('button', { class: 'btn btn-primary', id: 'plNLGo', onclick: go1, 'aria-label': 'Preview' }, 'Add')]);
  }
  function nlPreview(text) {
    const r = PlanNLP.parse(text, todayISO()), d = r.draft;
    const rows = [['Activity', d.title || '—'], ['When', `${fmtDay(d.date)} · ${t12(d.start)}–${t12(d.end)}${P.isOvernight(d.start, d.end) ? ' (next day)' : ''}`], ['Category', P.catOf(d.category).label], ['Repeats', d.recur.freq === 'none' ? 'No' : d.recur.freq === 'weekly' ? `Weekly · ${d.recur.days.map((x) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][x]).join(', ')}` : P.FREQS.find((f) => f[0] === d.recur.freq)[1]], ['Reminder', d.reminders.length ? d.reminders.map(P.reminderLabel).join(', ') + (d.alarm ? ' · alarm' : '') : 'None']];
    const clash = P.okDate(d.date) ? P.clashes(allItems(P.addDays(d.date, -1), P.addDays(d.date, 1)), d.date, d.start, d.end, null) : [];
    const close = openSheet('Check before saving', h('div', { id: 'nlPreview' }, [
      h('div', { class: 'pl-kv' }, rows.map(([k, v]) => h('div', {}, [h('small', {}, k), h('b', {}, v)]))),
      r.questions.length ? h('div', { class: 'pl-q', id: 'nlQuestions' }, r.questions.map((q) => h('div', {}, ['? ', q]))) : null,
      clash.length ? h('div', { class: 'pl-clash' }, `⚠ Overlaps ${clash.map((c) => c.title).slice(0, 2).join(', ')}`) : null,
      h('div', { class: 'btn-row' }, [h('button', { class: 'btn', id: 'nlEdit', onclick: () => { close(); editSheetDraft(d); } }, r.missing.length ? 'Fill in details' : 'Edit'), h('button', { class: 'btn btn-primary', id: 'nlSave', ...(r.missing.includes('title') ? { disabled: true } : {}), onclick: async () => { const err = P.validate(d); if (err) return toast(err); await createFrom({ title: d.title, date: d.date, start: d.start, end: d.end, category: d.category, reminders: d.reminders, alarm: d.alarm, recur: d.recur }, 'Activity saved'); close(); const n = document.getElementById('plNL'); if (n) n.value = ''; ui.date = d.date; ctx.render(); } }, 'Save')]),
    ]));
  }
  function editSheetDraft(d) { editSheet({ date: d.date, start: d.start, end: d.end, draft: d }); }

  // ------------------------------------------------------------------ planner settings (+ Google Calendar)
  function settingsSheet() {
    const c = pcfg(), save = async (patch) => { state.settings.planner = { ...pcfg(), ...patch }; await ctx.saveSettings(); };
    const tog = (id, label, key) => h('label', { class: 'pl-check' }, [h('input', { type: 'checkbox', id, ...(c[key] ? { checked: true } : {}), onchange: (e) => save({ [key]: e.target.checked }) }), h('span', {}, label)]);
    const time = (id, key) => h('input', { class: 'input', type: 'time', id, value: c[key], onchange: (e) => e.target.value && save({ [key]: e.target.value }) });
    const g = GCal.cfgOf(state.settings), gsave = async (patch) => { state.settings.gcal = { ...GCal.cfgOf(state.settings), ...patch }; await ctx.saveSettings(); };
    const gbox = h('div', { id: 'gcalBox' });
    const paintG = () => {
      const gc = GCal.cfgOf(state.settings); gbox.innerHTML = '';
      const conflicts = state.templates.filter((t) => t.type === 'activity' && !t.deleted_at && t.data.conflict);
      gbox.append(
        h('p', { class: 'muted pl-small' }, 'Optional. Imports events from one Google calendar and, if you choose, sends selected planner activities (title, time, place only). Case logbook, pre-op and patient details are never sent. Needs internet and your own Google OAuth Client ID (see README).'),
        h('div', { class: 'field' }, [h('label', {}, 'Google OAuth Client ID'), h('input', { class: 'input', id: 'gcClient', value: gc.clientId, placeholder: 'xxxx.apps.googleusercontent.com', onchange: (e) => gsave({ clientId: e.target.value.trim() }) })]),
        h('label', { class: 'pl-check' }, [h('input', { type: 'checkbox', id: 'gcConsent', ...(gc.consent ? { checked: true } : {}), onchange: async (e) => { await gsave({ consent: e.target.checked }); if (!e.target.checked) GCal.signOut(); paintG(); } }), h('span', {}, 'I agree to connect this planner to my Google Calendar. Activities that look like patient information are never uploaded.')]),
        gc.consent ? h('div', { class: 'btn-row' }, [h('button', { class: 'btn', id: 'gcSignIn', onclick: async () => { try { await GCal.signIn(gc.clientId, true); toast('Signed in to Google'); paintG(); } catch (e) { toast(e.message); } } }, GCal.signedIn() ? 'Signed in ✓' : 'Sign in with Google'), GCal.signedIn() ? h('button', { class: 'btn', id: 'gcCals', onclick: async () => { try { const cals = await GCal.listCalendars(); const close = openSheet('Choose a calendar', h('div', {}, cals.map((cc) => h('button', { class: 'btn btn-block', style: 'margin-bottom:6px', 'data-cal': cc.id, onclick: async () => { await gsave({ calendarId: cc.id, calendarName: cc.name }); close(); paintG(); } }, cc.name + (cc.primary ? ' (main)' : ''))))); } catch (e) { toast(e.message); } } }, gc.calendarName ? `Calendar: ${gc.calendarName}` : 'Choose calendar') : null]) : null,
        gc.consent ? h('div', { class: 'field' }, [h('label', {}, 'Sync mode'), h('select', { class: 'input', id: 'gcMode', onchange: (e) => gsave({ mode: e.target.value }) }, [['import', 'Import only (Google → planner)'], ['export', 'Import + send my planner activities'], ['twoway', 'Two-way (also edit Google events here)']].map(([v, l]) => h('option', { value: v, ...(gc.mode === v ? { selected: true } : {}) }, l)))]) : null,
        gc.consent && gc.mode !== 'import' ? h('div', { class: 'field' }, [h('label', {}, 'Categories allowed to leave the phone'), h('div', { class: 'chips', id: 'gcCats' }, P.CATEGORIES.map((cat) => h('button', { type: 'button', class: 'chip' + (gc.pushCats.includes(cat.id) ? ' on' : ''), 'data-gcat': cat.id, onclick: async () => { const l = gc.pushCats.includes(cat.id) ? gc.pushCats.filter((x) => x !== cat.id) : [...gc.pushCats, cat.id]; await gsave({ pushCats: l }); paintG(); } }, cat.label)))]) : null,
        gc.consent ? h('button', { class: 'btn btn-primary btn-block', id: 'gcSync', onclick: () => runSync(true).then(paintG) }, 'Sync now') : null,
        h('p', { class: 'muted pl-small', id: 'gcStatus' }, gc.lastSync ? `Last sync ${new Date(gc.lastSync).toLocaleString()}${gc.lastCounts ? ` · +${gc.lastCounts.imported} imported, ${gc.lastCounts.updated} updated, ${gc.lastCounts.pushed} sent, ${gc.lastCounts.conflicts} conflicts` : ''}` : 'Not synced yet.'),
        gc.lastError ? h('p', { class: 'pl-clash pl-small' }, gc.lastError) : null,
        ...conflicts.map((t) => h('div', { class: 'pl-conf', 'data-conflict': t.tpl_id }, [h('b', {}, t.data.title), h('small', {}, ' changed in both places'), h('div', { class: 'btn-row' }, [h('button', { class: 'btn btn-sm', onclick: async () => { GCal.resolve(t, 'mine'); await saveRec(t); paintG(); } }, 'Keep phone version'), t.data.conflict.remote ? h('button', { class: 'btn btn-sm', onclick: async () => { GCal.resolve(t, 'google'); await saveRec(t); paintG(); } }, 'Use Google version') : null])])),
        gc.consent ? h('button', { class: 'btn btn-sm btn-block', id: 'gcOff', style: 'margin-top:8px', onclick: async () => { GCal.signOut(); await gsave({ consent: false, calendarId: '', calendarName: '' }); paintG(); toast('Disconnected. Imported activities stay in your planner.'); } }, 'Disconnect Google') : null,
      );
    };
    paintG();
    openSheet('Planner settings', h('div', { class: 'pl-settings' }, [
      h('div', { class: 'subhead' }, 'Reminders'),
      h('div', { class: 'field' }, [h('label', {}, 'Notify me for'), h('select', { class: 'input', id: 'psFreq', onchange: (e) => save({ notifyFreq: e.target.value }) }, [['all', 'Every reminder'], ['first', 'Only the first reminder'], ['alarms', 'Alarms only']].map(([v, l]) => h('option', { value: v, ...(c.notifyFreq === v ? { selected: true } : {}) }, l)))]),
      h('div', { class: 'pl-row2' }, [h('div', { class: 'field' }, [h('label', {}, 'Quiet hours from'), time('psQs', 'quietStart')]), h('div', { class: 'field' }, [h('label', {}, 'to'), time('psQe', 'quietEnd')])]),
      tog('psAlarmQuiet', 'Alarms may ring during quiet hours', 'alarmsBreakQuiet'), tog('psDuty', 'Silence non-alarm reminders while I am on duty', 'dutySilence'),
      notifState() !== 'granted' ? h('button', { class: 'btn btn-block', id: 'psAllow', onclick: askPermission }, 'Allow notifications') : null,
      h('div', { class: 'subhead' }, 'Assistant'),
      tog('psSuggest', 'Adaptive suggestions (one at a time, explainable)', 'suggest'), tog('psPrompts', 'Ask whether activities were completed', 'prompts'),
      h('div', { class: 'pl-row2' }, [h('div', { class: 'field' }, [h('label', {}, 'My day starts'), time('psDs', 'dayStart')]), h('div', { class: 'field' }, [h('label', {}, 'and ends'), time('psDe', 'dayEnd')])]),
      h('div', { class: 'pl-row2' }, [h('div', { class: 'field' }, [h('label', {}, 'Protected rest from'), time('psRs', 'restStart')]), h('div', { class: 'field' }, [h('label', {}, 'to'), time('psRe', 'restEnd')])]),
      h('p', { class: 'muted pl-small' }, `Learning data stays on this phone (encrypted). ${hist().entries.length} history entries.`),
      h('div', { class: 'btn-row' }, [h('button', { class: 'btn btn-sm', id: 'psResetPrefs', onclick: () => confirmSheet({ title: 'Reset learned preferences?', text: 'Accepted and dismissed suggestions are forgotten.', okLabel: 'Reset', onOk: async () => { await saveHist((d) => { d.responses = {}; }); toast('Preferences reset'); } }) }, 'Reset preferences'), h('button', { class: 'btn btn-sm btn-danger', id: 'psDelHist', onclick: () => confirmSheet({ title: 'Delete activity history?', text: 'Completion history used for suggestions is deleted. Your activities stay.', okLabel: 'Delete history', danger: true, onOk: async () => { await saveHist((d) => { d.entries = []; d.responses = {}; }); toast('History deleted'); } }) }, 'Delete history')]),
      h('div', { class: 'subhead' }, 'Google Calendar (optional)'), gbox,
    ]));
  }
  let syncing = false;
  async function runSync(manual) {
    const gc = GCal.cfgOf(state.settings); if (syncing || !gc.consent || !gc.calendarId) return;
    if (!GCal.signedIn()) { if (manual) { try { await GCal.signIn(gc.clientId, true); } catch (e) { toast(e.message); return; } } else return; }
    syncing = true;
    try {
      const r = await GCal.sync(state.settings, { templates: state.templates, newId: () => 'act-' + uid(), save: (rec) => saveRec(rec) });
      state.settings.gcal = { ...gc, lastSync: new Date().toISOString(), lastError: r.errors.join('; '), lastCounts: r }; await ctx.saveSettings();
      if (manual) toast(`Synced · ${r.imported} new, ${r.updated} updated, ${r.pushed} sent${r.conflicts ? `, ${r.conflicts} conflict(s)` : ''}`);
    } catch (e) { state.settings.gcal = { ...gc, lastError: e.message }; await ctx.saveSettings(); if (manual) toast(e.message); } finally { syncing = false; if (state.route === 'planner') ctx.render(); }
  }

  // ------------------------------------------------------------------ views
  const viewSeg = () => h('div', { class: 'seg pl-seg', id: 'plViews' }, [['day', 'Day'], ['week', 'Week'], ['month', 'Month'], ['search', 'Search']].map(([v, l]) => h('button', { class: ui.view === v ? 'on' : '', 'data-view': v, onclick: () => { ui.view = v; ctx.render(); } }, l)));
  function nav() {
    const step = ui.view === 'month' ? 'm' : ui.view === 'week' ? 7 : 1;
    const move = (d) => { if (step === 'm') { const t = P.parse(ui.date); t.setDate(1); t.setMonth(t.getMonth() + d); ui.date = P.iso(t); } else ui.date = P.addDays(ui.date, d * step); ctx.render(); };
    const label = ui.view === 'month' ? monthLabel(ui.date.slice(0, 7)) : ui.view === 'week' ? `${fmtDay(weekStart(ui.date))} – ${fmtDay(P.addDays(weekStart(ui.date), 6))}` : (ui.date === todayISO() ? 'Today · ' : '') + fmtDay(ui.date);
    return h('div', { class: 'pl-nav' }, [h('button', { class: 'icon-btn', id: 'plPrev', 'aria-label': 'Previous', onclick: () => move(-1) }, ic('left')), h('b', { id: 'plLabel' }, label), h('button', { class: 'icon-btn', id: 'plNext', 'aria-label': 'Next', onclick: () => move(1) }, h('span', { style: 'display:inline-flex;transform:rotate(180deg)' }, ic('left'))), ui.date !== todayISO() ? h('button', { class: 'btn btn-sm', id: 'plToday', onclick: () => { ui.date = todayISO(); ctx.render(); } }, 'Today') : null]);
  }
  const weekStart = (d) => P.addDays(d, -((P.dow(d) + 6) % 7)); // Monday
  function filters() {
    const n = ui.cats.length;
    return h('div', { class: 'pl-filters' }, [
      h('button', { class: 'chip' + (n ? ' on' : ''), id: 'plFilterBtn', 'aria-expanded': ui.showFilters ? 'true' : 'false', onclick: () => { ui.showFilters = !ui.showFilters; ctx.render(); } }, [ic('filter', 'inl'), n ? ` Categories (${n})` : ' Categories']),
      h('select', { class: 'input pl-dutysel', id: 'plDuty', 'aria-label': 'Duty overlay', onchange: (e) => { ui.duty = e.target.value; ctx.render(); } }, [['mine', 'My duties & OT'], ['all', 'All THANC duties'], ['off', 'Hide duties']].map(([v, l]) => h('option', { value: v, ...(ui.duty === v ? { selected: true } : {}) }, l))),
      ui.showFilters || n ? h('div', { class: 'chips', id: 'plCatFilter' }, [...P.CATEGORIES.map((c) => h('button', { class: 'chip pl-cat' + (ui.cats.includes(c.id) ? ' on' : ''), 'data-fcat': c.id, style: `--cc:${c.color}`, onclick: () => { ui.cats = ui.cats.includes(c.id) ? ui.cats.filter((x) => x !== c.id) : [...ui.cats, c.id]; ui.showFilters = true; ctx.render(); } }, [h('i', { class: 'pl-dot', style: `background:${c.color}` }), c.label])), n ? h('button', { class: 'chip', id: 'plClearCats', onclick: () => { ui.cats = []; ctx.render(); } }, 'Clear') : null]) : null,
    ]);
  }
  /** lay overlapping blocks side by side */
  function columns(items) {
    const sorted = [...items].sort((a, b) => a.top - b.top || b.bottom - a.bottom), out = []; let cluster = [], end = -1;
    const flush = () => { const cols = []; for (const it of cluster) { let c = cols.findIndex((last) => last <= it.top); if (c < 0) { c = cols.length; cols.push(0); } cols[c] = it.bottom; it.col = c; } cluster.forEach((it) => (it.ncol = cols.length)); out.push(...cluster); cluster = []; };
    for (const it of sorted) { if (it.top >= end && cluster.length) { flush(); end = -1; } cluster.push(it); end = Math.max(end, it.bottom); }
    if (cluster.length) flush(); return out;
  }
  function dayView(screen) {
    const day = ui.date, occ = occsIn(P.addDays(day, -1), day), duty = dutyIn(P.addDays(day, -1), day);
    const items = [...P.forDay(occ, day), ...P.forDay(duty, day)], clash = P.overlaps([...occ, ...duty].filter((o) => P.forDay([o], day).length));
    const free = P.freeTime([...occ, ...duty], day, win()[0], win()[1], 30);
    const done = occ.filter((o) => P.forDay([o], day).length && o.status === 'completed').length, total = P.forDay(occ, day).length;
    screen.appendChild(h('div', { class: 'pl-sum' }, [h('span', {}, `${total} activit${total === 1 ? 'y' : 'ies'}${total ? ` · ${done} done` : ''}`), h('span', {}, `${free.reduce((s, f) => s + f.minutes, 0) ? durTxt(free.reduce((s, f) => s + f.minutes, 0)) + ' free' : 'No free time'}`), clash.size ? h('span', { class: 'pl-clash' }, `⚠ ${Math.ceil(clash.size / 2)} overlap${clash.size > 2 ? 's' : ''}`) : null]));
    const tl = h('div', { class: 'pl-tl', id: 'plTimeline', style: `height:${24 * HOUR}px` });
    for (let hr = 0; hr < 24; hr++) tl.appendChild(h('div', { class: 'pl-hr', style: `top:${hr * HOUR}px` }, [h('small', {}, hr === 0 ? '12 am' : hr < 12 ? `${hr} am` : hr === 12 ? '12 pm' : `${hr - 12} pm`)]));
    // tap an empty slot → quick add at that time
    tl.addEventListener('click', (e) => { if (e.target !== tl && !e.target.classList.contains('pl-hr') && !e.target.classList.contains('pl-free')) return; const r = tl.getBoundingClientRect(); const m = Math.max(0, Math.min(1425, Math.floor(((e.clientY - r.top) / HOUR) * 4) * 15)); editSheet({ date: day, start: `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}` }); });
    for (const f of free) tl.appendChild(h('div', { class: 'pl-free', style: `top:${(P.toMin(f.start) / 60) * HOUR}px;height:${(f.minutes / 60) * HOUR}px` }, [h('small', {}, `Free · ${durTxt(f.minutes)}`)]));
    for (const it of columns(items)) {
      const ht = Math.max(22, ((it.bottom - it.top) / 60) * HOUR - 2), w = 100 / it.ncol;
      const el = h('button', { class: 'pl-blk' + (it.readOnly ? ' ro' : '') + ` st-${it.status}` + (clash.has(it.key) ? ' clash' : ''), 'data-key': it.key, style: `top:${(it.top / 60) * HOUR}px;height:${ht}px;left:calc(56px + (100% - 60px) * ${it.col * w / 100});width:calc((100% - 60px) * ${w / 100} - 3px);--bc:${it.color}`, onclick: (e) => { if (ui.dragMoved) { ui.dragMoved = false; e.stopPropagation(); return; } e.stopPropagation(); occSheet(it); } }, [
        h('b', {}, [it.status === 'completed' ? '✓ ' : '', it.title]), ht > 34 ? h('small', {}, `${it.contFrom ? '… ' : ''}${t12(it.start)}–${t12(it.end)}${it.contTo ? ' …' : ''}${it.readOnly ? ' · read-only' : ''}`) : null, clash.has(it.key) ? h('i', { class: 'pl-cl', title: 'Overlaps ' + clash.get(it.key).join(', ') }, '⚠') : null]);
      if (!it.readOnly && !it.contFrom) enableDrag(el, it, day);
      tl.appendChild(el);
    }
    if (day === todayISO()) { const now = new Date(), nowLine = h('div', { class: 'pl-now', id: 'plNow', style: `top:${((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR}px` }); tl.appendChild(nowLine); clearInterval(dayView.iv); dayView.iv = setInterval(() => { const n = new Date(); if (!document.body.contains(nowLine)) return clearInterval(dayView.iv); nowLine.style.top = `${((n.getHours() * 60 + n.getMinutes()) / 60) * HOUR}px`; }, 30000); }
    screen.appendChild(h('div', { class: 'pl-tl-wrap', id: 'plTlWrap' }, tl));
    requestAnimationFrame(() => { const w = document.getElementById('plTlWrap'); if (!w) return; const n = new Date(), m = day === todayISO() ? n.getHours() * 60 + n.getMinutes() - 90 : (items.length ? Math.min(...items.map((i) => i.top)) - 30 : 7 * 60); w.scrollTop = Math.max(0, (m / 60) * HOUR); });
  }
  /** long-press then drag a block up/down (15-minute steps) to reschedule; repeating activities ask which occurrences */
  function enableDrag(el, it, day) {
    let t0 = null, startY = 0, base = 0, active = false, delta = 0;
    el.addEventListener('pointerdown', (e) => { startY = e.clientY; base = parseFloat(el.style.top); t0 = setTimeout(() => { active = true; el.classList.add('dragging'); try { el.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ } try { navigator.vibrate && navigator.vibrate(30); } catch (x) { /* none */ } }, 320); });
    el.addEventListener('pointermove', (e) => { if (!active) { if (Math.abs(e.clientY - startY) > 8) clearTimeout(t0); return; } e.preventDefault(); delta = Math.round(((e.clientY - startY) / HOUR) * 4) * 15; el.style.top = `${base + (delta / 60) * HOUR}px`; el.dataset.shift = delta; });
    const end = async () => {
      clearTimeout(t0); if (!active) return; active = false; el.classList.remove('dragging'); if (!delta) return; ui.dragMoved = true;
      const shift = (s) => { let m = P.toMin(s) + delta; let dd = 0; while (m < 0) { m += 1440; dd--; } while (m >= 1440) { m -= 1440; dd++; } return [`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`, dd]; };
      const [ns, dd] = shift(it.start), [ne] = shift(it.end), nd = P.addDays(it.date, dd); delta = 0;
      const rec = recOf(it.eid); if (!rec) return; const a = P.normalize(rec);
      if (a.recur.freq === 'none') { await patchData(rec, { date: nd, start: ns, end: ne }); toast(`Moved to ${t12(ns)}`, 'Undo', async () => { await patchData(rec, { date: it.date, start: it.start, end: it.end }); ctx.render(); }); ctx.render(); return; }
      const close = openSheet('Move repeating activity', h('div', {}, [h('p', {}, `${a.title} → ${t12(ns)}–${t12(ne)}`),
        h('button', { class: 'btn btn-block', id: 'plMoveOne', onclick: async () => { close(); await patchData(rec, { overrides: P.overrideOne(a, it.orig, { date: nd, start: ns, end: ne }) }); ctx.render(); } }, 'Only this occurrence'),
        h('button', { class: 'btn btn-primary btn-block', id: 'plMoveAll', style: 'margin-top:8px', onclick: async () => { close(); await patchData(rec, { start: ns, end: ne }); ctx.render(); } }, 'All occurrences'),
        h('button', { class: 'btn btn-block', style: 'margin-top:8px', onclick: () => { close(); ctx.render(); } }, 'Cancel')]));
    };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  }
  function agendaRow(o) {
    return h('button', { class: 'pl-ag' + (o.readOnly ? ' ro' : '') + ` st-${o.status}`, 'data-key': o.key, style: `--bc:${o.color}`, onclick: () => occSheet(o) }, [
      h('span', { class: 'pl-ag-t' }, [h('b', {}, t12(o.start)), h('small', {}, o.overnight ? `→ ${t12(o.end)} +1` : t12(o.end))]),
      h('span', { class: 'pl-ag-m' }, [h('b', {}, [o.status === 'completed' ? '✓ ' : '', o.title]), h('small', {}, o.readOnly ? (o.sub || 'Read-only') : `${P.catOf(o.category).label}${o.recurring ? ' · repeats' : ''}${o.status !== 'pending' ? ' · ' + o.status : ''}`)]),
    ]);
  }
  function weekView(screen) {
    const ws = weekStart(ui.date), occ = occsIn(P.addDays(ws, -1), P.addDays(ws, 6)), duty = dutyIn(P.addDays(ws, -1), P.addDays(ws, 6));
    const wp = PlanLearn.weekPlan({ weekStart: ws, occs: occ, duty, entries: hist().entries, now: new Date(), win: win(), rest: rest(), enabled: pcfg().suggest });
    const stat = (n, l) => h('div', {}, [h('b', {}, String(n)), h('small', {}, l)]);
    screen.appendChild(h('div', { class: 'card pl-week', id: 'plWeekSum' }, [h('div', { class: 'pl-wstats' }, [stat(wp.duties, 'duties'), stat(wp.clinical, 'clinical'), stat(wp.study, 'study'), stat(wp.personal, 'personal'), stat(wp.unfinished, 'unfinished'), stat(durTxt(wp.free).replace(' min', 'm'), 'free')]),
      ...wp.blocks.map((b) => h('div', { class: 'pl-wsug', 'data-sugdate': b.date }, [h('span', {}, [h('b', {}, `Study · ${fmtDay(b.date)} ${t12(b.start)}–${t12(b.end)}`), h('small', {}, b.why)]), h('button', { class: 'btn btn-sm', onclick: () => confirmSheet({ title: 'Add this study block?', text: `${fmtDay(b.date)} · ${t12(b.start)}–${t12(b.end)}`, okLabel: 'Add', onOk: async () => { await createFrom({ title: b.title, category: 'study', date: b.date, start: b.start, end: b.end }, 'Study block added'); ctx.render(); } }) }, 'Add')]))]));
    for (let i = 0; i < 7; i++) {
      const d = P.addDays(ws, i), list = [...occ, ...duty].filter((o) => o.date === d).sort((a, b) => a.startAt - b.startAt), free = P.freeTime([...occ, ...duty], d, win()[0], win()[1], 30).reduce((s, f) => s + f.minutes, 0);
      screen.appendChild(h('div', { class: 'pl-wday' + (d === todayISO() ? ' today' : ''), 'data-date': d }, [h('button', { class: 'pl-wh', onclick: () => { ui.date = d; ui.view = 'day'; ctx.render(); } }, [h('b', {}, fmtDay(d)), h('small', {}, `${list.length} item${list.length === 1 ? '' : 's'} · ${durTxt(free)} free`)]), ...list.map(agendaRow), h('button', { class: 'pl-wadd', onclick: () => editSheet({ date: d }) }, '+ Add')]));
    }
  }
  function monthView(screen) {
    const ym = ui.date.slice(0, 7), [y, m] = ym.split('-').map(Number), first = `${ym}-01`, dim = new Date(y, m, 0).getDate(), last = `${ym}-${String(dim).padStart(2, '0')}`;
    const occ = occsIn(first, last), duty = dutyIn(first, last), lead = (new Date(y, m - 1, 1).getDay() + 6) % 7;
    const grid = h('div', { class: 'pl-month' }, ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d) => h('div', { class: 'wd' }, d)));
    for (let i = 0; i < lead; i++) grid.appendChild(h('div'));
    for (let d = 1; d <= dim; d++) {
      const iso = `${ym}-${String(d).padStart(2, '0')}`, list = occ.filter((o) => o.date === iso), du = duty.filter((o) => o.date === iso);
      grid.appendChild(h('button', { class: 'pl-mc' + (iso === todayISO() ? ' today' : '') + (iso === ui.date ? ' sel' : ''), 'data-date': iso, onclick: () => { ui.date = iso; ui.view = 'day'; ctx.render(); } }, [h('span', {}, d), h('i', { class: 'pl-mdots' }, [...[...new Set(list.map((o) => o.color))].slice(0, 3).map((c) => h('u', { style: `background:${c}` })), du.length ? h('u', { class: 'duty' }) : null]), list.length ? h('small', {}, String(list.length)) : null]));
    }
    screen.appendChild(grid);
    screen.appendChild(h('div', { class: 'legend-row pl-legend' }, [...P.CATEGORIES.map((c) => h('span', {}, [h('i', { class: 'pl-dot', style: `background:${c.color}` }), ' ' + c.label])), h('span', {}, [h('i', { class: 'pl-dot', style: 'background:#F59E0B;border-radius:3px' }), ' Duty / OT'])]));

    const now = new Date(), sel = ui.date.startsWith(ym) ? ui.date : first, list = (arr, empty) => arr.length ? arr.map(agendaRow) : [h('p', { class: 'muted pl-small' }, empty)];
    const sec = (id, title, nodes, open) => ctx.fold({ id: 'plm-' + id, title, open }, nodes);
    screen.appendChild(sec('day', `${fmtDay(sel)}`, list([...occ, ...duty].filter((o) => o.date === sel).sort((a, b) => a.startAt - b.startAt), 'Nothing on this date.').concat(h('button', { class: 'btn btn-sm', onclick: () => editSheet({ date: sel }) }, '+ Add on this date')), true));
    const upAll = occsIn(P.iso(now), P.addDays(P.iso(now), 7)).filter((o) => o.startAt > now && P.OPEN.has(o.status));
    screen.appendChild(sec('up', `Upcoming (7 days) · ${upAll.length}`, list(upAll.slice(0, 8), 'Nothing coming up.'), true));
    const overdue = occsIn(P.addDays(P.iso(now), -14), P.iso(now)).filter((o) => (o.status === 'postponed') || (P.OPEN.has(o.status) && o.endAt < now));
    if (overdue.length) screen.appendChild(sec('over', `Overdue & postponed · ${overdue.length}`, list(overdue.slice(0, 8), ''), true));
    const done = occ.filter((o) => o.status === 'completed' || o.status === 'partial');
    screen.appendChild(sec('done', `Completed this month · ${done.length}`, list(done.slice(-8).reverse(), 'None yet.'), false));
    const routines = acts().filter((a) => a.recur.freq !== 'none');
    screen.appendChild(sec('rout', `Routines · ${routines.length}`, routines.length ? routines.map((a) => h('button', { class: 'pl-ag', style: `--bc:${P.catOf(a.category).color}`, onclick: () => editSheet({ rec: a.rec }) }, [h('span', { class: 'pl-ag-t' }, [h('b', {}, t12(a.start)), h('small', {}, t12(a.end))]), h('span', { class: 'pl-ag-m' }, [h('b', {}, a.title), h('small', {}, a.recur.freq === 'weekly' ? 'Weekly · ' + a.recur.days.map((x) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][x]).join(', ') : P.FREQS.find((f) => f[0] === a.recur.freq)[1])])])) : [h('p', { class: 'muted pl-small' }, 'No repeating activities.')], false));
    const sg = suggestionCard(true); if (sg) screen.appendChild(sec('sug', 'Suggested', [sg], true));
  }
  function searchView(screen) {
    const box = h('input', { class: 'input', id: 'plQ', type: 'search', placeholder: 'Search title, place, notes…', value: ui.q, oninput: (e) => { ui.q = e.target.value; paint(); } });
    const res = h('div', { id: 'plResults' });
    function paint() {
      const list = P.search(acts(), ui.q, ui.cats).slice(0, 80); res.innerHTML = '';
      if (!list.length) { res.appendChild(h('div', { class: 'empty', style: 'padding:20px' }, [ic('search'), h('div', {}, ui.q ? 'No matching activities.' : 'No activities yet.')])); return; }
      list.forEach((a) => res.appendChild(h('button', { class: 'pl-ag', style: `--bc:${P.catOf(a.category).color}`, 'data-eid': a.id, onclick: () => editSheet({ rec: a.rec }) }, [h('span', { class: 'pl-ag-t' }, [h('b', {}, fmtDay(a.date).replace(/^\w+ /, '')), h('small', {}, t12(a.start))]), h('span', { class: 'pl-ag-m' }, [h('b', {}, a.title), h('small', {}, `${P.catOf(a.category).label}${a.recur.freq !== 'none' ? ' · ' + P.FREQS.find((x) => x[0] === a.recur.freq)[1].toLowerCase() : ''}${a.location ? ' · ' + a.location : ''}`)])])));
    }
    screen.appendChild(box); paint(); screen.appendChild(res); setTimeout(() => box.focus(), 50);
  }
  function renderPlanner(screen) {
    if (!ui.date) ui.date = todayISO();
    screen.appendChild(ctx.pageHead('Planner', '24-hour day · reminders', h('div', { class: 'pl-head-btns' }, [
      h('button', { class: 'icon-btn', id: 'plIcsAll', 'aria-label': 'Add all to phone calendar', onclick: () => exportICS(acts()) }, ic('download')),
      h('button', { class: 'icon-btn', id: 'plSettings', 'aria-label': 'Planner settings & Google Calendar', onclick: () => settingsSheet() }, ic('sliders')),
    ]), 'home'));
    const onb = remindersCard(); if (onb) screen.appendChild(onb);
    const ask = promptCard(); if (ask) screen.appendChild(ask); else { const sg = suggestionCard(false); if (sg) screen.appendChild(sg); }
    screen.appendChild(nlBar());
    screen.appendChild(viewSeg()); if (ui.view !== 'search') screen.appendChild(nav()); screen.appendChild(filters());
    ({ day: dayView, week: weekView, month: monthView, search: searchView })[ui.view](screen);
    screen.appendChild(h('button', { class: 'fab pl-fab', id: 'plAdd', 'aria-label': 'Add activity', onclick: () => editSheet({ date: ui.date }) }, ic('plus')));
  }

  // ------------------------------------------------------------------ Home: compact duty + next up
  function nextUp() {
    const now = new Date(), today = todayISO(), to = P.addDays(today, 1);
    const items = [...P.occurrences(acts(), today, to), ...(() => { const s = ui.duty; ui.duty = 'mine'; const d = dutyIn(today, to); ui.duty = s; return d; })()]
      .filter((o) => o.endAt > now && o.status !== 'completed' && o.status !== 'skipped').sort((a, b) => a.startAt - b.startAt).slice(0, 3);
    return h('div', { class: 'card pl-next', id: 'nextUp' }, [h('div', { class: 'pl-next-h' }, [h('h3', {}, 'Next up'), h('button', { class: 'link', id: 'nextUpOpen', onclick: () => { ui.view = 'day'; ui.date = today; go('planner'); } }, 'Planner →')]),
      items.length ? h('div', {}, items.map((o) => h('button', { class: 'pl-nrow', 'data-key': o.key, style: `--bc:${o.color}`, onclick: () => occSheet(o) }, [h('b', {}, o.startAt <= now ? 'Now' : o.date === today ? t12(o.start) : 'Tmrw ' + t12(o.start)), h('span', {}, o.title)]))) : h('p', { class: 'muted pl-small', style: 'margin:4px 0 0' }, 'Nothing else planned for the next 24 hours.')]);
  }
  /** Home "My Day": the next n personal activities / planned OT cases (today, then tomorrow), with status and one-tap complete. */
  function myDay(n = 2) {
    const now = new Date(), today = todayISO(), to = P.addDays(today, 1);
    const plans = typeof Schedule !== 'undefined' ? P.dutyBlocks({ plans: Schedule.plansOf(state.templates) }, today, to) : [];
    const items = [...P.occurrences(acts(), today, to), ...plans].filter((o) => o.endAt > now && !['completed', 'skipped', 'cancelled', 'partial'].includes(o.status)).sort((a, b) => a.startAt - b.startAt).slice(0, n);
    const card = h('div', { class: 'card hm-day', id: 'myDay' }, [h('button', { class: 'hm-ch', id: 'myDayOpen', onclick: () => { ui.view = 'day'; ui.date = today; go('planner'); } }, [h('h3', {}, 'My day'), h('small', {}, items.length ? 'Next up' : ''), h('span', { class: 'hm-go' }, ic('left'))])]);
    if (!items.length) { card.appendChild(h('button', { class: 'hm-empty', id: 'myDayPlan', onclick: () => { ui.view = 'day'; ui.date = today; go('planner'); setTimeout(() => { const i = document.getElementById('plNL'); if (i) i.focus(); }, 120); } }, [ic('plus', 'inl'), ' Nothing planned — add an activity'])); return card; }
    for (const o of items) {
      const st = P.liveStatus(o, now), soon = o.startAt - now < 30 * 60000 && o.startAt > now;
      card.appendChild(h('div', { class: 'hm-aline' + (soon ? ' soon' : ''), 'data-key': o.key, style: `--bc:${o.color}` }, [
        h('button', { class: 'hm-at', onclick: () => occSheet(o) }, [h('b', {}, st === 'in_progress' ? 'Now' : o.date === today ? t12(o.start) : 'Tomorrow ' + t12(o.start)), h('span', {}, o.title), h('small', {}, o.readOnly ? 'OT schedule' : P.statusLabel(st) + (soon ? ' · soon' : ''))]),
        o.readOnly ? null : h('button', { class: 'hm-tick', 'aria-label': 'Mark completed', 'data-done': o.key, onclick: async () => { await decide(o, 'completed'); ctx.render(); toast('Completed ✓', 'Undo', async () => { await decide(o, 'pending'); ctx.render(); }); } }, ic('check'))]));
    }
    return card;
  }
  return { screens: { planner: renderPlanner }, api: { plannerMyDay: myDay, startPlanner, plannerAlerts, plannerNextUp: nextUp, plannerEdit: (o) => editSheet(o || {}), openPlanner: () => go('planner'), plannerTick: tick, plannerPromptCard: promptCard, plannerSuggestion: () => suggestionCard(true), gcalAutoSync: () => runSync(false), plannerSettings: settingsSheet, plannerHasOverdue: () => !!promptCard() } };
});
