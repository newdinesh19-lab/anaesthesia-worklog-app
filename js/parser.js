/** parser.js — OCR text of a registration sheet -> structured fields + per-field confidence. Pure functions. */
const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
const titleCase = (s) => clean(s).toLowerCase().split(' ').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
function tidyName(raw) { let s = clean(raw); s = s.replace(/^(MR|MRS|MS|MISS|MASTER|BABY OF|DR)\.?\s+/i, ''); return s.replace(/[:|]+$/, '').trim(); }
function normalizeDate(raw) {
  if (!raw) return null;
  const m = clean(raw).match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (!m) return null;
  let [, d, mo, y] = m;
  if (y.length === 2) y = (Number(y) > 50 ? '19' : '20') + y;
  if (Number(mo) < 1 || Number(mo) > 12 || Number(d) < 1 || Number(d) > 31) return null;
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}
const L = {
  name: /^(NAME|PATIENT\s*NAME|PT\s*NAME)\s*[:\-]\s*(.+)$/i,
  ageSex: /^(AGE\s*\/\s*SEX|AGE\/SEX|AGE\s*SEX)\s*[:\-]\s*(.+)$/i,
  uhid: /^(UHID(?:\s*NO\.?)?|HOSPITAL\s*ID|MRN)\s*[:\-]\s*(.+)$/i,
  visitNo: /^(VISIT\s*NO\.?|VISIT\s*NUMBER|VISIT\s*ID)\s*[:\-]\s*(.+)$/i,
  doctor: /^(DOCTOR|CONSULTANT|SURGEON|UNDER\s*CARE\s*OF)\s*[:\-]\s*(.+)$/i,
  doa: /^(DOA|DATE\s*OF\s*ADMISSION|ADMISSION\s*DATE)\s*[:\-]\s*(.+)$/i,
  procDate: /^(DATE\s*OF\s*PROCEDURE|PROCEDURE\s*DATE|DOS|DATE\s*OF\s*SURGERY)\s*[:\-]\s*(.+)$/i,
  payment: /^(PAYMENT\s*MODE|PAYMENT)\s*[:\-]\s*(.+)$/i,
  hospital: /^(HOSPITAL)\s*[:\-]\s*(.+)$/i,
};
const LABEL_ALT = 'PATIENT\\s*NAME|NAME|AGE\\s*\\/\\s*SEX|UHID(?:\\s*NO\\.?)?|VISIT\\s*(?:NO\\.?|NUMBER|ID)|DOCTOR|CONSULTANT|SURGEON|DOA|DATE\\s*OF\\s*(?:ADMISSION|PROCEDURE|SURGERY)|PAYMENT\\s*MODE|HOSPITAL';
/** OCR often puts several "LABEL: value" pairs on one line and reads ":" as ";". Give every label its own line. */
function normalizeLabels(text) {
  return text.replace(new RegExp('(^|[\\s|])(' + LABEL_ALT + ')\\s*[:;]', 'gi'), (m, pre, label) => '\n' + label + ':');
}
function parseRegistrationSheet(ocrText) {
  const text = ocrText || '';
  const lines = normalizeLabels(text).split(/\r?\n/).map(clean).filter(Boolean);
  const f = { patient_name: null, age: null, sex: null, uhid: null, visit_number: null, consultant: null, doa: null, procedure_date: null, payment_mode: null, hospital: null };
  const conf = {};
  for (const line of lines) {
    let m;
    if (!f.patient_name && (m = line.match(L.name))) { const n = tidyName(m[2]); f.patient_name = titleCase(n); conf.patient_name = n.length >= 2 ? 'high' : 'low'; continue; }
    if (!f.age && (m = line.match(L.ageSex))) {
      const rest = clean(m[2]); const am = rest.match(/(\d{1,3})\s*(?:YRS?|Y)?/i); const sm = rest.match(/\b(MALE|FEMALE|M|F|OTHER)\b/i);
      if (am) { f.age = Number(am[1]); conf.age = f.age > 0 && f.age < 120 ? 'high' : 'low'; } else conf.age = 'low';
      if (sm) { const r = sm[1].toUpperCase(); f.sex = r === 'M' ? 'Male' : r === 'F' ? 'Female' : titleCase(r); conf.sex = 'high'; } else conf.sex = 'low';
      continue;
    }
    if (!f.uhid && (m = line.match(L.uhid))) { const v = clean(m[2]).replace(/\s+/g, ''); f.uhid = v; conf.uhid = /^[A-Za-z0-9.\-]{5,}$/.test(v) ? 'high' : 'low'; continue; }
    if (!f.visit_number && (m = line.match(L.visitNo))) { const v = clean(m[2]).replace(/\s+/g, ''); f.visit_number = v; conf.visit_number = /^[A-Za-z0-9\-]{5,}$/.test(v) ? 'high' : 'low'; continue; }
    if (!f.consultant && (m = line.match(L.doctor))) {
      const v = clean(m[2]);
      f.consultant = v.split('/').map(clean).filter(Boolean).map((n) => (/^dr\.?/i.test(n) ? n : `Dr. ${n}`)).join(' / ');
      conf.consultant = v.length >= 3 ? 'high' : 'low'; continue;
    }
    if (!f.doa && (m = line.match(L.doa))) { f.doa = normalizeDate(m[2]); conf.doa = f.doa ? 'high' : 'low'; continue; }
    if (!f.procedure_date && (m = line.match(L.procDate))) { f.procedure_date = normalizeDate(m[2]); conf.procedure_date = f.procedure_date ? 'high' : 'low'; continue; }
    if (!f.payment_mode && (m = line.match(L.payment))) { f.payment_mode = titleCase(clean(m[2])); conf.payment_mode = 'high'; continue; }
    if (!f.hospital && (m = line.match(L.hospital))) { f.hospital = clean(m[2]); conf.hospital = 'high'; continue; }
  }
  if (!f.doa) { const any = text.match(/\b\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}\b/); if (any) { f.doa = normalizeDate(any[0]); conf.doa = 'low'; } }
  for (const k of ['patient_name', 'age', 'sex', 'uhid', 'visit_number', 'consultant', 'doa']) if (f[k] === null || f[k] === '') conf[k] = 'low';
  return { fields: f, confidence: conf, raw: text };
}
function overallConfidence(conf) { const k = Object.keys(conf); return k.length ? Math.round((k.filter((x) => conf[x] === 'high').length / k.length) * 100) / 100 : 0; }
const ParserModule = { normalizeLabels, parseRegistrationSheet, overallConfidence, normalizeDate, titleCase, tidyName };
if (typeof module !== 'undefined' && module.exports) module.exports = ParserModule;
if (typeof window !== 'undefined') window.Parser = ParserModule;
