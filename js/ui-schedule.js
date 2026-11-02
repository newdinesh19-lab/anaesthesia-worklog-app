/**
 * ui-schedule.js — plan upcoming cases (when / where / what), see them in a calendar, get reminders.
 * Routes: schedule, planEdit. Reminders: in-app + system notification while the app is open or recently used,
 * and a calendar (.ics) export so the phone's own Calendar app gives alerts even when this app is closed.
 */
(window.V8Ext = window.V8Ext || []).push((ctx) => {
  const { state, h, ic, go, toast, openSheet, confirmSheet, todayISO, fmtDate, fmtDay, monthLabel, shiftMonth, uid } = ctx;
  const Sc = Schedule, S = Schema, X = ctx.X;
  const ui = { tab: 'upcoming', ym: '', day: '' };
  const plans = () => Sc.plansOf(state.templates);
  const fmtTime = (t) => { if (!t) return 'time not set'; const [hh, mm] = t.split(':').map(Number); return `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'am' : 'pm'}`; };
  const where = (p) => [p.hospital, p.location].filter(Boolean).join(' · ') || 'Place not set';
  const dayLabel = (d) => { const t = todayISO(); return d === t ? 'Today' : d === ctx.shiftDay(t, 1) ? 'Tomorrow' : fmtDay(d); };
  const save = async (rec, patch) => { rec.data = { ...rec.data, ...patch }; rec.updated_at = new Date().toISOString(); await ctx.putTemplate(rec); };

  // ------------------------------------------------------------------ reminders
  const notifState = () => ('Notification' in window ? Notification.permission : 'unsupported');
  async function notify(title, body, tag) {
    if (notifState() !== 'granted') return false;
    try { const reg = await navigator.serviceWorker.getRegistration(); if (reg) { await reg.showNotification(title, { body, tag, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { route: 'schedule' }, requireInteraction: false }); return true; } } catch (e) { /* fall through */ }
    try { new Notification(title, { body, tag, icon: 'icons/icon-192.png' }); return true; } catch (e) { return false; }
  }
  let ticking = false;
  async function checkReminders() {
    if (ticking || !state.key) return; ticking = true;
    try {
      const list = Sc.due(plans(), new Date()); const live = list.filter((d) => !d.stale);
      for (const d of list) { const rec = d.plan.rec; await save(rec, { fired: [...(rec.data.fired || []), d.key] }); }
      for (const d of live) {
        const p = d.plan, title = d.minutes === 0 ? 'Case starting now' : `Case ${Sc.until(p).replace('started ', '')}`.replace('Case in', 'Case in');
        const body = `${fmtTime(p.time)} · ${p.surgery || 'Planned case'} · ${where(p)}`;
        const ok = await notify(title, body, 'plan-' + p.id + '-' + d.key);
        toast(`${title}: ${p.surgery || 'planned case'} at ${fmtTime(p.time)}`, 'Open', () => go('schedule'));
        void ok;
      }
      if (list.length && state.route === 'home') ctx.render();
    } finally { ticking = false; }
  }
  let timer = null;
  function startReminders() { clearInterval(timer); timer = setInterval(checkReminders, 30000); document.addEventListener('visibilitychange', () => { if (!document.hidden) checkReminders(); }); setTimeout(checkReminders, 1200); }

  // ------------------------------------------------------------------ calendar export
  function exportICS(list, name) {
    const inc = h('input', { type: 'checkbox', id: 'icsId' });
    const close = openSheet('Add to phone calendar', h('div', {}, [
      h('p', {}, 'Creates a calendar file. Open it on your phone and choose Calendar; each case then gets alerts from the Calendar app, even when this app is closed.'),
      h('label', { class: 'toggle-row', style: 'margin-bottom:10px' }, [inc, h('span', { style: 'flex:1;margin-left:10px' }, 'Include patient name, UHID and notes (they will be stored unencrypted in your calendar)')]),
      h('div', { class: 'btn-row' }, [h('button', { class: 'btn', onclick: () => close() }, 'Cancel'), h('button', { class: 'btn btn-primary', id: 'icsGo', onclick: () => { ExportModule.downloadBlob(new Blob([Sc.buildICS(list, { identifiers: inc.checked })], { type: 'text/calendar;charset=utf-8' }), name); close(); toast('Calendar file created'); } }, [ic('download'), 'Create file'])]),
    ]));
  }
  async function askNotifications() {
    if (notifState() === 'unsupported') return toast('This browser cannot show notifications.');
    if (notifState() === 'denied') return toast('Notifications are blocked. Allow them in the phone’s site settings for this app.');
    const r = await Notification.requestPermission(); toast(r === 'granted' ? 'Notifications are on' : 'Notifications not allowed'); ctx.render(); if (r === 'granted') notify('Reminders are on', 'You will be alerted about planned cases while the app is open or recently used.', 'plan-test');
  }

  // ------------------------------------------------------------------ list screen
  function planCard(p, opts = {}) {
    const now = new Date(), s = Sc.startOf(p), clash = Sc.overlaps(p, plans());
    const card = h('div', { class: 'plan' + (p.status !== 'planned' ? ' off' : '') + (p.date === todayISO() ? ' today' : '') }, [
      h('button', { class: 'plan-head', onclick: () => card.classList.toggle('open') }, [
        h('span', { class: 'plan-time' }, [h('b', {}, fmtTime(p.time).replace(' ', '')), h('small', {}, opts.showDate ? fmtDate(p.date).replace(/ \d{4}$/, '') : p.status === 'planned' ? Sc.until(p, now) : p.status)]),
        h('span', { class: 'plan-main' }, [h('b', {}, p.surgery || 'Planned case'), h('small', {}, [where(p)]), clash.length ? h('small', { class: 'plan-clash' }, '⚠ overlaps another planned case') : null]),
        ic('chev')]),
      h('div', { class: 'plan-body' }, [
        ...[['Date', `${fmtDay(p.date)}${p.end_time ? ' · until ' + fmtTime(p.end_time) : ''}`], ['Consultant', p.consultant], ['Anaesthetist', p.anaesthetist ? ctx.shortName(p.anaesthetist) : ''], ['Plan', [p.techniques.join(' + '), p.urgency].filter(Boolean).join(' · ')], ['Patient', p.patient ? `${p.patient}${p.uhid ? ' · ' + p.uhid : ''}` : ''], ['Reminders', p.remind.length ? p.remind.slice().sort((a, b) => a - b).map((m) => Sc.REMIND.find((r) => r[0] === m)?.[1] || m + ' min before').join(', ') : 'none'], ['Notes', p.notes]].filter((r) => r[1]).map(([k, v]) => h('div', { class: 'kv' }, [h('span', {}, k), h('span', {}, v)])),
        h('div', { class: 'case-actions', style: 'flex-wrap:wrap' }, [
          p.status === 'planned' ? h('button', { class: 'btn btn-sm btn-primary', id: 'planStart', onclick: () => startCase(p) }, [ic('plus'), 'Start case']) : null,
          h('button', { class: 'btn btn-sm', onclick: () => { state.planDraft = JSON.parse(JSON.stringify(p.rec)); state.planEditing = true; go('planEdit'); } }, [ic('edit'), 'Edit']),
          h('button', { class: 'btn btn-sm', onclick: () => exportICS([p], `case-${p.date}.ics`) }, [ic('calendar'), 'Calendar']),
          p.status === 'planned' ? h('button', { class: 'btn btn-sm', onclick: async () => { await save(p.rec, { status: 'done' }); ctx.render(); toast('Marked done'); } }, [ic('check'), 'Done']) : h('button', { class: 'btn btn-sm', onclick: async () => { await save(p.rec, { status: 'planned', fired: [] }); ctx.render(); } }, 'Re-plan'),
          p.status === 'planned' ? h('button', { class: 'btn btn-sm', onclick: () => confirmSheet({ title: 'Cancel this planned case?', text: 'It stays in Past as cancelled and reminders stop.', okLabel: 'Cancel case', danger: true, onOk: async () => { await save(p.rec, { status: 'cancelled' }); ctx.render(); } }) }, 'Cancel case') : null,
          h('button', { class: 'btn btn-sm btn-danger', onclick: async () => { p.rec.deleted_at = new Date().toISOString(); await ctx.putTemplate(p.rec); ctx.render(); toast('Plan deleted', 'Undo', async () => { p.rec.deleted_at = null; await ctx.putTemplate(p.rec); ctx.render(); }); } }, [ic('trash'), 'Delete']),
        ]),
      ]),
    ]);
    return card;
  }
  function startCase(p) {
    ctx.startCaseFrom({ patient_name: p.patient, uhid: p.uhid, consultant: p.consultant, procedure_date: p.date }, { surgery: p.surgery, hospital: p.hospital || state.settings.hospital, location: p.location || state.settings.location, techniques: p.techniques.length ? p.techniques : undefined, anaesthesia_mode: p.techniques.length ? S.modeFromTechniques(p.techniques) : undefined, urgency: p.urgency, anaesthetist: p.anaesthetist || undefined });
    save(p.rec, { status: 'done', case_id: state.pending && state.pending.case_id });
    toast('Case form filled from your plan');
  }

  function renderSchedule(screen) {
    const today = todayISO(); if (!ui.ym) ui.ym = today.slice(0, 7);
    const all = plans(), up = Sc.upcoming(all);
    screen.appendChild(ctx.pageHead('Schedule', 'Planned cases', h('button', { class: 'icon-btn', id: 'planAdd', 'aria-label': 'Plan a case', onclick: () => newPlan() }, ic('plus')), 'home'));
    screen.appendChild(h('div', { class: 'seg' }, [['upcoming', 'Upcoming'], ['calendar', 'Calendar'], ['past', 'Past']].map(([k, l]) => h('button', { class: ui.tab === k ? 'on' : '', id: 'sch-' + k, onclick: () => { ui.tab = k; ctx.render(); } }, l))));
    // reminders status
    const ns = notifState();
    if (ui.tab === 'upcoming') screen.appendChild(h('div', { class: 'card', id: 'remCard' }, [h('h3', {}, 'Reminders'),
      h('div', { class: 'muted', style: 'font-size:13px;margin-bottom:10px' }, ns === 'granted' ? 'App notifications are on. They arrive while the app is open or was used recently. For alerts when the app is fully closed, add cases to your phone calendar.' : ns === 'denied' ? 'Notifications are blocked for this app in phone settings. In-app reminders still appear when you open it.' : 'Turn on notifications to be alerted about planned cases. For alerts when the app is fully closed, add cases to your phone calendar.'),
      h('div', { class: 'btn-row' }, [ns !== 'granted' && ns !== 'unsupported' && ns !== 'denied' ? h('button', { class: 'btn btn-primary', id: 'notifOn', onclick: askNotifications }, [ic('bell'), 'Turn on notifications']) : null, up.length ? h('button', { class: 'btn', id: 'icsAll', onclick: () => exportICS(up, 'planned-cases.ics') }, [ic('calendar'), 'All to phone calendar']) : null])]));
    const body = h('div'); screen.appendChild(body);
    if (ui.tab === 'upcoming') {
      if (!up.length) body.appendChild(h('div', { class: 'empty' }, [ic('calendar'), h('div', {}, 'No planned cases. Plan one with date, time and place, and get reminded.'), h('button', { class: 'btn btn-primary', style: 'margin-top:12px', onclick: () => newPlan() }, [ic('plus'), 'Plan a case'])]));
      let last = ''; for (const p of up) { if (p.date !== last) { last = p.date; body.appendChild(h('div', { class: 'group-head', style: 'cursor:default' }, [h('b', {}, dayLabel(p.date)), h('span', {}, up.filter((x) => x.date === p.date).length + ' planned')])); } body.appendChild(planCard(p)); }
    } else if (ui.tab === 'past') {
      const past = all.filter((p) => !up.includes(p)).sort((a, b) => Sc.cmp(b, a));
      if (!past.length) body.appendChild(h('div', { class: 'empty' }, [ic('clip'), h('div', {}, 'Nothing here yet.')]));
      past.slice(0, 60).forEach((p) => body.appendChild(planCard(p, { showDate: true })));
    } else {
      body.appendChild(h('div', { class: 'month-nav' }, [h('button', { class: 'icon-btn', 'aria-label': 'Previous month', onclick: () => { ui.ym = shiftMonth(ui.ym, -1); ui.day = ''; ctx.render(); } }, ic('left')), h('b', {}, monthLabel(ui.ym)), h('button', { class: 'icon-btn', 'aria-label': 'Next month', onclick: () => { ui.ym = shiftMonth(ui.ym, 1); ui.day = ''; ctx.render(); } }, ic('chev'))]));
      const [y, m] = ui.ym.split('-').map(Number), first = new Date(y, m - 1, 1).getDay(), dim = new Date(y, m, 0).getDate();
      const grid = h('div', { class: 'cal' }, ctx.DOW.map((d) => h('div', { class: 'wd' }, d[0])));
      for (let i = 0; i < first; i++) grid.appendChild(h('div', { class: 'cal-cell blank' }));
      for (let d = 1; d <= dim; d++) {
        const iso = `${ui.ym}-${String(d).padStart(2, '0')}`, dp = all.filter((p) => p.date === iso && p.status !== 'cancelled'), night = ctx.dutiesOn(iso).length;
        grid.appendChild(h('button', { class: 'cal-cell' + (dp.length ? ' has' : '') + (night ? ' night' : '') + (iso === today ? ' today' : '') + (ui.day === iso ? ' sel' : ''), 'data-date': iso, onclick: () => { ui.day = ui.day === iso ? '' : iso; ctx.render(); } }, [h('span', {}, d), dp.length ? h('em', {}, dp.length) : null, night ? ic('moon', 'moon') : null]));
      }
      body.appendChild(grid);
      body.appendChild(h('div', { class: 'legend-row' }, [h('span', {}, [h('i', { style: 'background:var(--mint);width:12px;height:12px;border-radius:4px;display:inline-block' }), ' planned case']), h('span', {}, [ic('moon'), ' night duty'])]));
      const dayList = ui.day ? all.filter((p) => p.date === ui.day) : all.filter((p) => p.date.startsWith(ui.ym) && p.status !== 'cancelled');
      body.appendChild(h('div', { class: 'section-title' }, [h('h2', {}, ui.day ? dayLabel(ui.day) : `All in ${monthLabel(ui.ym)}`), ui.day ? h('button', { onclick: () => newPlan({ date: ui.day }) }, '+ Plan on this day') : null]));
      if (!dayList.length) body.appendChild(h('div', { class: 'empty', style: 'padding:20px' }, [h('div', {}, ui.day ? 'Nothing planned on this day.' : 'Nothing planned this month.')]));
      dayList.sort(Sc.cmp).forEach((p) => body.appendChild(planCard(p, { showDate: !ui.day })));
    }
  }

  // ------------------------------------------------------------------ add / edit
  function newPlan(defaults = {}) {
    state.planDraft = { tpl_id: uid(), type: 'plan', name: '', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), uses: 0, deleted_at: null, data: { date: todayISO(), time: (() => { const n = new Date(Date.now() + 3600000); return String(n.getHours()).padStart(2, '0') + ':00'; })(), end_time: '', surgery: '', hospital: state.settings.hospital, location: '', consultant: '', anaesthetist: state.settings.anaesthetists[0] || '', patient: '', uhid: '', techniques: [], urgency: 'Elective', notes: '', remind: [...Sc.DEFAULT_REMIND], status: 'planned', fired: [], ...defaults } };
    state.planEditing = false; go('planEdit');
  }
  function renderPlanEdit(screen) {
    if (!state.planDraft) return go('schedule', null, { replace: true });
    const rec = state.planDraft, d = rec.data, editing = state.planEditing;
    screen.appendChild(ctx.pageHead(editing ? 'Edit planned case' : 'Plan a case', 'Schedule', null, 'schedule'));
    const txt = (label, key, o = {}) => h('div', { class: 'field' }, [h('label', {}, label), h('input', { class: 'input', type: o.type || 'text', list: o.list, placeholder: o.placeholder, value: d[key] ?? '', oninput: (e) => (d[key] = e.target.value), onchange: (e) => { if (o.onchange) o.onchange(e); } })]);
    const clash = h('div', { class: 'note warn', style: 'display:none' });
    const chk = () => { const o = Sc.overlaps(Sc.normalize({ ...rec, data: d }), plans()); clash.style.display = o.length ? 'block' : 'none'; clash.textContent = o.length ? `⚠ Overlaps: ${o.map((p) => `${fmtTime(p.time)} ${p.surgery || 'planned case'}`).join(', ')}` : ''; };
    screen.appendChild(h('div', { class: 'card' }, [h('h3', {}, 'When'),
      h('div', { class: 'grid2' }, [txt('Date', 'date', { type: 'date', onchange: chk }), txt('Start time', 'time', { type: 'time', onchange: chk })]),
      h('div', { class: 'grid2' }, [txt('Expected end (optional)', 'end_time', { type: 'time', onchange: chk }), h('div')]), clash]));
    const surgeries = [...new Set(ctx.activeCases().map((c) => c.surgery).filter(Boolean))].slice(0, 80);
    const hosp = h('datalist', { id: 'planHosp' }, ctx.hospitalList().map((n) => h('option', { value: n })));
    const surg = h('datalist', { id: 'planSurg' }, surgeries.map((n) => h('option', { value: n })));
    const cons = h('datalist', { id: 'planCons' }, [...new Set([...(state.settings.consultants || []), ...ctx.activeCases().map((c) => c.consultant).filter(Boolean)])].slice(0, 80).map((n) => h('option', { value: n })));
    screen.appendChild(h('div', { class: 'card' }, [h('h3', {}, 'Where & what'), hosp, surg, cons,
      txt('Hospital', 'hospital', { list: 'planHosp' }), txt('Theatre / ward / location', 'location', { placeholder: 'e.g. OT 2, Day care' }), txt('Surgery / procedure', 'surgery', { list: 'planSurg', placeholder: 'e.g. Total thyroidectomy' }), txt('Consultant / surgeon', 'consultant', { list: 'planCons' }),
      h('div', { class: 'field' }, [h('label', {}, 'Anaesthetist'), ctx.chipGroup(state.settings.anaesthetists, () => d.anaesthetist, (v) => (d.anaesthetist = v))]),
      h('div', { class: 'field' }, [h('label', {}, 'Urgency'), ctx.chipGroup(S.URGENCY, () => d.urgency, (v) => (d.urgency = v))]),
      h('div', { class: 'field' }, [h('label', {}, 'Planned technique'), ctx.toggleChips(S.TECHNIQUES, () => d.techniques, (v) => (d.techniques = v))])]));
    screen.appendChild(h('div', { class: 'card' }, [h('h3', {}, 'Patient (optional, stays encrypted)'), txt('Name', 'patient'), txt('UHID', 'uhid'), h('div', { class: 'field' }, [h('label', {}, 'Notes'), h('textarea', { class: 'input', rows: '3', id: 'planNotes', placeholder: 'Anything to remember: investigations pending, blood arranged, ICU bed…', oninput: (e) => (d.notes = e.target.value) })])]));
    screen.querySelector('#planNotes').value = d.notes || '';
    screen.appendChild(h('div', { class: 'card' }, [h('h3', {}, 'Remind me'), ctx.toggleChips(Sc.REMIND.map((r) => r[1]), () => d.remind.map((m) => (Sc.REMIND.find((r) => r[0] === m) || [])[1]).filter(Boolean), (v) => { d.remind = v.map((l) => Sc.REMIND.find((r) => r[1] === l)[0]); d.fired = []; }),
      h('div', { class: 'note' }, notifState() === 'granted' ? 'You will get an app notification at each time you pick (while the app is open or recently used).' : 'Turn on notifications on the Schedule screen. You can also add the case to your phone calendar for alerts when the app is closed.')]));
    chk();
    screen.appendChild(h('div', { class: 'sticky-bar' }, h('div', { class: 'inner' }, [
      h('button', { class: 'btn', onclick: () => { state.planDraft = null; history.length > 1 ? history.back() : go('schedule'); } }, 'Cancel'),
      h('button', { class: 'btn btn-primary', id: 'planSave', onclick: async () => {
        if (!d.date) return toast('Choose the date'); if (!d.surgery.trim() && !d.location.trim() && !d.hospital.trim()) return toast('Add the surgery or the place');
        rec.name = d.surgery.trim() || 'Planned case'; rec.updated_at = new Date().toISOString(); d.status = d.status || 'planned';
        await ctx.putTemplate(rec); const i = state.templates.findIndex((t) => t.tpl_id === rec.tpl_id); i >= 0 ? (state.templates[i] = rec) : state.templates.push(rec);
        if (ctx.rememberLists({ hospital: d.hospital })) await ctx.saveSettings();
        state.planDraft = null; ui.tab = Sc.upcoming([Sc.normalize(rec)]).length ? 'upcoming' : 'past'; go('schedule', null, { replace: true }); toast('Planned case saved', 'Add to calendar', () => exportICS([Sc.normalize(rec)], `case-${d.date}.ics`)); setTimeout(checkReminders, 300);
      } }, [ic('check'), 'Save']),
    ])));
  }

  // ------------------------------------------------------------------ home card + alerts
  function homeCard() {
    const up = Sc.upcoming(plans()), now = new Date(), horizon = new Date(now.getTime() + 7 * 864e5);
    const soon = up.filter((p) => Sc.startOf(p) <= horizon).slice(0, 3);
    const link = h('button', { id: 'planAllLink', onclick: () => go('schedule') }, 'Calendar →');
    const rows = soon.length ? soon.map((p) => h('button', { class: 'plan-row', onclick: () => { ui.tab = 'upcoming'; go('schedule'); } }, [
      h('span', { class: 'plan-date' }, [h('b', {}, new Date(...p.date.split('-').map((x, i) => (i === 1 ? x - 1 : +x))).getDate()), h('small', {}, ctx.MON[Number(p.date.slice(5, 7)) - 1])]),
      h('span', { class: 'plan-main' }, [h('b', {}, p.surgery || 'Planned case'), h('small', {}, `${fmtTime(p.time)} · ${where(p)}`)]), h('span', { class: 'status st-ok' }, Sc.until(p, now))])) : [h('div', { class: 'plan-empty muted' }, up.length ? `Next: ${fmtDay(up[0].date)} · ${up[0].surgery || 'planned case'}` : 'No upcoming cases planned.')];
    const nextP = up[0]; const sum = nextP ? `${up.length} upcoming · next ${fmtDay(nextP.date)}` : 'Nothing planned';
    return ctx.fold({ id: 'plans', title: 'Planned cases', right: link, summary: sum }, [h('div', { class: 'card plan-card', id: 'planCard' }, [...rows, h('button', { class: 'btn btn-soft btn-block', id: 'planNew', style: 'margin-top:8px', onclick: () => newPlan() }, [ic('plus'), 'Plan a case — when & where'])])]);
  }
  const alertsFor = () => { const now = new Date(); const t = Sc.upcoming(plans()).filter((p) => p.date === todayISO()); return t.length ? [{ tone: 'info', icon: 'calendar', title: `${t.length} case${t.length === 1 ? '' : 's'} planned today`, text: `Next at ${fmtTime(t[0].time)} · ${where(t[0])}`, action: 'Open', go: () => go('schedule') }] : []; };

  return { screens: { schedule: renderSchedule, planEdit: renderPlanEdit }, api: { schedHomeCard: homeCard, schedAlerts: alertsFor, startReminders, checkReminders, openSchedule: () => go('schedule') } };
});
