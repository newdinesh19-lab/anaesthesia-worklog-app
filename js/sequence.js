/** sequence.js — per-day alternating anaesthetist assignment. */
function nextSuggestedAnaesthetist(casesForDay, roster) {
  if (!roster || !roster.length) throw new Error('roster must have at least one anaesthetist');
  const position = (casesForDay || []).length;
  return { suggested: roster[position % roster.length], sequence_index: position };
}
function annotateSequence(casesForDay, roster) {
  return (casesForDay || []).map((c, i) => ({ ...c, sequence_suggested: roster[i % roster.length] }));
}
function resetSequenceFrom(casesForDay, roster, fromCaseId) {
  const idx = casesForDay.findIndex((c) => c.case_id === fromCaseId);
  if (idx === -1) return casesForDay;
  const out = casesForDay.slice();
  for (let i = idx; i < out.length; i++) { const pos = i - idx; out[i] = { ...out[i], anaesthetist: roster[pos % roster.length], is_override: false, sequence_index: pos }; }
  return out;
}
const SequenceModule = { nextSuggestedAnaesthetist, annotateSequence, resetSequenceFrom };
if (typeof module !== 'undefined' && module.exports) module.exports = SequenceModule;
if (typeof window !== 'undefined') window.Sequence = SequenceModule;
