/** duplicates.js — same UHID, same visit number, or same name + date. */
const norm = (s) => (s || '').toString().trim().toLowerCase().replace(/\s+/g, ' ');
function findPossibleDuplicates(cand, existing) {
  const out = [];
  const u = norm(cand.uhid), v = norm(cand.visit_number), n = norm(cand.patient_name);
  for (const e of existing || []) {
    if (e.deleted_at || (cand.case_id && e.case_id === cand.case_id)) continue;
    const su = u && norm(e.uhid) === u, sv = v && norm(e.visit_number) === v;
    const sn = n && norm(e.patient_name) === n && cand.case_date && e.case_date === cand.case_date;
    if (!(su || sv || sn)) continue;
    // strong: same visit number, same name on the same day, or same UHID on the same day. weak: same UHID on another day (a repeat visit is normal).
    const sameDay = cand.case_date && e.case_date === cand.case_date;
    out.push({ case: e, matchedOn: [su && 'UHID', sv && 'Visit No', sn && 'Name + Date'].filter(Boolean), strength: sv || sn || (su && sameDay) ? 'strong' : 'weak' });
  }
  return out;
}
const DuplicatesModule = { findPossibleDuplicates };
if (typeof module !== 'undefined' && module.exports) module.exports = DuplicatesModule;
if (typeof window !== 'undefined') window.Duplicates = DuplicatesModule;
