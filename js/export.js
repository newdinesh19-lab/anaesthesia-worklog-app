/** export.js — month-end Excel (8 sheets) / CSV / PDF. Needs XLSX (SheetJS) and jspdf + autotable globals. */
const ExportModule = (() => {
  const COLS = [['S.No', 'sno'], ['Patient Name', 'patient_name'], ['Age', 'age'], ['Sex', 'sex'], ['UHID', 'uhid'], ['Visit No', 'visit_number'], ['Consultant', 'consultant'],
    ['Surgery', 'surgery'], ['Mode of Anaesthesia', 'anaesthesia_mode'], ['Case Date', 'case_date'], ['Hospital', 'hospital'], ['Location', 'location'], ['Anaesthetist', 'anaesthetist'], ['Notable', 'notable_text']];
  const withNotable = (cases) => cases.map((c) => ({ ...c, notable_text: c.notable ? [c.notable_type, c.notable_note].filter(Boolean).join(': ') || 'Yes' : '' }));
  const rows = (cases, cols) => cases.map((c, i) => { const r = {}; for (const [label, key] of cols) r[label] = key === 'sno' ? i + 1 : c[key] ?? ''; return r; });
  const byDate = (a, b) => a.case_date.localeCompare(b.case_date);

  function dailyRows(cases, roster) {
    const m = Stats.byDay(cases);
    return [...m.keys()].sort().map((d) => { const s = Stats.dailySummary(m.get(d), roster); const r = { Date: d, 'Total Cases': s.total }; for (const n of roster) r[n] = s.byAnaesthetist[n] || 0; return r; });
  }
  function statRows(cases, roster, label, duties) {
    const s = Stats.monthlyStats(cases, roster);
    const r = [{ Metric: 'Month', Value: label }, { Metric: 'Total Cases', Value: s.totalCases }, { Metric: 'Working Days', Value: s.workingDays }, { Metric: 'Average Cases/Day', Value: s.avgPerDay },
      { Metric: 'Maximum Cases in a Day', Value: s.maxPerDay }, { Metric: 'Minimum Cases in a Day', Value: s.minPerDay }, { Metric: 'Number of Consultants', Value: s.consultantCount },
      { Metric: 'Notable Cases', Value: s.notableCount }, { Metric: 'Night Duties', Value: (duties || []).length }];
    for (const n of roster) r.push({ Metric: `Cases — ${n}`, Value: s.byAnaesthetist[n] || 0 });
    return r;
  }
  const dutyRows = (duties) => [...duties].sort((a, b) => a.date.localeCompare(b.date)).map((d) => ({ Date: d.date, Hospital: d.hospital || '', Location: d.location || '', From: d.start || '', To: d.end || '', Notes: d.notes || '' }));
  const sheet = (rowsArr, headers) => XLSX.utils.json_to_sheet(rowsArr.length ? rowsArr : [Object.fromEntries(headers.map((h) => [h, '']))]);

  function exportMonthExcel({ cases, duties = [], roster, monthLabel, fileNamePrefix }) {
    const wb = XLSX.utils.book_new();
    const all = withNotable([...cases].sort(byDate));
    const headers = COLS.map((c) => c[0]);
    XLSX.utils.book_append_sheet(wb, sheet(rows(all, COLS), headers), 'ALL CASES');
    roster.forEach((name, i) => {
      const base = (name.replace(/[^\w ]/g, '').trim() || 'CASES').toUpperCase();
      XLSX.utils.book_append_sheet(wb, sheet(rows(all.filter((c) => c.anaesthetist === name), COLS), headers), i === 0 ? 'MY CASES' : (base + ' CASES').slice(0, 31));
    });
    const cons = Object.entries(Stats.monthlyStats(cases, []).byConsultant).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ Consultant: k, 'Case Count': v }));
    XLSX.utils.book_append_sheet(wb, sheet(cons, ['Consultant', 'Case Count']), 'CONSULTANT SUMMARY');
    XLSX.utils.book_append_sheet(wb, sheet(dailyRows(cases, roster), ['Date', 'Total Cases']), 'DAILY SUMMARY');
    XLSX.utils.book_append_sheet(wb, sheet(statRows(cases, roster, monthLabel, duties), ['Metric', 'Value']), 'MONTHLY STATISTICS');
    XLSX.utils.book_append_sheet(wb, sheet(dutyRows(duties), ['Date', 'Hospital', 'Location', 'From', 'To', 'Notes']), 'NIGHT DUTIES');
    XLSX.utils.book_append_sheet(wb, sheet(rows(all.filter((c) => c.notable), COLS), headers), 'NOTABLE CASES');
    XLSX.writeFile(wb, `${fileNamePrefix}.xlsx`);
  }
  function exportCasesCSV(cases, fileName) {
    const csv = XLSX.utils.sheet_to_csv(XLSX.utils.json_to_sheet(rows(withNotable([...cases].sort(byDate)), COLS)));
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), fileName);
  }
  function exportMonthPDF({ cases, duties = [], roster, monthLabel, hospitalLine, fileNamePrefix }) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape' });
    const s = Stats.monthlyStats(cases, roster);
    doc.setFontSize(16); doc.text('ANAESTHESIA CASE LOG', 14, 16);
    doc.setFontSize(11); doc.text(hospitalLine || '', 14, 23);
    doc.setFontSize(13); doc.text(monthLabel, 14, 31);
    doc.setFontSize(10);
    let y = 40;
    doc.text(`Total Cases: ${s.totalCases}    Night duties: ${duties.length}    Notable: ${s.notableCount}`, 14, y); y += 6;
    for (const n of roster) { doc.text(`${n}: ${s.byAnaesthetist[n] || 0}`, 14, y); y += 6; }
    doc.text(`Working Days: ${s.workingDays}    Avg/Day: ${s.avgPerDay}`, 14, y); y += 8;
    const all = withNotable([...cases].sort(byDate));
    doc.autoTable({ startY: y, head: [COLS.map(([l]) => l)], body: all.map((c, i) => COLS.map(([, k]) => (k === 'sno' ? i + 1 : c[k] ?? ''))), styles: { fontSize: 7 }, headStyles: { fillColor: [44, 106, 85] } });
    if (duties.length) doc.autoTable({ head: [['Night duty date', 'Hospital', 'Location', 'From', 'To', 'Notes']], body: [...duties].sort((a, b) => a.date.localeCompare(b.date)).map((d) => [d.date, d.hospital || '', d.location || '', d.start || '', d.end || '', d.notes || '']), styles: { fontSize: 8 }, headStyles: { fillColor: [60, 60, 120] } });
    doc.save(`${fileNamePrefix}.pdf`);
  }
  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  return { exportMonthExcel, exportCasesCSV, exportMonthPDF, downloadBlob, COLS };
})();
if (typeof window !== 'undefined') window.ExportModule = ExportModule;
