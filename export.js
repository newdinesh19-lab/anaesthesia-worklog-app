/**
 * export.js — month-end export to Excel (6 sheets), CSV, and a PDF report.
 * Relies on the global `XLSX` (SheetJS) and `jspdf` (+ jspdf-autotable)
 * libraries loaded via <script> tags in index.html.
 */

const ExportModule = (() => {
  const ALL_COLUMNS = [
    ['S.No', 'sno'],
    ['Patient Name', 'patient_name'],
    ['Age', 'age'],
    ['Sex', 'sex'],
    ['UHID', 'uhid'],
    ['Visit No', 'visit_number'],
    ['Consultant', 'consultant'],
    ['Case Date', 'case_date'],
    ['Hospital', 'hospital'],
    ['Location', 'location'],
    ['Anaesthetist', 'anaesthetist'],
  ];

  function toRows(cases, columns) {
    return cases.map((c, i) => {
      const row = {};
      for (const [label, key] of columns) {
        row[label] = key === 'sno' ? i + 1 : c[key] ?? '';
      }
      return row;
    });
  }

  function dailySummaryRows(cases, roster) {
    const byDate = Stats.byDay(cases);
    const dates = [...byDate.keys()].sort();
    return dates.map((date) => {
      const summary = Stats.dailySummary(byDate.get(date), roster);
      const row = { Date: date, 'Total Cases': summary.total };
      for (const name of roster) row[name] = summary.byAnaesthetist[name] || 0;
      return row;
    });
  }

  function consultantSummaryRows(cases) {
    const stats = Stats.monthlyStats(cases, []);
    return Object.entries(stats.byConsultant)
      .sort((a, b) => b[1] - a[1])
      .map(([consultant, count]) => ({ Consultant: consultant, 'Case Count': count }));
  }

  function monthlyStatsRows(cases, roster, monthLabel) {
    const stats = Stats.monthlyStats(cases, roster);
    const rows = [
      { Metric: 'Month', Value: monthLabel },
      { Metric: 'Total Cases', Value: stats.totalCases },
      { Metric: 'Working Days', Value: stats.workingDays },
      { Metric: 'Average Cases/Day', Value: stats.avgPerDay },
      { Metric: 'Maximum Cases in a Day', Value: stats.maxPerDay },
      { Metric: 'Minimum Cases in a Day', Value: stats.minPerDay },
      { Metric: 'Number of Consultants', Value: stats.consultantCount },
    ];
    for (const name of roster) rows.push({ Metric: `Cases — ${name}`, Value: stats.byAnaesthetist[name] || 0 });
    return rows;
  }

  /**
   * Build and trigger download of the month-end Excel workbook with the
   * six sheets required by the spec.
   */
  function exportMonthExcel({ cases, roster, monthLabel, fileNamePrefix }) {
    const wb = XLSX.utils.book_new();

    const sortedAll = [...cases].sort((a, b) => a.case_date.localeCompare(b.case_date));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(toRows(sortedAll, ALL_COLUMNS)), 'ALL CASES');

    for (const name of roster) {
      const mine = sortedAll.filter((c) => c.anaesthetist === name);
      const sheetName = name.replace(/[^\w ]/g, '').slice(0, 28) || 'CASES';
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(toRows(mine, ALL_COLUMNS)), sheetName.toUpperCase());
    }

    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(consultantSummaryRows(cases)), 'CONSULTANT SUMMARY');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dailySummaryRows(cases, roster)), 'DAILY SUMMARY');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(monthlyStatsRows(cases, roster, monthLabel)), 'MONTHLY STATISTICS');

    XLSX.writeFile(wb, `${fileNamePrefix}.xlsx`);
  }

  function exportCasesCSV(cases, fileName) {
    const sorted = [...cases].sort((a, b) => a.case_date.localeCompare(b.case_date));
    const ws = XLSX.utils.json_to_sheet(toRows(sorted, ALL_COLUMNS));
    const csv = XLSX.utils.sheet_to_csv(ws);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    downloadBlob(blob, fileName);
  }

  function exportMonthPDF({ cases, roster, monthLabel, hospitalLine, fileNamePrefix }) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const stats = Stats.monthlyStats(cases, roster);

    doc.setFontSize(16);
    doc.text('ANAESTHESIA CASE LOG', 14, 16);
    doc.setFontSize(11);
    doc.text(hospitalLine || '', 14, 23);
    doc.setFontSize(13);
    doc.text(monthLabel, 14, 31);

    doc.setFontSize(10);
    let y = 40;
    doc.text(`Total Cases: ${stats.totalCases}`, 14, y);
    y += 6;
    for (const name of roster) {
      doc.text(`${name}: ${stats.byAnaesthetist[name] || 0}`, 14, y);
      y += 6;
    }
    doc.text(`Working Days: ${stats.workingDays}    Avg/Day: ${stats.avgPerDay}`, 14, y);
    y += 10;

    const sortedAll = [...cases].sort((a, b) => a.case_date.localeCompare(b.case_date));
    doc.autoTable({
      startY: y,
      head: [ALL_COLUMNS.map(([label]) => label)],
      body: sortedAll.map((c, i) => ALL_COLUMNS.map(([, key]) => (key === 'sno' ? i + 1 : c[key] ?? ''))),
      styles: { fontSize: 7 },
      headStyles: { fillColor: [30, 41, 59] },
    });

    doc.save(`${fileNamePrefix}.pdf`);
  }

  function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  return { exportMonthExcel, exportCasesCSV, exportMonthPDF, downloadBlob, ALL_COLUMNS };
})();

if (typeof window !== 'undefined') window.ExportModule = ExportModule;
