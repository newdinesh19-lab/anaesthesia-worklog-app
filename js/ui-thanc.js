/**
 * ui-thanc.js — THANC duty tracker, core: Home section (morning / evening / night, one-tap or edit), calendar, history,
 * editor with per-doctor timings and change history. Analytics, doctors, reports and data tools live in ui-thanc-reports.js.
 * Data: encrypted 'templates' store, type 'thanc' (see thanc.js). Separate from patient cases.
 * Every write goes through commit(): one atomic IndexedDB transaction (record(s) + settings together).
 */
(window.V8Ext = window.V8Ext || []).push((ctx) => {
  const { state, h, ic, go, toast, openSheet, todayISO, fmtDay, monthLabel, shiftMonth, shiftDay } = ctx;
  const Th = Thanc, HR = ThancHours;
  const ui = { date: '', drafts: {}, open: {}, tab: 'calendar', ym: '', day: '', q: '', showDeleted: false };
  const cfg = () => Th.config(state.settings && state.settings.thanc);
  const resolve = () => Th.resolver(cfg());
  const recs = () => Th.recordsOf(state.templates, resolve());
  const findRec = (id) => state.templates.find((t) => t.tpl_id === id);
  const SHIFT_IC = { morning: 'sun', evening: 'cloud', night: 'moon' };
  const icon = (shift) => ic(SHIFT_IC[shift] || 'clip');
  const today = () => todayISO();
  ui.date = today();
  const T_NOW = () => new Date().toISOString();

  // ------------------------------------------------------------------ data
  /** Atomic write of several duty records (and optionally settings). State is only updated after the database accepted it. */
  async function commit(list, { settings = false } = {}) {
    const ops = []; for (const r of list) ops.push(await ctx.encOp('templates', r)); if (settings) ops.push(await ctx.settingsOp());
    if (ops.length) await DB.batch(ops);
    for (const r of list) { const i = state.templates.findIndex((t) => t.tpl_id === r.tpl_id); if (i >= 0) state.templates[i] = r; else state.templates.push(r); }
    ui.drafts = {};
  }
  async function saveCfg(patch) { state.settings.thanc = { ...(state.settings.thanc || {}), ...patch }; await DB.batch([await ctx.settingsOp()]); ui.drafts = {}; }
  function draftFor(date, shift) {
    const k = date + '|' + shift;
    if (!ui.drafts[k]) {
      const rec = findRec(Th.idFor(date, shift)); const n = rec && !rec.deleted_at && Th.wellFormed(rec) ? Th.norm(rec, resolve()) : null; const c = cfg().shifts[shift];
      ui.drafts[k] = n ? { saved: true, dirty: false, doctors: [...n.doctors], start: n.start, end: n.end, notes: n.notes, doctorTimes: Object.fromEntries(n.assignments.filter((a) => a.custom).map((a) => [a.doctor, { start: a.start, end: a.end }])) }
        : { saved: false, dirty: false, doctors: [...c.doctors], start: c.start, end: c.end, notes: '', doctorTimes: {} };
    }
    return ui.drafts[k];
  }
  const resetDrafts = () => { ui.drafts = {}; };
  const durText = (s, e) => { const iv = HR.interval('2000-01-01', s, e); return iv.status === 'ok' ? { ok: true, text: HR.fmt(iv.minutes) + (iv.overnight ? ' · overnight' : ''), warn: iv.warn } : { ok: false, text: iv.reason }; };
  /** Problem with the times of an edit, or ''. New edits can't contain unreadable or zero-length times. */
  function timeProblem(f, doctors) {
    const chk = (s, e, who) => { const iv = HR.interval('2000-01-01', s, e); return iv.status === 'ok' ? '' : `${who}: ${iv.reason}`; };
    let m = chk(f.start, f.end, 'Shift time'); if (m) return m;
    for (const [n, v] of Object.entries(f.doctorTimes || {})) { if (!v || !doctors.some((d) => Th.canonKey(d) === Th.canonKey(n))) continue; m = chk(v.start || f.start, v.end || f.end, Th.shortName(n)); if (m) return m; }
    return '';
  }
  /** Save (create / edit / move) one duty. Returns true when saved or unchanged. */
  async function persist(date, shift, f, old) {
    const c = cfg(), r = resolve(), doctors = Th.uniq(f.doctors || [], r);
    if (!doctors.length) { toast('Choose at least one doctor'); return false; }
    if (!Th.idOk(date)) { toast('Choose a valid date'); return false; }
    const bad = timeProblem(f, doctors); if (bad) { toast(bad); return false; }
    const now = T_NOW(), id = Th.idFor(date, shift), target = findRec(id), ff = { date, shift, doctors, start: f.start, end: f.end, notes: f.notes || '', doctorTimes: f.doctorTimes || {} };
    let puts = [];
    if (old && old.tpl_id !== id) {
      if (target && !target.deleted_at) { toast(`A ${shift} duty already exists on ${fmtDay(date)} — edit that one instead`); return false; }
      const mv = Th.moveRecord(old, ff, c, now, target); puts = [mv.rec, mv.tomb];
    } else if (target) { const e = Th.applyEdit(target, ff, c, now); if (e !== target) puts = [e]; }
    else puts = [Th.createRecord(date, shift, ff, c, now)];
    const known = new Set(c.roster.map(Th.canonKey)), fresh = doctors.filter((n) => !known.has(Th.canonKey(n)));
    if (fresh.length) state.settings.thanc = { ...(state.settings.thanc || {}), roster: [...c.roster, ...fresh] };
    try { await commit(puts, { settings: !!fresh.length }); } catch (e) { toast('Could not save: ' + ((e && e.message) || 'database error')); return false; }
    return true;
  }
  async function removeRec(rec) {
    const t = Th.softDelete(rec, T_NOW()); await commit([t]); ctx.render();
    toast('Duty deleted (history kept)', 'Undo', async () => { await commit([Th.restore(t, T_NOW(), 'undo delete')]); ctx.render(); });
  }
  async function setDefault(shift, f) {
    const cur = cfg(); await saveCfg({ roster: cur.roster, shifts: { ...cur.shifts, [shift]: { doctors: Th.uniq(f.doctors, resolve()), start: f.start, end: f.end } } }); toast('Saved as the default for ' + shift);
  }

  // ------------------------------------------------------------------ small widgets
  const avatar = (n) => h('span', { class: 'th-av' }, Th.initials(n));
  const docChip = (n, onRemove) => h('span', { class: 'th-doc' }, [avatar(n), h('b', {}, Th.shortName(n)), onRemove ? h('button', { 'aria-label': 'Remove ' + n, onclick: (e) => { e.stopPropagation(); onRemove(); } }, '×') : null]);
  const timeRange = (s, e) => `${Th.fmtTime(s)} – ${Th.fmtTime(e)}`;
  const activeRoster = () => { const c = cfg(), off = new Set(c.inactive.map(Th.canonKey)); return c.roster.filter((n) => !off.has(Th.canonKey(n))); };

  /** Multi-select doctor list + add-other. Mutates f.doctors, calls onChange. */
  function doctorPicker(f, onChange) {
    const wrap = h('div', { class: 'th-pick' });
    const paint = () => {
      wrap.innerHTML = ''; const r = resolve();
      const names = Th.uniq([...activeRoster(), ...f.doctors], r);
      wrap.appendChild(h('div', { class: 'chips sel-chips' }, names.map((n) => { const on = f.doctors.some((x) => Th.canonKey(r(x)) === Th.canonKey(n));
        return h('button', { class: 'chip th-sel' + (on ? ' on' : ''), 'data-doc': n, onclick: () => { f.doctors = on ? f.doctors.filter((x) => Th.canonKey(r(x)) !== Th.canonKey(n)) : [...f.doctors, n]; onChange && onChange(); paint(); } }, [avatar(n), Th.shortName(n)]); })));
      const inp = h('input', { class: 'input', placeholder: 'Add another doctor…', 'aria-label': 'Add another doctor', onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } } });
      const add = () => { const n = r(Th.clean(inp.value)); if (!n) return; f.doctors = Th.uniq([...f.doctors, n], r); onChange && onChange(); paint(); };
      wrap.appendChild(h('div', { class: 'th-addrow' }, [inp, h('button', { class: 'btn btn-soft', onclick: add }, [ic('plus'), 'Add'])]));
    };
    paint(); return wrap;
  }
  const timeInput = (value, onchange, label) => h('input', { class: 'input', type: 'time', value: value || '', 'aria-label': label, onchange: (e) => onchange(e.target.value) });
  const durChip = (s, e) => { const d = durText(s, e); return h('span', { class: 'th-dur' + (d.ok ? (d.warn ? ' warn' : '') : ' bad') }, d.ok ? d.text : d.text); };

  /** Full editor body (Home expanded card and the edit sheet): shift times, doctors, individual timings, notes. */
  function shiftForm(date, shift, f, o = {}) {
    const meta = Th.shiftMeta(shift); f.doctorTimes = f.doctorTimes || {};
    const times = h('div', { class: 'th-times' }); const shiftDur = h('span', { id: 'thShiftDur' });
    const keyFor = (n) => Object.keys(f.doctorTimes).find((k) => Th.canonKey(k) === Th.canonKey(n)) || n;
    const paintTimes = () => {
      shiftDur.innerHTML = ''; shiftDur.appendChild(durChip(f.start, f.end)); times.innerHTML = '';
      if (!f.doctors.length) return;
      times.appendChild(h('div', { class: 'th-tl' }, 'Individual timings (optional) — change only if a doctor worked different hours'));
      for (const n of f.doctors) {
        const k = keyFor(n), cur = f.doctorTimes[k], s = (cur && cur.start) || f.start, e = (cur && cur.end) || f.end; const dur = h('span', {}, durChip(s, e));
        const set = (part, v) => { const c2 = f.doctorTimes[keyFor(n)] || { start: f.start, end: f.end }; f.doctorTimes[keyFor(n)] = { ...c2, [part]: v }; o.onChange && o.onChange(); paintTimes(); };
        times.appendChild(h('div', { class: 'th-trow', 'data-doc-times': n }, [h('span', { class: 'th-tn' }, [avatar(n), Th.shortName(n)]), timeInput(s, (v) => set('start', v), 'Start ' + n), timeInput(e, (v) => set('end', v), 'End ' + n), dur,
          cur ? h('button', { class: 'th-reset', 'aria-label': 'Use shift times for ' + n, onclick: () => { delete f.doctorTimes[k]; o.onChange && o.onChange(); paintTimes(); } }, '↺') : null]));
      }
    };
    const change = () => { o.onChange && o.onChange(); paintTimes(); };
    const form = h('div', { class: 'th-form' }, [
      o.dateField ? h('div', { class: 'field' }, [h('label', {}, 'Duty date'), h('input', { class: 'input', type: 'date', value: o.dateField.value, onchange: (e) => o.dateField.onchange(e.target.value) })]) : h('div', { class: 'th-fact' }, [h('span', {}, 'Duty date'), h('b', {}, fmtDay(date))]),
      h('div', { class: 'th-fact' }, [h('span', {}, 'Shift'), h('b', {}, `${meta.label} · ${Th.HOSPITAL}`)]),
      h('div', { class: 'grid2' }, [h('div', { class: 'field' }, [h('label', {}, 'Start time'), timeInput(f.start, (v) => { f.start = v; change(); }, 'Start time')]), h('div', { class: 'field' }, [h('label', {}, 'End time'), timeInput(f.end, (v) => { f.end = v; change(); }, 'End time')])]),
      h('div', { class: 'th-fact' }, [h('span', {}, 'Duration'), shiftDur]),
      h('div', { class: 'field' }, [h('label', {}, 'Assigned doctors'), doctorPicker(f, change)]),
      times,
      h('div', { class: 'field' }, [h('label', {}, 'Notes'), h('textarea', { class: 'input', rows: 2, placeholder: 'Swap, cover, remarks…', oninput: (e) => { f.notes = e.target.value; o.onChange && o.onChange(); } }, f.notes || '')]),
    ]);
    paintTimes(); return form;
  }

  /** Change history of one duty. */
  const FIELD = { date: 'Date', shift: 'Shift', doctors: 'Doctors', start: 'Start', end: 'End', notes: 'Notes', doctorTimes: 'Individual times' };
  function historyView(rec) {
    const n = Th.norm(rec, resolve()), list = [...n.audit].reverse();
    const box = h('div', { class: 'th-hist' });
    if (!list.length) box.appendChild(h('p', { class: 'muted', style: 'margin:6px 0' }, n.schemaV === 1 ? 'Recorded before change history existed — changes made from now on are tracked here.' : 'No changes yet.'));
    for (const e of list) box.appendChild(h('div', { class: 'th-h' }, [h('b', {}, `${e.action[0].toUpperCase()}${e.action.slice(1)} · ${new Date(e.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`),
      ...Object.entries(e.changes || {}).map(([k, v]) => h('small', {}, `${FIELD[k] || k}: ${v[0] || '—'} → ${v[1] || '—'}`)), e.note ? h('small', {}, e.note) : null]));
    return box;
  }

  // ------------------------------------------------------------------ edit sheet (calendar / history / quick pick)
  function editSheet(date, shift, opts = {}) {
    const old = findRec(Th.idFor(date, shift)); const live = old && !old.deleted_at && Th.wellFormed(old) ? old : null; const c = cfg().shifts[shift];
    const f = live ? (() => { const n = Th.norm(live, resolve()); return { doctors: [...n.doctors], start: n.start, end: n.end, notes: n.notes, doctorTimes: Object.fromEntries(n.assignments.filter((a) => a.custom).map((a) => [a.doctor, { start: a.start, end: a.end }])) }; })() : { doctors: [...c.doctors], start: c.start, end: c.end, notes: '', doctorTimes: {} };
    let curDate = date, curShift = shift; const body = h('div'); let close;
    const paint = () => {
      body.innerHTML = '';
      body.appendChild(h('div', { class: 'seg th-seg' }, Th.SHIFTS.map((s) => h('button', { class: curShift === s.id ? 'on' : '', 'data-shift': s.id, onclick: () => { if (curShift !== s.id) { const prev = cfg().shifts[curShift]; if (!live && f.start === prev.start && f.end === prev.end) { const n = cfg().shifts[s.id]; f.start = n.start; f.end = n.end; } curShift = s.id; paint(); } } }, s.label))));
      body.appendChild(shiftForm(curDate, curShift, f, { dateField: { value: curDate, onchange: (v) => { curDate = v; } } }));
      body.appendChild(h('div', { class: 'btn-row', style: 'margin-top:12px' }, [
        live ? h('button', { class: 'btn btn-danger', id: 'thDel', onclick: () => { close(); removeRec(live); } }, 'Delete') : null,
        h('button', { class: 'btn btn-primary', id: 'thSave', onclick: async () => { if (await persist(curDate, curShift, f, live)) { close(); ctx.render(); toast('Duty saved'); opts.after && opts.after(curDate); } } }, [ic('check'), 'Save']),
      ]));
      body.appendChild(h('button', { class: 'btn btn-soft btn-block th-def', style: 'margin-top:8px', onclick: () => setDefault(curShift, f) }, 'Use these doctors & timings as my default for ' + Th.shiftMeta(curShift).label.toLowerCase()));
      if (live) body.appendChild(h('details', { class: 'th-details', id: 'thHist' }, [h('summary', {}, `Change history (${(live.data.audit || []).length})`), historyView(live)]));
    };
    close = openSheet(`${live ? 'Edit' : 'Add'} duty · ${Th.HOSPITAL}`, body); paint();
  }

  /** Compact selection panel: pick doctors for one shift and save. */
  function quickSheet(date, shift) {
    const d0 = draftFor(date, shift), f = { ...d0, doctors: [...d0.doctors] }; const meta = Th.shiftMeta(shift); let close;
    const body = h('div', {}, [
      h('p', { class: 'muted', style: 'margin:0 0 8px' }, `${fmtDay(date)} · ${timeRange(f.start, f.end)}`), doctorPicker(f),
      h('button', { class: 'btn btn-primary btn-block', id: 'thQuickSave', style: 'margin-top:12px', onclick: async () => { const rec = findRec(Th.idFor(date, shift)); if (await persist(date, shift, { ...d0, doctors: f.doctors }, rec && !rec.deleted_at ? rec : null)) { close(); ctx.render(); toast(meta.label + ' duty saved'); } } }, [ic('check'), `Save ${meta.label.toLowerCase()} duty`]),
    ]);
    close = openSheet(shift === 'night' && date === today() ? 'Mark tonight’s duty' : `${meta.label} duty · ${fmtDay(date)}`, body);
  }

  // ------------------------------------------------------------------ Home section
  const liveOf = (date, shift) => { const r = findRec(Th.idFor(date, shift)); return r && !r.deleted_at ? r : null; };
  function shiftCard(date, shift) {
    const meta = Th.shiftMeta(shift), d = draftFor(date, shift), open = !!ui.open[shift];
    const status = d.dirty ? h('span', { class: 'th-pill warn' }, 'Unsaved') : d.saved ? h('span', { class: 'th-pill ok' }, [ic('check'), 'Saved']) : h('span', { class: 'th-pill' }, 'Not marked');
    if (d.saved && !d.dirty && !open) return h('div', { class: `th-card compact th-${meta.tone}`, id: 'th-' + shift }, [
      h('button', { class: 'th-head', 'aria-expanded': false, onclick: () => { ui.open[shift] = true; ctx.render(); } }, [
        h('span', { class: 'th-ic sm' }, icon(shift)),
        h('span', { class: 'th-t' }, [h('b', {}, meta.label), h('small', {}, `${timeRange(d.start, d.end)} · ${d.doctors.map(Th.shortName).join(', ') || '—'}`)]),
        h('span', { class: 'th-pill ok' }, ic('check')), h('span', { class: 'th-chev' }, ic('chev'))]),
    ]);
    const chips = h('div', { class: 'th-docs' }, [
      ...d.doctors.map((n) => docChip(n, () => { d.doctors = d.doctors.filter((x) => x !== n); d.dirty = true; ctx.render(); })),
      h('button', { class: 'th-add', 'data-add': shift, onclick: () => quickSheet(date, shift) }, [ic('plus'), d.doctors.length ? 'Add' : 'Assign doctors']),
    ]);
    const quickLabel = shift === 'night' ? (date === today() ? 'MARK TONIGHT’S DUTY' : 'MARK NIGHT DUTY') : `Mark ${meta.label.toLowerCase()} duty`;
    const quick = (!d.saved || d.dirty) ? h('button', { class: 'btn th-mark' + (shift === 'night' ? ' big' : ''), 'data-mark': shift, onclick: async () => { if (!d.doctors.length) return quickSheet(date, shift); if (await persist(date, shift, d, liveOf(date, shift))) { ctx.render(); toast(meta.label + ' duty saved'); } } }, [ic('check'), quickLabel]) : null;
    return h('div', { class: `th-card th-${meta.tone}` + (open ? ' open' : ''), id: 'th-' + shift }, [
      h('button', { class: 'th-head', 'aria-expanded': open, onclick: () => { ui.open[shift] = !open; ctx.render(); } }, [
        h('span', { class: 'th-ic' }, icon(shift)), h('span', { class: 'th-t' }, [h('b', {}, meta.label + (shift === 'night' ? ' duty' : ' shift')), h('small', {}, timeRange(d.start, d.end))]), status, h('span', { class: 'th-chev' }, ic('chev')),
      ]),
      chips, quick,
      open ? h('div', { class: 'th-more' }, [shiftForm(date, shift, d, { onChange: () => { d.dirty = true; } }),
        h('div', { class: 'btn-row', style: 'margin-top:10px' }, [
          d.saved ? h('button', { class: 'btn btn-danger', onclick: () => { const rec = liveOf(date, shift); rec && removeRec(rec); } }, 'Delete') : null,
          h('button', { class: 'btn btn-primary', 'data-save': shift, onclick: async () => { if (await persist(date, shift, d, liveOf(date, shift))) { ui.open[shift] = false; ctx.render(); toast(meta.label + ' duty saved'); } } }, [ic('check'), 'Save']),
        ]),
        d.saved && liveOf(date, shift) ? h('details', { class: 'th-details' }, [h('summary', {}, 'Change history'), historyView(liveOf(date, shift))]) : null]) : null,
    ]);
  }
  function homeSection() {
    if (!state.key) return h('div');
    const date = ui.date || today();
    const nav = h('div', { class: 'th-datenav' }, [
      h('button', { class: 'icon-btn', 'aria-label': 'Previous day', onclick: () => { ui.date = shiftDay(date, -1); resetDrafts(); ctx.render(); } }, ic('left')),
      h('button', { class: 'th-date', id: 'thDate', onclick: () => { if (date !== today()) { ui.date = today(); resetDrafts(); ctx.render(); } } }, [h('b', {}, date === today() ? 'Today' : fmtDay(date)), h('small', {}, date === today() ? fmtDay(date) : 'tap for today')]),
      h('button', { class: 'icon-btn', 'aria-label': 'Next day', onclick: () => { ui.date = shiftDay(date, 1); resetDrafts(); ctx.render(); } }, ic('chev')),
    ]);
    const pending = Th.SHIFTS.filter((s) => { const d = draftFor(date, s.id); return d.doctors.length && (!d.saved || d.dirty); });
    const sumTxt = Th.SHIFTS.map((s) => { const d = draftFor(date, s.id); return `${s.label[0]}: ${d.doctors.length ? d.doctors.map(Th.shortName).join(', ') : '—'}${d.saved && !d.dirty ? '' : '*'}`; }).join('  ·  ');
    return h('div', { class: 'th-section', id: 'thanc' }, [ctx.fold({ id: 'thanc', title: 'THANC — Today’s duty', right: h('button', { id: 'thLink', onclick: () => go('thanc') }, 'Calendar →'), summary: sumTxt }, [
      nav, ...Th.SHIFTS.map((s) => shiftCard(date, s.id)),
      h('button', { class: 'btn btn-primary btn-block' + (pending.length ? '' : ' th-done'), id: 'thSaveAll', disabled: !pending.length, onclick: async () => { let n = 0; for (const s of pending) { const d = draftFor(date, s.id); if (await persist(date, s.id, d, liveOf(date, s.id))) n++; } ctx.render(); toast(n ? `Saved ${n} duty entr${n === 1 ? 'y' : 'ies'}` : 'Nothing to save'); } }, [ic('check'), pending.length ? `SAVE TODAY’S DUTY (${pending.length})` : 'ALL DUTY SAVED']),
    ])]);
  }

  // ------------------------------------------------------------------ THANC screen (calendar + history; other tabs come from ui-thanc-reports.js)
  const issueIds = () => new Set(Th.issues(recs(), cfg(), state.templates).map((i) => i.id));
  const dutyRow = (r, o = {}) => { const bad = o.issues && o.issues.has(r.id); const custom = r.assignments.filter((a) => a.custom);
    return h('div', { class: `th-row th-${Th.shiftMeta(r.shift).tone}` }, [
      h('span', { class: 'th-ic sm' }, icon(r.shift)),
      h('div', { class: 'th-rmain' }, [h('b', {}, (o.showDate ? fmtDay(r.date) + ' · ' : '') + Th.shiftMeta(r.shift).label, bad ? h('span', { class: 'th-pill warn', style: 'margin-left:6px' }, 'Check') : null, r.importedFrom ? h('span', { class: 'th-pill', style: 'margin-left:6px' }, 'Imported') : null), h('small', {}, timeRange(r.start, r.end)),
        h('div', { class: 'th-docs' }, r.doctors.map((n) => docChip(n))), ...custom.map((a) => h('small', { class: 'th-custom' }, `${Th.shortName(a.doctor)}: ${timeRange(a.start, a.end)}`)), r.notes ? h('p', { class: 'th-note' }, r.notes) : null]),
      h('button', { class: 'btn btn-sm', 'data-edit': r.id, onclick: () => editSheet(r.date, r.shift) }, 'Edit'),
    ]); };
  const monthNav = () => h('div', { class: 'month-nav' }, [h('button', { class: 'icon-btn', 'aria-label': 'Previous month', onclick: () => { ui.ym = shiftMonth(ui.ym, -1); ui.day = ''; ctx.render(); } }, ic('left')), h('b', {}, monthLabel(ui.ym)), h('button', { class: 'icon-btn', 'aria-label': 'Next month', onclick: () => { ui.ym = shiftMonth(ui.ym, 1); ui.day = ''; ctx.render(); } }, ic('chev'))]);
  ctx.thTabs = ctx.thTabs || {};

  function renderCalendar(body) {
    const all = recs(); body.appendChild(monthNav());
    const [y, m] = ui.ym.split('-').map(Number), first = new Date(y, m - 1, 1).getDay(), dim = new Date(y, m, 0).getDate(), bad = issueIds();
    const grid = h('div', { class: 'cal th-cal' }, ctx.DOW.map((d) => h('div', { class: 'wd' }, d[0])));
    for (let i = 0; i < first; i++) grid.appendChild(h('div', { class: 'cal-cell blank' }));
    for (let d = 1; d <= dim; d++) {
      const iso = `${ui.ym}-${String(d).padStart(2, '0')}`, day = Th.forDate(all, iso);
      grid.appendChild(h('button', { class: 'cal-cell th-cell' + (iso === today() ? ' today' : '') + (ui.day === iso ? ' sel' : ''), 'data-date': iso, onclick: () => { ui.day = iso; ctx.render(); } }, [h('span', {}, d), h('i', { class: 'th-dots' }, day.map((r) => h('u', { class: 'd-' + Th.shiftMeta(r.shift).tone + (bad.has(r.id) ? ' bad' : '') })))]));
    }
    body.appendChild(grid);
    body.appendChild(h('div', { class: 'legend-row' }, Th.SHIFTS.map((s) => h('span', {}, [h('i', { class: 'd-' + s.tone, style: 'width:10px;height:10px;border-radius:50%;display:inline-block' }), ' ' + s.label]))));
    const day = ui.day || today(); const list = Th.forDate(all, day);
    body.appendChild(h('div', { class: 'section-title' }, [h('h2', {}, fmtDay(day)), h('button', { onclick: () => editSheet(day, (Th.SHIFTS.find((s) => !list.some((r) => r.shift === s.id)) || Th.SHIFTS[0]).id) }, '+ Add duty')]));
    if (!list.length) body.appendChild(h('div', { class: 'empty', style: 'padding:20px' }, [h('div', {}, 'No duty recorded for this date.')]));
    list.forEach((r) => body.appendChild(dutyRow(r, { issues: bad })));
  }
  function renderHistory(body) {
    const all = recs(), bad = issueIds();
    const inp = h('input', { class: 'input', id: 'thQ', placeholder: 'Search doctor, date, shift — “Karthik”, “2026-11”, “5 Nov”, “night”', value: ui.q, oninput: (e) => { ui.q = e.target.value; paint(); } });
    body.appendChild(h('div', { class: 'field' }, [inp]));
    body.appendChild(h('label', { class: 'th-check' }, [h('input', { type: 'checkbox', id: 'thShowDel', checked: ui.showDeleted, onchange: (e) => { ui.showDeleted = e.target.checked; paint(); } }), ' Show deleted duties (can be restored)']));
    const out = h('div'); body.appendChild(out);
    const paint = () => { out.innerHTML = ''; const list = Th.search(all, ui.q, bad); const s = Th.summary(list, resolve());
      out.appendChild(h('p', { class: 'muted', id: 'thCount', style: 'margin:0 0 8px' }, `${list.length} duty entr${list.length === 1 ? 'y' : 'ies'}` + (ui.q ? ` · ${s.rows.length} doctor${s.rows.length === 1 ? '' : 's'}` : '')));
      if (ui.q && s.rows.length) out.appendChild(h('div', { class: 'th-sum' }, s.rows.slice(0, 6).map((r) => h('span', { class: 'chip' }, `${Th.shortName(r.doctor)} · M${r.morning} E${r.evening} N${r.night}`))));
      if (!list.length) out.appendChild(h('div', { class: 'empty' }, [ic('search'), h('div', {}, 'No matching duty.')]));
      list.slice(0, 120).forEach((r) => out.appendChild(dutyRow(r, { showDate: true, issues: bad })));
      if (list.length > 120) out.appendChild(h('p', { class: 'muted' }, `Showing the latest 120 of ${list.length}. Narrow the search or use Analytics → Export for everything.`));
      if (ui.showDeleted) { const del = Th.deletedOf(state.templates, resolve()).filter((r) => Th.search([r], ui.q).length).sort(Th.sortAsc).reverse();
        out.appendChild(h('div', { class: 'section-title' }, [h('h2', {}, `Deleted (${del.length})`)])); if (!del.length) out.appendChild(h('p', { class: 'muted' }, 'Nothing deleted.'));
        del.forEach((r) => out.appendChild(h('div', { class: `th-row th-${Th.shiftMeta(r.shift).tone} th-deleted` }, [h('span', { class: 'th-ic sm' }, icon(r.shift)), h('div', { class: 'th-rmain' }, [h('b', {}, fmtDay(r.date) + ' · ' + Th.shiftMeta(r.shift).label), h('small', {}, r.doctors.map(Th.shortName).join(', ') || '—')]),
          h('button', { class: 'btn btn-sm', 'data-restore': r.id, onclick: async () => { if (liveOf(r.date, r.shift)) return toast('A duty already exists for that date and shift'); await commit([Th.restore(r.rec, T_NOW())]); ctx.render(); toast('Duty restored'); } }, 'Restore')]))); } };
    paint();
  }
  const TABS = [['calendar', 'Calendar'], ['analytics', 'Analytics'], ['history', 'History'], ['doctors', 'Doctors'], ['data', 'Data']];
  function renderThanc(screen) {
    if (!ui.ym) ui.ym = today().slice(0, 7);
    if (ui.tab === 'summary') ui.tab = 'analytics';
    screen.appendChild(ctx.pageHead('THANC Duty', 'Morning · Evening · Night', h('button', { class: 'icon-btn', id: 'thAdd', 'aria-label': 'Add duty', onclick: () => editSheet(ui.day || today(), 'morning') }, ic('plus')), 'more'));
    screen.appendChild(h('div', { class: 'seg th-tabs' }, TABS.map(([k, l]) => h('button', { class: ui.tab === k ? 'on' : '', id: 'thTab-' + k, onclick: () => { ui.tab = k; ctx.render(); } }, l))));
    const body = h('div'); screen.appendChild(body);
    if (ui.tab === 'calendar') renderCalendar(body); else if (ui.tab === 'history') renderHistory(body);
    else if (ctx.thTabs[ui.tab]) ctx.thTabs[ui.tab](body); else body.appendChild(h('p', { class: 'muted' }, 'Loading…'));
  }
  ctx.thUI = { ui, cfg, resolve, recs, findRec, commit, saveCfg, persist, editSheet, dutyRow, avatar, docChip, monthNav, timeRange, issueIds, durText, historyView, liveOf };
  return { screens: { thanc: renderThanc }, api: { thancHome: homeSection, openThanc: () => go('thanc') } };
});
