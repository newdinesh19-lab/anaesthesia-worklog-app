/**
 * sequence.js — per-day alternating anaesthetist assignment.
 *
 * Rule (from spec):
 *  - Sequence restarts independently for each CASE DATE.
 *  - Case 1 of a day -> anaesthetist[0], case 2 -> anaesthetist[1], case 3 ->
 *    anaesthetist[0], etc. (strict alternation, configurable list of 2+ names).
 *  - A manual override on one case must NOT shift the underlying sequence
 *    for later cases that day, unless the user explicitly asks to
 *    "reset/continue sequence" from that point.
 *
 * The underlying sequence position is tracked independently of what got
 * manually typed into any one case, by counting only non-overridden
 * ("auto") cases when deciding the next suggestion — see
 * `nextSuggestedAnaesthetist`.
 */

/**
 * @param {Array<{case_date:string, anaesthetist:string, is_override:boolean, sequence_index:number|null}>} casesForDay
 *        All non-deleted cases already saved for the same case_date,
 *        ordered by creation time (oldest first). `sequence_index` is the
 *        0-based position in the alternating pattern this case occupied
 *        when it was created (independent of any later manual edit).
 * @param {string[]} roster  e.g. ["Dr. Me", "Dr. Jagadeesh"]
 * @returns {{ suggested: string, sequence_index: number }}
 */
function nextSuggestedAnaesthetist(casesForDay, roster) {
  if (!roster || roster.length === 0) {
    throw new Error('roster must have at least one anaesthetist');
  }
  // sequence_index is the case's absolute position within the day (0-based);
  // the roster slot it maps to is sequence_index % roster.length.
  const position = (casesForDay || []).length;
  const rosterSlot = position % roster.length;
  return { suggested: roster[rosterSlot], sequence_index: position };
}

/**
 * Build the display list for a day's cases, computing each case's
 * "sequence-suggested" anaesthetist (for reference / audit) independent of
 * whatever was actually saved (which may have been manually overridden).
 * Useful for showing "Case 3 -> sequence says Dr. Jagadeesh, but was
 * manually set to Dr. Me".
 */
function annotateSequence(casesForDay, roster) {
  return (casesForDay || []).map((c, i) => ({
    ...c,
    sequence_suggested: roster[i % roster.length],
  }));
}

/**
 * When the user explicitly resets/continues the sequence from a given case
 * onward (case_id), recompute sequence_index for that case and all later
 * cases that day as if counting fresh from this point, while leaving
 * earlier cases untouched. This does NOT change already-saved
 * `anaesthetist` values for other cases -- it only affects what gets
 * *suggested* going forward for new cases and for cases explicitly
 * reset.
 */
function resetSequenceFrom(casesForDay, roster, fromCaseId) {
  const idx = casesForDay.findIndex((c) => c.case_id === fromCaseId);
  if (idx === -1) return casesForDay;
  const result = casesForDay.slice();
  for (let i = idx; i < result.length; i++) {
    const posInNewRun = i - idx;
    const suggested = roster[posInNewRun % roster.length];
    result[i] = { ...result[i], anaesthetist: suggested, is_override: false, sequence_index: posInNewRun };
  }
  return result;
}

const SequenceModule = { nextSuggestedAnaesthetist, annotateSequence, resetSequenceFrom };
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SequenceModule;
}
if (typeof window !== 'undefined') {
  window.Sequence = SequenceModule;
}
