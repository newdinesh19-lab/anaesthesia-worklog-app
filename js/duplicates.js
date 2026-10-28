/**
 * duplicates.js — pre-save duplicate detection.
 *
 * Criteria (from spec):
 *   - same UHID, OR
 *   - same visit_number, OR
 *   - same patient_name (case/space-insensitive) + same case_date
 */

function norm(s) {
  return (s || '').toString().trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * @param {Object} candidate  the case about to be saved
 * @param {Array<Object>} existingCases  all non-deleted saved cases
 * @returns {Array<Object>} matching existing cases (possibly empty)
 */
function findPossibleDuplicates(candidate, existingCases) {
  const matches = [];
  const candUhid = norm(candidate.uhid);
  const candVisit = norm(candidate.visit_number);
  const candName = norm(candidate.patient_name);
  const candDate = candidate.case_date;

  for (const existing of existingCases || []) {
    if (existing.deleted_at) continue;
    if (candidate.case_id && existing.case_id === candidate.case_id) continue; // editing self

    const sameUhid = candUhid && norm(existing.uhid) === candUhid;
    const sameVisit = candVisit && norm(existing.visit_number) === candVisit;
    const sameNameDate =
      candName && norm(existing.patient_name) === candName && candDate && existing.case_date === candDate;

    if (sameUhid || sameVisit || sameNameDate) {
      matches.push({
        case: existing,
        matchedOn: [sameUhid && 'UHID', sameVisit && 'Visit No', sameNameDate && 'Name + Date'].filter(Boolean),
      });
    }
  }
  return matches;
}

const DuplicatesModule = { findPossibleDuplicates };
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DuplicatesModule;
}
if (typeof window !== 'undefined') {
  window.Duplicates = DuplicatesModule;
}
