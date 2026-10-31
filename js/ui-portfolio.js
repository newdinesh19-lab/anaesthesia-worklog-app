/**
 * ui-portfolio.js — clinical portfolio by speciality: category tiles, per-category breakdown, linked procedures, export.
 * Screens: portfolio, portfolioCat.  Categories overlap (Paediatric / Geriatric are counted in addition to surgical speciality).
 */
(window.V8Ext = window.V8Ext || []).push((ctx) => {
  const { state, h, ic, go, toast, openSheet, fmtDate } = ctx;
  const S = Schema, X = ctx.X;
  const pui = { cat: '', q: '' };
  const opts = () => ({ paedAgeMax: state.settings.paedAgeMax, geriatricAgeMin: state.settings.geriatricAgeMin });
  const inCat = (c, cat) => S.categoriesOf(c, opts()).includes(cat);
  const rangeCases = (r) => ctx.activeCases().filter((c) => Analytics.inRange(c.case_date, r));

  function renderPortfolio(screen) {
    screen.appendChild(ctx.pageHead('Portfolio', 'By speciality', null, 'more'));
    const body = h('div');
    screen.appendChild(X.rangeBar(() => paint()));
    screen.appendChild(body);
    function paint() {
      body.innerHTML = '';
      const r = X.getRange(), cases = rangeCases(r);
      const sum = Analytics.caseSummary(cases, opts());
      body.appendChild(h('div', { class: 'muted', style: 'margin:2px 4px 8px;font-size:13px' }, `${r.label} · ${cases.length} case${cases.length === 1 ? '' : 's'}`));
      const sug = cases.filter((c) => !c.speciality && S.specialityOf(c).auto);
      const none = cases.filter((c) => !S.specialityOf(c).value).length;
      if (sug.length) body.appendChild(h('div', { class: 'note', id: 'sugNote' }, [ic('info', 'inl'), ` ${sug.length} case${sug.length === 1 ? ' is' : 's are'} placed in a speciality only by a keyword guess from the surgery name. `, h('button', { class: 'btn btn-sm', id: 'confirmSpec', style: 'margin-top:8px', onclick: () => confirmSuggested(sug, paint) }, 'Review & confirm')]));
      if (!cases.length) { body.appendChild(h('div', { class: 'empty' }, [ic('folder'), h('div', {}, 'No cases in this period. Change the date range or add a case.')])); return; }
      const tiles = h('div', { class: 'tiles' });
      S.PORTFOLIO_CATEGORIES.forEach((cat, i) => { const n = sum.categories[cat] || 0; tiles.appendChild(h('button', { class: 'tile t-' + ['mint', 'sky', 'violet', 'amber', 'rose'][i % 5], 'data-cat': cat, onclick: () => { pui.cat = cat; go('portfolioCat'); } }, [h('div', { class: 'num' }, n), h('div', { class: 'lbl' }, cat)])); });
      body.appendChild(tiles);
      body.appendChild(h('div', { class: 'note' }, [ic('info', 'inl'), ` Categories overlap: a child having ENT surgery counts under both ENT and Paediatric, so tiles add up to more than ${cases.length}.${none ? ` ${none} case(s) have no speciality and are counted under Other.` : ''} Paediatric = under ${state.settings.paedAgeMax ?? 16} y; Geriatric = ${state.settings.geriatricAgeMin ?? 65} y and over.`]));
      body.appendChild(h('div', { class: 'card' }, [h('h3', {}, 'Distribution'), X.hbars(Analytics.entries(sum.categories), { limit: 13, onTap: (n) => { pui.cat = n; go('portfolioCat'); } }), X.qualityNote()]));
    }
    paint();
  }

  function confirmSuggested(list, done) {
    const chosen = new Set(list.map((c) => c.case_id));
    const rows = h('div');
    const paint = () => { rows.innerHTML = ''; list.forEach((c) => rows.appendChild(h('button', { class: 'toggle-row' + (chosen.has(c.case_id) ? ' on' : ''), onclick: () => { chosen.has(c.case_id) ? chosen.delete(c.case_id) : chosen.add(c.case_id); paint(); } }, [h('span', { style: 'flex:1' }, [h('b', {}, c.surgery || '(no surgery)'), h('small', { class: 'muted', style: 'display:block' }, `${fmtDate(c.case_date)} → ${S.specialityOf(c).value}`)]), h('span', { class: 'sw' })]))); };
    paint();
    const close = openSheet('Confirm suggested specialities', h('div', {}, [h('p', {}, 'Untick any that are wrong. Only ticked cases are updated, and only the speciality field changes.'), h('div', { style: 'max-height:45vh;overflow:auto' }, rows),
      h('div', { class: 'btn-row', style: 'margin-top:12px' }, [h('button', { class: 'btn', onclick: () => close() }, 'Cancel'), h('button', { class: 'btn btn-primary', id: 'applySpec', onclick: async () => {
        const todo = list.filter((c) => chosen.has(c.case_id)); if (!todo.length) return close();
        const now = new Date().toISOString(); const ops = [];
        for (const c of todo) { c.speciality = S.specialityOf(c).value; c.updated_at = now; c.schema_version = S.VERSION; ops.push(await ctx.encOp('cases', c)); }
        await DB.batch(ops); close(); toast(`${todo.length} speciality${todo.length === 1 ? '' : 'ies'} confirmed`); done();
      } }, [ic('check'), 'Confirm ticked'])])]));
  }

  function renderCategory(screen) {
    const cat = pui.cat || S.PORTFOLIO_CATEGORIES[0];
    screen.appendChild(ctx.pageHead(cat, 'Portfolio', null, 'portfolio'));
    const body = h('div');
    screen.appendChild(X.rangeBar(() => paint()));
    screen.appendChild(body);
    function paint() {
      body.innerHTML = '';
      const r = X.getRange(), cases = rangeCases(r).filter((c) => inCat(c, cat));
      body.appendChild(h('div', { class: 'muted', style: 'margin:2px 4px 8px;font-size:13px' }, `${r.label} · ${cases.length} case${cases.length === 1 ? '' : 's'}`));
      if (!cases.length) { body.appendChild(h('div', { class: 'empty' }, [ic('folder'), h('div', {}, `No ${cat} cases in this period.`)])); return; }
      const sum = Analytics.caseSummary(cases, opts());
      const ids = new Set(cases.map((c) => c.case_id));
      const procs = ctx.activeProcedures().filter((p) => ids.has(p.case_id));
      const ps = Analytics.procSummary(procs);
      body.appendChild(h('div', { class: 'tiles' }, [X.stat(cases.length, 'Cases', 'mint'), X.stat(sum.emergency, 'Emergency', 'rose'), X.stat(sum.icuHdu, 'ICU / HDU', 'violet'), X.stat(ps.total, 'Linked procedures', 'sky')]));
      body.appendChild(h('div', { class: 'card' }, [h('h3', {}, 'ASA grade'), X.hbars(Analytics.ORDERED([...S.ASA, 'Not recorded'], sum.asa), { pct: true })]));
      body.appendChild(h('div', { class: 'card' }, [h('h3', {}, 'Technique'), X.hbars(Analytics.entries(sum.techniques), { pct: true }), sum.combinedCount ? h('div', { class: 'muted', style: 'font-size:12px;margin-top:6px' }, `${sum.combinedCount} case(s) used combined techniques and appear in more than one row.`) : null]));
      body.appendChild(h('div', { class: 'card' }, [h('h3', {}, 'Complexity'), X.hbars(Analytics.ORDERED([...S.COMPLEXITY, 'Not recorded'], sum.complexity), { pct: true })]));
      if (ps.total) body.appendChild(h('div', { class: 'card' }, [h('h3', {}, 'Procedures in these cases'), X.hbars(Analytics.entries(ps.byProc), { limit: 10 })]));
      const top = Analytics.entries(sum.speciality).filter(([n]) => n !== cat).slice(0, 5);
      if (['Paediatric', 'Geriatric'].includes(cat) && top.length) body.appendChild(h('div', { class: 'card' }, [h('h3', {}, 'Surgical speciality'), X.hbars(top)]));
      body.appendChild(h('div', { class: 'card' }, [h('h3', {}, 'Export this category'), h('div', { class: 'note' }, [ic('warn', 'inl'), ' The CSV contains the identifiers stored with each case (name, UHID). Keep it private.']),
        h('div', { class: 'btn-row', style: 'margin-top:8px' }, [
          h('button', { class: 'btn', id: 'catCsv', onclick: () => ctx.safeExport(() => ExportModule.exportCasesCSV(cases, `portfolio-${cat.replace(/\W+/g, '-').toLowerCase()}.csv`)) }, [ic('download'), 'CSV (with identifiers)']),
          X.exportCategoryDeidentified ? h('button', { class: 'btn btn-primary', onclick: () => X.exportCategoryDeidentified(cat, cases, r) }, 'De-identified') : null])]));
      const list = h('div', { class: 'card' }, [h('h3', {}, 'Cases')]);
      cases.slice().sort((a, b) => b.case_date.localeCompare(a.case_date)).slice(0, 50).forEach((c, i) => list.appendChild(ctx.caseCard(c, i + 1)));
      if (cases.length > 50) list.appendChild(h('div', { class: 'muted' }, `Showing the latest 50 of ${cases.length}. Use Cases → filters for the rest.`));
      body.appendChild(list);
    }
    paint();
  }

  return { screens: { portfolio: renderPortfolio, portfolioCat: renderCategory }, api: { portfolioCasesFor: (cat, r) => rangeCases(r).filter((c) => inCat(c, cat)) } };
});
