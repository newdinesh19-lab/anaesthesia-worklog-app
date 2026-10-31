/**
 * ui-dash.js — "More" hub, analytics dashboard and home additions (grows through the V8 phases).
 */
(window.V8Ext = window.V8Ext || []).push((ctx) => {
  const { state, h, ic, go, pageHead } = ctx;

  function renderMore(screen) {
    screen.appendChild(pageHead('More', 'Everything else', h('button', { class: 'icon-btn', 'aria-label': 'Lock', onclick: ctx.lockNow }, ic('lock'))));
    const item = (route, icon, title, sub, tone) => h('button', { class: `hub-item t-${tone}`, id: 'hub-' + route, onclick: () => go(route) }, [h('span', { class: 'hub-ic' }, ic(icon)), h('b', {}, title), h('small', {}, sub)]);
    screen.appendChild(h('div', { class: 'hub' }, [
      item('procedures', 'syringe', 'Procedures', 'Logbook & counts', 'mint'),
      item('portfolio', 'folder', 'Portfolio', 'By speciality', 'sky'),
      item('analytics', 'pie', 'Analytics', 'Charts & workload', 'violet'),
      item('reports', 'file', 'Reports', 'PDF · Excel · CSV', 'amber'),
      item('search', 'search', 'Search', 'Everything, fast', 'night'),
      item('settings', 'sliders', 'Settings', 'Profile & security', 'mint'),
      item('backup', 'download', 'Backup', 'Back up / restore', 'sky'),
      item('bin', 'trash', 'Recycle bin', 'Restore deleted', 'amber'),
    ]));
  }

  // ------------------------------------------------------------------ analytics dashboard
  const X = ctx.X;
  const au = { asaShow: true };
  function drill(patch, r) { state.casesView = 'list'; state.filters = { ...ctx.emptyFilters(''), from: r.from, to: r.to, ...patch }; go('cases'); }
  function renderAnalytics(screen) {
    screen.appendChild(pageHead('Analytics', 'Your workload & case mix', null, 'more'));
    const body = h('div'); screen.appendChild(X.rangeBar(() => paint())); screen.appendChild(body);
    function paint() {
      body.innerHTML = '';
      const r = X.getRange(), opts = { paedAgeMax: state.settings.paedAgeMax, geriatricAgeMin: state.settings.geriatricAgeMin };
      const all = ctx.activeCases(), duties = state.duties.filter((d) => !d.deleted_at), procs = ctx.activeProcedures();
      const cases = all.filter((c) => Analytics.inRange(c.case_date, r));
      const sum = Analytics.caseSummary(cases, opts), wl = Analytics.workload(all, duties, procs, r), ps = Analytics.procSummary(procs.filter((p) => Analytics.inRange(p.date, r)));
      body.appendChild(h('div', { class: 'muted', style: 'margin:2px 4px 8px;font-size:13px' }, r.label));
      // fixed snapshots independent of the range
      const now = new Date(), snap = (k) => all.filter((c) => Analytics.inRange(c.case_date, Analytics.rangeFor(k, now))).length;
      body.appendChild(h('div', { class: 'tiles three', id: 'snapTiles' }, [X.stat(snap('today'), 'Today', 'mint'), X.stat(snap('month'), 'This month', 'sky'), X.stat(snap('ytd'), 'Year to date', 'violet')]));
      if (!cases.length) { body.appendChild(h('div', { class: 'empty' }, [ic('pie'), h('div', {}, 'No cases in this period. Pick another range above.')])); return; }
      body.appendChild(h('div', { class: 'tiles' }, [
        X.stat(sum.total, 'Cases in range', 'mint', () => drill({}, r)),
        X.stat(sum.emergencyPct == null ? '—' : sum.emergencyPct + '%', 'Emergency', 'rose', () => drill({ urgency: 'Emergency' }, r)),
        X.stat(wl.nightDuties, 'Night duties', 'night'), X.stat(ps.total, 'Procedures', 'amber', () => go('procedures')),
        X.stat(sum.icuHdu, 'ICU / HDU', 'violet'), X.stat(sum.complicationCases, 'With complication', 'sky', () => drill({ complication: true }, r)),
      ]));
      body.appendChild(h('div', { class: 'card' }, [h('h3', {}, 'Workload summary'),
        ...[['Working days', wl.workingDays], ['Average per working day', wl.avgPerWorkingDay], ['Busiest day', wl.busiest ? `${ctx.fmtDate(wl.busiest.date)} · ${wl.busiest.count}` : '—'], ['Notable cases', sum.notable], ['Documented difficult airways', sum.difficultAirway]].map(([k, v]) => h('div', { class: 'kv' }, [h('span', {}, k), h('b', {}, String(v))]))]));
      const yr = (r.to || r.from || Analytics.iso(now)).slice(0, 4);
      body.appendChild(h('div', { class: 'card' }, [h('h3', {}, `Cases per month · ${yr}`), X.columnChart(Analytics.monthSeries(all, 'case_date', yr), Analytics.MONTH_ABBR, { unit: 'cases', short: Analytics.MONTH_ABBR.map((m) => m[0]), color: 'var(--c1)' })]));
      body.appendChild(h('div', { class: 'card' }, [h('h3', {}, 'Emergency vs elective'), X.donutChart(Analytics.entries(sum.urgency), { onTap: (n) => (n === 'Emergency' || n === 'Elective') && drill({ urgency: n }, r) })]));
      body.appendChild(h('div', { class: 'card' }, [h('h3', {}, 'ASA grade'), X.hbars(Analytics.ORDERED([...Schema.ASA, 'Not recorded'], sum.asa), { pct: true, onTap: (n) => Schema.ASA.includes(n) && drill({ asa: n }, r) })]));
      body.appendChild(h('div', { class: 'card' }, [h('h3', {}, 'Technique'), X.hbars(Analytics.entries(sum.techniques), { pct: true, onTap: (n) => drill({ mode: n }, r) }), sum.combinedCount ? h('div', { class: 'muted', style: 'font-size:12px;margin-top:6px' }, `${sum.combinedCount} combined-technique case(s) are counted under each technique.`) : null]));
      body.appendChild(h('div', { class: 'card' }, [h('h3', {}, 'Speciality / category'), X.donutChart(Analytics.entries(sum.categories), { unit: 'ENTRIES', onTap: (n) => { go('portfolio'); } }), h('div', { class: 'muted', style: 'font-size:12px;margin-top:6px' }, 'Paediatric and Geriatric overlap with surgical specialities.')]));
      body.appendChild(h('div', { class: 'card' }, [h('h3', {}, 'Consultant workload'), X.hbars(Analytics.entries(sum.consultants), { limit: 10, onTap: (n) => drill({ consultant: n }, r) })]));
      body.appendChild(h('div', { class: 'card' }, [h('h3', {}, 'Hospital workload'), X.hbars(Analytics.entries(sum.hospitals), { onTap: (n) => n !== 'Not recorded' && drill({ hospital: n }, r) })]));
      if (Object.keys(sum.destinations).length) body.appendChild(h('div', { class: 'card' }, [h('h3', {}, 'Post-op destination'), X.hbars(Analytics.entries(sum.destinations), { pct: true })]));
      if (Object.keys(sum.complicationTypes).length) body.appendChild(h('div', { class: 'card' }, [h('h3', {}, 'Documented complications'), X.hbars(Analytics.entries(sum.complicationTypes), { limit: 10 })]));
      if (ps.total) body.appendChild(h('div', { class: 'card' }, [h('h3', {}, 'Procedure counts'), X.hbars(Analytics.entries(ps.byProc), { limit: 10 })]));
      body.appendChild(X.qualityNote());
      const cv = sum.coverage;
      body.appendChild(h('div', { class: 'note' }, [ic('info', 'inl'), ` Data completeness: ASA ${cv.asa}% · urgency ${cv.urgency}% · technique ${cv.technique}% · speciality ${cv.speciality}%. Charts only reflect what was entered; older cases may lack newer fields.`]));
      body.appendChild(h('button', { class: 'btn btn-primary btn-block', id: 'yearEnd', style: 'margin-top:12px', onclick: () => { X.range.preset = 'year'; X.setReportType('yearend'); go('reports'); } }, [ic('file'), 'Year-end portfolio report']));
    }
    paint();
  }
  return { screens: { more: renderMore, analytics: renderAnalytics } };
});
