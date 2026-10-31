/** ui-search.js — global search across cases, pre-ops, procedures and night duties. Route: search. */
(window.V8Ext = window.V8Ext || []).push((ctx) => {
  const { state, h, ic, go, fmtDate } = ctx;
  const su = { q: '' };
  const words = (q) => q.toLowerCase().split(/\s+/).filter(Boolean);
  const match = (hay, w) => w.every((x) => hay.join(' ').toLowerCase().includes(x));
  function renderSearch(screen) {
    screen.appendChild(ctx.pageHead('Search', 'Cases, pre-ops, procedures, duties', null, 'more'));
    const box = h('div');
    const input = h('input', { class: 'input', id: 'gsearch', type: 'search', placeholder: 'UHID, date, consultant, surgery, technique, ASA, complication, hospital…', value: su.q, autocomplete: 'off', oninput: (e) => { su.q = e.target.value; clearTimeout(input._t); input._t = setTimeout(paint, 120); } });
    screen.appendChild(h('div', { class: 'search' }, [ic('search'), input])); screen.appendChild(box);
    function paint() {
      box.innerHTML = '';
      const w = words(su.q);
      if (!w.length) { box.appendChild(h('div', { class: 'empty' }, [ic('search'), h('div', {}, 'Type to search everything. Try "spinal III", "Dr. Anand", a UHID, or 2026-03.')])); return; }
      const cases = ctx.activeCases().filter((c) => match([c.patient_name, c.uhid, c.visit_number, c.consultant, c.surgery, c.anaesthesia_mode, ...Schema.techniquesOf(c), c.asa && `asa ${c.asa}`, c.urgency, Schema.specialityOf(c).value, c.hospital, c.location, c.case_date, ctx.fmtDate(c.case_date), c.anaesthetist, c.notable_type, c.notable_note, c.complexity, ...Schema.complicationsOf(c), ...Schema.eventsOf(c)], w)).sort((a, b) => b.case_date.localeCompare(a.case_date));
      const preops = ctx.activePreops().filter((p) => match([p.patient_name, p.uhid, p.surgery, p.hospital, p.date, ctx.fmtDate(p.date), p.asa && `asa ${p.asa}`, ...(p.conditions || [])], w));
      const procs = ctx.activeProcedures().filter((p) => match([p.procedure, p.site, p.case_ref, p.operator, p.assistant, p.supervisor, p.hospital, p.date, ctx.fmtDate(p.date), p.notes, ...(p.complications || [])], w));
      const duties = state.duties.filter((d) => !d.deleted_at && match([d.date, ctx.fmtDate(d.date), d.hospital, d.location, d.notes, 'night duty'], w));
      const total = cases.length + preops.length + procs.length + duties.length;
      box.appendChild(h('div', { class: 'muted', id: 'sCount', style: 'margin:4px 4px 8px;font-size:13px' }, `${total} result${total === 1 ? '' : 's'}`));
      if (!total) box.appendChild(h('div', { class: 'empty' }, [ic('search'), h('div', {}, 'Nothing matches. Check spelling or try fewer words.')]));
      const sec = (title, n, nodes) => n && box.appendChild(h('div', {}, [h('div', { class: 'section-title' }, h('h2', {}, `${title} (${n})`)), ...nodes]));
      sec('Cases', cases.length, cases.slice(0, 30).map((c, i) => ctx.caseCard(c, i + 1)));
      if (cases.length > 30) box.appendChild(h('div', { class: 'muted' }, `Showing 30 of ${cases.length}. Narrow the search to see the rest.`));
      const row = (title, sub, fn) => h('button', { class: 'notable-item', onclick: fn }, [h('b', {}, title), h('small', {}, sub)]);
      sec('Pre-op assessments', preops.length, preops.slice(0, 15).map((p) => row(`${p.patient_name || '(no name)'} · ${p.surgery || ''}`, fmtDate(p.date), () => { state.preopQ = su.q; go('preop'); })));
      sec('Procedures', procs.length, procs.slice(0, 15).map((p) => row(p.procedure + (p.site ? ' · ' + p.site : ''), fmtDate(p.date), () => go('procedures'))));
      sec('Night duties', duties.length, duties.slice(0, 15).map((d) => row(fmtDate(d.date), d.hospital || '', () => go('day', d.date))));
    }
    paint();
  }
  return { screens: { search: renderSearch } };
});
