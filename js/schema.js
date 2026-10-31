/**
 * schema.js — V8 data model: pick-lists, defaults and READ-TIME upgraders.
 *
 * Rules that keep old data safe:
 *  - Stored records are never rewritten just because the app was upgraded. An older record is normalised
 *    in memory when it is loaded, and only written back (with schema_version 8) when the user saves it.
 *  - Nothing is ever removed from a record. Legacy fields (e.g. anaesthesia_mode) stay and keep working.
 *  - New fields are all optional; "quick entry" records are valid V8 records.
 * Pure functions, no DOM: unit-testable in Node.
 */
const Schema = (() => {
  const VERSION = 8;
  const APP_VERSION = '8.0.0';
  const uniq = (a) => [...new Set(a)];

  // ---------------------------------------------------------------- pick-lists
  const SPECIALITIES = ['ENT', 'Head & neck oncology', 'Thyroid', 'Dental & maxillofacial', 'General surgery', 'Obstetrics & gynaecology', 'Orthopaedics', 'Urology', 'Neurosurgery', 'Cardiac & thoracic', 'Other'];
  const AGE_GROUPS = ['Paediatric', 'Geriatric']; // counted in addition to the surgical speciality
  const PORTFOLIO_CATEGORIES = ['ENT', 'Head & neck oncology', 'Thyroid', 'Dental & maxillofacial', 'General surgery', 'Obstetrics & gynaecology', 'Orthopaedics', 'Urology', 'Neurosurgery', 'Paediatric', 'Geriatric', 'Cardiac & thoracic', 'Other'];
  const TECHNIQUES = ['GA', 'Spinal', 'Epidural', 'CSE', 'Peripheral nerve block', 'Sedation / MAC', 'Local + standby'];
  const URGENCY = ['Elective', 'Emergency'];
  const ASA = ['I', 'II', 'III', 'IV', 'V', 'VI'];
  const COMPLEXITY = ['Minor', 'Intermediate', 'Major', 'Complex'];
  const RISK_FACTORS = ['Difficult airway predicted', 'Obesity (BMI ≥ 35)', 'OSA', 'Full stomach / aspiration risk', 'Extremes of age', 'Pregnancy', 'Raised ICP', 'Anticoagulated', 'Cardiac risk', 'Pulmonary risk', 'Renal impairment', 'Sepsis / shock', 'Massive haemorrhage risk', 'Difficult IV access', 'Prolonged surgery (> 4 h)', 'Prone / lateral position'];

  const AIRWAY = {
    mask: ['Grade 1', 'Grade 2', 'Grade 3', 'Grade 4'],
    maskHelp: '1 easy · 2 with adjunct · 3 difficult · 4 impossible (Han scale)',
    cl: ['I', 'II', 'III', 'IV'],
    clMod: ['I', 'IIa', 'IIb', 'III', 'IV'],
    devices: ['Macintosh laryngoscope', 'Video laryngoscope', 'Fibreoptic', 'Bougie-assisted', 'Supraglottic airway', 'Face mask only', 'Tracheostomy', 'Double-lumen tube', 'Other'],
    ettTypes: ['Oral cuffed', 'Oral uncuffed', 'Nasal', 'Armoured', 'Preformed (RAE)', 'Microlaryngeal', 'Double-lumen'],
    lmaTypes: ['Classic', 'ProSeal', 'Supreme', 'i-gel', 'Flexible', 'Intubating', 'Air-Q', 'Other'],
    lmaSizes: ['1', '1.5', '2', '2.5', '3', '4', '5'],
    attempts: ['1', '2', '3', '>3'],
    complications: ['Dental injury', 'Lip / mucosal trauma', 'Sore throat / hoarseness', 'Laryngospasm', 'Bronchospasm', 'Aspiration', 'Oesophageal intubation (recognised)', 'Endobronchial intubation', 'Hypoxia (SpO₂ < 90%)', 'Airway bleeding', 'Failed intubation', 'Other'],
    extubation: ['Awake', 'Deep', 'Extubated in OT', 'Extubated in PACU / ICU', 'Remained intubated', 'Not applicable'],
  };

  const INTRAOP = {
    monitoring: ['ECG', 'NIBP', 'SpO₂', 'EtCO₂', 'Temperature', 'Urine output', 'Invasive BP', 'CVP', 'Depth of anaesthesia (BIS)', 'Neuromuscular monitor', 'TEE', 'Cardiac output'],
    access: ['Peripheral IV', 'Large-bore IV', 'Arterial line', 'Central line', 'PICC', 'Intraosseous'],
    airwayTech: ['Face mask', 'Supraglottic airway', 'ETT – oral', 'ETT – nasal', 'Tracheostomy', 'Spontaneous breathing', 'Controlled ventilation'],
    drugs: [
      ['Induction / sedation', ['Propofol', 'Etomidate', 'Ketamine', 'Thiopentone', 'Midazolam', 'Dexmedetomidine']],
      ['Opioids / analgesics', ['Fentanyl', 'Morphine', 'Tramadol', 'Butorphanol', 'Nalbuphine', 'Remifentanil', 'Paracetamol IV', 'Diclofenac']],
      ['Muscle relaxants', ['Succinylcholine', 'Atracurium', 'Cisatracurium', 'Rocuronium', 'Vecuronium']],
      ['Inhalational', ['Sevoflurane', 'Isoflurane', 'Desflurane', 'Nitrous oxide']],
      ['Reversal', ['Neostigmine + glycopyrrolate', 'Sugammadex']],
      ['Local anaesthetics', ['Bupivacaine (heavy)', 'Bupivacaine', 'Ropivacaine', 'Levobupivacaine', 'Lignocaine']],
      ['Other', ['Ondansetron', 'Dexamethasone', 'Tranexamic acid', 'Antibiotic prophylaxis', 'Oxytocin', 'Hydrocortisone']],
    ],
    vasoactive: ['Ephedrine', 'Phenylephrine', 'Mephentermine', 'Noradrenaline', 'Adrenaline', 'Vasopressin', 'Dopamine', 'Dobutamine', 'Atropine', 'Glycopyrrolate', 'Nitroglycerin', 'Esmolol', 'Labetalol'],
    fluids: ['Normal saline', 'Ringer lactate', 'Plasmalyte', 'Colloid', 'Dextrose'],
    blood: ['PRBC', 'FFP', 'Platelets', 'Cryoprecipitate', 'Whole blood', 'Albumin'],
    blocks: ['Brachial plexus', 'Interscalene', 'Supraclavicular', 'Axillary', 'Femoral', 'Adductor canal', 'Sciatic / popliteal', 'Fascia iliaca', 'TAP', 'Erector spinae', 'Rectus sheath', 'Paravertebral', 'Superficial cervical plexus', 'Scalp', 'Caudal', 'Epidural catheter', 'Other'],
    events: ['Hypotension', 'Hypertension', 'Bradycardia', 'Tachycardia', 'Arrhythmia', 'Desaturation', 'Major blood loss', 'Hypothermia', 'Difficult IV access', 'Failed / patchy block', 'Conversion to GA', 'Position-related problem', 'Other'],
    complications: ['Bronchospasm', 'Laryngospasm', 'Aspiration', 'Anaphylaxis / drug reaction', 'High / total spinal', 'Local anaesthetic toxicity', 'Awareness (suspected)', 'Malignant hyperthermia (suspected)', 'Cardiac arrest', 'Pneumothorax', 'Other'],
  };

  const POSTOP = {
    airwayStatus: ['Extubated in OT', 'Extubated in PACU', 'Remained ventilated', 'Not applicable'],
    pacu: ['Smooth recovery', 'Delayed recovery', 'Shivering', 'Agitation / delirium', 'Not applicable'],
    pain: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'],
    ponv: ['None', 'Nausea', 'Vomiting', 'Treated'],
    haemo: ['Stable', 'Needed support', 'Unstable'],
    o2: ['Room air', 'Nasal prongs', 'Face mask', 'Non-rebreather', 'HFNO / NIV', 'Ventilated'],
    complications: ['Uncontrolled pain', 'PONV', 'Hypotension', 'Respiratory depression', 'Desaturation', 'Residual block', 'Shivering', 'Delirium', 'Urinary retention', 'Post-dural puncture headache', 'Suspected nerve injury', 'Bleeding', 'Re-intubation', 'Unplanned ICU admission', 'Other'],
    destination: ['Ward', 'PACU → ward', 'HDU', 'ICU', 'Day-care discharge', 'Other'],
  };

  // Procedure logbook
  const PROCEDURES = ['Endotracheal intubation', 'Difficult intubation', 'Fibreoptic intubation', 'Video laryngoscopy', 'LMA insertion', 'Spinal anaesthesia', 'Epidural insertion', 'CSE', 'Peripheral nerve block', 'Arterial cannulation', 'Central venous catheterisation', 'PICC insertion', 'Ultrasound-guided procedure', 'TEE / TTE exposure', 'Other procedure'];
  const PROC_ROLES = ['Performed independently', 'Performed under supervision', 'Assisted', 'Observed'];
  const PROC_COMPLICATIONS = ['None', 'Failed / abandoned', 'Bleeding / haematoma', 'Accidental dural puncture', 'Paraesthesia', 'Pneumothorax', 'Arterial puncture', 'Vascular injury', 'Hypotension', 'Airway trauma', 'Desaturation', 'Infection concern', 'Other'];
  const TEMPLATE_TYPES = [['surgery', 'Surgery'], ['anaesthesia', 'Anaesthesia'], ['procedure', 'Procedure']];

  // ---------------------------------------------------------------- legacy mode <-> techniques
  const LEGACY_MODE = {
    'GA': ['GA'], 'SA (Spinal)': ['Spinal'], 'Epidural': ['Epidural'], 'CSE': ['CSE'], 'Regional Block': ['Peripheral nerve block'],
    'Sedation / MAC': ['Sedation / MAC'], 'Local + Standby': ['Local + standby'], 'GA + Regional': ['GA', 'Peripheral nerve block'], 'Other': [],
  };
  const MODE_NAME = { 'GA': 'GA', 'Spinal': 'SA (Spinal)', 'Epidural': 'Epidural', 'CSE': 'CSE', 'Peripheral nerve block': 'Regional Block', 'Sedation / MAC': 'Sedation / MAC', 'Local + standby': 'Local + Standby' };
  function techniquesFromMode(mode) {
    if (!mode) return [];
    if (LEGACY_MODE[mode]) return LEGACY_MODE[mode].slice();
    // Free-text or combined strings such as "GA + Spinal": pick up every known token.
    const out = [];
    const m = String(mode).toLowerCase();
    if (/\bga\b|general/.test(m)) out.push('GA');
    if (/\bcse\b|combined spinal/.test(m)) out.push('CSE');
    else if (/spinal|\bsa\b/.test(m)) out.push('Spinal');
    if (/epidural/.test(m) && !/cse/.test(m)) out.push('Epidural');
    if (/block|regional|plexus/.test(m)) out.push('Peripheral nerve block');
    if (/sedation|mac\b/.test(m)) out.push('Sedation / MAC');
    if (/local/.test(m)) out.push('Local + standby');
    return uniq(out);
  }
  function modeFromTechniques(t) {
    const a = uniq(t || []);
    if (!a.length) return '';
    if (a.length === 1) return MODE_NAME[a[0]] || a[0];
    if (a.length === 2 && a.includes('GA') && a.includes('Peripheral nerve block')) return 'GA + Regional';
    return a.map((x) => (x === 'Spinal' ? 'Spinal' : x === 'Peripheral nerve block' ? 'Block' : x)).join(' + ');
  }

  // ---------------------------------------------------------------- speciality suggestion (a suggestion only)
  const SPEC_RULES = [
    ['Thyroid', /thyroid|parathyroid|hemithyroid/],
    ['Head & neck oncology', /laryngectomy|neck dissection|glossectomy|mandibulectomy|maxillectomy|parotidectomy|oral cancer|commando|pharyngectomy|head and neck|\bmrnd\b|\bwle\b.*(oral|tongue|buccal)|hemiglossectomy|free flap|pmmc flap/],
    ['Cardiac & thoracic', /cabg|valve|thoracotomy|\bvats\b|lobectomy|pneumonectomy|pericard|cardiac|decortication|thoracoscop|mediastin|pacemaker|oesophagectomy|esophagectomy|\bpda\b|\basd\b|\bvsd\b/],
    ['Neurosurgery', /craniotomy|craniectomy|\bvp shunt|\bshunt\b|burr hole|laminectomy|discectomy|brain|aneurysm|clipping|\bevd\b|subdural|\bsdh\b|pituitary|transsphenoidal|spinal cord|\bdbs\b/],
    ['Urology', /\bturp\b|\bturbt\b|\bpcnl\b|\brirs\b|ureteroscop|cystoscop|nephrectomy|prostat|urethroplasty|orchi?dectomy|hydrocele|circumcision|dj stent|lithotripsy|bladder|\brenal\b|ureter|pyeloplasty|varicocele|urethrotomy|\bviu\b/],
    ['Obstetrics & gynaecology', /caesarean|cesarean|\blscs\b|hysterectomy|myomectomy|ovarian|d ?& ?c\b|hysteroscopy|ectopic|obstetric|cerclage|salpingo|oophorectomy|prolapse|\btvt\b|evacuation|\bmtp\b|labou?r|gynae|tubal|fibroid|\bvh\b|\btah\b|\bnd?vh\b/],
    ['Dental & maxillofacial', /dental|tooth|teeth|molar|extraction|maxillofacial|mandible|mandibular|\bjaw\b|\bcleft\b|\btmj\b|genioplasty|orthognath|maxilla|zygoma|facial fracture|alveol/],
    ['ENT', /tonsil|adenoid|septoplasty|\bfess\b|sinus|tympano|mastoid|grommet|myringo|rhinoplasty|turbinate|microlaryngeal|\bdl ?scopy|tracheost|\bear\b|nasal|polyp|stapedectomy|cochlear|laryngoscopy|\bent\b|\bdns\b/],
    ['Orthopaedics', /fracture|arthroplasty|\btkr\b|\bthr\b|\bacl\b|nailing|\bdhs\b|\bcrif\b|\borif\b|spine|fixation|arthroscop|\bknee\b|\bhip\b|shoulder|femur|tibia|humerus|radius|ulna|ankle|amputation|hemiarthroplasty|tendon|carpal|\bplating\b|\bslap\b|rotator|\bpfn\b|bipolar/],
    ['General surgery', /cholecystectomy|hernia|appendic|laparotomy|mastectomy|haemorrhoid|hemorrhoid|fistula|fissure|colectomy|gastrectomy|whipple|bariatric|sleeve|splenectomy|abscess|debridement|\blap\b|excision|biopsy|stoma|resection|pilonidal|varicose|skin graft|wound|\bcyst\b|\bi ?& ?d\b|hepatectomy|\bpancrea|bowel|anastomosis|adhesiolysis|\bmwle\b|\bbcs\b|lipoma/],
  ];
  function suggestSpeciality(surgery) {
    const s = String(surgery || '').toLowerCase().trim();
    if (!s) return '';
    for (const [name, re] of SPEC_RULES) if (re.test(s)) return name;
    return '';
  }
  /** Surgical speciality of a case: what the user chose, else a suggestion made from the surgery name (flagged auto). */
  function specialityOf(c) {
    if (c.speciality) return { value: c.speciality, auto: false };
    const s = suggestSpeciality(c.surgery);
    return s ? { value: s, auto: true } : { value: '', auto: false };
  }
  /** Portfolio categories a case counts in. Age groups are IN ADDITION to the surgical speciality, so categories can overlap. */
  function categoriesOf(c, opts = {}) {
    const paedMax = opts.paedAgeMax ?? 16, gerMin = opts.geriatricAgeMin ?? 65;
    const out = [];
    const sp = specialityOf(c).value;
    out.push(sp && SPECIALITIES.includes(sp) ? sp : 'Other');
    const age = Number(c.age);
    if (c.age !== '' && c.age != null && Number.isFinite(age)) { if (age < paedMax) out.push('Paediatric'); if (age >= gerMin) out.push('Geriatric'); }
    return uniq(out);
  }

  // ---------------------------------------------------------------- derived helpers
  const arr = (x) => (Array.isArray(x) ? x : x ? [x] : []);
  function techniquesOf(c) { return arr(c.techniques).length ? arr(c.techniques) : techniquesFromMode(c.anaesthesia_mode); }
  function complicationsOf(c) {
    const out = [];
    const a = c.airway || {}, i = c.intraop || {}, p = c.postop || {};
    for (const x of arr(a.complications)) out.push(`Airway: ${x}`);
    if (a.difficult) out.push('Airway: Difficult airway');
    for (const x of arr(i.complications)) out.push(`Intra-op: ${x}`);
    for (const x of arr(p.complications)) out.push(`Post-op: ${x}`);
    return uniq(out);
  }
  /** Neutral intra-operative events (e.g. hypotension): reported separately from complications. */
  const eventsOf = (c) => arr((c.intraop || {}).events);
  const isHighDependency = (c) => ['HDU', 'ICU'].includes((c.postop || {}).destination);
  function minutesBetween(a, b) {
    if (!/^\d{1,2}:\d{2}$/.test(a || '') || !/^\d{1,2}:\d{2}$/.test(b || '')) return null;
    const m = (t) => { const [h, mm] = t.split(':').map(Number); return h * 60 + mm; };
    let d = m(b) - m(a); if (d < 0) d += 24 * 60; // crosses midnight
    return d;
  }
  /** Does the record carry any detailed documentation (beyond quick entry)? */
  function hasDetail(c) {
    const nonEmpty = (o) => Object.values(o || {}).some((v) => (Array.isArray(v) ? v.length : v !== '' && v != null && v !== false));
    return nonEmpty(c.airway) || nonEmpty(c.intraop) || nonEmpty(c.postop) || arr(c.comorbidities).length > 0 || arr(c.risk_factors).length > 0;
  }

  // ---------------------------------------------------------------- upgraders (idempotent, in place, never destructive)
  function upgradeCase(c) {
    if (!c || typeof c !== 'object') return c;
    c.techniques = arr(c.techniques).length ? arr(c.techniques) : techniquesFromMode(c.anaesthesia_mode);
    if (c.urgency == null) c.urgency = '';
    if (c.asa == null) c.asa = '';
    if (c.speciality == null) c.speciality = '';
    if (c.complexity == null) c.complexity = '';
    c.comorbidities = arr(c.comorbidities); c.risk_factors = arr(c.risk_factors);
    c.airway = c.airway && typeof c.airway === 'object' ? c.airway : {};
    c.intraop = c.intraop && typeof c.intraop === 'object' ? c.intraop : {};
    c.postop = c.postop && typeof c.postop === 'object' ? c.postop : {};
    if (!c.created_at) c.created_at = c.updated_at || new Date(0).toISOString();
    if (!c.case_date) c.case_date = (c.created_at || '').slice(0, 10);
    if (!c.schema_version) c.schema_version = 7; // legacy record; becomes 8 only when the user saves it
    return c;
  }
  const PREOP_DEFAULTS = {
    cvs_symptoms: [], cvs_notes: '', ecg: '', echo: '',
    resp_symptoms: [], resp_notes: '', cxr: '', pft: '',
    ulbt: '', airway_notes: '',
    neuro: [], neuro_notes: '',
    renal: [], renal_notes: '', creat: '', urea: '', na: '', k: '',
    endocrine: [], endocrine_notes: '', hba1c: '',
    functional: '', functional_note: '',
    plt: '', inr: '', inv_other: '',
    med_review: '', antithrombotic: [], antithrombotic_last: '', antithrombotic_note: '',
    prev_anaes: [], prev_anaes_notes: '',
    npo_solids: '', npo_clear: '',
    plan_techniques: [], plan_airway: '', plan_postop: '', plan_notes: '',
    consent: '', consent_notes: '',
    optimisation: [], optimisation_notes: '',
    photos: [], deleted_at: null,
  };
  function upgradePreop(p) {
    if (!p || typeof p !== 'object') return p;
    for (const [k, v] of Object.entries(PREOP_DEFAULTS)) if (p[k] == null) p[k] = Array.isArray(v) ? [] : v;
    for (const k of ['conditions', 'medications', 'allergies', 'difficulties']) p[k] = arr(p[k]);
    if (p.meds_other == null) p.meds_other = ''; if (p.allergy_other == null) p.allergy_other = '';
    return p;
  }
  function upgradeProcedure(p) {
    if (!p || typeof p !== 'object') return p;
    p.complications = arr(p.complications); if (p.deleted_at == null) p.deleted_at = null;
    if (p.success == null) p.success = true;
    if (p.attempts == null || p.attempts === '') p.attempts = 1;
    return p;
  }
  function newProcedure(defaults = {}) {
    const now = new Date().toISOString();
    return upgradeProcedure({ proc_id: '', date: '', procedure: '', site: '', case_id: '', case_ref: '', role: PROC_ROLES[0], operator: '', assistant: '', supervisor: '', success: true, attempts: 1, us_guided: false, complications: [], complication_notes: '', notes: '', hospital: '', schema_version: VERSION, created_at: now, updated_at: now, deleted_at: null, ...defaults });
  }

  /** Light structural validation used by the integrity check. Returns a list of problems (empty = fine). */
  function validate(kind, r) {
    const bad = [];
    if (!r || typeof r !== 'object') return ['not an object'];
    if (kind === 'case') {
      if (!r.case_id) bad.push('missing case_id');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(r.case_date || '')) bad.push('bad case_date');
    } else if (kind === 'preop') {
      if (!r.preop_id) bad.push('missing preop_id');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date || '')) bad.push('bad date');
    } else if (kind === 'procedure') {
      if (!r.proc_id) bad.push('missing proc_id');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date || '')) bad.push('bad date');
    } else if (kind === 'duty') {
      if (!r.duty_id) bad.push('missing duty_id');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date || '')) bad.push('bad date');
    }
    return bad;
  }

  return {
    VERSION, APP_VERSION, SPECIALITIES, AGE_GROUPS, PORTFOLIO_CATEGORIES, TECHNIQUES, URGENCY, ASA, COMPLEXITY, RISK_FACTORS, AIRWAY, INTRAOP, POSTOP,
    PROCEDURES, PROC_ROLES, PROC_COMPLICATIONS, TEMPLATE_TYPES, PREOP_DEFAULTS,
    techniquesFromMode, modeFromTechniques, suggestSpeciality, specialityOf, categoriesOf, techniquesOf, complicationsOf, eventsOf, isHighDependency, minutesBetween, hasDetail,
    upgradeCase, upgradePreop, upgradeProcedure, newProcedure, validate,
  };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Schema;
if (typeof window !== 'undefined') window.Schema = Schema;
