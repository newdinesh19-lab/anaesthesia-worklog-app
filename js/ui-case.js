/**
 * ui-case.js — V8 structured case documentation: technique / ASA / speciality, optional detailed sections
 * (airway, intra-op, post-op), case-card detail rows, and case templates.
 * The core form (patient, date, anaesthetist, surgery, hospital) stays in app.js; this module adds the new parts.
 */
(window.V8Ext = window.V8Ext || []).push((ctx) => {
  const { state, h, ic, go, toast, openSheet, chipGroup, toggleChips, dropdownList } = ctx;
  const S = Schema;

  // ---------------------------------------------------------------- small form helpers
  const area = (label, get, set, ph, rows = 3) => { const t = h('textarea', { class: 'input', rows: String(rows), placeholder: ph || '', oninput: (e) => set(e.target.value) }); t.value = get() || ''; return h('div', { class: 'field' }, [h('label', {}, label), t]); };
  const text = (label, get, set, o = {}) => h('div', { class: 'field' }, [h('label', {}, label), h('input', { class: 'input', type: o.type || 'text', inputmode: o.inputmode, placeholder: o.placeholder, value: get() ?? '', oninput: (e) => set(e.target.value) })]);
  const one = (label, options, get, set, help, extra = '') => h('div', { class: 'field' }, [h('label', {}, label), chipGroup(options, get, set, extra), help ? h('div', { class: 'note' }, help) : null]);
  const many = (label, options, get, set, extra = '', onChange) => h('div', { class: 'field' }, [h('label', {}, label), toggleChips(options, get, set, extra, onChange)]);
  const toggle = (label, sub, get, set, extra = '') => {
    const b = h('button', { class: 'toggle-row' + (get() ? ' on' : ''), onclick: () => { set(!get()); b.classList.toggle('on', !!get()); } }, [h('span', { style: 'flex:1' }, [h('b', {}, label), sub ? h('small', {}, sub) : null]), h('span', { class: 'sw' })]);
    return b;
  };
  const sub = (t) => h('div', { class: 'subhead' }, t);
  const join = (a, sep = ' · ') => a.filter(Boolean).join(sep);

  function acc(title, summary, build, open) {
    const d = h('details', { class: 'acc', ...(open ? { open: true } : {}) });
    const sm = h('small', {}, summary());
    d.appendChild(h('summary', {}, [h('span', {}, title), sm]));
    const body = h('div', { class: 'acc-body' }); d.appendChild(body);
    let built = false; const fill = () => { if (!built) { built = true; body.appendChild(build(() => { sm.textContent = summary(); })); } };
    if (open) fill();
    d.addEventListener('toggle', () => { if (d.open) fill(); });
    d.addEventListener('click', () => setTimeout(() => { sm.textContent = summary(); }, 0), true);
    return d;
  }

  // ---------------------------------------------------------------- quick / detailed switch
  function entryModeToggle() {
    const s = state.settings;
    const seg = h('div', { class: 'seg', id: 'entrySeg' }, ['quick', 'detailed'].map((m) => h('button', { class: s.entryMode === m ? 'on' : '', id: 'entry-' + m, onclick: async () => { if (s.entryMode === m) return; s.entryMode = m; await ctx.saveSettings(); ctx.render(); } }, m === 'quick' ? [ic('bolt'), 'Quick entry'] : [ic('clip'), 'Detailed'])));
    return seg;
  }

  // ---------------------------------------------------------------- core fields (shown in both modes)
  function techniqueField(c) {
    const wrap = h('div', { class: 'field' });
    wrap.appendChild(h('label', {}, 'Anaesthesia technique (tap all that apply)'));
    wrap.appendChild(toggleChips(S.TECHNIQUES, () => c.techniques, (v) => { c.techniques = v; c.anaesthesia_mode = S.modeFromTechniques(v) || (v.length ? '' : c.anaesthesia_mode); }, '', null));
    if (!c.techniques.length && c.anaesthesia_mode) wrap.appendChild(h('div', { class: 'note' }, `Recorded earlier as “${c.anaesthesia_mode}”. Pick techniques above to update it.`));
    return wrap;
  }

  function clinicalCard(c) {
    const card = h('div', { class: 'card', id: 'clinicalCard' });
    card.appendChild(h('h3', {}, 'Case details'));
    card.appendChild(h('div', { class: 'field' }, [h('label', {}, 'ASA grade'), chipGroup(S.ASA, () => c.asa, (v) => (c.asa = v))]));
    card.appendChild(h('div', { class: 'field' }, [h('label', {}, 'Urgency'), chipGroup(S.URGENCY, () => c.urgency, (v) => (c.urgency = v), 'star')]));
    // speciality with a suggestion made from the surgery name
    const spWrap = h('div', { class: 'field' });
    const hint = h('div', { class: 'chips', style: 'padding-top:2px' });
    const paintHint = () => {
      hint.innerHTML = '';
      const sug = S.suggestSpeciality(c.surgery);
      if (sug && c.speciality !== sug) hint.appendChild(h('button', { class: 'chip sug', id: 'specSuggest', onclick: () => { c.speciality = sug; repaintSp(); paintHint(); } }, `Suggested: ${sug} — tap to use`));
    };
    const spBox = h('div'); const repaintSp = () => { spBox.innerHTML = ''; spBox.appendChild(chipGroup(S.SPECIALITIES, () => c.speciality, (v) => { c.speciality = v; paintHint(); })); };
    repaintSp(); paintHint();
    spWrap.append(h('label', {}, 'Surgical speciality'), spBox, hint);
    card.appendChild(spWrap);
    const onSurg = () => { if (!spWrap.isConnected) return document.removeEventListener('surgery-changed', onSurg); paintHint(); };
    document.addEventListener('surgery-changed', onSurg);
    card.appendChild(h('div', { class: 'field' }, [h('label', {}, 'Complexity'), chipGroup(S.COMPLEXITY, () => c.complexity, (v) => (c.complexity = v))]));
    if (state.settings.entryMode === 'quick') card.appendChild(h('div', { class: 'field' }, [h('label', {}, 'After surgery'), chipGroup(S.POSTOP.destination, () => c.postop.destination, (v) => (c.postop.destination = v))]));
    return card;
  }

  // ---------------------------------------------------------------- detailed sections
  const dur = (a, b) => { const m = S.minutesBetween(a, b); return m == null ? '' : m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`; };

  function riskSection(c) {
    return acc('Comorbidities & risk', () => join([c.comorbidities.length && `${c.comorbidities.length} conditions`, c.risk_factors.length && `${c.risk_factors.length} risks`]) || 'Optional', () => h('div', {}, [
      dropdownList({ label: 'Relevant comorbidities', groups: MedData.CONDITIONS, getList: () => c.comorbidities, setList: (v) => (c.comorbidities = v) }),
      many('Pre-operative risk factors', S.RISK_FACTORS, () => c.risk_factors, (v) => (c.risk_factors = v), 'star'),
    ]), !!(c.comorbidities.length || c.risk_factors.length));
  }

  function airwaySection(c, bumpNotable) {
    const a = c.airway;
    const sum = () => join([a.mask && `Mask ${a.mask.replace('Grade ', 'G')}`, a.cl && `CL ${a.cl}`, a.attempts && `${a.attempts} attempt${a.attempts === '1' ? '' : 's'}`, a.difficult && '⚠ difficult']) || 'Optional';
    return acc('Airway', sum, (refresh) => {
      const box = h('div');
      box.append(
        one('Mask ventilation', S.AIRWAY.mask, () => a.mask, (v) => { a.mask = v; refresh(); }, S.AIRWAY.maskHelp),
        one('Laryngoscopy grade (Cormack–Lehane)', S.AIRWAY.cl, () => a.cl, (v) => { a.cl = v; refresh(); }),
        one('Modified Cormack–Lehane', S.AIRWAY.clMod, () => a.cl_mod, (v) => (a.cl_mod = v)),
        many('Device / technique used', S.AIRWAY.devices, () => a.devices || [], (v) => (a.devices = v)),
        sub('Endotracheal tube'),
        one('Tube type', S.AIRWAY.ettTypes, () => a.ett_type, (v) => (a.ett_type = v)),
        h('div', { class: 'grid2' }, [text('Size (ID mm)', () => a.ett_size, (v) => (a.ett_size = v), { inputmode: 'decimal', placeholder: '7.5' }), text('Depth at teeth/lip (cm)', () => a.ett_depth, (v) => (a.ett_depth = v), { inputmode: 'decimal', placeholder: '21' })]),
        sub('Supraglottic airway (LMA)'),
        one('LMA type', S.AIRWAY.lmaTypes, () => a.lma_type, (v) => (a.lma_type = v)),
        one('LMA size', S.AIRWAY.lmaSizes, () => a.lma_size, (v) => (a.lma_size = v)),
        one('Number of attempts', S.AIRWAY.attempts, () => a.attempts, (v) => { a.attempts = v; refresh(); }),
      );
      const flag = toggle('Difficult airway', 'Anticipated or unanticipated', () => !!a.difficult, (v) => { a.difficult = v; refresh(); paintNotableHint(); }, 'warn');
      const nh = h('div'); const paintNotableHint = () => { nh.innerHTML = ''; if (a.difficult && !c.notable) nh.appendChild(h('button', { class: 'btn btn-soft btn-block', style: 'margin-bottom:10px', onclick: () => { c.notable = true; c.notable_type = c.notable_type || 'Difficult airway'; bumpNotable(); toast('Marked as notable — add details below'); paintNotableHint(); } }, [ic('star'), 'Also mark as a notable case'])); };
      box.append(flag, nh);
      paintNotableHint();
      box.append(
        many('Airway complications', S.AIRWAY.complications, () => a.complications || [], (v) => (a.complications = v), 'warn'),
        one('Extubation', S.AIRWAY.extubation, () => a.extubation, (v) => (a.extubation = v)),
        area('Airway / extubation notes', () => a.notes, (v) => (a.notes = v), 'e.g. bougie used, external laryngeal manipulation, awake extubation after reversal', 2),
      );
      return box;
    }, !!Object.values(a).some((v) => (Array.isArray(v) ? v.length : v)));
  }

  function intraopSection(c) {
    const i = c.intraop;
    const sum = () => join([i.anaes_start && i.anaes_end && `Anaes ${dur(i.anaes_start, i.anaes_end)}`, i.ebl_ml && `EBL ${i.ebl_ml} ml`, (i.complications || []).length && `${i.complications.length} complication(s)`]) || 'Optional';
    return acc('Intra-operative', sum, (refresh) => {
      const timesNote = h('div', { class: 'note' }); const paintT = () => { timesNote.textContent = join([i.anaes_start && i.anaes_end && `Anaesthesia ${dur(i.anaes_start, i.anaes_end)}`, i.surg_start && i.surg_end && `Surgery ${dur(i.surg_start, i.surg_end)}`]); refresh(); };
      const tm = (label, key) => h('div', { class: 'field' }, [h('label', {}, label), h('input', { class: 'input', type: 'time', value: i[key] || '', onchange: (e) => { i[key] = e.target.value; paintT(); } })]);
      const box = h('div');
      box.append(
        h('div', { class: 'grid2' }, [tm('Anaesthesia start', 'anaes_start'), tm('Anaesthesia end', 'anaes_end')]),
        h('div', { class: 'grid2' }, [tm('Surgery start', 'surg_start'), tm('Surgery end', 'surg_end')]), timesNote,
        many('Monitoring', S.INTRAOP.monitoring, () => i.monitoring || [], (v) => (i.monitoring = v)),
        many('Vascular access', S.INTRAOP.access, () => i.access || [], (v) => (i.access = v)),
        many('Airway technique', S.INTRAOP.airwayTech, () => i.airway_tech || [], (v) => (i.airway_tech = v)),
        dropdownList({ label: 'Drugs administered', groups: S.INTRAOP.drugs, getList: () => i.drugs || [], setList: (v) => (i.drugs = v) }),
        area('Doses / other drugs', () => i.drug_notes, (v) => (i.drug_notes = v), 'e.g. Propofol 120 mg, Fentanyl 100 mcg, Atracurium 40 mg', 2),
        many('Vasopressors & inotropes', S.INTRAOP.vasoactive, () => i.vasoactive || [], (v) => (i.vasoactive = v)),
        text('Vasopressor doses / infusions', () => i.vaso_notes, (v) => (i.vaso_notes = v), { placeholder: 'e.g. Ephedrine 6 mg ×2; noradrenaline 0.05 mcg/kg/min' }),
        many('IV fluids', S.INTRAOP.fluids, () => i.fluids || [], (v) => (i.fluids = v)),
        h('div', { class: 'grid2' }, [text('Total fluids (ml)', () => i.fluids_ml, (v) => (i.fluids_ml = v), { inputmode: 'numeric' }), text('Urine output (ml)', () => i.urine_ml, (v) => (i.urine_ml = v), { inputmode: 'numeric' })]),
        h('div', { class: 'grid2' }, [text('Est. blood loss (ml)', () => i.ebl_ml, (v) => { i.ebl_ml = v; refresh(); }, { inputmode: 'numeric' }), text('Blood product units', () => i.blood_units, (v) => (i.blood_units = v), { placeholder: 'e.g. PRBC 2' })]),
        many('Blood products', S.INTRAOP.blood, () => i.blood || [], (v) => (i.blood = v)),
        sub('Regional technique'),
        many('Block / catheter', S.INTRAOP.blocks, () => i.blocks || [], (v) => (i.blocks = v)),
        toggle('Ultrasound-guided', 'Tick if an ultrasound was used for the block or line', () => !!i.us_guided, (v) => (i.us_guided = v)),
        text('Regional details', () => i.regional_details, (v) => (i.regional_details = v), { placeholder: 'Drug, volume, level / side, catheter depth' }),
        sub('Events & complications'),
        many('Intra-operative events', S.INTRAOP.events, () => i.events || [], (v) => (i.events = v)),
        many('Complications', S.INTRAOP.complications, () => i.complications || [], (v) => { i.complications = v; refresh(); }, 'warn'),
        area('Event notes & interventions', () => i.interventions, (v) => (i.interventions = v), 'What happened and what you did: e.g. hypotension after induction, ephedrine 12 mg + fluid bolus, settled', 3),
      );
      paintT();
      return box;
    }, !!Object.values(i).some((v) => (Array.isArray(v) ? v.length : v)));
  }

  function postopSection(c) {
    const p = c.postop;
    const sum = () => join([p.destination, p.pain != null && p.pain !== '' && `Pain ${p.pain}/10`, (p.complications || []).length && `${p.complications.length} complication(s)`]) || 'Optional';
    return acc('Post-operative', sum, (refresh) => h('div', {}, [
      one('Airway / ventilation at end', S.POSTOP.airwayStatus, () => p.airway_status, (v) => (p.airway_status = v)),
      many('PACU recovery', S.POSTOP.pacu, () => p.pacu || [], (v) => (p.pacu = v)),
      one('Pain score (0–10)', S.POSTOP.pain, () => (p.pain == null ? '' : String(p.pain)), (v) => { p.pain = v; refresh(); }),
      one('PONV', S.POSTOP.ponv, () => p.ponv, (v) => (p.ponv = v)),
      one('Haemodynamics', S.POSTOP.haemo, () => p.haemo, (v) => (p.haemo = v)),
      one('Oxygen requirement', S.POSTOP.o2, () => p.o2, (v) => (p.o2 = v)),
      many('Post-operative complications', S.POSTOP.complications, () => p.complications || [], (v) => { p.complications = v; refresh(); }, 'warn'),
      one('Destination', S.POSTOP.destination, () => p.destination, (v) => { p.destination = v; refresh(); }),
      area('Handover notes', () => p.handover, (v) => (p.handover = v), 'Analgesia plan, fluids, concerns for the ward / ICU team', 3),
    ]), !!Object.values(p).some((v) => (Array.isArray(v) ? v.length : v !== '' && v != null)));
  }

  /** Detailed accordions (airway, intra-op, post-op, risk). Quick mode shows a single "add details" prompt instead. */
  function detailSections(c, bumpNotable) {
    if (state.settings.entryMode !== 'detailed') {
      return [h('button', { class: 'btn btn-soft btn-block', id: 'addDetails', style: 'margin-bottom:14px', onclick: async () => { state.settings.entryMode = 'detailed'; await ctx.saveSettings(); ctx.render(); } }, [ic('clip'), 'Add airway, intra-op & post-op details'])];
    }
    return [riskSection(c), airwaySection(c, bumpNotable), intraopSection(c), postopSection(c)];
  }

  // ---------------------------------------------------------------- read-only rows for case cards
  function caseExtraRows(c) {
    const rows = [];
    const add = (k, v) => { if (v) rows.push([k, v]); };
    const a = c.airway || {}, i = c.intraop || {}, p = c.postop || {};
    add('Technique', (c.techniques || []).join(' + '));
    add('ASA', c.asa && `${c.asa}${c.urgency === 'Emergency' ? ' E' : ''}`); add('Urgency', c.urgency);
    const sp = S.specialityOf(c); add('Speciality', sp.value && sp.value + (sp.auto ? ' (suggested)' : '')); add('Complexity', c.complexity);
    add('Comorbidities', (c.comorbidities || []).join(', ')); add('Risk factors', (c.risk_factors || []).join(', '));
    add('Airway', join([a.mask && `Mask ${a.mask}`, a.cl && `CL ${a.cl}${a.cl_mod ? ` (${a.cl_mod})` : ''}`, (a.devices || []).join(', '), a.ett_type && `ETT ${a.ett_type}${a.ett_size ? ' ' + a.ett_size : ''}${a.ett_depth ? ' @' + a.ett_depth + ' cm' : ''}`, a.lma_type && `LMA ${a.lma_type}${a.lma_size ? ' ' + a.lma_size : ''}`, a.attempts && `${a.attempts} attempt(s)`, a.difficult && 'DIFFICULT AIRWAY']));
    add('Airway complications', (a.complications || []).join(', ')); add('Extubation', a.extubation); add('Airway notes', a.notes);
    add('Times', join([i.anaes_start && `Anaes ${i.anaes_start}–${i.anaes_end || '?'}${dur(i.anaes_start, i.anaes_end) ? ' (' + dur(i.anaes_start, i.anaes_end) + ')' : ''}`, i.surg_start && `Surgery ${i.surg_start}–${i.surg_end || '?'}${dur(i.surg_start, i.surg_end) ? ' (' + dur(i.surg_start, i.surg_end) + ')' : ''}`]));
    add('Monitoring', (i.monitoring || []).join(', ')); add('Access', (i.access || []).join(', ')); add('Airway technique', (i.airway_tech || []).join(', '));
    add('Drugs', join([(i.drugs || []).join(', '), i.drug_notes], ' — ')); add('Vasoactive', join([(i.vasoactive || []).join(', '), i.vaso_notes], ' — '));
    add('Fluids', join([(i.fluids || []).join(', '), i.fluids_ml && `${i.fluids_ml} ml`])); add('EBL', i.ebl_ml && `${i.ebl_ml} ml`); add('Urine', i.urine_ml && `${i.urine_ml} ml`);
    add('Blood products', join([(i.blood || []).join(', '), i.blood_units]));
    add('Regional', join([(i.blocks || []).join(', '), i.us_guided && 'US-guided', i.regional_details]));
    add('Events', (i.events || []).join(', ')); add('Intra-op complications', (i.complications || []).join(', ')); add('Interventions', i.interventions);
    add('Post-op', join([p.airway_status, (p.pacu || []).join(', '), p.pain !== '' && p.pain != null && `Pain ${p.pain}/10`, p.ponv && `PONV: ${p.ponv}`, p.haemo, p.o2]));
    add('Post-op complications', (p.complications || []).join(', ')); add('Destination', p.destination); add('Handover', p.handover);
    return rows;
  }

  // ---------------------------------------------------------------- templates
  const PICK = {
    airway: ['devices', 'ett_type', 'ett_size', 'ett_depth', 'lma_type', 'lma_size', 'extubation'],
    intraop: ['monitoring', 'access', 'airway_tech', 'drugs', 'drug_notes', 'vasoactive', 'fluids', 'blocks', 'us_guided', 'regional_details'],
    postop: ['airway_status', 'pacu', 'o2', 'haemo', 'destination'],
  };
  const pick = (o, keys) => { const r = {}; for (const k of keys) if (o && o[k] != null && o[k] !== '' && !(Array.isArray(o[k]) && !o[k].length)) r[k] = JSON.parse(JSON.stringify(o[k])); return r; };
  const typeLabel = (t) => (S.TEMPLATE_TYPES.find((x) => x[0] === t) || [t, t])[1];
  function templateData(type, c) {
    if (type === 'surgery') return { surgery: c.surgery || '', speciality: c.speciality || S.suggestSpeciality(c.surgery), complexity: c.complexity || '', techniques: [...(c.techniques || [])], consultant: c.consultant || '' };
    return { techniques: [...(c.techniques || [])], airway: pick(c.airway, PICK.airway), intraop: pick(c.intraop, PICK.intraop), postop: pick(c.postop, PICK.postop) };
  }
  function applyTemplate(c, t) {
    const d = t.data || {};
    if (t.type === 'surgery') {
      if (d.surgery) c.surgery = d.surgery; if (d.speciality) c.speciality = d.speciality; if (d.complexity) c.complexity = d.complexity;
      if (d.consultant && !c.consultant) c.consultant = d.consultant;
      if ((d.techniques || []).length) { c.techniques = [...d.techniques]; c.anaesthesia_mode = S.modeFromTechniques(c.techniques); }
    } else {
      if ((d.techniques || []).length) { c.techniques = [...d.techniques]; c.anaesthesia_mode = S.modeFromTechniques(c.techniques); }
      Object.assign(c.airway, JSON.parse(JSON.stringify(d.airway || {}))); Object.assign(c.intraop, JSON.parse(JSON.stringify(d.intraop || {}))); Object.assign(c.postop, JSON.parse(JSON.stringify(d.postop || {})));
      if (Object.keys(d.airway || {}).length || Object.keys(d.intraop || {}).length || Object.keys(d.postop || {}).length) { state.settings.entryMode = 'detailed'; }
    }
    t.uses = (t.uses || 0) + 1; t.last_used = new Date().toISOString(); ctx.putTemplate(t);
    toast(`Template applied · ${t.name}`);
    ctx.render();
  }
  function templateStrip(c) {
    const list = state.templates.filter((t) => t.type === 'surgery' || t.type === 'anaesthesia').sort((a, b) => (b.favourite ? 1 : 0) - (a.favourite ? 1 : 0) || (b.uses || 0) - (a.uses || 0)).slice(0, 10);
    if (!list.length) return null;
    return h('div', { class: 'card', id: 'tplStrip' }, [h('h3', {}, 'Apply a template'), h('div', { class: 'chips' }, list.map((t) => h('button', { class: 'chip' + (t.favourite ? ' star on' : ''), onclick: () => applyTemplate(c, t) }, [t.favourite ? '★ ' : '', t.name, h('small', { class: 'tpl-type' }, ' ' + typeLabel(t.type))])))]);
  }
  function saveTemplateSheet(c, defaults = {}) {
    let type = defaults.type || 'surgery', fav = true;
    const name = h('input', { class: 'input', id: 'tplName', value: defaults.name || c.surgery || '', placeholder: 'Template name' });
    const info = h('div', { class: 'note' });
    const typeBox = h('div');
    const paint = () => { typeBox.innerHTML = ''; typeBox.appendChild(chipGroup(['surgery', 'anaesthesia'], () => type, (v) => { type = v || type; paint(); })); info.textContent = type === 'surgery' ? 'Saves surgery name, speciality, complexity, technique and consultant.' : 'Saves technique plus airway device, monitoring, access, drugs, fluids, blocks and post-op plan. Never saves times, blood loss, events or notes.'; };
    typeBox.addEventListener('click', () => {}); paint();
    const close = openSheet('Save as template', h('div', {}, [
      h('div', { class: 'field' }, [h('label', {}, 'Type'), typeBox, info]), h('div', { class: 'field' }, [h('label', {}, 'Name'), name]),
      toggle('Favourite', 'Favourites appear first', () => fav, (v) => (fav = v)),
      h('div', { class: 'btn-row', style: 'margin-top:12px' }, [h('button', { class: 'btn', onclick: () => close() }, 'Cancel'), h('button', { class: 'btn btn-primary', id: 'tplSave', onclick: async () => {
        const nm = name.value.trim(); if (!nm) return toast('Give the template a name');
        const t = state.templates.find((x) => x.type === type && x.name.toLowerCase() === nm.toLowerCase()) || { tpl_id: ctx.uid(), type, created_at: new Date().toISOString(), uses: 0 };
        Object.assign(t, { name: nm, favourite: fav, data: templateData(type, c), updated_at: new Date().toISOString() });
        if (!state.templates.includes(t)) state.templates.push(t);
        await ctx.putTemplate(t); close(); toast('Template saved');
      } }, [ic('check'), 'Save'])]),
    ]));
  }

  function renderTemplates(screen) {
    screen.appendChild(ctx.pageHead('Templates', 'Surgery · anaesthesia · procedure', null, 'settings'));
    if (!state.templates.length) screen.appendChild(h('div', { class: 'empty' }, [ic('bolt'), h('div', {}, 'No templates yet. Use “Save as template” on a case or a procedure.')]));
    for (const [type, label] of S.TEMPLATE_TYPES) {
      const list = state.templates.filter((t) => t.type === type).sort((a, b) => (b.favourite ? 1 : 0) - (a.favourite ? 1 : 0) || a.name.localeCompare(b.name));
      if (!list.length) continue;
      screen.appendChild(h('div', { class: 'card' }, [h('h3', {}, `${label} templates (${list.length})`), ...list.map((t) => h('div', { class: 'deleted-row' }, [
        h('div', {}, [h('b', {}, (t.favourite ? '★ ' : '') + t.name), h('small', {}, t.uses ? `Used ${t.uses}×` : 'Not used yet')]),
        h('div', { class: 'btn-row', style: 'flex:none' }, [
          h('button', { class: 'btn btn-sm btn-soft', 'aria-label': 'Toggle favourite', onclick: async () => { t.favourite = !t.favourite; await ctx.putTemplate(t); ctx.render(); } }, t.favourite ? 'Unstar' : 'Star'),
          h('button', { class: 'btn btn-sm btn-danger', onclick: async () => { state.templates = state.templates.filter((x) => x !== t); await DB.del('templates', t.tpl_id); ctx.render(); toast('Template deleted', 'Undo', async () => { state.templates.push(t); await ctx.putTemplate(t); ctx.render(); }); } }, 'Delete'),
        ]),
      ]))]));
    }
  }

  return { screens: { templates: renderTemplates }, api: { entryModeToggle, techniqueField, clinicalCard, detailSections, caseExtraRows, templateStrip, saveTemplateSheet, applyTemplate } };
});
