/**
 * parser.js — turns raw OCR text from a hospital registration/admission
 * sheet into structured case fields, with a confidence flag per field.
 *
 * Pure functions only (no DOM, no I/O) so this can be unit-tested with
 * plain Node and reused from the app's OCR-review screen.
 */

// ---- small text helpers --------------------------------------------------

function clean(s) {
  return (s || '').replace(/\s+/g, ' ').trim();
}

// Strip common OCR-mangled honorifics/prefixes from a name, but keep the
// core name intact.
function tidyName(raw) {
  let s = clean(raw);
  s = s.replace(/^(MR|MRS|MS|MISS|MASTER|BABY OF|DR)\.?\s+/i, '');
  s = s.replace(/[:|]+$/, '').trim();
  return s;
}

function titleCase(s) {
  return clean(s)
    .toLowerCase()
    .split(' ')
    .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

// Normalize a date to YYYY-MM-DD. Accepts DD-MM-YYYY, DD/MM/YYYY,
// DD-MM-YY, with optional trailing time ("12:10 PM") which is ignored.
function normalizeDate(raw) {
  if (!raw) return null;
  const s = clean(raw);
  const m = s.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (!m) return null;
  let [, d, mo, y] = m;
  d = d.padStart(2, '0');
  mo = mo.padStart(2, '0');
  if (y.length === 2) y = (Number(y) > 50 ? '19' : '20') + y;
  const day = Number(d), mon = Number(mo), yr = Number(y);
  if (mon < 1 || mon > 12 || day < 1 || day > 31) return null;
  return `${y}-${mo}-${d}`;
}

// ---- field extractors -----------------------------------------------------
// Each extractor returns { value, confidence: 'high'|'low', raw } or null.

const LINE_LABELS = {
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

/**
 * Parse raw OCR text into a structured case object.
 * @param {string} ocrText
 * @returns {{fields: Object, confidence: Object, raw: string}}
 */
function parseRegistrationSheet(ocrText) {
  const text = ocrText || '';
  const lines = text.split(/\r?\n/).map(clean).filter(Boolean);

  const fields = {
    patient_name: null,
    age: null,
    sex: null,
    uhid: null,
    visit_number: null,
    consultant: null,
    doa: null, // document/admission date, ISO
    procedure_date: null, // ISO, if present
    payment_mode: null,
    hospital: null,
  };
  const confidence = {}; // fieldName -> 'high' | 'low'

  for (const line of lines) {
    let m;

    if (!fields.patient_name && (m = line.match(LINE_LABELS.name))) {
      const name = tidyName(m[2]);
      fields.patient_name = titleCase(name);
      confidence.patient_name = name.length >= 2 ? 'high' : 'low';
      continue;
    }

    if (!fields.age && (m = line.match(LINE_LABELS.ageSex))) {
      const rest = clean(m[2]);
      const am = rest.match(/(\d{1,3})\s*(?:YRS?|Y)?/i);
      const sm = rest.match(/\b(MALE|FEMALE|M|F|OTHER)\b/i);
      if (am) {
        fields.age = Number(am[1]);
        confidence.age = fields.age > 0 && fields.age < 120 ? 'high' : 'low';
      } else {
        confidence.age = 'low';
      }
      if (sm) {
        const raw = sm[1].toUpperCase();
        fields.sex = raw === 'M' ? 'Male' : raw === 'F' ? 'Female' : titleCase(raw);
        confidence.sex = 'high';
      } else {
        confidence.sex = 'low';
      }
      continue;
    }

    if (!fields.uhid && (m = line.match(LINE_LABELS.uhid))) {
      const val = clean(m[2]).replace(/\s+/g, '');
      fields.uhid = val;
      // Low confidence if it doesn't look like a typical alnum ID
      confidence.uhid = /^[A-Za-z0-9.\-]{5,}$/.test(val) ? 'high' : 'low';
      continue;
    }

    if (!fields.visit_number && (m = line.match(LINE_LABELS.visitNo))) {
      const val = clean(m[2]).replace(/\s+/g, '');
      fields.visit_number = val;
      confidence.visit_number = /^[A-Za-z0-9\-]{5,}$/.test(val) ? 'high' : 'low';
      continue;
    }

    if (!fields.consultant && (m = line.match(LINE_LABELS.doctor))) {
      const val = clean(m[2]);
      fields.consultant = val
        .split('/')
        .map((n) => clean(n))
        .filter(Boolean)
        .map((n) => (/^dr\.?/i.test(n) ? n : `Dr. ${n}`))
        .join(' / ');
      confidence.consultant = val.length >= 3 ? 'high' : 'low';
      continue;
    }

    if (!fields.doa && (m = line.match(LINE_LABELS.doa))) {
      const iso = normalizeDate(m[2]);
      fields.doa = iso;
      confidence.doa = iso ? 'high' : 'low';
      continue;
    }

    if (!fields.procedure_date && (m = line.match(LINE_LABELS.procDate))) {
      const iso = normalizeDate(m[2]);
      fields.procedure_date = iso;
      confidence.procedure_date = iso ? 'high' : 'low';
      continue;
    }

    if (!fields.payment_mode && (m = line.match(LINE_LABELS.payment))) {
      fields.payment_mode = titleCase(clean(m[2]));
      confidence.payment_mode = 'high';
      continue;
    }

    if (!fields.hospital && (m = line.match(LINE_LABELS.hospital))) {
      fields.hospital = clean(m[2]);
      confidence.hospital = 'high';
      continue;
    }
  }

  // Fallback: if no labelled date found anywhere, try to find any bare date
  // in the whole text as a last resort (marked low confidence).
  if (!fields.doa) {
    const anyDate = text.match(/\b\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}\b/);
    if (anyDate) {
      fields.doa = normalizeDate(anyDate[0]);
      confidence.doa = 'low';
    }
  }

  // Mark any field that stayed null as low confidence so the review screen
  // flags it for the user, EXCEPT purely optional ones.
  const REQUIRED = ['patient_name', 'age', 'sex', 'uhid', 'visit_number', 'consultant', 'doa'];
  for (const f of REQUIRED) {
    if (fields[f] === null || fields[f] === '') confidence[f] = 'low';
  }

  return { fields, confidence, raw: text };
}

// Overall confidence score 0-1 for display / sorting.
function overallConfidence(confidence) {
  const keys = Object.keys(confidence);
  if (!keys.length) return 0;
  const high = keys.filter((k) => confidence[k] === 'high').length;
  return Math.round((high / keys.length) * 100) / 100;
}

const ParserModule = { parseRegistrationSheet, overallConfidence, normalizeDate, titleCase, tidyName };
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ParserModule;
}
if (typeof window !== 'undefined') {
  window.Parser = ParserModule;
}
