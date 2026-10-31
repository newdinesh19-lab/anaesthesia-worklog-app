/**
 * ui-proc.js — procedure logbook: log, edit, monthly / yearly counts, quick logging from a case, procedure templates.
 * Screens: procedures, procEdit.
 */
(window.V8Ext = window.V8Ext || []).push((ctx) => {
  const { state, h, ic, go, toast, openSheet, confirmSheet, pageHead, chipGroup, toggleChips, fmtDate, todayISO, monthLabel, shiftMonth, uid } = ctx;
  const S = Schema, X = ctx.X;
  const ui = { mode: 'year', ym: '', year: '', filter: '', q: '' };
  const initUi = () => { const t = todayISO(); if (!ui.ym) ui.ym = t.slice(0, 7); if (!ui.year) ui.year = t.slice(0, 4); };
  const caseOf = (p) => (p.case_id ? state.cases.find((c) => c.case_id === p.case_id) : null);
  const roster = () => state.settings.anaesthetists;
  const shortOf = (n) => ctx.shortName(n);

  function inPeriod(p) { return ui.mode === 'month' ? (p.date || '').startsWith(ui.ym) : ui.mode === 'year' ? (p.date || '').startsWith(ui.year) : true; }

  // ------------------------------------------------------------------ list screen
  function renderProcedures(screen) {
    initUi();
    const all = ctx.activeProcedures();
    screen.appendChild(pageHead('Procedures', 'Logbook', h('button', { class: 'icon-btn', id: 'procAdd', 'aria-label': 'Log a procedure', onclick: () => openNew() }, ic('plus')), 'more'));
    screen.appendChild(h('div', { class: 'seg' }, [['month', 'Month'], ['year', 'Year'], ['all', 'All time']].map(([k, l]) => h('button', { class: ui.mode === k ? 'on' : '', id: 'pm-' + k, onclick: () => { ui.mode = k; ctx.render(); } }, l))));
    if (ui.mode !== 'all') {
      const label = ui.mode === 'month' ? monthLabel(ui.ym) : ui.year;
      const step = (d) => { if (ui.mode === 'month') ui.ym = shiftMonth(ui.ym, d); else ui.year = String(Number(ui.year) + d); ctx.render(); };
      screen.appendChild(h('div', { class: 'month-nav' }, [h('button', { class: 'icon-btn', 'aria-label': 'Previous', onclick: () => step(-1) }, ic('left')), h('b', {}, label), h('button', { class: 'icon-btn', 'aria-label': 'Next', onclick: () => step(1) }, ic('chev'))]));
    }
    const period = all.filter(inPeriod);
    const sum = Analytics.procSummary(period);
    screen.appendChild(h('div', { class: 'tiles' }, [
      X.stat(sum.total, ui.mode === 'month' ? 'This month' : ui.mode === 'year' ? 'This year' : 'All time', 'mint', null),
      X.stat(Object.keys(sum.byProc).length, 'Types logged', 'sky', null),
      X.stat(sum.byRole['Performed independently'] || 0, 'Independent', 'violet', null),
      X.stat(sum.usGuided, 'Ultrasound-guided', 'amber', null),
    ]));
    if (ui.mode === 'year') {
      const vals = Analytics.monthSeries(all, 'date', ui.year), now = new Date();
      screen.appendChild(h('div', { class: 'card' }, [h('h3', {}, `Monthly counts · ${ui.year}`), X.columnChart(vals, Analytics.MONTH_ABBR, { unit: 'procedures', short: Analytics.MONTH_ABBR.map((m) => m[0]), active: String(now.getFullYear()) === ui.year ? now.getMonth() : -1, color: 'var(--c4)', onTap: (i) => { ui.ym = `${ui.year}-${String(i + 1).padStart(2, '0')}`; } })]));
    }
    if (sum.total) screen.appendChild(h('div', { class: 'card' }, [h('h3', {}, 'Counts by procedure'), X.hbars(Analytics.entries(sum.byProc), { limit: 15, onTap: (n) => { ui.filter = ui.filter === n ? '' : n; ctx.render(); } }), X.qualityNote()]));

    screen.appendChild(h('div', { class: 'chips' }, [h('button', { class: 'chip' + (!ui.filter ? ' on' : ''), onclick: () => { ui.filter = ''; ctx.render(); } }, 'All'), ...Object.keys(sum.byProc).sort().map((n) => h('button', { class: 'chip' + (ui.filter === n ? ' on' : ''), onclick: () => { ui.filter = ui.filter === n ? '' : n; ctx.render(); } }, n))]));
    const box = h('div');
    screen.appendChild(h('div', { class: 'search' }, [ic('search'), h('input', { class: 'input', type: 'search', placeholder: 'Search site, case ref, supervisor, notes…', value: ui.q, oninput: (e) => { ui.q = e.target.value; paint(); } })]));
    screen.appendChild(box);
    function paint() {
      box.innerHTML = '';
      const words = ui.q.toLowerCase().split(/\s+/).filter(Boolean);
      const list = period.filter((p) => !ui.filter || p.procedure === ui.filter).filter((p) => { const c = caseOf(p); const hay = [p.procedure, p.site, p.case_ref, p.operator, p.assistant, p.supervisor, p.notes, p.hospital, ...(p.complications || []), c && c.patient_name, c && c.surgery].join(' ').toLowerCase(); return words.every((w) => hay.includes(w)); })
        .sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at));
      box.appendChild(h('div', { class: 'muted', style: 'margin:4px 4px 0;font-size:13px' }, `${list.length} entr${list.length === 1 ? 'y' : 'ies'}`));
      if (!list.length) box.appendChild(h('div', { class: 'empty' }, [ic('syringe'), h('div', {}, all.length ? 'No procedures match this period or filter.' : 'No procedures logged yet. Tap + to log your first.'), h('button', { class: 'btn btn-primary', style: 'margin-top:12px', onclick: () => openNew() }, [ic('plus'), 'Log a procedure'])]));
      list.forEach((p) => box.appendChild(procCard(p)));
    }
    paint();
  }

  function procCard(p) {
    const c = caseOf(p);
    const card = h('div', { class: 'case a2' });
    const sub = [fmtDate(p.date), p.site, p.role === S.PROC_ROLES[0] ? '' : p.role].filter(Boolean).join(' · ');
    card.appendChild(h('button', { class: 'case-head', onclick: () => card.classList.toggle('open') }, [
      h('span', { class: 'avatar' }, p.success === false ? '✗' : '✓'),
      h('span', { class: 'case-main' }, [h('b', {}, p.procedure), h('small', {}, sub || '—')]),
      h('span', { class: 'tag' }, `×${p.attempts || 1}`), ic('chev'),
    ]));
    const kv = (k, v) => h('div', { class: 'kv' }, [h('span', {}, k), h('span', {}, v || '—')]);
    card.appendChild(h('div', { class: 'case-body' }, [
      kv('Date', fmtDate(p.date)), kv('Site / detail', p.site), kv('Role', p.role), kv('Operator', p.operator), kv('Assistant', p.assistant), kv('Supervisor', p.supervisor),
      kv('Outcome', p.success === false ? 'Unsuccessful' : 'Successful'), kv('Attempts', p.attempts), kv('Ultrasound-guided', p.us_guided ? 'Yes' : ''),
      kv('Case', c ? `${c.patient_name || '(no name)'}${c.surgery ? ' · ' + c.surgery : ''}` : p.case_ref), kv('Hospital', p.hospital),
      (p.complications || []).length ? kv('Complications', p.complications.join(', ')) : null, p.complication_notes ? kv('Complication notes', p.complication_notes) : null, p.notes ? kv('Notes', p.notes) : null,
      h('div', { class: 'case-actions' }, [
        h('button', { class: 'btn btn-sm', onclick: () => { state.procDraft = JSON.parse(JSON.stringify(p)); state.procEditing = true; go('procEdit'); } }, [ic('edit'), 'Edit']),
        h('button', { class: 'btn btn-sm btn-danger', onclick: () => confirmSheet({ title: 'Delete this entry?', text: 'It moves to the Recycle bin, where you can restore it.', okLabel: 'Delete', danger: true, onOk: async () => { p.deleted_at = new Date().toISOString(); await ctx.putProcedure(p); ctx.render(); toast('Entry deleted', 'Undo', async () => { p.deleted_at = null; await ctx.putProcedure(p); ctx.render(); }); } }) }, [ic('trash'), 'Delete']),
      ]),
    ]));
    return card;
  }

  // ------------------------------------------------------------------ form
  function openNew(defaults = {}) {
    state.procDraft = S.newProcedure({ proc_id: uid(), date: todayISO(), operator: roster()[0] || '', hospital: state.settings.hospital, ...defaults });
    state.procEditing = false; go('procEdit');
  }
  const caseLabel = (c) => `${c.patient_name || '(no name)'}${c.surgery ? ' · ' + c.surgery : ''}`;

  function renderProcEdit(screen) {
    const p = state.procDraft || (state.procDraft = S.newProcedure({ proc_id: uid(), date: todayISO(), operator: roster()[0] || '', hospital: state.settings.hospital }));
    const editing = state.procEditing;
    screen.appendChild(pageHead(editing ? 'Edit Procedure' : 'Log Procedure', 'Procedure logbook', null, 'procedures'));

    // templates
    const tpls = state.templates.filter((t) => t.type === 'procedure').sort((a, b) => (b.favourite ? 1 : 0) - (a.favourite ? 1 : 0) || (b.uses || 0) - (a.uses || 0)).slice(0, 8);
    if (!editing && tpls.length) screen.appendChild(h('div', { class: 'card', id: 'procTpls' }, [h('h3', {}, 'Apply a template'), h('div', { class: 'chips' }, tpls.map((t) => h('button', { class: 'chip' + (t.favourite ? ' star on' : ''), onclick: () => { Object.assign(p, JSON.parse(JSON.stringify(t.data || {}))); t.uses = (t.uses || 0) + 1; ctx.putTemplate(t); toast('Template applied'); ctx.render(); } }, [t.favourite ? '★ ' : '', t.name]))) ]));

    const txt = (label, key, o = {}) => h('div', { class: 'field' }, [h('label', {}, label), h('input', { class: 'input', type: 'text', list: o.list, placeholder: o.placeholder, inputmode: o.inputmode, value: p[key] ?? '', oninput: (e) => (p[key] = e.target.value) })]);
    const caseSel = h('select', { class: 'input', id: 'procCase', onchange: (e) => { p.case_id = e.target.value; const c = caseOf(p); if (c) { p.case_ref = c.uhid || p.case_ref; if (!p.hospital) p.hospital = c.hospital; } } });
    const paintCases = () => {
      caseSel.innerHTML = '';
      const sameDay = ctx.casesForDate(p.date); const linked = caseOf(p); const opts = linked && !sameDay.includes(linked) ? [...sameDay, linked] : sameDay;
      caseSel.appendChild(h('option', { value: '' }, sameDay.length ? '— not linked —' : '— no cases on this date —'));
      opts.forEach((c) => caseSel.appendChild(h('option', { value: c.case_id, ...(p.case_id === c.case_id ? { selected: true } : {}) }, caseLabel(c))));
    };
    paintCases();

    screen.appendChild(h('div', { class: 'card' }, [
      h('h3', {}, 'Procedure'),
      h('div', { class: 'field' }, [h('label', {}, 'Date'), h('input', { class: 'input', type: 'date', value: p.date, onchange: (e) => { if (e.target.value) { p.date = e.target.value; paintCases(); } } })]),
      h('div', { class: 'field' }, [h('label', {}, 'Procedure'), chipGroup(S.PROCEDURES, () => p.procedure, (v) => (p.procedure = v))]),
      txt('Site / detail', 'site', { placeholder: 'e.g. Right IJV, L3-4, 7.0 ETT, brachial plexus' }),
      toggleRow('Ultrasound-guided', () => !!p.us_guided, (v) => (p.us_guided = v)),
    ]));

    screen.appendChild(h('div', { class: 'card' }, [
      h('h3', {}, 'Patient case'),
      h('div', { class: 'field' }, [h('label', {}, 'Link to a case on this date'), caseSel]),
      txt('Case reference', 'case_ref', { placeholder: 'UHID or any reference you will recognise' }),
      h('div', { class: 'note' }, 'Reports hide this reference unless you choose to include identifiers.'),
    ]));

    const people = [...new Set([...roster(), ...(state.settings.consultants || []), ...(state.settings.supervisors || [])])];
    screen.appendChild(h('div', { class: 'card' }, [
      h('h3', {}, 'Who'),
      h('div', { class: 'field' }, [h('label', {}, 'Your role'), chipGroup(S.PROC_ROLES, () => p.role, (v) => (p.role = v || S.PROC_ROLES[0]))]),
      txt('Operator', 'operator', { list: 'peopleList' }), txt('Assistant', 'assistant', { list: 'peopleList' }), txt('Supervisor', 'supervisor', { list: 'peopleList' }),
      h('datalist', { id: 'peopleList' }, people.map((n) => h('option', { value: n }))),
    ]));

    const attempts = ['1', '2', '3', '4', '5+'];
    screen.appendChild(h('div', { class: 'card' }, [
      h('h3', {}, 'Outcome'),
      h('div', { class: 'field' }, [h('label', {}, 'Result'), chipGroup(['Successful', 'Unsuccessful'], () => (p.success === false ? 'Unsuccessful' : 'Successful'), (v) => (p.success = v !== 'Unsuccessful'))]),
      h('div', { class: 'field' }, [h('label', {}, 'Number of attempts'), chipGroup(attempts, () => (Number(p.attempts) >= 5 ? '5+' : String(p.attempts || 1)), (v) => (p.attempts = v === '5+' ? 5 : Number(v) || 1))]),
      h('div', { class: 'field' }, [h('label', {}, 'Complications'), toggleChips(S.PROC_COMPLICATIONS, () => p.complications, (v) => (p.complications = v.includes('None') && v.length > 1 && !p.complications.includes('None') ? ['None'] : v.filter((x) => x !== 'None' || v.length === 1)), 'warn')]),
      h('div', { class: 'field' }, [h('label', {}, 'Complication details'), h('textarea', { class: 'input', rows: '2', oninput: (e) => (p.complication_notes = e.target.value) })]),
      h('div', { class: 'field' }, [h('label', {}, 'Notes'), h('textarea', { class: 'input', rows: '3', placeholder: 'Learning points, difficulty, equipment…', oninput: (e) => (p.notes = e.target.value) })]),
      txt('Hospital', 'hospital', { list: 'hospList2' }), h('datalist', { id: 'hospList2' }, ctx.hospitalList().map((n) => h('option', { value: n }))),
    ]));
    const tas = screen.querySelectorAll('textarea'); if (tas[0]) tas[0].value = p.complication_notes || ''; if (tas[1]) tas[1].value = p.notes || '';

    screen.appendChild(h('button', { class: 'btn btn-block', id: 'procTpl', style: 'margin-bottom:14px', onclick: () => saveProcTemplate(p) }, [ic('bolt'), 'Save as template']));
    screen.appendChild(h('div', { class: 'sticky-bar' }, h('div', { class: 'inner' }, [
      h('button', { class: 'btn', onclick: () => (history.length > 1 ? history.back() : go('procedures')) }, 'Cancel'),
      !editing ? h('button', { class: 'btn', id: 'procSaveMore', onclick: () => save(true) }, 'Save + another') : null,
      h('button', { class: 'btn btn-primary', id: 'procSave', onclick: () => save(false) }, [ic('check'), 'Save']),
    ])));
  }
  function toggleRow(label, get, set) { const b = h('button', { class: 'toggle-row' + (get() ? ' on' : ''), style: 'margin-bottom:6px', onclick: () => { set(!get()); b.classList.toggle('on', !!get()); } }, [h('span', { style: 'flex:1' }, h('b', {}, label)), h('span', { class: 'sw' })]); return b; }

  async function save(another) {
    const p = state.procDraft;
    if (!p.procedure) return toast('Choose the procedure');
    if (!p.date) return toast('Date is required');
    p.updated_at = new Date().toISOString(); p.schema_version = S.VERSION; p.attempts = Number(p.attempts) || 1;
    const ops = [await ctx.encOp('procedures', p)];
    const people = [p.operator, p.assistant, p.supervisor].map((x) => (x || '').trim()).filter(Boolean);
    state.settings.supervisors = state.settings.supervisors || [];
    let dirty = false; for (const n of people) if (!state.settings.supervisors.includes(n) && !roster().includes(n) && !(state.settings.consultants || []).includes(n)) { state.settings.supervisors.push(n); dirty = true; }
    if (ctx.rememberLists({ hospital: p.hospital }) || dirty) ops.push(await ctx.settingsOp());
    await DB.batch(ops);
    const i = state.procedures.findIndex((x) => x.proc_id === p.proc_id); i >= 0 ? (state.procedures[i] = p) : state.procedures.push(p);
    const keep = { date: p.date, operator: p.operator, hospital: p.hospital, case_id: p.case_id, case_ref: p.case_ref };
    state.procDraft = null; state.procEditing = false;
    if (another) { openNew(keep); toast('Saved — log the next one'); } else { go('procedures', null, { replace: true }); toast('Procedure saved'); }
  }

  function saveProcTemplate(p) {
    const name = h('input', { class: 'input', id: 'ptName', value: p.procedure ? `${p.procedure}${p.site ? ' – ' + p.site : ''}` : '', placeholder: 'Template name' });
    const close = openSheet('Save procedure template', h('div', {}, [h('p', {}, 'Saves the procedure, site, your role, people and ultrasound flag. Never dates, patients, results or notes.'), h('div', { class: 'field' }, [h('label', {}, 'Name'), name]),
      h('div', { class: 'btn-row' }, [h('button', { class: 'btn', onclick: () => close() }, 'Cancel'), h('button', { class: 'btn btn-primary', id: 'ptSave', onclick: async () => {
        const nm = name.value.trim(); if (!nm || !p.procedure) return toast(p.procedure ? 'Give the template a name' : 'Choose a procedure first');
        const t = state.templates.find((x) => x.type === 'procedure' && x.name.toLowerCase() === nm.toLowerCase()) || { tpl_id: uid(), type: 'procedure', created_at: new Date().toISOString(), uses: 0 };
        Object.assign(t, { name: nm, favourite: true, data: { procedure: p.procedure, site: p.site, role: p.role, us_guided: !!p.us_guided, operator: p.operator, assistant: p.assistant, supervisor: p.supervisor }, updated_at: new Date().toISOString() });
        if (!state.templates.includes(t)) state.templates.push(t); await ctx.putTemplate(t); close(); toast('Template saved');
      } }, [ic('check'), 'Save'])])]));
  }

  // ------------------------------------------------------------------ quick logging from a case
  function suggestFromCase(c) {
    const out = []; const add = (n) => { if (!out.includes(n)) out.push(n); };
    const t = S.techniquesOf(c), a = c.airway || {}, i = c.intraop || {}; const dev = a.devices || [], tech = i.airway_tech || [];
    if (t.includes('Spinal')) add('Spinal anaesthesia'); if (t.includes('Epidural')) add('Epidural insertion'); if (t.includes('CSE')) add('CSE');
    if (t.includes('Peripheral nerve block') || (i.blocks || []).length) add('Peripheral nerve block');
    if (dev.includes('Video laryngoscope')) add('Video laryngoscopy'); if (dev.includes('Fibreoptic')) add('Fibreoptic intubation');
    if (a.ett_type || a.ett_size || tech.some((x) => /^ETT/.test(x)) || dev.some((d) => /laryngoscope|Fibreoptic|Bougie|Double-lumen/.test(d))) add('Endotracheal intubation');
    if (a.difficult) add('Difficult intubation');
    if (a.lma_type || dev.includes('Supraglottic airway') || tech.includes('Supraglottic airway')) add('LMA insertion');
    if ((i.access || []).includes('Arterial line')) add('Arterial cannulation'); if ((i.access || []).includes('Central line')) add('Central venous catheterisation'); if ((i.access || []).includes('PICC')) add('PICC insertion');
    if ((i.monitoring || []).includes('TEE')) add('TEE / TTE exposure');
    return out;
  }
  const AIRWAY_PROCS = ['Endotracheal intubation', 'Difficult intubation', 'Fibreoptic intubation', 'Video laryngoscopy', 'LMA insertion'];
  function logProcedureFor(c) {
    const sug = suggestFromCase(c); const logged = new Set(ctx.activeProcedures().filter((p) => p.case_id === c.case_id).map((p) => p.procedure));
    const base = { date: c.case_date, case_id: c.case_id, case_ref: c.uhid || '', hospital: c.hospital || state.settings.hospital };
    if (!sug.length) return openNew(base);
    const chosen = new Set(sug.filter((n) => !logged.has(n)));
    const list = h('div');
    const paint = () => { list.innerHTML = ''; list.appendChild(toggleChips(sug, () => [...chosen], (v) => { chosen.clear(); v.forEach((x) => chosen.add(x)); }, '', null)); };
    paint();
    const close = openSheet('Log procedures from this case', h('div', {}, [
      h('p', {}, `Based on what you documented for ${c.patient_name || 'this case'}. Tap to include or leave out; you can edit each entry afterwards.${logged.size ? ' Already logged ones are left unticked.' : ''}`), list,
      h('div', { class: 'btn-row', style: 'margin-top:12px' }, [
        h('button', { class: 'btn', onclick: () => { close(); openNew(base); } }, 'Other / manual'),
        h('button', { class: 'btn btn-primary', id: 'logFromCase', onclick: async () => {
          if (!chosen.size) return toast('Pick at least one');
          const now = new Date().toISOString(); const made = [];
          for (const name of chosen) {
            const attempts = AIRWAY_PROCS.includes(name) && (c.airway || {}).attempts ? (c.airway.attempts === '>3' ? 4 : Number(c.airway.attempts) || 1) : 1;
            const usable = /nerve block|Arterial|Central|PICC/.test(name) && (c.intraop || {}).us_guided;
            made.push(S.newProcedure({ proc_id: uid(), ...base, procedure: name, operator: roster()[0] || '', attempts, us_guided: !!usable, created_at: now, updated_at: now }));
          }
          await DB.batch(await Promise.all(made.map((m) => ctx.encOp('procedures', m)))); state.procedures.push(...made);
          close(); ctx.render(); toast(`${made.length} procedure${made.length === 1 ? '' : 's'} logged`, 'View', () => go('procedures'));
        } }, [ic('check'), 'Log selected']),
      ]),
    ]));
  }

  return { screens: { procedures: renderProcedures, procEdit: renderProcEdit }, api: { logProcedureFor, suggestFromCase, openNewProcedure: openNew } };
});
