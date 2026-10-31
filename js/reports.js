/**
 * reports.js — builds report models (pure) and renders them to CSV / Excel (separate worksheets) / PDF.
 * Reports are de-identified by default: no patient name, UHID, exact age, case reference or free-text notes.
 * Counts are personal workload/exposure figures, not quality-of-care indicators.
 */
const Reports = (() => {
  const A = typeof Analytics !== 'undefined' ? Analytics : require('./analytics');
  const S = typeof Schema !== 'undefined' ? Schema : require('./schema');
  const TYPES = [
    ['monthly', 'Monthly case log', 'Every case in the period with totals'],
    ['yearly', 'Yearly summary', 'Month-by-month counts and distributions'],
    ['portfolio', 'Speciality portfolio', 'Cases by speciality with ASA, technique and complexity'],
    ['procedures', 'Procedure logbook', 'Procedures with roles, attempts and outcomes'],
    ['duties', 'Night duties', 'Duty dates, hospitals and totals'],
    ['workload', 'Consultant & hospital workload', 'Who and where you worked'],
    ['complications', 'Complications & notable cases', 'Documented events and interesting cases (exposure, not quality)'],
    ['yearend', 'Year-end portfolio', 'Everything above in one workbook'],
  ];
  const DISCLAIMER = 'Counts describe personal workload and exposure. They are not measures of quality of care or outcomes. Self-reported data; verify against hospital records before formal use.';
  const join = (a) => (a || []).filter(Boolean).join('; ');
  const sortBy = (arr, k) => arr.slice().sort((a, b) => String(a[k]).localeCompare(String(b[k])));

  function caseRows(cases, o) {
    const id = !!o.identifiers;
    const head = ['Code', 'Date', ...(id ? ['Patient', 'Age'] : ['Age band']), 'Sex', ...(id ? ['UHID'] : []), 'Surgery', 'Speciality', 'ASA', 'Urgency', 'Technique', 'Complexity', 'Consultant', 'Hospital', 'Destination', 'Complications'];
    const rows = sortBy(cases, 'case_date').map((c) => [A.anonCode(c.case_id), c.case_date, ...(id ? [c.patient_name || '', c.age ?? ''] : [A.ageBand(c.age)]), c.sex || '', ...(id ? [c.uhid || ''] : []), c.surgery || '', S.specialityOf(c).value || '', c.asa || '', c.urgency || '', S.techniquesOf(c).join(' + '), c.complexity || '', c.consultant || '', c.hospital || '', (c.postop || {}).destination || '', join(S.complicationsOf(c))]);
    return { name: 'Cases', columns: head, rows };
  }
  function procRows(procs, o, cases) {
    const id = !!o.identifiers;
    const head = ['Date', 'Procedure', 'Site', 'Role', 'Operator', 'Assistant', 'Supervisor', 'Success', 'Attempts', 'US-guided', 'Complications', 'Hospital', id ? 'Case reference' : 'Case code', ...(id ? ['Notes'] : [])];
    const rows = sortBy(procs, 'date').map((p) => [p.date, p.procedure, p.site || '', p.role || '', p.operator || '', p.assistant || '', p.supervisor || '', p.success === false ? 'No' : 'Yes', p.attempts || 1, p.us_guided ? 'Yes' : '', join((p.complications || []).filter((x) => x !== 'None')), p.hospital || '', id ? p.case_ref || '' : p.case_id ? A.anonCode(p.case_id) : '', ...(id ? [p.notes || ''] : [])]);
    return { name: 'Procedures', columns: head, rows };
  }
  const dist = (name, label, obj, keysOrder) => ({ name, columns: [label, 'Count'], rows: (keysOrder ? A.ORDERED(keysOrder, obj) : A.entries(obj)).map(([k, v]) => [k, v]) });
  const MONTHS = A.MONTH_ABBR;

  function build(type, data, o = {}) {
    const { cases = [], duties = [], procs = [], range = { from: '', to: '', label: 'All time' }, settings = {} } = data;
    const opts = { paedAgeMax: settings.paedAgeMax, geriatricAgeMin: settings.geriatricAgeMin };
    const c = cases.filter((x) => A.inRange(x.case_date, range)), d = duties.filter((x) => A.inRange(x.date, range)), p = procs.filter((x) => A.inRange(x.date, range));
    const cs = A.caseSummary(c, opts), ps = A.procSummary(p), wl = A.workload(cases, duties, procs, range);
    const title = (TYPES.find((t) => t[0] === type) || [])[1] || type;
    const m = { type, title, range: range.label, generated: new Date().toISOString().slice(0, 16).replace('T', ' '), identifiers: !!o.identifiers, totals: [], sheets: [], charts: [], disclaimer: DISCLAIMER };
    const T = (k, v) => m.totals.push([k, v]);
    const urgencyT = () => { T('Emergency', cs.emergency); T('Elective', cs.elective); if (cs.emergencyPct != null) T('Emergency %', cs.emergencyPct + '%'); };
    const addCharts = () => {
      m.charts.push({ title: 'ASA grade', entries: A.ORDERED([...S.ASA, 'Not recorded'], cs.asa) }, { title: 'Technique', entries: A.entries(cs.techniques) }, { title: 'Speciality / category', entries: A.entries(cs.categories) });
    };
    const summarySheets = () => [dist('ASA', 'ASA', cs.asa, [...S.ASA, 'Not recorded']), dist('Technique', 'Technique', cs.techniques), dist('Speciality', 'Category', cs.categories), dist('Complexity', 'Complexity', cs.complexity, [...S.COMPLEXITY, 'Not recorded']), dist('Urgency', 'Urgency', cs.urgency)];
    const dutySheet = () => ({ name: 'Night duties', columns: ['Date', 'Hospital', 'Location', 'From', 'To'].concat(o.identifiers ? ['Notes'] : []), rows: sortBy(d, 'date').map((x) => [x.date, x.hospital || '', x.location || '', x.start || '', x.end || ''].concat(o.identifiers ? [x.notes || ''] : [])) });
    const workSheets = () => [dist('Consultants', 'Consultant', cs.consultants), dist('Hospitals', 'Hospital', cs.hospitals)];
    const compSheet = () => {
      const rows = sortBy(c.filter((x) => S.complicationsOf(x).length || S.eventsOf(x).length || x.notable), 'case_date').map((x) => [A.anonCode(x.case_id), x.case_date, ...(o.identifiers ? [x.patient_name || ''] : []), x.surgery || '', x.asa || '', join(S.complicationsOf(x)), join(S.eventsOf(x)), x.notable ? x.notable_type || 'Notable' : '', ...(o.identifiers ? [x.notable_note || ''] : [])]);
      return { name: 'Complications & notable', columns: ['Code', 'Date', ...(o.identifiers ? ['Patient'] : []), 'Surgery', 'ASA', 'Complications', 'Events', 'Notable type', ...(o.identifiers ? ['Note'] : [])], rows };
    };
    const monthSheet = (yr) => ({ name: 'By month', columns: ['Month', 'Cases', 'Procedures', 'Night duties'], rows: MONTHS.map((mn, i) => [mn, A.monthSeries(c, 'case_date', yr)[i], A.monthSeries(p, 'date', yr)[i], A.monthSeries(d, 'date', yr)[i]]) });
    const yr = (range.to || range.from || new Date().toISOString()).slice(0, 4);

    if (type === 'monthly') { T('Cases', cs.total); urgencyT(); T('Working days', wl.workingDays); T('Avg per working day', wl.avgPerWorkingDay); T('Night duties', d.length); T('Procedures', p.length); m.sheets.push(caseRows(c, o), ...summarySheets().slice(0, 2)); addCharts(); }
    else if (type === 'yearly') { T('Cases', cs.total); urgencyT(); T('Procedures', p.length); T('Night duties', d.length); T('ICU/HDU transfers', cs.icuHdu); m.sheets.push(monthSheet(yr), ...summarySheets(), ...workSheets()); m.charts.push({ title: 'Cases per month', entries: MONTHS.map((mn, i) => [mn, A.monthSeries(c, 'case_date', yr)[i]]) }); addCharts(); }
    else if (type === 'portfolio') { T('Cases', cs.total); T('Categories used', Object.keys(cs.categories).length); m.note = 'Paediatric and Geriatric are counted in addition to the surgical speciality, so category counts exceed the case total.'; m.sheets.push(dist('Categories', 'Category', cs.categories, S.PORTFOLIO_CATEGORIES), ...summarySheets().slice(0, 4), dist('Age groups', 'Group', cs.ageGroups)); addCharts(); }
    else if (type === 'procedures') { T('Procedures', ps.total); T('Independent', ps.byRole['Performed independently'] || 0); T('Ultrasound-guided', ps.usGuided); T('Unsuccessful', ps.unsuccessful); T('With a complication', ps.withComplication); m.sheets.push(procRows(p, o), dist('By procedure', 'Procedure', ps.byProc), dist('By role', 'Role', ps.byRole)); m.charts.push({ title: 'Procedures', entries: A.entries(ps.byProc) }); }
    else if (type === 'duties') { T('Night duties', d.length); T('Hospitals', new Set(d.map((x) => x.hospital).filter(Boolean)).size); m.sheets.push(dutySheet(), dist('By hospital', 'Hospital', A.count(d, (x) => x.hospital || 'Not recorded'))); }
    else if (type === 'workload') { T('Cases', cs.total); T('Working days', wl.workingDays); T('Avg per working day', wl.avgPerWorkingDay); if (wl.busiest) T('Busiest day', `${wl.busiest.date} (${wl.busiest.count})`); T('Consultants', Object.keys(cs.consultants).length); m.sheets.push(...workSheets(), dist('Destination', 'Destination', cs.destinations)); m.charts.push({ title: 'Consultants', entries: A.entries(cs.consultants).slice(0, 12) }, { title: 'Hospitals', entries: A.entries(cs.hospitals) }); }
    else if (type === 'complications') { T('Cases', cs.total); T('Cases with a documented complication', cs.complicationCases); T('Difficult airways documented', cs.difficultAirway); T('Notable cases', cs.notable); T('ICU/HDU transfers', cs.icuHdu); m.sheets.push(compSheet(), dist('Complication types', 'Type', cs.complicationTypes), dist('Events', 'Event', cs.eventTypes)); m.charts.push({ title: 'Complication types', entries: A.entries(cs.complicationTypes) }); }
    else if (type === 'yearend') { T('Cases', cs.total); urgencyT(); T('Procedures', p.length); T('Night duties', d.length); T('ICU/HDU transfers', cs.icuHdu); T('Notable cases', cs.notable); m.sheets.push(monthSheet(yr), caseRows(c, o), procRows(p, o), dutySheet(), ...summarySheets(), dist('Categories', 'Category', cs.categories, S.PORTFOLIO_CATEGORIES), ...workSheets(), dist('Procedures by type', 'Procedure', ps.byProc), compSheet()); m.charts.push({ title: 'Cases per month', entries: MONTHS.map((mn, i) => [mn, A.monthSeries(c, 'case_date', yr)[i]]) }); addCharts(); }
    m.coverage = cs.coverage;
    return m;
  }

  // ---------------------------------------------------------------- renderers
  const esc = (v) => { const s = String(v ?? ''); const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? "'" + s : s; return /[",\n\r]/.test(safe) ? '"' + safe.replace(/"/g, '""') + '"' : safe; };
  /** One CSV: header block, totals, then every sheet one after another. */
  function toCSV(m) {
    const L = [[m.title], ['Period', m.range], ['Generated', m.generated], ['Identifiers included', m.identifiers ? 'Yes' : 'No (de-identified)'], [], ['Totals'], ...m.totals];
    for (const s of m.sheets) { L.push([], [s.name], s.columns, ...s.rows); }
    L.push([], [m.disclaimer]);
    return '﻿' + L.map((r) => r.map(esc).join(',')).join('\r\n');
  }
  const sheetName = (n, used) => { let b = n.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet', k = b, i = 2; while (used.has(k.toLowerCase())) k = b.slice(0, 28) + ' ' + i++; used.add(k.toLowerCase()); return k; };
  function toWorkbook(m) {
    const wb = XLSX.utils.book_new(), used = new Set();
    const sum = [[m.title], ['Period', m.range], ['Generated', m.generated], ['Identifiers included', m.identifiers ? 'Yes' : 'No (de-identified)'], [], ['Totals'], ...m.totals, [], [m.disclaimer]];
    if (m.note) sum.push([m.note]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sum), sheetName('Summary', used));
    for (const s of m.sheets) { const ws = XLSX.utils.aoa_to_sheet([s.columns, ...s.rows]); ws['!cols'] = s.columns.map((c, i) => ({ wch: Math.min(40, Math.max(c.length + 2, ...s.rows.slice(0, 200).map((r) => String(r[i] ?? '').length + 2))) })); XLSX.utils.book_append_sheet(wb, ws, sheetName(s.name, used)); }
    return wb;
  }
  const toExcel = (m, file) => XLSX.writeFile(toWorkbook(m), file);
  function toPDF(m, file) {
    const { jsPDF } = window.jspdf; const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' }); const W = doc.internal.pageSize.getWidth();
    doc.setFontSize(16); doc.text(m.title, 40, 44); doc.setFontSize(9); doc.setTextColor(90);
    doc.text(`Period: ${m.range}   ·   Generated: ${m.generated}   ·   ${m.identifiers ? 'CONTAINS PATIENT IDENTIFIERS' : 'De-identified'}`, 40, 60); doc.setTextColor(0);
    let y = 78;
    if (m.totals.length) { doc.autoTable({ startY: y, head: [['Total', 'Value']], body: m.totals.map((t) => [t[0], String(t[1])]), theme: 'grid', styles: { fontSize: 9 }, headStyles: { fillColor: [124, 77, 255] }, tableWidth: 320, margin: { left: 40 } }); y = doc.lastAutoTable.finalY + 14; }
    for (const ch of m.charts) {
      const e = ch.entries.slice(0, 10); if (!e.length) continue; const max = Math.max(1, ...e.map((x) => x[1])), h = 16 + e.length * 14 + 6;
      if (y + h > 540) { doc.addPage(); y = 40; }
      doc.setFontSize(10); doc.setFont(undefined, 'bold'); doc.text(ch.title, 40, y); doc.setFont(undefined, 'normal'); y += 12; doc.setFontSize(8);
      e.forEach(([k, v]) => { doc.text(String(k).slice(0, 30), 40, y + 8); doc.setFillColor(124, 77, 255); doc.rect(190, y, Math.max(1, (v / max) * 300), 9, 'F'); doc.text(String(v), 196 + (v / max) * 300, y + 8); y += 14; });
      y += 8;
    }
    for (const s of m.sheets) {
      if (!s.rows.length) continue;
      if (y > 480) { doc.addPage(); y = 40; }
      doc.setFontSize(11); doc.setFont(undefined, 'bold'); doc.text(s.name, 40, y); doc.setFont(undefined, 'normal');
      doc.autoTable({ startY: y + 6, head: [s.columns], body: s.rows.map((r) => r.map((v) => String(v ?? ''))), theme: 'striped', styles: { fontSize: s.columns.length > 9 ? 6.5 : 8, cellPadding: 2 }, headStyles: { fillColor: [124, 77, 255] }, margin: { left: 40, right: 40 } });
      y = doc.lastAutoTable.finalY + 18;
    }
    const n = doc.internal.getNumberOfPages();
    for (let i = 1; i <= n; i++) { doc.setPage(i); doc.setFontSize(7); doc.setTextColor(110); doc.text(m.disclaimer, 40, 575, { maxWidth: W - 120 }); doc.text(`${i}/${n}`, W - 60, 575); }
    doc.save(file);
  }
  const fileName = (m, ext) => `${m.type}-${(m.range || 'all').replace(/[^\w]+/g, '-').toLowerCase()}${m.identifiers ? '-IDENTIFIABLE' : ''}.${ext}`;
  const download = (text, name, mime) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: mime })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); };

  return { TYPES, DISCLAIMER, build, toCSV, toWorkbook, toExcel, toPDF, fileName, download };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Reports;
if (typeof window !== 'undefined') window.Reports = Reports;
