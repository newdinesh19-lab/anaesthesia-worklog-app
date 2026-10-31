/**
 * ui-preop.js — V8 expanded pre-operative assessment: system-by-system fields, functional capacity,
 * investigations, antithrombotic history, previous anaesthesia, plan, consent, optimisation, multiple photos.
 *
 * The app only RECORDS what the clinician enters. It never calculates fitness, risk scores or decisions.
 */
(window.V8Ext = window.V8Ext || []).push((ctx) => {
  const { state, h, ic, toast, openSheet, confirmSheet, chipGroup, toggleChips } = ctx;
  const S = Schema;

  const L = {
    cvs: ['Chest pain / angina', 'Dyspnoea on exertion', 'Orthopnoea / PND', 'Palpitations', 'Syncope / presyncope', 'Ankle oedema', 'Claudication', 'No cardiac symptoms'],
    resp: ['Cough', 'Wheeze', 'Dyspnoea at rest', 'Productive sputum', 'Recent URTI (< 4 weeks)', 'Current smoker', 'Ex-smoker', 'Home oxygen', 'Snoring / OSA symptoms', 'No respiratory symptoms'],
    ulbt: ['Class I', 'Class II', 'Class III'],
    neuro: ['Alert & oriented', 'Seizure disorder', 'Previous stroke / TIA', 'Focal weakness', 'Neuropathy', 'Raised ICP symptoms', 'Cognitive impairment', 'Neuromuscular disease', 'Spinal / limb deformity', 'No neurological issues'],
    renal: ['Normal renal function', 'CKD (not on dialysis)', 'On dialysis', 'AKI / rising creatinine', 'Oliguria', 'Electrolyte abnormality', 'Renal transplant'],
    endo: ['Diabetes – diet / oral agents', 'Diabetes – on insulin', 'Poor glycaemic control', 'Hypothyroid', 'Hyperthyroid', 'Long-term steroids', 'Adrenal insufficiency', 'Obesity', 'Pregnancy'],
    functional: ['< 4 METs', '4–7 METs', '> 7 METs', 'Unable to assess'],
    antithrombotic: ['None', 'Aspirin', 'Clopidogrel', 'Prasugrel / ticagrelor', 'Warfarin', 'DOAC (rivaroxaban / apixaban / dabigatran)', 'LMWH', 'Unfractionated heparin'],
    prev: ['None / not known', 'Uneventful GA', 'Uneventful regional', 'PONV', 'Difficult airway / intubation', 'Malignant hyperthermia (patient)', 'Family history of anaesthetic problem', 'Awareness', 'Prolonged paralysis', 'Other problem'],
    consent: ['Not yet obtained', 'Informed consent obtained', 'High-risk consent obtained', 'Surrogate consent (patient unable)', 'Refused / deferred'],
    optimisation: ['Anaemia correction', 'Glycaemic control', 'BP control', 'Cardiology opinion', 'Physician opinion', 'Pulmonology opinion', 'Hold / bridge anticoagulant', 'Echo / further tests', 'Blood arrangement', 'ICU / HDU bed booking', 'Nutrition', 'Other'],
  };
  const join = (a, sep = ' · ') => a.filter(Boolean).join(sep);
  const area = (label, get, set, ph, rows = 2) => { const t = h('textarea', { class: 'input', rows: String(rows), placeholder: ph || '', oninput: (e) => set(e.target.value) }); t.value = get() || ''; return h('div', { class: 'field' }, [h('label', {}, label), t]); };
  const text = (label, get, set, o = {}) => h('div', { class: 'field' }, [h('label', {}, label), h('input', { class: 'input', type: 'text', inputmode: o.inputmode, placeholder: o.placeholder, value: get() ?? '', oninput: (e) => set(e.target.value) })]);
  const many = (label, options, get, set, extra) => h('div', { class: 'field' }, [label ? h('label', {}, label) : null, toggleChips(options, get, set, extra || '')]);

  function acc(title, summary, build, open) {
    const d = h('details', { class: 'acc', ...(open ? { open: true } : {}) });
    const sm = h('small', {}, summary());
    d.appendChild(h('summary', {}, [h('span', {}, title), sm]));
    const body = h('div', { class: 'acc-body' }); d.appendChild(body);
    let built = false; const fill = () => { if (!built) { built = true; body.appendChild(build()); } };
    if (open) fill(); d.addEventListener('toggle', () => { if (d.open) fill(); });
    d.addEventListener('click', () => setTimeout(() => { sm.textContent = summary(); }, 0), true);
    return d;
  }
  const has = (...v) => v.some((x) => (Array.isArray(x) ? x.length : x));

  // ------------------------------------------------------------------ the new form sections
  function systems(p) {
    const wrap = h('div');
    wrap.append(
      acc('Cardiovascular', () => join([p.cvs_symptoms.length && `${p.cvs_symptoms.length} noted`, p.ecg && 'ECG', p.echo && 'Echo']) || 'Optional', () => h('div', {}, [
        many('Symptoms', L.cvs, () => p.cvs_symptoms, (v) => (p.cvs_symptoms = v)),
        text('ECG', () => p.ecg, (v) => (p.ecg = v), { placeholder: 'Rhythm, rate, ST/T changes, conduction' }),
        text('Echo / EF', () => p.echo, (v) => (p.echo = v), { placeholder: 'e.g. EF 55%, mild MR' }),
        area('Cardiac notes (exam, stents, pacemaker, stress test)', () => p.cvs_notes, (v) => (p.cvs_notes = v)),
      ]), has(p.cvs_symptoms, p.cvs_notes, p.ecg, p.echo)),
      acc('Respiratory', () => join([p.resp_symptoms.length && `${p.resp_symptoms.length} noted`, p.cxr && 'CXR', p.pft && 'PFT']) || 'Optional', () => h('div', {}, [
        many('Symptoms / history', L.resp, () => p.resp_symptoms, (v) => (p.resp_symptoms = v)),
        text('Chest X-ray', () => p.cxr, (v) => (p.cxr = v)), text('PFT / ABG / peak flow', () => p.pft, (v) => (p.pft = v)),
        area('Respiratory notes (exam, inhaler use, exacerbations)', () => p.resp_notes, (v) => (p.resp_notes = v)),
      ]), has(p.resp_symptoms, p.resp_notes, p.cxr, p.pft)),
      acc('Neurological', () => (p.neuro.length ? `${p.neuro.length} noted` : 'Optional'), () => h('div', {}, [
        many('Findings', L.neuro, () => p.neuro, (v) => (p.neuro = v)), area('Neurological notes', () => p.neuro_notes, (v) => (p.neuro_notes = v)),
      ]), has(p.neuro, p.neuro_notes)),
      acc('Renal', () => join([p.renal.length && `${p.renal.length} noted`, p.creat && `Cr ${p.creat}`]) || 'Optional', () => h('div', {}, [
        many('Findings', L.renal, () => p.renal, (v) => (p.renal = v)), area('Renal notes', () => p.renal_notes, (v) => (p.renal_notes = v)),
      ]), has(p.renal, p.renal_notes)),
      acc('Endocrine', () => join([p.endocrine.length && `${p.endocrine.length} noted`, p.hba1c && `HbA1c ${p.hba1c}`]) || 'Optional', () => h('div', {}, [
        many('Findings', L.endo, () => p.endocrine, (v) => (p.endocrine = v)),
        text('HbA1c (%)', () => p.hba1c, (v) => (p.hba1c = v), { inputmode: 'decimal' }), area('Endocrine notes', () => p.endocrine_notes, (v) => (p.endocrine_notes = v)),
      ]), has(p.endocrine, p.endocrine_notes, p.hba1c)),
    );
    return wrap;
  }

  const functionalCard = (p) => h('div', { class: 'card' }, [h('h3', {}, 'Functional capacity'),
    h('div', { class: 'field' }, [h('label', {}, 'Your estimate'), chipGroup(L.functional, () => p.functional, (v) => (p.functional = v))]),
    text('How you judged it', () => p.functional_note, (v) => (p.functional_note = v), { placeholder: 'e.g. climbs 2 flights without stopping' })]);

  const airwayExtras = (p) => h('div', {}, [
    h('div', { class: 'field' }, [h('label', {}, 'Upper-lip bite test'), chipGroup(L.ulbt, () => p.ulbt, (v) => (p.ulbt = v))]),
    area('Airway notes', () => p.airway_notes, (v) => (p.airway_notes = v), 'Beard, neck circumference, previous airway surgery, mouth opening in cm'),
  ]);

  const investigationsCard = (p) => {
    const f = (label, key, o = {}) => text(label, () => p[key], (v) => (p[key] = v), o);
    return h('div', { class: 'card' }, [h('h3', {}, 'More investigations'),
      h('div', { class: 'grid2' }, [f('Platelets (×10³/µL)', 'plt', { inputmode: 'decimal' }), f('INR', 'inr', { inputmode: 'decimal' })]),
      h('div', { class: 'grid2' }, [f('Creatinine (mg/dL)', 'creat', { inputmode: 'decimal' }), f('Urea (mg/dL)', 'urea', { inputmode: 'decimal' })]),
      h('div', { class: 'grid2' }, [f('Sodium (mmol/L)', 'na', { inputmode: 'decimal' }), f('Potassium (mmol/L)', 'k', { inputmode: 'decimal' })]),
      area('Other results', () => p.inv_other, (v) => (p.inv_other = v), 'LFT, coag profile, ABG, CT/MRI findings, blood group'),
    ]);
  };

  const medReviewCard = (p) => h('div', { class: 'card' }, [h('h3', {}, 'Medication review'),
    area('What to continue / hold (your decision)', () => p.med_review, (v) => (p.med_review = v), 'e.g. Hold metformin on the day; continue beta-blocker and statin; stop clopidogrel 5 days before after cardiology advice', 3),
    h('div', { class: 'note' }, 'Medicine prompts above are reminders only. Follow your hospital protocol and the surgeon / physician advice.')]);

  const antithromboticCard = (p) => h('div', { class: 'card' }, [h('h3', {}, 'Anticoagulant & antiplatelet history'),
    many('', L.antithrombotic, () => p.antithrombotic, (v) => (p.antithrombotic = v), 'star'),
    text('Last dose / when stopped', () => p.antithrombotic_last, (v) => (p.antithrombotic_last = v), { placeholder: 'e.g. Clopidogrel last taken 14 Mar' }),
    text('Indication', () => p.antithrombotic_note, (v) => (p.antithrombotic_note = v), { placeholder: 'e.g. DES to LAD 2 years ago; AF' }),
    h('div', { class: 'note' }, 'Matters for neuraxial and deep nerve blocks as well as bleeding risk. Timing decisions are yours.')]);

  const prevAnaesCard = (p) => h('div', { class: 'card' }, [h('h3', {}, 'Previous anaesthesia'),
    many('', L.prev, () => p.prev_anaes, (v) => (p.prev_anaes = v)), area('Details', () => p.prev_anaes_notes, (v) => (p.prev_anaes_notes = v), 'Which surgery, when, what happened')]);

  const fastingExtras = (p) => h('div', { class: 'grid2' }, [text('Solids – hours since last meal', () => p.npo_solids, (v) => (p.npo_solids = v), { inputmode: 'decimal' }), text('Clear fluids – hours', () => p.npo_clear, (v) => (p.npo_clear = v), { inputmode: 'decimal' })]);

  const planCard = (p) => h('div', { class: 'card' }, [h('h3', {}, 'Anaesthesia plan'),
    many('Planned technique', S.TECHNIQUES, () => p.plan_techniques, (v) => (p.plan_techniques = v)),
    text('Airway plan', () => p.plan_airway, (v) => (p.plan_airway = v), { placeholder: 'A: … B: … C: …' }),
    h('div', { class: 'field' }, [h('label', {}, 'Planned post-op destination'), chipGroup(S.POSTOP.destination, () => p.plan_postop, (v) => (p.plan_postop = v))]),
    area('Plan notes', () => p.plan_notes, (v) => (p.plan_notes = v), 'Analgesia, monitoring, drugs to avoid, special equipment', 3)]);

  const consentCard = (p) => h('div', { class: 'card' }, [h('h3', {}, 'Consent'),
    h('div', { class: 'field' }, [chipGroup(L.consent, () => p.consent, (v) => (p.consent = v))]), text('Consent notes', () => p.consent_notes, (v) => (p.consent_notes = v), { placeholder: 'Language, who was present, risks discussed' })]);

  const optimisationCard = (p) => h('div', { class: 'card' }, [h('h3', {}, 'Optimisation requirements'),
    many('', L.optimisation, () => p.optimisation, (v) => (p.optimisation = v), 'star'), area('Details', () => p.optimisation_notes, (v) => (p.optimisation_notes = v), 'What is needed before surgery, and from whom')]);

  const disclaimer = () => h('div', { class: 'hint-box', style: 'margin-bottom:14px' }, [h('b', {}, 'Your assessment, your decision'), 'This form records what you enter. The app does not determine fitness, calculate risk or recommend any clinical action.']);

  // ------------------------------------------------------------------ photos (several per assessment)
  const keysOf = (p) => [...new Set([p.preop_id, ...(p.photos || [])])];
  function clearPending() { for (const im of state.preopImages || []) if (im.url) URL.revokeObjectURL(im.url); state.preopImages = []; }

  function photoCard(p, editing) {
    const strip = h('div', { class: 'photo-strip' });
    const paint = () => {
      strip.innerHTML = '';
      (state.preopImages || []).forEach((im, i) => strip.appendChild(h('div', { class: 'ph' }, [h('img', { src: im.url, alt: `New photo ${i + 1}`, onclick: () => openSheet('Photo', h('img', { src: im.url })) }), h('button', { class: 'x', 'aria-label': 'Remove photo', onclick: () => { URL.revokeObjectURL(im.url); state.preopImages.splice(i, 1); paint(); } }, '✕')])));
    };
    async function onPhoto(e) {
      const files = [...e.target.files]; if (!files.length) return;
      for (const file of files) {
        const { store } = await ctx.prepareImages(file);
        state.preopImages.push({ arrayBuffer: await store.arrayBuffer(), mimeType: store.type || 'image/jpeg', url: URL.createObjectURL(store) });
      }
      e.target.value = ''; paint();
    }
    paint();
    return h('div', { class: 'card' }, [h('h3', {}, 'Chart photos (optional)'),
      editing ? h('button', { class: 'btn btn-block', id: 'viewSaved', style: 'margin-bottom:10px', onclick: () => viewPhotos(p) }, [ic('eye'), 'View saved photos']) : null,
      strip,
      h('div', { class: 'cap-btns' }, [
        h('label', { class: 'btn btn-primary' }, [ic('camera'), 'Take photo', h('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'hidden-file', id: 'preopCam', onchange: onPhoto })]),
        h('label', { class: 'btn' }, [ic('image'), 'Upload photo(s)', h('input', { type: 'file', accept: 'image/*', multiple: true, class: 'hidden-file', id: 'preopUp', onchange: onPhoto })]),
      ]),
      h('button', { class: 'btn btn-soft btn-block', id: 'manualPreop', onclick: () => { const t = document.querySelector('#preopPatient'); t && t.scrollIntoView({ behavior: 'smooth', block: 'start' }); const i = t && t.querySelector('input'); i && setTimeout(() => i.focus(), 350); } }, [ic('edit'), 'No photo? Enter details manually']),
      h('div', { class: 'note' }, 'Photos are optional and stored encrypted on this device with the assessment. Several pages can be added.')]);
  }

  /** Turn the pending photos into image records and record the keys on the assessment. Existing photos are never touched. */
  async function collectImages(p) {
    const out = [];
    const existing = new Set(await (async () => { const ks = []; for (const k of keysOf(p)) if (await DB.get('images', k)) ks.push(k); return ks; })());
    for (const im of state.preopImages || []) {
      let key = !existing.has(p.preop_id) ? p.preop_id : `${p.preop_id}:${ctx.uid().slice(0, 8)}`;
      existing.add(key); out.push({ key, arrayBuffer: im.arrayBuffer, mimeType: im.mimeType });
    }
    p.photos = [...existing];
    return out;
  }

  async function viewPhotos(p) {
    const urls = []; const box = h('div');
    for (const k of keysOf(p)) {
      const rec = await DB.get('images', k); if (!rec) continue;
      const url = URL.createObjectURL(new Blob([await CryptoModule.decryptBinary(state.key, { iv: rec.iv, data: rec.data })], { type: rec.mimeType })); urls.push(url);
      box.appendChild(h('div', { class: 'ph-full' }, [h('img', { src: url, alt: 'Chart photo' }), k === p.preop_id && keysOf(p).length === 1 ? null : null,
        h('button', { class: 'btn btn-sm btn-danger', onclick: () => confirmSheet({ title: 'Remove this photo?', text: 'The photo is deleted from this device. The assessment stays.', okLabel: 'Remove photo', danger: true, onOk: async () => { await DB.del('images', k); p.photos = (p.photos || []).filter((x) => x !== k); await ctx.putPreopRec(p); toast('Photo removed'); ctx.render(); } }) }, [ic('trash'), 'Remove this photo'])]));
    }
    if (!urls.length) return toast('No photo stored for this assessment');
    openSheet('Chart photos', box);
    setTimeout(() => urls.forEach((u) => URL.revokeObjectURL(u)), 180000);
  }

  // ------------------------------------------------------------------ read-only rows for the assessment card
  function preopExtraRows(p) {
    const rows = []; const add = (k, v) => { if (v && String(v).trim()) rows.push([k, v]); };
    add('Cardiovascular', join([(p.cvs_symptoms || []).join(', '), p.ecg && `ECG: ${p.ecg}`, p.echo && `Echo: ${p.echo}`, p.cvs_notes], ' — '));
    add('Respiratory', join([(p.resp_symptoms || []).join(', '), p.cxr && `CXR: ${p.cxr}`, p.pft && `PFT: ${p.pft}`, p.resp_notes], ' — '));
    add('Airway extras', join([p.ulbt && `ULBT ${p.ulbt}`, p.airway_notes]));
    add('Neurological', join([(p.neuro || []).join(', '), p.neuro_notes], ' — '));
    add('Renal', join([(p.renal || []).join(', '), p.renal_notes], ' — '));
    add('Endocrine', join([(p.endocrine || []).join(', '), p.hba1c && `HbA1c ${p.hba1c}%`, p.endocrine_notes], ' — '));
    add('Functional capacity', join([p.functional, p.functional_note], ' — '));
    add('Investigations', join([p.plt && `Plt ${p.plt}`, p.inr && `INR ${p.inr}`, p.creat && `Cr ${p.creat}`, p.urea && `Urea ${p.urea}`, p.na && `Na ${p.na}`, p.k && `K ${p.k}`, p.inv_other]));
    add('Medication review', p.med_review);
    add('Antithrombotics', join([(p.antithrombotic || []).join(', '), p.antithrombotic_last && `last: ${p.antithrombotic_last}`, p.antithrombotic_note], ' — '));
    add('Previous anaesthesia', join([(p.prev_anaes || []).join(', '), p.prev_anaes_notes], ' — '));
    add('Fasting', join([p.fasting, p.npo_solids && `solids ${p.npo_solids} h`, p.npo_clear && `clear ${p.npo_clear} h`]));
    add('Plan', join([(p.plan_techniques || []).join(' + '), p.plan_airway && `Airway: ${p.plan_airway}`, p.plan_postop && `→ ${p.plan_postop}`, p.plan_notes], ' — '));
    add('Consent', join([p.consent, p.consent_notes], ' — '));
    add('Optimisation', join([(p.optimisation || []).join(', '), p.optimisation_notes], ' — '));
    return rows;
  }
  const searchText = (p) => [p.ulbt, p.cvs_notes, p.resp_notes, p.neuro_notes, p.renal_notes, p.endocrine_notes, p.med_review, p.prev_anaes_notes, p.plan_notes, p.consent, p.consent_notes, p.optimisation_notes, p.ecg, p.echo, ...(p.cvs_symptoms || []), ...(p.resp_symptoms || []), ...(p.neuro || []), ...(p.renal || []), ...(p.endocrine || []), ...(p.antithrombotic || []), ...(p.prev_anaes || []), ...(p.plan_techniques || []), ...(p.optimisation || [])].join(' ');

  return { api: { preopSystems: systems, preopFunctional: functionalCard, preopAirwayExtras: airwayExtras, preopInvestigations: investigationsCard, preopMedReview: medReviewCard, preopAntithrombotic: antithromboticCard, preopPrevAnaes: prevAnaesCard, preopFasting: fastingExtras, preopPlan: planCard, preopConsent: consentCard, preopOptimisation: optimisationCard, preopDisclaimer: disclaimer, preopPhotoCard: photoCard, collectPreopImages: collectImages, viewPreopPhotos: viewPhotos, clearPreopPending: clearPending, preopExtraRows, preopSearchText: searchText } };
});
