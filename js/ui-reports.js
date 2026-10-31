/** ui-reports.js — report centre: 8 report types, date range, identifier opt-in, PDF / Excel / CSV. Route: reports. */
(window.V8Ext = window.V8Ext || []).push((ctx) => {
  const { state, h, ic, go, toast, openSheet } = ctx, X = ctx.X;
  const rs = { type: 'monthly', identifiers: false };
  const data = (range) => ({ cases: ctx.activeCases(), duties: state.duties.filter((d) => !d.deleted_at), procs: ctx.activeProcedures(), range, settings: state.settings });

  function out(m, fmt) {
    const go2 = () => {
      try {
        if (fmt === 'csv') Reports.download(Reports.toCSV(m), Reports.fileName(m, 'csv'), 'text/csv;charset=utf-8');
        else if (fmt === 'xlsx') Reports.toExcel(m, Reports.fileName(m, 'xlsx'));
        else Reports.toPDF(m, Reports.fileName(m, 'pdf'));
        toast('Report created');
      } catch (e) { console.warn(e); toast('Export failed — Excel/PDF libraries need one online visit to cache'); }
    };
    if (!m.identifiers) return go2();
    const close = openSheet('This report contains patient identifiers', h('div', {}, [h('p', {}, 'Names, UHIDs and exact ages will be in the file. Store and share it only as your hospital policy allows. The app being encrypted does not protect an exported file.'),
      h('div', { class: 'btn-row' }, [h('button', { class: 'btn', onclick: () => close() }, 'Cancel'), h('button', { class: 'btn btn-danger', id: 'idOk', onclick: () => { close(); go2(); } }, 'Export with identifiers')])]));
  }

  function renderReports(screen) {
    screen.appendChild(ctx.pageHead('Reports', 'PDF · Excel · CSV', null, 'more'));
    const body = h('div'); screen.appendChild(X.rangeBar(() => paint())); screen.appendChild(body);
    function paint() {
      body.innerHTML = '';
      const r = X.getRange();
      body.appendChild(h('div', { class: 'card' }, [h('h3', {}, 'Report'), h('div', { class: 'chip-grid' }, Reports.TYPES.map(([k, l]) => h('button', { class: 'chip' + (rs.type === k ? ' on' : ''), 'data-rt': k, onclick: () => { rs.type = k; paint(); } }, l))), h('div', { class: 'muted', style: 'margin-top:8px;font-size:13px' }, Reports.TYPES.find((t) => t[0] === rs.type)[2])]));
      const m = Reports.build(rs.type, data(r), { identifiers: rs.identifiers });
      body.appendChild(h('div', { class: 'card', id: 'repPreview' }, [h('h3', {}, `Preview · ${m.range}`), ...m.totals.map(([k, v]) => h('div', { class: 'kv' }, [h('span', {}, k), h('b', {}, String(v))])), h('div', { class: 'muted', style: 'font-size:12px;margin-top:6px' }, `Sheets: ${m.sheets.map((s) => `${s.name} (${s.rows.length})`).join(' · ')}`)]));
      const idRow = h('button', { class: 'toggle-row' + (rs.identifiers ? ' on' : ''), id: 'idToggle', onclick: () => { rs.identifiers = !rs.identifiers; paint(); } }, [h('span', { style: 'flex:1' }, [h('b', {}, 'Include patient identifiers'), h('small', { class: 'muted', style: 'display:block' }, rs.identifiers ? 'Names, UHID, exact age and notes WILL be included' : 'Off — codes and age bands only (recommended)')]), h('span', { class: 'sw' })]);
      body.appendChild(h('div', { class: 'card' }, [h('h3', {}, 'Privacy'), idRow, rs.identifiers ? h('div', { class: 'note warn' }, [ic('warn', 'inl'), ' Exported files are not encrypted.']) : null]));
      if (m.coverage && m.coverage.detailed < 50 && m.coverage.speciality < 80) body.appendChild(h('div', { class: 'note' }, [ic('info', 'inl'), ` Data completeness: speciality recorded on ${m.coverage.speciality}% of cases, ASA on ${m.coverage.asa}%. Totals for those fields reflect only what was entered.`]));
      body.appendChild(h('div', { class: 'card' }, [h('h3', {}, 'Create'), h('div', { class: 'btn-row' }, [
        h('button', { class: 'btn btn-primary', id: 'repPdf', onclick: () => out(m, 'pdf') }, [ic('file'), 'PDF']), h('button', { class: 'btn btn-primary', id: 'repXlsx', onclick: () => out(m, 'xlsx') }, [ic('download'), 'Excel']), h('button', { class: 'btn', id: 'repCsv', onclick: () => out(m, 'csv') }, 'CSV')]),
        h('div', { class: 'muted', style: 'font-size:12px;margin-top:8px' }, Reports.DISCLAIMER)]));
      body.appendChild(h('button', { class: 'btn btn-soft btn-block', id: 'classicMonthly', onclick: () => go('monthly') }, 'Classic month-end report'));
    }
    paint();
  }
  function exportCategoryDeidentified(cat, cases, r) {
    const m = Reports.build('portfolio', { cases, duties: [], procs: [], range: r, settings: state.settings }, { identifiers: false }); m.title = `Portfolio – ${cat}`;
    m.sheets.unshift({ name: 'Cases', columns: Reports.build('monthly', { cases, range: r, settings: state.settings }, {}).sheets[0].columns, rows: Reports.build('monthly', { cases, range: r, settings: state.settings }, {}).sheets[0].rows });
    out(Object.assign(m, { type: 'portfolio-' + cat.replace(/\W+/g, '-').toLowerCase() }), 'xlsx');
  }
  return { screens: { reports: renderReports }, api: { exportCategoryDeidentified, setReportType: (t) => { rs.type = t; } } };
});
