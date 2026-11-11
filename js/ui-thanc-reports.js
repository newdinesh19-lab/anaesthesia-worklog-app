/**
 * ui-thanc-reports.js — THANC duty analytics (counts + actual working hours), doctor management, data checks,
 * import of earlier night duties (preview, duplicate-safe, roll-back-able) and PDF / CSV / Excel exports.
 * Pure calculations are in thanc.js / thanc-hours.js; this file only draws and exports them.
 */
(window.V8Ext = window.V8Ext || []).push((ctx) => {
  const { state, h, ic, toast, confirmSheet, todayISO, fmtDay, go } = ctx;
  const Th = Thanc, HR = ThancHours;
  const S = { kind: 'month', key: '', doctor: 'ALL' };
  const U = () => ctx.thUI;
  const hrs = (m) => HR.hoursDec(m);
  const num = (n) => (Math.round(n * 10) / 10).toString();
  const KINDS = [['month', 'Month'], ['quarter', 'Quarter'], ['year', 'Year'], ['fy', 'Fin. year']];
  const TONE = { morning: 'am', evening: 'pm', night: 'nt' };

  function analysis() { const u = U(); if (!S.key) S.key = HR.keyOf(S.kind, todayISO()); return Th.analyse(u.recs(), u.cfg(), { kind: S.kind, key: S.key, doctor: S.doctor }); }
  const setKind = (k) => { const cur = S.key ? HR.range(S.kind, S.key).from : todayISO(); S.kind = k; S.key = HR.keyOf(k, cur); ctx.render(); };

  // ------------------------------------------------------------------ exports
  const fname = (a, ext) => `THANC-duty-${a.kind === 'fy' ? 'FY' + a.key : a.key}${a.doctor !== 'ALL' ? '-' + Th.shortName(a.doctor).replace(/\s+/g, '') : ''}.${ext}`;
  function exportCSV(a, which) {
    const u = U(), ts = Th.tableSet(u.recs(), u.cfg(), a, state.templates), t = ts.find((x) => x.name === which); if (!t) return;
    if (!t.rows.length) return toast('Nothing to export for this period');
    Reports.download(Th.toCSVTable(t.head, t.rows), fname(a, 'csv').replace('.csv', `-${which.toLowerCase().replace(/\s+/g, '-')}.csv`), 'text/csv;charset=utf-8');
  }
  function exportExcel(a) {
    if (typeof XLSX === 'undefined') return toast('Excel library not available yet — connect to the internet once, then try again (CSV works now).');
    const u = U(), recs = u.recs(), ts = Th.tableSet(recs, u.cfg(), a, state.templates), wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['THANC duty report'], ['Period', a.label, `${a.from} to ${a.to}`], ['Doctor', a.doctor === 'ALL' ? 'All doctors' : a.doctor], ['Generated', new Date().toLocaleString('en-IN')],
      ['Rules', 'A duty counts in the month it starts. Hours use the recorded start/end times and are split at midnight between months.']]), 'About');
    for (const t of ts) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([t.head, ...t.rows]), t.name.slice(0, 31));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([Th.AUDIT_HEAD, ...Th.auditRows(recs)]), 'Audit trail');
    XLSX.writeFile(wb, fname(a, 'xlsx'));
  }
  function exportPDF(a) {
    if (!window.jspdf || !window.jspdf.jsPDF) return toast('PDF library not available yet — connect to the internet once, then try again.');
    const u = U(), recs = u.recs(), ts = Th.tableSet(recs, u.cfg(), a, state.templates); const { jsPDF } = window.jspdf; const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const navy = [23, 37, 84], W = doc.internal.pageSize.getWidth();
    doc.setFillColor(...navy); doc.rect(0, 0, W, 22, 'F'); doc.setTextColor(255); doc.setFontSize(15); doc.text('THANC Duty & Workload Report', 12, 11); doc.setFontSize(9.5); doc.text(`${a.label}  ·  ${a.doctor === 'ALL' ? 'All doctors' : a.doctor}  ·  ${a.from} to ${a.to}`, 12, 17.5);
    doc.setTextColor(40); doc.setFontSize(9); let y = 28;
    const t = a.totals; doc.text(`Duties: ${t.total} (Morning ${t.morning} · Evening ${t.evening} · Night ${t.night})   Hours worked: ${num(hrs(t.minutes.total))}   Avg per duty: ${num(hrs(t.avg))} h   Longest: ${num(hrs(t.max))} h`, 12, y); y += 5;
    if (a.highest) doc.text(`Most duties: ${a.highest.doctors.join(', ')} (${a.highest.value})   Fewest: ${a.lowest.doctors.join(', ')} (${a.lowest.value})`, 12, y), y += 6; else y += 2;
    // workload comparison bars (hours)
    const max = Math.max(1, ...a.rows.map((r) => r.minutes.total)); doc.setFontSize(8); doc.setFont(undefined, 'bold'); doc.text('Workload comparison (hours worked)', 12, y); doc.setFont(undefined, 'normal'); y += 3;
    const COL = { morning: [245, 158, 11], evening: [13, 148, 136], night: [99, 82, 230] };
    for (const r of a.rows.slice(0, 14)) { doc.text(Th.shortName(r.doctor).slice(0, 18), 12, y + 3); let x = 48; for (const s of ['morning', 'evening', 'night']) { const w = (r.minutes[s] / max) * 110; if (w > 0) { doc.setFillColor(...COL[s]); doc.rect(x, y, w, 4, 'F'); x += w; } } doc.text(`${num(hrs(r.minutes.total))} h · ${r.total} duties`, Math.min(x + 2, 165), y + 3); y += 6; }
    doc.setFontSize(7); [['Morning', COL.morning], ['Evening', COL.evening], ['Night', COL.night]].forEach(([l, c], i) => { doc.setFillColor(...c); doc.rect(12 + i * 28, y, 3, 3, 'F'); doc.text(l, 16.5 + i * 28, y + 2.6); }); y += 7;
    const head = (cols) => [cols]; const opts = { styles: { fontSize: 7.5, cellPadding: 1.6 }, headStyles: { fillColor: navy }, margin: { left: 12, right: 12 } };
    doc.autoTable({ startY: y, head: head(ts[0].head), body: ts[0].rows, ...opts, didParseCell: (d) => { if (d.row.index === ts[0].rows.length - 1 && d.section === 'body') d.cell.styles.fontStyle = 'bold'; } });
    doc.autoTable({ startY: doc.lastAutoTable.finalY + 6, head: head(ts[1].head), body: ts[1].rows, ...opts });
    if (ts[3].rows.length) { doc.setFontSize(9); doc.text('Entries needing attention', 12, doc.lastAutoTable.finalY + 10); doc.autoTable({ startY: doc.lastAutoTable.finalY + 12, head: head(ts[3].head), body: ts[3].rows, ...opts, headStyles: { fillColor: [180, 83, 9] } }); }
    doc.addPage(); doc.setFontSize(11); doc.setTextColor(...navy); doc.text('Duty lines (one row per doctor per duty)', 12, 14); doc.autoTable({ startY: 18, head: head(ts[2].head), body: ts[2].rows, ...opts, styles: { fontSize: 6.8, cellPadding: 1.3 } });
    const pages = doc.getNumberOfPages(); for (let i = 1; i <= pages; i++) { doc.setPage(i); doc.setFontSize(7); doc.setTextColor(120); doc.text('Counts: a duty is counted in the month it starts. Hours: actual recorded times, split at midnight between months.', 12, 291); doc.text(`Page ${i}/${pages}`, W - 24, 291); }
    doc.save(fname(a, 'pdf'));
  }
  const exportBar = (a) => h('div', { class: 'th-export' }, [
    h('button', { class: 'btn btn-soft', id: 'thPdf', onclick: () => exportPDF(a) }, [ic('download'), 'PDF']), h('button', { class: 'btn btn-soft', id: 'thXlsx', onclick: () => exportExcel(a) }, [ic('download'), 'Excel']),
    h('button', { class: 'btn btn-soft', id: 'thCsv', onclick: () => exportCSV(a, 'Doctor-wise') }, [ic('download'), 'CSV']), h('button', { class: 'btn btn-soft', id: 'thCsvLines', onclick: () => exportCSV(a, 'Duty lines') }, [ic('download'), 'CSV (lines)'])]);

  // ------------------------------------------------------------------ analytics tab
  const stackBar = (r, max, mode) => { const parts = ['morning', 'evening', 'night']; const val = (s) => (mode === 'hours' ? r.minutes[s] : r[s]);
    return h('div', { class: 'th-bar' }, parts.map((s) => (val(s) ? h('i', { class: 'd-' + TONE[s], style: `width:${(val(s) / max) * 100}%`, title: `${s}: ${mode === 'hours' ? num(hrs(r.minutes[s])) + ' h' : r[s]}` }) : null))); };
  function renderAnalytics(body) {
    const u = U(), a = analysis(), t = a.totals, roster = Th.uniq([...u.cfg().roster, ...u.recs().flatMap((r) => r.doctors)], u.resolve());
    body.appendChild(h('div', { class: 'seg th-kinds' }, KINDS.map(([k, l]) => h('button', { class: S.kind === k ? 'on' : '', 'data-kind': k, onclick: () => setKind(k) }, l))));
    const nav = h('div', { class: 'month-nav' }, [h('button', { class: 'icon-btn', 'aria-label': 'Previous period', onclick: () => { S.key = HR.shiftKey(S.kind, S.key, -1); ctx.render(); } }, ic('left')), h('b', { id: 'thPeriod' }, a.label),
      h('button', { class: 'icon-btn', 'aria-label': 'Next period', onclick: () => { S.key = HR.shiftKey(S.kind, S.key, 1); ctx.render(); } }, ic('chev'))]); body.appendChild(nav);
    const sel = h('select', { class: 'input', id: 'thDoctor', 'aria-label': 'Doctor', onchange: (e) => { S.doctor = e.target.value; ctx.render(); } }, [h('option', { value: 'ALL' }, 'All doctors'), ...roster.map((n) => h('option', { value: n }, n))]); sel.value = S.doctor; body.appendChild(h('div', { class: 'field' }, [sel]));
    body.appendChild(h('div', { class: 'th-tiles four', id: 'thTiles' }, [['Duties', t.total, 'tt'], ['Hours', num(hrs(t.minutes.total)), 'am'], ['Avg h/duty', num(hrs(t.avg)), 'pm'], ['Longest h', num(hrs(t.max)), 'nt']].map(([l, n, c]) => h('div', { class: 'th-tile th-' + c }, [h('b', {}, n), h('small', {}, l)]))));
    body.appendChild(h('div', { class: 'th-split' }, ['morning', 'evening', 'night'].map((s) => h('span', { class: 'th-pill th-' + TONE[s] }, `${Th.shiftMeta(s).label} ${t[s]} · ${num(hrs(t.minutes[s]))} h`))));
    if (!a.rows.length || (!t.total && !t.minutes.total)) body.appendChild(h('div', { class: 'empty' }, [ic('calendar'), h('div', {}, `No duty recorded in ${a.label}.`)]));
    if (S.doctor === 'ALL' && a.highest) body.appendChild(h('div', { class: 'card th-hl' }, [h('div', {}, [h('small', {}, 'MOST DUTIES'), h('b', {}, a.highest.doctors.map(Th.shortName).join(', ')), h('span', {}, `${a.highest.value} duties`)]), h('div', {}, [h('small', {}, 'FEWEST DUTIES'), h('b', {}, a.lowest.doctors.map(Th.shortName).join(', ')), h('span', {}, `${a.lowest.value} duties`)]),
      a.highestHours ? h('div', {}, [h('small', {}, 'MOST HOURS'), h('b', {}, a.highestHours.doctors.map(Th.shortName).join(', ')), h('span', {}, `${num(hrs(a.highestHours.value))} h`)]) : null]));
    if (a.rows.length) {
      const maxN = Math.max(1, ...a.rows.map((r) => r.total)), maxH = Math.max(1, ...a.rows.map((r) => r.minutes.total));
      body.appendChild(h('div', { class: 'section-title' }, [h('h2', {}, 'Doctor-wise')]));
      body.appendChild(h('div', { class: 'card th-table', id: 'thDocTable' }, [h('div', { class: 'th-tr wide head' }, ['Doctor', 'M', 'E', 'N', 'Duties', 'Hours'].map((x) => h('span', {}, x))),
        ...a.rows.map((r) => h('div', { class: 'th-tr wide', 'data-doc-row': r.doctor }, [h('span', { class: 'nm' }, [u.avatar(r.doctor), Th.shortName(r.doctor)]), h('span', {}, r.morning), h('span', {}, r.evening), h('span', {}, r.night), h('b', {}, r.total), h('b', {}, num(hrs(r.minutes.total)))])),
        h('div', { class: 'th-tr wide foot' }, [h('span', {}, 'Total'), h('span', {}, t.morning), h('span', {}, t.evening), h('span', {}, t.night), h('b', {}, t.total), h('b', {}, num(hrs(t.minutes.total)))])]));
      body.appendChild(h('div', { class: 'section-title' }, [h('h2', {}, 'Comparison')]));
      body.appendChild(h('div', { class: 'card th-chart' }, [h('small', { class: 'th-cap' }, 'Duties'), ...a.rows.map((r) => h('div', { class: 'th-crow' }, [h('span', {}, Th.shortName(r.doctor)), stackBar(r, maxN, 'count'), h('b', {}, r.total)])),
        h('small', { class: 'th-cap' }, 'Hours worked'), ...a.rows.map((r) => h('div', { class: 'th-crow' }, [h('span', {}, Th.shortName(r.doctor)), stackBar(r, maxH, 'hours'), h('b', {}, num(hrs(r.minutes.total)))])),
        h('div', { class: 'legend-row' }, Th.SHIFTS.map((s) => h('span', {}, [h('i', { class: 'd-' + s.tone, style: 'width:10px;height:10px;border-radius:50%;display:inline-block' }), ' ' + s.label])))]));
      body.appendChild(h('div', { class: 'section-title' }, [h('h2', {}, 'Per doctor — hours')]));
      body.appendChild(h('div', { class: 'card th-table' }, [h('div', { class: 'th-tr hrs head' }, ['Doctor', 'Total', 'Avg', 'Max', 'Flags'].map((x) => h('span', {}, x))),
        ...a.rows.map((r) => h('div', { class: 'th-tr hrs' }, [h('span', { class: 'nm' }, [u.avatar(r.doctor), Th.shortName(r.doctor)]), h('b', {}, num(hrs(r.minutes.total))), h('span', {}, num(hrs(r.avg))), h('span', {}, num(hrs(r.max))), h('span', { class: r.invalid ? 'bad' : '' }, r.invalid ? r.invalid + ' ⚠' : '—')]))]));
    }
    body.appendChild(h('div', { class: 'section-title' }, [h('h2', {}, 'By shift')]));
    body.appendChild(h('div', { class: 'card th-table', id: 'thShiftTable' }, [h('div', { class: 'th-tr shift head' }, ['Shift', 'Duties', 'Assign.', 'Hours', 'Avg'].map((x) => h('span', {}, x))), ...a.shiftWise.map((s) => h('div', { class: 'th-tr shift' }, [h('span', { class: 'nm' }, s.label), h('span', {}, s.duties), h('span', {}, s.assignments), h('b', {}, num(hrs(s.minutes))), h('span', {}, num(hrs(s.avg)))]))]));
    // monthly trend
    const tr = Th.trend(u.recs(), u.cfg(), { endYm: HR.range(S.kind, S.key).months.slice(-1)[0], n: 6, doctor: S.doctor }); const maxT = Math.max(1, ...tr.map((m) => m.duties.morning + m.duties.evening + m.duties.night));
    body.appendChild(h('div', { class: 'section-title' }, [h('h2', {}, 'Monthly workload')]));
    body.appendChild(h('div', { class: 'card th-trend', id: 'thTrend' }, [h('div', { class: 'th-tcols' }, tr.map((m) => { const n = m.duties.morning + m.duties.evening + m.duties.night;
      return h('div', { class: 'th-tcol' }, [h('b', {}, n || ''), h('div', { class: 'th-tbar' }, ['night', 'evening', 'morning'].map((s) => (m.duties[s] ? h('i', { class: 'd-' + TONE[s], style: `height:${(m.duties[s] / maxT) * 100}%` }) : null))), h('small', {}, HR.label('month', m.ym).slice(0, 3)), h('small', { class: 'hh' }, num(hrs(m.minutes)) + ' h')]); }))]));
    const iss = Th.issues(u.recs(), u.cfg(), state.templates).filter((i) => i.date >= a.from && i.date <= a.to && (S.doctor === 'ALL' || !i.doctor || Th.canonKey(i.doctor) === Th.canonKey(S.doctor)));
    if (iss.length) body.appendChild(h('div', { class: 'card th-warnbox', id: 'thIssuesBox' }, [h('b', {}, `${iss.length} entr${iss.length === 1 ? 'y needs' : 'ies need'} attention in this period`), h('small', {}, 'Incomplete or invalid times are never counted as hours.'), h('button', { class: 'btn btn-sm', onclick: () => { u.ui.tab = 'data'; ctx.render(); } }, 'Review →')]));
    body.appendChild(h('p', { class: 'muted th-rule' }, 'A duty counts in the month it starts. Hours use each doctor’s recorded start/end times and are split at midnight between months, so an overnight shift on the 31st adds hours to both months.'));
    body.appendChild(exportBar(a));
  }

  // ------------------------------------------------------------------ doctors tab
  function renderDoctors(body) {
    const u = U(), c = u.cfg(), r = u.resolve(), off = new Set(c.inactive.map(Th.canonKey)); const all = u.recs();
    const counts = new Map(); for (const rec of all) for (const d of rec.doctors) { const k = Th.canonKey(r(d)); counts.set(k, (counts.get(k) || 0) + 1); }
    const names = Th.uniq([...c.roster, ...all.flatMap((x) => x.doctors)], r);
    body.appendChild(h('p', { class: 'muted' }, 'Adding or removing a doctor only changes the pick-lists. Saved duties and their history are never changed.'));
    const inp = h('input', { class: 'input', id: 'thNewDoc', placeholder: 'Add a doctor (e.g. Priya)', onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } } });
    const add = async () => { const n = r(Th.clean(inp.value)); if (!n) return; if (names.some((x) => Th.canonKey(x) === Th.canonKey(n)) && !off.has(Th.canonKey(n)) && c.roster.some((x) => Th.canonKey(x) === Th.canonKey(n))) return toast(n + ' is already in the list'); await u.saveCfg({ roster: Th.uniq([...c.roster, n], r), inactive: c.inactive.filter((x) => Th.canonKey(x) !== Th.canonKey(n)) }); ctx.render(); toast(n + ' added'); };
    body.appendChild(h('div', { class: 'th-addrow' }, [inp, h('button', { class: 'btn btn-primary', id: 'thAddDoc', onclick: add }, [ic('plus'), 'Add'])]));
    names.forEach((n) => { const k = Th.canonKey(n), n2 = counts.get(k) || 0, inactive = off.has(k), inRoster = c.roster.some((x) => Th.canonKey(x) === k);
      body.appendChild(h('div', { class: 'th-row th-doc-row' + (inactive ? ' off' : ''), 'data-doctor': n }, [u.avatar(n), h('div', { class: 'th-rmain' }, [h('b', {}, n), h('small', {}, `${n2} dut${n2 === 1 ? 'y' : 'ies'} recorded${inactive ? ' · hidden from pick-lists' : ''}`)]),
        h('button', { class: 'btn btn-sm', onclick: () => doctorSheet(n, n2, inactive, inRoster, names) }, 'Manage')])); });
    const d = c.shifts;
    body.appendChild(h('div', { class: 'section-title' }, [h('h2', {}, 'Defaults')]));
    body.appendChild(h('div', { class: 'card' }, Th.SHIFTS.map((s) => h('div', { class: 'th-fact' }, [h('span', {}, s.label), h('b', { style: 'text-align:right' }, `${d[s.id].doctors.map(Th.shortName).join(', ') || 'none'} · ${u.timeRange(d[s.id].start, d[s.id].end)}`)]))));
    body.appendChild(h('p', { class: 'muted' }, 'Change a default from any duty’s Edit screen (“Use these doctors & timings as my default”).'));
    body.appendChild(h('button', { class: 'btn btn-block', id: 'thResetDef', onclick: () => confirmSheet({ title: 'Reset defaults?', text: 'Morning: Dr. Dinesh & Dr. Arafath · Night: all four doctors · standard timings. Saved duties are not changed.', okLabel: 'Reset', onOk: async () => { await u.saveCfg({ shifts: Th.DEFAULTS().shifts }); ctx.render(); toast('Defaults reset'); } }) }, 'Reset defaults to standard'));
  }
  function doctorSheet(name, count, inactive, inRoster, names) {
    const u = U(), c = u.cfg(); let close; const sel = h('select', { class: 'input', id: 'thMergeTo' }, [h('option', { value: '' }, 'Choose the correct doctor…'), ...names.filter((x) => Th.canonKey(x) !== Th.canonKey(name)).map((x) => h('option', { value: x }, x))]);
    const body = h('div', {}, [
      h('p', { class: 'muted', style: 'margin-top:0' }, `${count} duties recorded for ${name}.`),
      h('button', { class: 'btn btn-block', id: 'thToggleDoc', onclick: async () => { close(); const k = Th.canonKey(name); if (inactive) await u.saveCfg({ inactive: c.inactive.filter((x) => Th.canonKey(x) !== k), roster: Th.uniq([...c.roster, name], u.resolve()) });
        else if (count === 0) await u.saveCfg({ roster: c.roster.filter((x) => Th.canonKey(x) !== k), shifts: Object.fromEntries(Th.SHIFTS.map((s) => [s.id, { ...c.shifts[s.id], doctors: c.shifts[s.id].doctors.filter((x) => Th.canonKey(x) !== k) }])) });
        else await u.saveCfg({ inactive: Th.uniq([...c.inactive, name], u.resolve()) }); ctx.render(); toast(inactive ? name + ' is back in the pick-lists' : name + ' removed from the pick-lists'); } }, inactive ? 'Show in pick-lists again' : count ? 'Remove from pick-lists (keep history)' : 'Remove doctor'),
      h('div', { class: 'field', style: 'margin-top:14px' }, [h('label', {}, 'Same person under another spelling? Merge into:'), sel, h('small', { class: 'muted' }, `Future and past entries written as “${name}” will be counted under the chosen doctor. Nothing is rewritten.`)]),
      h('button', { class: 'btn btn-soft btn-block', id: 'thMerge', onclick: async () => { if (!sel.value) return toast('Choose a doctor'); close(); const k = Th.canonKey(name), aliases = { ...c.aliases, [name]: sel.value }; for (const [a, to] of Object.entries(aliases)) if (Th.canonKey(to) === k) aliases[a] = sel.value;
        await u.saveCfg({ aliases, roster: c.roster.filter((x) => Th.canonKey(x) !== k) }); ctx.render(); toast(`${name} merged into ${sel.value}`); } }, 'Merge')]);
    close = ctx.openSheet(name, body);
  }

  // ------------------------------------------------------------------ data tab: checks, import of earlier night duties, rollback
  const STATUS = { new: ['New', 'ok'], exists: ['Night already recorded', 'warn'], imported: ['Already imported', ''], invalid: ['Invalid', 'bad'] };
  function renderData(body) {
    const u = U(), recs = u.recs(), cfg = u.cfg(), iss = Th.issues(recs, cfg, state.templates), chk = Th.selfCheck(recs, cfg), corrupt = (state.corrupt || []).filter((c) => c.store === 'templates');
    body.appendChild(h('div', { class: 'section-title' }, [h('h2', {}, 'Data check')]));
    body.appendChild(h('div', { class: 'card', id: 'thCheck' }, [h('div', { class: 'th-fact' }, [h('span', {}, 'Duty records'), h('b', {}, recs.length)]),
      ...chk.checks.map((k) => h('div', { class: 'th-fact' }, [h('span', {}, k.name), h('b', { class: k.ok ? 'okc' : 'bad' }, k.ok ? `✓ ${k.actual}` : `✗ ${k.actual} ≠ ${k.expected}`)])),
      corrupt.length ? h('div', { class: 'th-fact' }, [h('span', {}, 'Unreadable stored records'), h('b', { class: 'bad' }, corrupt.length)]) : null]));
    body.appendChild(h('div', { class: 'section-title' }, [h('h2', {}, `Entries needing attention (${iss.length})`)]));
    if (!iss.length) body.appendChild(h('div', { class: 'empty', style: 'padding:14px' }, [h('div', {}, 'No incomplete or invalid entries found.')]));
    iss.slice(0, 80).forEach((i) => body.appendChild(h('div', { class: 'th-row bad-row' }, [h('div', { class: 'th-rmain' }, [h('b', {}, `${fmtDay(i.date)} · ${i.shift}${i.doctor ? ' · ' + Th.shortName(i.doctor) : ''}`), h('small', {}, i.text)]), i.type !== 'malformed' ? h('button', { class: 'btn btn-sm', onclick: () => u.editSheet(i.date, i.shift) }, 'Fix') : null])));
    // ---- import
    body.appendChild(h('div', { class: 'section-title' }, [h('h2', {}, 'Earlier night duties')]));
    const cand = Th.legacyCandidates(state.duties || [], state.templates, cfg, 'Dr. Dinesh'); const sel = new Map();
    body.appendChild(h('p', { class: 'muted' }, 'Your personal night-duty list from before THANC tracking. Only entries marked THANC are shown. They are copied as Dr. Dinesh’s night duties; the original list is never changed or deleted.'));
    if (!cand.length) body.appendChild(h('div', { class: 'empty', style: 'padding:14px' }, [h('div', {}, 'No earlier night duties are marked THANC.')]));
    else {
      const box = h('div', { class: 'card th-table', id: 'thImportPreview' }); const summary = h('p', { class: 'muted', id: 'thImportSummary' }); const btn = h('button', { class: 'btn btn-primary btn-block', id: 'thImportGo', disabled: true }, [ic('download'), 'Import selected']);
      const refresh = () => { const n = [...sel.values()].filter(Boolean).length; summary.textContent = `${n} selected`; btn.disabled = !n; };
      box.appendChild(h('div', { class: 'th-tr imp head' }, ['', 'Date', 'Time', 'Hours', 'Status'].map((x) => h('span', {}, x))));
      cand.forEach((r) => { const can = r.status === 'new' || (r.status === 'exists' && !r.hasDoctor); if (can) sel.set(r.legacyId, r.status === 'new');
        const cb = can ? h('input', { type: 'checkbox', 'aria-label': 'Import ' + r.date, 'data-legacy': r.legacyId, checked: r.status === 'new', onchange: (e) => { sel.set(r.legacyId, e.target.checked); refresh(); } }) : h('span', {});
        const [lab, cls] = STATUS[r.status];
        box.appendChild(h('div', { class: 'th-tr imp', 'data-imp-status': r.status }, [cb, h('span', {}, fmtDay(r.date)), h('span', {}, `${Th.fmtTime(r.start)}–${Th.fmtTime(r.end)}`), h('span', {}, r.hours === null ? '—' : num(r.hours)), h('span', { class: 'th-pill ' + cls }, r.status === 'exists' ? (r.hasDoctor ? 'Dr. Dinesh already on it' : 'Add Dr. Dinesh to existing') : lab)])); });
      body.appendChild(box); body.appendChild(summary); body.appendChild(btn); refresh();
      btn.onclick = () => { const chosen = cand.filter((r) => sel.get(r.legacyId)); const adds = new Set(chosen.filter((r) => r.status === 'exists').map((r) => r.legacyId));
        confirmSheet({ title: `Import ${chosen.length} duties?`, text: `${chosen.length - adds.size} new THANC night duties for Dr. Dinesh${adds.size ? ` and ${adds.size} existing night duties get Dr. Dinesh added` : ''}. Nothing is deleted or overwritten, and you can roll this back afterwards.`, okLabel: 'Import',
          onOk: async () => { const batchId = 'thanc-import-' + Date.now().toString(36); const built = Th.buildImport(chosen, state.templates, cfg, { batchId, addToExisting: adds });
            try { await u.commit([...built.upserts, built.batch]); } catch (e) { return toast('Import failed: ' + e.message); } ctx.render(); toast(`${built.count} duties imported`); } }); };
    }
    const batches = state.templates.filter(Th.isImportBatch).sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (batches.length) { body.appendChild(h('div', { class: 'section-title' }, [h('h2', {}, 'Import history')]));
      batches.forEach((b) => { const rolled = !!b.data.rolledBackAt; body.appendChild(h('div', { class: 'th-row', 'data-batch': b.tpl_id }, [h('div', { class: 'th-rmain' }, [h('b', {}, `${b.data.items.length} duties · ${new Date(b.data.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`), h('small', {}, rolled ? 'Rolled back — can be imported again' : 'Active')]),
        rolled ? h('span', { class: 'th-pill' }, 'Rolled back') : h('button', { class: 'btn btn-sm btn-danger', 'data-rollback': b.tpl_id, onclick: () => confirmSheet({ title: 'Roll back this import?', text: 'Duties created by this import are removed (their history is kept and they can be restored from History → Show deleted). Doctors added to existing duties are taken off again. Your original night-duty list is untouched.', okLabel: 'Roll back', danger: true,
          onOk: async () => { const rb = Th.buildRollback(b, state.templates, cfg); await u.commit([...rb.upserts, rb.batch]); ctx.render(); toast('Import rolled back'); } }) }, 'Roll back')])); }); }
    body.appendChild(h('div', { class: 'section-title' }, [h('h2', {}, 'Backup & audit')]));
    body.appendChild(h('div', { class: 'btn-row' }, [h('button', { class: 'btn', onclick: () => go('backup') }, 'Back up / restore'), h('button', { class: 'btn', id: 'thAuditCsv', onclick: () => { const rows = Th.auditRows(recs.concat(Th.deletedOf(state.templates, u.resolve()))); if (!rows.length) return toast('No changes recorded yet'); Reports.download(Th.toCSVTable(Th.AUDIT_HEAD, rows), 'THANC-audit-trail.csv', 'text/csv;charset=utf-8'); } }, 'Audit trail (CSV)')]));
  }

  ctx.thTabs.analytics = renderAnalytics; ctx.thTabs.doctors = renderDoctors; ctx.thTabs.data = renderData;
  return { api: { thancExport: { csv: exportCSV, xlsx: exportExcel, pdf: exportPDF, analysis } } };
});
