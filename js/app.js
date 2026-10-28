/**
 * app.js — UI controller for the Anaesthesia Case Log.
 * Vanilla JS, no build step. Patient data lives only in IndexedDB
 * (AES-GCM encrypted) and, while unlocked, in memory in `state.cases`.
 */
const App = (() => {
  // ------------------------------------------------------------------
  // constants & state
  // ------------------------------------------------------------------
  const ANAESTHESIA_MODES = ['GA', 'SA (Spinal)', 'Epidural', 'CSE', 'Regional Block', 'Sedation / MAC', 'Local + Standby', 'GA + Regional', 'Other'];
  const TONES = ['a0', 'a1', 'a2'];
  const TONE_VAR = { a0: 'var(--a0)', a1: 'var(--a1)', a2: 'var(--a2)' };

  const state = {
    key: null,
    settings: null,
    cases: [], // includes soft-deleted
    route: 'home',
    param: null,
    casesView: 'list',
    filters: { month: '', anaes: 'ALL', consultant: '', hospital: '', mode: '', q: '' },
    reportMonth: '',
    pending: null,
    pendingImage: null, // { arrayBuffer, mimeType, url }
    editingId: null,
    template: null,
    addDate: null,
    failedPins: 0,
  };

  // ------------------------------------------------------------------
  // tiny DOM helpers
  // ------------------------------------------------------------------
  const $ = (sel, root = document) => root.querySelector(sel);
  const root = () => $('#app');
  function h(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === false || v == null) continue;
      if (k === 'class') node.className = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : v);
    }
    for (const c of [].concat(children)) {
      if (c == null || c === false) continue;
      node.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return node;
  }

  const ICONS = {
    home: '<path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>',
    sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
    camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
    lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    bolt: '<path d="M13 2L3 14h9l-1 8 10-12h-9z"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>',
    filter: '<path d="M22 3H2l8 9.46V19l4 2v-8.54z"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
    edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/><circle cx="12" cy="12" r="3"/>',
    chev: '<path d="M9 18l6-6-6-6"/>',
    left: '<path d="M15 18l-6-6 6-6"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
    check: '<path d="M20 6L9 17l-5-5"/>',
    clip: '<path d="M9 3h6l1 2h3v16H5V5h3z"/><path d="M9 13l2 2 4-4"/>',
    refresh: '<path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15"/>',
    dots: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  };
  const ic = (name) => h('span', { class: 'ic', html: `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>` });

  // ------------------------------------------------------------------
  // dates (always LOCAL time — toISOString() is UTC and gave the wrong
  // day before 05:30 IST)
  // ------------------------------------------------------------------
  const pad = (n) => String(n).padStart(2, '0');
  const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const todayISO = () => isoOf(new Date());
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const parseISO = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
  const fmtDate = (iso) => { if (!iso) return ''; const [y, m, d] = iso.split('-'); return `${d} ${MON[Number(m) - 1]} ${y}`; };
  const fmtDay = (iso) => { const d = parseISO(iso); return `${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`; };
  const monthLabel = (ym) => { const [y, m] = ym.split('-'); return `${MONTHS[Number(m) - 1]} ${y}`; };
  const shiftMonth = (ym, delta) => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + delta, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
  const shiftDay = (iso, delta) => { const d = parseISO(iso); d.setDate(d.getDate() + delta); return isoOf(d); };
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'c' + Date.now() + Math.random().toString(16).slice(2));
  const shortName = (n) => (n || '').replace(/^Dr\.?\s*/i, '');
  const initials = (n) => ((n || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('') || '?').toUpperCase();
  const toneOf = (name) => { const i = (state.settings?.anaesthetists || []).indexOf(name); return TONES[i >= 0 ? i % 3 : 2]; };
  const greeting = () => { const hr = new Date().getHours(); return hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening'; };

  // ------------------------------------------------------------------
  // toast / sheet
  // ------------------------------------------------------------------
  function toast(msg, actionLabel, onAction) {
    document.querySelectorAll('.toast').forEach((t) => t.remove());
    const t = h('div', { class: 'toast' }, [msg, actionLabel ? h('button', { onclick: () => { t.remove(); onAction && onAction(); } }, actionLabel) : null]);
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add('in'));
    setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 300); }, 3800);
  }

  function openSheet(title, body) {
    const back = h('div', { class: 'sheet-back', onclick: (e) => { if (e.target === back) close(); } });
    const sheet = h('div', { class: 'sheet' }, [h('div', { class: 'grab' }), title ? h('h3', { class: 'sheet-title' }, title) : null, body]);
    back.appendChild(sheet);
    document.body.appendChild(back);
    requestAnimationFrame(() => back.classList.add('in'));
    function close() { back.classList.remove('in'); setTimeout(() => back.remove(), 220); }
    return close;
  }

  function confirmSheet({ title, text, okLabel = 'Confirm', danger = false, onOk }) {
    const close = openSheet(title, h('div', {}, [
      h('p', {}, text),
      h('div', { class: 'btn-row' }, [
        h('button', { class: 'btn', onclick: () => close() }, 'Cancel'),
        h('button', { class: 'btn ' + (danger ? 'btn-danger' : 'btn-primary'), onclick: () => { close(); onOk && onOk(); } }, okLabel),
      ]),
    ]));
  }

  // ------------------------------------------------------------------
  // persistence
  // ------------------------------------------------------------------
  const defaultSettings = () => ({
    anaesthetists: ['Dr. Me', 'Dr. Jagadeesh'],
    hospital: 'Apollo Spectra Hospital',
    location: 'MRC Nagar, Chennai',
    consultants: [],
    surgeries: [],
    lastMode: '',
    autoLockMin: 2,
  });

  async function saveSettings() {
    const packet = await CryptoModule.encryptJSON(state.key, state.settings);
    await DB.put('meta', { key: 'settings', value: packet });
  }
  async function loadSettings() {
    const rec = await DB.get('meta', 'settings');
    state.settings = { ...defaultSettings(), ...(rec ? await CryptoModule.decryptJSON(state.key, rec.value) : {}) };
  }
  async function loadAllCases() {
    const records = await DB.getAll('cases');
    const list = await Promise.all(records.map((r) => CryptoModule.decryptJSON(state.key, r.value)));
    list.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
    state.cases = list;
  }
  async function putCase(c) {
    await DB.put('cases', { case_id: c.case_id, value: await CryptoModule.encryptJSON(state.key, c) });
  }
  async function persistCase(c, image) {
    await putCase(c);
    if (image) {
      const enc = await CryptoModule.encryptBinary(state.key, image.arrayBuffer);
      await DB.put('images', { case_id: c.case_id, iv: enc.iv, data: enc.data, mimeType: image.mimeType });
    }
    let dirty = false;
    const s = state.settings;
    if (c.anaesthesia_mode && s.lastMode !== c.anaesthesia_mode) { s.lastMode = c.anaesthesia_mode; dirty = true; }
    const surg = (c.surgery || '').trim();
    if (surg && !s.surgeries.includes(surg)) { s.surgeries.push(surg); dirty = true; }
    for (const n of (c.consultant || '').split('/').map((x) => x.trim()).filter(Boolean)) {
      if (!s.consultants.includes(n)) { s.consultants.push(n); dirty = true; }
    }
    if (dirty) await saveSettings();
  }

  const activeCases = () => state.cases.filter((c) => !c.deleted_at);
  const casesForDate = (iso) => activeCases().filter((c) => c.case_date === iso).sort((a, b) => a.created_at.localeCompare(b.created_at));

  // ------------------------------------------------------------------
  // lock / unlock / setup
  // ------------------------------------------------------------------
  async function boot() {
    const salt = await DB.get('meta', 'salt');
    salt ? renderUnlock() : renderSetupPin();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('popstate', onPop);
  }

  let hiddenAt = 0;
  function onVisibility() {
    if (!state.key) return;
    if (document.hidden) { hiddenAt = Date.now(); return; }
    const min = state.settings?.autoLockMin ?? 2;
    if (min > 0 && hiddenAt && Date.now() - hiddenAt > min * 60000) lockNow();
  }

  function lockNow() {
    state.key = null; state.settings = null; state.cases = []; state.pending = null; revokeImage();
    document.querySelectorAll('.sheet-back, .toast').forEach((n) => n.remove());
    renderUnlock();
  }

  function lockScreen(title, subtitle, fields, btnLabel, onSubmit) {
    root().innerHTML = '';
    const err = h('div', { class: 'error', id: 'pinErr' });
    const btn = h('button', { class: 'btn btn-primary btn-block', onclick: () => onSubmit(err, btn) }, btnLabel);
    root().appendChild(h('div', { class: 'lock' }, [
      h('div', { class: 'logo' }, ic('clip')),
      h('h1', {}, title),
      h('p', { class: 'muted', style: 'max-width:320px;line-height:1.45' }, subtitle),
      h('div', { class: 'box' }, [...fields, err, btn]),
    ]));
    setTimeout(() => fields[0] && fields[0].focus(), 60);
  }

  function renderSetupPin() {
    const p1 = h('input', { id: 'pin1', class: 'input', type: 'password', inputmode: 'numeric', placeholder: 'New PIN', autocomplete: 'new-password' });
    const p2 = h('input', { id: 'pin2', class: 'input', type: 'password', inputmode: 'numeric', placeholder: 'Confirm PIN', autocomplete: 'new-password' });
    lockScreen('Anaesthesia Log', 'Create a PIN (4+ digits). It encrypts all case data on this device. It cannot be recovered if lost, so keep a backup file.', [p1, p2], 'Create PIN', async (err) => {
      if (p1.value.length < 4) return (err.textContent = 'PIN must be at least 4 characters.');
      if (p1.value !== p2.value) return (err.textContent = 'PINs do not match.');
      const salt = CryptoModule.newSalt();
      const key = await CryptoModule.deriveKey(p1.value, salt);
      await DB.put('meta', { key: 'salt', value: salt });
      await DB.put('meta', { key: 'verifier', value: await CryptoModule.makeVerifier(key) });
      state.key = key;
      state.settings = defaultSettings();
      await saveSettings();
      enterApp();
    });
  }

  function renderUnlock() {
    const pin = h('input', { id: 'pinIn', class: 'input', type: 'password', inputmode: 'numeric', placeholder: 'PIN', autocomplete: 'current-password', onkeydown: (e) => e.key === 'Enter' && $('.lock .btn-primary').click() });
    lockScreen('Anaesthesia Log', 'Enter your PIN to unlock.', [pin], 'Unlock', async (err, btn) => {
      if (btn.disabled) return;
      const salt = await DB.get('meta', 'salt');
      const verifier = await DB.get('meta', 'verifier');
      const key = await CryptoModule.deriveKey(pin.value, salt.value);
      if (!(await CryptoModule.checkVerifier(key, verifier.value))) {
        state.failedPins++;
        err.textContent = 'Incorrect PIN.';
        pin.value = '';
        if (state.failedPins >= 5) {
          btn.disabled = true;
          err.textContent = 'Too many attempts. Wait 30 seconds.';
          setTimeout(() => { btn.disabled = false; state.failedPins = 0; err.textContent = ''; }, 30000);
        }
        return;
      }
      state.failedPins = 0;
      state.key = key;
      await loadSettings();
      await loadAllCases();
      enterApp();
    });
  }

  function enterApp() {
    state.filters = { month: todayISO().slice(0, 7), anaes: 'ALL', consultant: '', hospital: '', mode: '', q: '' };
    state.reportMonth = todayISO().slice(0, 7);
    try { history.replaceState({ route: 'home' }, ''); } catch (e) { /* ignore */ }
    go('home', null, { replace: true });
  }

  // ------------------------------------------------------------------
  // routing (with real browser back-button support)
  // ------------------------------------------------------------------
  function go(route, param = null, opts = {}) {
    if (route !== 'add') { state.pending = null; revokeImage(); state.editingId = null; state.template = null; state.addDate = null; }
    state.route = route;
    state.param = param;
    try { opts.replace ? history.replaceState({ route, param }, '') : history.pushState({ route, param }, ''); } catch (e) { /* ignore */ }
    window.scrollTo(0, 0);
    render();
  }
  function onPop(e) {
    if (!state.key) return;
    const s = e.state;
    state.pending = null; revokeImage(); state.editingId = null;
    if (s && s.route && s.route !== 'add') { state.route = s.route; state.param = s.param; }
    else { state.route = 'home'; state.param = null; }
    render();
  }
  function revokeImage() { if (state.pendingImage?.url) URL.revokeObjectURL(state.pendingImage.url); state.pendingImage = null; }

  const SCREENS = { home: renderHome, add: renderAdd, cases: renderCases, day: renderDay, reports: renderReports, settings: renderSettings, backup: renderBackup };

  function render() {
    root().innerHTML = '';
    const screen = h('div', { class: 'screen' });
    root().appendChild(screen);
    (SCREENS[state.route] || renderHome)(screen);
    if (state.route !== 'add') root().appendChild(dock());
  }

  function dock() {
    const item = (route, icon, label) => h('button', { class: state.route === route || (route === 'cases' && state.route === 'day') || (route === 'settings' && state.route === 'backup') ? 'on' : '', onclick: () => go(route) }, [ic(icon), label]);
    return h('nav', { class: 'dock' }, [
      item('home', 'home', 'Home'),
      item('cases', 'list', 'Cases'),
      h('button', { class: 'add', onclick: () => go('add') }, [ic('plus'), 'Add']),
      item('reports', 'chart', 'Reports'),
      item('settings', 'sliders', 'Settings'),
    ]);
  }

  function pageHead(title, sub, right, back) {
    return h('div', { class: 'page-head' }, [
      back ? h('button', { class: 'icon-btn back-btn', 'aria-label': 'Back', onclick: () => (history.length > 1 ? history.back() : go(back)) }, ic('left')) : h('div', { class: 'logo' }, ic('clip')),
      h('div', { class: 'page-title' }, [h('small', {}, sub), h('h1', {}, title)]),
      right,
    ]);
  }

  // ------------------------------------------------------------------
  // shared pieces
  // ------------------------------------------------------------------
  function tile(num, label, tone, onclick) {
    return h(onclick ? 'button' : 'div', { class: `tile t-${tone}`, onclick }, [h('div', { class: 'num' }, num), h('div', { class: 'lbl' }, label)]);
  }

  function caseCard(c, sno) {
    const tone = toneOf(c.anaesthetist);
    const card = h('div', { class: 'case ' + tone });
    const sub = [c.age ? `${c.age}/${(c.sex || '?')[0]}` : '', c.surgery, c.anaesthesia_mode].filter(Boolean).join(' · ') || '—';
    card.appendChild(h('button', { class: 'case-head', onclick: () => card.classList.toggle('open') }, [
      h('span', { class: 'avatar' }, sno ? String(sno) : initials(c.patient_name)),
      h('span', { class: 'case-main' }, [h('b', {}, c.patient_name || '(no name)'), h('small', {}, sub)]),
      h('span', { class: 'tag' }, shortName(c.anaesthetist)),
      ic('chev'),
    ]));
    const kv = (k, v) => h('div', { class: 'kv' }, [h('span', {}, k), h('span', {}, v || '—')]);
    card.appendChild(h('div', { class: 'case-body' }, [
      kv('Date', fmtDate(c.case_date)), kv('UHID', c.uhid), kv('Visit No', c.visit_number), kv('Consultant', c.consultant),
      kv('Surgery', c.surgery), kv('Mode', c.anaesthesia_mode), kv('Hospital', [c.hospital, c.location].filter(Boolean).join(', ')),
      kv('Anaesthetist', c.anaesthetist + (c.is_override ? ' (manual)' : '')),
      h('div', { class: 'case-actions' }, [
        h('button', { class: 'btn btn-sm', onclick: () => openEdit(c.case_id) }, [ic('edit'), 'Edit']),
        h('button', { class: 'btn btn-sm', onclick: () => viewImage(c.case_id) }, [ic('eye'), 'Photo']),
        h('button', { class: 'btn btn-sm btn-danger', onclick: () => confirmDelete(c.case_id) }, [ic('trash'), 'Delete']),
      ]),
    ]));
    return card;
  }

  function dotsFor(dayCases) {
    const wrap = h('div', { class: 'dots' });
    state.settings.anaesthetists.forEach((n) => { if (dayCases.some((c) => c.anaesthetist === n)) wrap.appendChild(h('i', { style: `background:${TONE_VAR[toneOf(n)]}` })); });
    return wrap;
  }

  // ------------------------------------------------------------------
  // HOME
  // ------------------------------------------------------------------
  function recentTemplates(limit = 3) {
    const counts = new Map();
    const sorted = [...activeCases()].sort((a, b) => b.created_at.localeCompare(a.created_at));
    for (const c of sorted) {
      if (!c.surgery && !c.anaesthesia_mode) continue;
      const k = (c.surgery || '') + '|' + (c.anaesthesia_mode || '');
      if (!counts.has(k)) counts.set(k, { surgery: c.surgery || '', mode: c.anaesthesia_mode || '', uses: 0 });
      counts.get(k).uses++;
    }
    return [...counts.values()].slice(0, limit);
  }

  function theatreSVG() {
    return `<svg viewBox="0 0 360 170" role="img" aria-label="Operating theatre illustration">
      <rect width="360" height="170" fill="var(--mint)"/>
      <rect y="118" width="360" height="52" fill="var(--line)" opacity=".55"/>
      <rect y="112" width="360" height="8" fill="var(--brand-2)" opacity=".45"/>
      <g class="lamp"><circle cx="150" cy="22" r="15" fill="#ffd96b"/><circle cx="150" cy="22" r="8" fill="#fff4c4"/><circle cx="196" cy="22" r="15" fill="#ffd96b"/><circle cx="196" cy="22" r="8" fill="#fff4c4"/></g>
      <path d="M120 0v8h110V0" stroke="var(--muted)" stroke-width="3" fill="none"/>
      <rect x="130" y="80" width="110" height="14" rx="6" fill="var(--card)" stroke="var(--muted)" stroke-width="2"/>
      <rect x="180" y="94" width="10" height="26" fill="var(--muted)"/><rect x="164" y="118" width="42" height="6" rx="3" fill="var(--muted)"/>
      <ellipse cx="170" cy="74" rx="34" ry="8" fill="#9fd9c0"/><circle cx="142" cy="70" r="7" fill="#f2c9a5"/>
      <rect x="40" y="52" width="58" height="48" rx="6" fill="var(--card)" stroke="var(--muted)" stroke-width="2"/>
      <rect x="47" y="59" width="44" height="26" rx="3" fill="#10231d"/>
      <polyline class="ecg" points="49,74 58,74 62,64 67,84 72,70 76,74 89,74" fill="none" stroke="#58e0a8" stroke-width="2"/>
      <rect x="50" y="100" width="40" height="22" fill="var(--muted)" opacity=".5"/>
      <rect x="262" y="60" width="52" height="60" rx="6" fill="var(--card)" stroke="var(--muted)" stroke-width="2"/>
      <rect x="270" y="70" width="36" height="8" rx="3" fill="var(--brand-2)"/><rect x="270" y="84" width="36" height="8" rx="3" fill="var(--sky-ink)" opacity=".6"/><rect x="270" y="98" width="36" height="8" rx="3" fill="#e9a23b"/>
      <g><circle cx="116" cy="82" r="8" fill="#f2c9a5"/><rect x="106" y="90" width="20" height="30" rx="8" fill="#3f9a78"/></g>
      <g><circle cx="226" cy="82" r="8" fill="#f2c9a5"/><rect x="216" y="90" width="20" height="30" rx="8" fill="#2a6fb5"/></g>
    </svg>`;
  }

  function renderHome(screen) {
    const s = state.settings;
    const roster = s.anaesthetists;
    const today = todayISO();
    const ym = today.slice(0, 7);
    const all = activeCases();
    const monthCases = all.filter((c) => c.case_date.startsWith(ym));
    const todayCases = all.filter((c) => c.case_date === today);
    const ms = Stats.monthlyStats(monthCases, roster);
    const ts = Stats.dailySummary(todayCases, roster);
    const openMine = (name) => { state.casesView = 'list'; state.filters = { month: ym, anaes: name, consultant: '', hospital: '', mode: '', q: '' }; go('cases'); };

    screen.appendChild(pageHead('Anaesthesia Log', `${greeting()} · ${monthLabel(ym)}`, h('button', { class: 'icon-btn', 'aria-label': 'Lock', onclick: lockNow }, ic('lock'))));

    screen.appendChild(h('button', { class: 'hero', onclick: () => go('add') }, [
      h('span', { class: 'chev' }, ic('chev')),
      h('div', { class: 'hero-plus' }, ic('camera')),
      h('h2', {}, 'Add Case'),
      h('p', {}, 'Photo → auto-fill → save in seconds'),
    ]));

    screen.appendChild(h('div', { class: 'section-title' }, [h('h2', {}, 'One-tap templates'), h('span', { class: 'muted', style: 'font-size:13px' }, 'surgery + mode')]));
    const tpls = recentTemplates(3);
    const row = h('div', { class: 'tpl-row' });
    if (!tpls.length) row.appendChild(h('div', { class: 'tpl empty' }, 'Your recent surgery + anaesthesia combos will appear here.'));
    tpls.forEach((t, i) => row.appendChild(h('button', { class: 'tpl' + (i === 0 ? ' first' : '') + (Math.max(...(t.surgery || t.mode).split(/\s+/).map((w) => w.length)) >= 11 ? ' long' : ''), onclick: () => { state.template = t; go('add'); } }, [
      ic(i === 0 ? 'bolt' : 'refresh'), h('b', {}, t.surgery || t.mode), h('small', {}, t.surgery ? t.mode || 'tap to use' : 'tap to use'),
    ])));
    screen.appendChild(row);

    screen.appendChild(h('div', { class: 'section-title' }, [h('h2', {}, 'Today'), h('button', { onclick: () => go('day', today) }, 'Open day')]));
    screen.appendChild(h('div', { class: 'card theatre' }, [
      h('div', { html: theatreSVG() }),
      h('div', { class: 'theatre-foot' }, [
        h('div', { class: 'theatre-top' }, [h('b', {}, `${ts.total} case${ts.total === 1 ? '' : 's'}`), h('span', { class: 'pill' }, fmtDay(today))]),
        h('div', { class: 'pill-row' }, roster.map((n) => h('span', { class: 'pill ' + toneOf(n) }, `${shortName(n)} · ${ts.byAnaesthetist[n] || 0}`))),
        h('button', { class: 'btn btn-soft btn-block', onclick: () => go('day', today) }, 'View today'),
      ]),
    ]));

    screen.appendChild(h('div', { class: 'section-title' }, [h('h2', {}, monthLabel(ym)), h('button', { onclick: () => go('reports') }, 'Full report')]));
    screen.appendChild(h('div', { class: 'tiles' }, [
      tile(ms.totalCases, 'Cases this month', 'mint', () => openMine('ALL')),
      tile(ms.byAnaesthetist[roster[0]] || 0, shortName(roster[0]), 'sky', () => openMine(roster[0])),
      tile(ms.byAnaesthetist[roster[1]] || 0, shortName(roster[1] || '—'), 'amber', () => roster[1] && openMine(roster[1])),
      tile(ms.avgPerDay, `Avg / day · ${ms.workingDays} days`, 'violet', () => go('reports')),
    ]));

    const days = [];
    for (let i = 6; i >= 0; i--) days.push(shiftDay(today, -i));
    const max = Math.max(1, ...days.map((d) => casesForDate(d).length));
    screen.appendChild(h('div', { class: 'card' }, [
      h('h3', {}, 'Last 7 days'),
      h('div', { class: 'week' }, days.map((d, i) => {
        const dc = casesForDate(d);
        const bar = h('div', { class: 'wbar', style: `height:${Math.max(4, (dc.length / max) * 100)}px;animation-delay:${i * 60}ms` },
          roster.map((n) => h('i', { style: `height:${dc.length ? (dc.filter((c) => c.anaesthetist === n).length / dc.length) * 100 : 0}%;background:${TONE_VAR[toneOf(n)]}` })));
        return h('button', { class: 'wcol' + (d === today ? ' today' : ''), onclick: () => go('day', d) }, [h('b', {}, dc.length || ''), bar, h('small', {}, DOW[parseISO(d).getDay()][0])]);
      })),
    ]));

    const recent = [...all].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 3);
    if (recent.length) {
      screen.appendChild(h('div', { class: 'section-title' }, [h('h2', {}, 'Recently added'), h('button', { onclick: () => go('cases') }, 'All cases')]));
      recent.forEach((c) => screen.appendChild(caseCard(c)));
    }
  }

  // ------------------------------------------------------------------
  // ADD CASE  (photo -> OCR -> review -> save)
  // ------------------------------------------------------------------
  function renderAdd(screen) {
    if (state.pending) return renderReview(screen);
    const date = state.addDate || todayISO();
    screen.appendChild(pageHead('Add Case', state.addDate ? `For ${fmtDay(date)}` : 'Step 1 of 2 · capture the sheet', null, 'home'));

    if (state.template) {
      screen.appendChild(h('div', { class: 'tpl-banner' }, [ic('bolt'), h('span', { style: 'flex:1' }, `Template: ${[state.template.surgery, state.template.mode].filter(Boolean).join(' · ')}`), h('button', { class: 'link', style: 'padding:0', onclick: () => { state.template = null; render(); } }, 'Clear')]));
    } else {
      const tpls = recentTemplates(6);
      if (tpls.length) {
        screen.appendChild(h('div', { class: 'muted', style: 'font-size:13px;margin:0 4px 6px' }, 'Optional: pick a template first'));
        screen.appendChild(h('div', { class: 'chips' }, tpls.map((t) => h('button', { class: 'chip', onclick: () => { state.template = t; render(); } }, [t.surgery || t.mode, t.surgery && t.mode ? ` · ${t.mode}` : '']))));
      }
    }

    const status = h('div', { id: 'ocrStatus', class: 'center' });
    screen.appendChild(h('div', { class: 'cap-btns' }, [
      h('label', { class: 'btn btn-primary' }, [ic('camera'), 'Take photo', h('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'hidden-file', onchange: onImageChosen })]),
      h('label', { class: 'btn' }, [ic('image'), 'Upload photo', h('input', { type: 'file', accept: 'image/*', class: 'hidden-file', onchange: onImageChosen })]),
    ]));
    screen.appendChild(status);
    screen.appendChild(h('div', { class: 'center' }, h('button', { class: 'link', onclick: () => { buildReview({ fields: {}, confidence: {}, raw: '' }); render(); } }, 'Skip photo — enter manually')));
  }

  async function prepareImages(file) {
    // Downscale to ~1800px: faster OCR and smaller encrypted storage.
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      const scale = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
      const w = Math.round(bmp.width * scale), hgt = Math.round(bmp.height * scale);
      const mk = (filter) => { const cv = document.createElement('canvas'); cv.width = w; cv.height = hgt; const ctx = cv.getContext('2d'); if (filter) ctx.filter = filter; ctx.drawImage(bmp, 0, 0, w, hgt); return new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.85)); };
      const [store, ocr] = await Promise.all([mk(''), mk('grayscale(1) contrast(1.25)')]);
      return { store: store || file, ocr: ocr || file };
    } catch (e) {
      return { store: file, ocr: file };
    }
  }

  async function onImageChosen(e) {
    const file = e.target.files[0];
    if (!file) return;
    const status = $('#ocrStatus');
    const bar = h('i');
    const label = h('div', { class: 'muted' }, 'Preparing image…');
    status.innerHTML = '';
    status.append(h('div', { class: 'spinner' }), label, h('div', { class: 'progress' }, bar));

    const { store, ocr } = await prepareImages(file);
    revokeImage();
    state.pendingImage = { arrayBuffer: await store.arrayBuffer(), mimeType: store.type || 'image/jpeg', url: URL.createObjectURL(store) };
    try {
      label.textContent = 'Reading text on device…';
      const { text } = await OCR.recognize(ocr, (p) => { bar.style.width = Math.round(p * 100) + '%'; label.textContent = `Reading text… ${Math.round(p * 100)}%`; });
      buildReview(Parser.parseRegistrationSheet(text));
    } catch (err) {
      toast('OCR failed — fill the details in manually');
      buildReview({ fields: {}, confidence: {}, raw: '' });
    }
    render();
  }

  function buildReview({ fields, confidence, raw }) {
    const caseDate = fields.procedure_date || state.addDate || todayISO();
    const seq = Sequence.nextSuggestedAnaesthetist(casesForDate(caseDate), state.settings.anaesthetists);
    const t = state.template;
    state.pending = {
      case_id: uid(), case_date: caseDate, upload_date: todayISO(),
      patient_name: fields.patient_name || '', age: fields.age ?? '', sex: fields.sex || '',
      uhid: fields.uhid || '', visit_number: fields.visit_number || '', consultant: fields.consultant || '',
      surgery: t?.surgery || '', anaesthesia_mode: t?.mode || state.settings.lastMode || '',
      hospital: state.settings.hospital, location: state.settings.location,
      anaesthetist: seq.suggested, sequence_index: seq.sequence_index, is_override: false,
      payment_mode: fields.payment_mode || '', document_date: fields.doa || '',
      ocr_raw_text: raw, ocr_confidence: confidence || {},
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(), deleted_at: null,
    };
  }

  function suggestedFor(c) {
    return Sequence.nextSuggestedAnaesthetist(casesForDate(c.case_date).filter((x) => x.case_id !== c.case_id), state.settings.anaesthetists).suggested;
  }

  function field(label, key, opts = {}) {
    const c = state.pending;
    const conf = c.ocr_confidence[key];
    const warn = conf === 'low';
    const input = h('input', { class: 'input' + (warn ? ' warn' : ''), type: opts.type || 'text', inputmode: opts.inputmode, value: c[key] ?? '', placeholder: opts.placeholder, oninput: (e) => { c[key] = e.target.value; e.target.classList.remove('warn'); } });
    return h('div', { class: 'field' }, [
      h('label', {}, [h('span', {}, label), warn ? h('span', { class: 'verify' }, '⚠ Verify') : conf === 'high' ? h('span', { class: 'okmark' }, '✓') : null]),
      input,
    ]);
  }

  function chipGroup(options, getVal, setVal) {
    const wrap = h('div', { class: 'chip-grid' });
    const paint = () => {
      wrap.innerHTML = '';
      options.forEach((o) => wrap.appendChild(h('button', { class: 'chip' + (getVal() === o ? ' on' : ''), onclick: () => { setVal(getVal() === o ? '' : o); paint(); } }, o)));
    };
    paint();
    return wrap;
  }

  function renderReview(screen) {
    const c = state.pending;
    const editing = !!state.editingId;
    screen.appendChild(pageHead(editing ? 'Edit Case' : 'Review Case', editing ? 'Update details' : 'Step 2 of 2 · check & save', null, 'home'));

    if (state.pendingImage?.url) {
      screen.appendChild(h('img', { class: 'thumb', src: state.pendingImage.url, alt: 'Registration sheet', onclick: () => openSheet('Original sheet', h('img', { src: state.pendingImage.url })) }));
    }

    screen.appendChild(h('div', { class: 'card' }, [
      h('h3', {}, 'Patient'),
      field('Patient name', 'patient_name'),
      h('div', { class: 'grid2' }, [
        field('Age', 'age', { type: 'number', inputmode: 'numeric' }),
        h('div', { class: 'field' }, [h('label', {}, 'Sex'), chipGroup(['Male', 'Female', 'Other'], () => c.sex, (v) => (c.sex = v))]),
      ]),
      field('UHID', 'uhid'),
      field('Visit no', 'visit_number'),
      field('Consultant / Surgeon', 'consultant'),
    ]));

    const surgeryInput = h('input', { class: 'input', type: 'text', list: 'surgeryList', placeholder: 'e.g. Lap cholecystectomy', value: c.surgery || '', oninput: (e) => (c.surgery = e.target.value) });
    const recentSurg = [...(state.settings.surgeries || [])].slice(-6).reverse();
    const anaesWrap = h('div', { class: 'chip-grid' });
    const note = h('div', { class: 'note' });
    const paintAnaes = () => {
      anaesWrap.innerHTML = '';
      const sug = suggestedFor(c);
      state.settings.anaesthetists.forEach((n) => anaesWrap.appendChild(h('button', { class: `chip ${toneOf(n)} ${c.anaesthetist === n ? 'on' : ''}`, onclick: () => { c.anaesthetist = n; c.is_override = n !== sug; paintAnaes(); } }, n + (n === sug ? '  ★' : ''))));
      note.textContent = c.is_override ? `Manual override — sequence suggests ${sug}` : '★ = suggested by the alternating sequence for this day';
    };
    paintAnaes();

    const dateInput = h('input', { class: 'input', type: 'date', value: c.case_date, onchange: (e) => {
      if (!e.target.value) return;
      c.case_date = e.target.value;
      const seq = Sequence.nextSuggestedAnaesthetist(casesForDate(c.case_date).filter((x) => x.case_id !== c.case_id), state.settings.anaesthetists);
      c.anaesthetist = seq.suggested; c.sequence_index = seq.sequence_index; c.is_override = false;
      paintAnaes();
    } });

    screen.appendChild(h('div', { class: 'card' }, [
      h('h3', {}, 'Anaesthesia'),
      h('div', { class: 'field' }, [h('label', {}, 'Case date'), dateInput, c.document_date && c.document_date !== c.case_date ? h('div', { class: 'note' }, `Date on sheet: ${fmtDate(c.document_date)}`) : null]),
      h('div', { class: 'field' }, [h('label', {}, 'Anaesthetist'), anaesWrap, note]),
      h('div', { class: 'field' }, [h('label', {}, 'Surgery / procedure'), surgeryInput,
        h('datalist', { id: 'surgeryList' }, (state.settings.surgeries || []).map((n) => h('option', { value: n }))),
        recentSurg.length ? h('div', { class: 'chips', style: 'padding-top:8px' }, recentSurg.map((n) => h('button', { class: 'chip', onclick: () => { c.surgery = n; surgeryInput.value = n; } }, n))) : null]),
      h('div', { class: 'field' }, [h('label', {}, 'Mode of anaesthesia'), chipGroup(ANAESTHESIA_MODES, () => c.anaesthesia_mode, (v) => (c.anaesthesia_mode = v))]),
    ]));

    screen.appendChild(h('div', { class: 'card' }, [h('h3', {}, 'Location'), field('Hospital', 'hospital'), field('Location', 'location')]));

    screen.appendChild(h('div', { class: 'sticky-bar' }, h('div', { class: 'inner' }, [
      h('button', { class: 'btn', onclick: () => (history.length > 1 ? history.back() : go('home')) }, 'Cancel'),
      h('button', { class: 'btn btn-primary', onclick: () => saveCase(false) }, [ic('check'), editing ? 'Save changes' : 'Save case']),
    ])));
  }

  async function saveCase(skipDup) {
    const c = state.pending;
    if (!(c.patient_name || '').trim()) { toast('Patient name is required'); return; }
    if (!skipDup) {
      const dups = Duplicates.findPossibleDuplicates(c, activeCases());
      if (dups.length) { showDuplicates(dups); return; }
    }
    const isEdit = !!state.editingId;
    c.updated_at = new Date().toISOString();
    c.age = c.age === '' || c.age == null ? '' : Number(c.age);
    await persistCase(c, isEdit ? null : state.pendingImage);
    const idx = state.cases.findIndex((x) => x.case_id === c.case_id);
    idx >= 0 ? (state.cases[idx] = c) : state.cases.push(c);
    const n = casesForDate(c.case_date).findIndex((x) => x.case_id === c.case_id) + 1;
    const date = c.case_date, name = c.anaesthetist;
    state.pending = null; revokeImage(); state.editingId = null; state.template = null;
    go('day', date, { replace: true });
    toast(isEdit ? 'Changes saved' : `Saved · case ${n} · ${shortName(name)}`, isEdit ? null : 'Add another', () => { state.addDate = date; go('add'); });
  }

  function showDuplicates(dups) {
    const list = h('div', {}, dups.map((d) => h('div', { class: 'card', style: 'box-shadow:none;margin-bottom:8px' }, [
      h('b', {}, d.case.patient_name), h('div', { class: 'muted', style: 'font-size:13px' }, `${fmtDate(d.case.case_date)} · ${d.case.uhid || ''} · ${shortName(d.case.anaesthetist)}`),
      h('div', { class: 'pill', style: 'margin-top:6px' }, 'Matched: ' + d.matchedOn.join(', ')),
    ])));
    const close = openSheet('⚠ Possible duplicate', h('div', {}, [
      h('p', {}, 'This patient/case may already exist:'), list,
      h('div', { class: 'btn-row' }, [h('button', { class: 'btn', onclick: () => close() }, 'Cancel'), h('button', { class: 'btn btn-primary', onclick: () => { close(); saveCase(true); } }, 'Save anyway')]),
    ]));
  }

  function openEdit(id) {
    const c = state.cases.find((x) => x.case_id === id);
    if (!c) return;
    state.route = 'add';
    state.pending = JSON.parse(JSON.stringify(c));
    state.pending.ocr_confidence = {};
    revokeImage();
    state.editingId = id;
    go('add');
  }

  async function viewImage(id) {
    const rec = await DB.get('images', id);
    if (!rec) return toast('No photo stored for this case');
    const buf = await CryptoModule.decryptBinary(state.key, { iv: rec.iv, data: rec.data });
    const url = URL.createObjectURL(new Blob([buf], { type: rec.mimeType }));
    const close = openSheet('Original sheet', h('div', {}, [h('img', { src: url }), h('button', { class: 'btn btn-block', onclick: () => close() }, 'Close')]));
    setTimeout(() => URL.revokeObjectURL(url), 120000);
  }

  function confirmDelete(id) {
    confirmSheet({ title: 'Delete this case?', text: 'It moves to Settings → Recently deleted, where you can restore it.', okLabel: 'Delete', danger: true, onOk: async () => {
      const c = state.cases.find((x) => x.case_id === id);
      if (!c) return;
      c.deleted_at = new Date().toISOString();
      await putCase(c);
      render();
      toast('Case deleted', 'Undo', async () => { c.deleted_at = null; await putCase(c); render(); });
    } });
  }

  // ------------------------------------------------------------------
  // DAY
  // ------------------------------------------------------------------
  function renderDay(screen) {
    const date = state.param || todayISO();
    const roster = state.settings.anaesthetists;
    const cases = casesForDate(date);
    const sum = Stats.dailySummary(cases, roster);

    screen.appendChild(pageHead(fmtDay(date), `${parseISO(date).getFullYear()} · daily log`, h('button', { class: 'icon-btn', 'aria-label': 'More', onclick: () => dayMenu(date, cases) }, ic('dots')), 'cases'));
    screen.appendChild(h('div', { class: 'month-nav' }, [
      h('button', { class: 'icon-btn', 'aria-label': 'Previous day', onclick: () => go('day', shiftDay(date, -1), { replace: true }) }, ic('left')),
      h('input', { class: 'input', type: 'date', value: date, style: 'max-width:200px;text-align:center', onchange: (e) => e.target.value && go('day', e.target.value, { replace: true }) }),
      h('button', { class: 'icon-btn', 'aria-label': 'Next day', onclick: () => go('day', shiftDay(date, 1), { replace: true }) }, ic('chev')),
    ]));
    screen.appendChild(h('div', { class: 'tiles' }, [
      tile(sum.total, 'Total cases', 'mint', null),
      tile(sum.byAnaesthetist[roster[0]] || 0, shortName(roster[0]), 'sky', null),
      tile(sum.byAnaesthetist[roster[1]] || 0, shortName(roster[1] || '—'), 'amber', null),
    ]));
    if (!cases.length) screen.appendChild(h('div', { class: 'empty' }, [ic('clip'), h('div', {}, 'No cases on this day yet.')]));
    cases.forEach((c, i) => screen.appendChild(caseCard(c, i + 1)));
    screen.appendChild(h('button', { class: 'btn btn-primary btn-block', style: 'margin-top:8px', onclick: () => { state.addDate = date; go('add'); } }, [ic('plus'), `Add case for ${fmtDay(date)}`]));
  }

  function dayMenu(date, cases) {
    const close = openSheet(fmtDay(date), h('div', {}, [
      h('p', {}, 'Re-applying the sequence reassigns every case on this day in order: case 1 → first anaesthetist, case 2 → second, and so on. Manual overrides on this day are cleared.'),
      h('button', { class: 'btn btn-block', disabled: cases.length ? false : true, onclick: () => {
        close();
        confirmSheet({ title: 'Re-apply sequence?', text: `This reassigns ${cases.length} case(s) on ${fmtDay(date)}.`, okLabel: 'Re-apply', onOk: async () => {
          const redone = Sequence.resetSequenceFrom(cases, state.settings.anaesthetists, cases[0].case_id);
          for (const r of redone) { const c = state.cases.find((x) => x.case_id === r.case_id); c.anaesthetist = r.anaesthetist; c.is_override = false; c.sequence_index = r.sequence_index; c.updated_at = new Date().toISOString(); await putCase(c); }
          render(); toast('Sequence re-applied');
        } });
      } }, [ic('refresh'), 'Re-apply alternating sequence']),
    ]));
  }

  // ------------------------------------------------------------------
  // CASES (list / calendar, search, filters)
  // ------------------------------------------------------------------
  function applyFilters(cases, f) {
    const q = (f.q || '').trim().toLowerCase();
    return cases.filter((c) => {
      if (f.month && !c.case_date.startsWith(f.month)) return false;
      if (f.anaes !== 'ALL' && c.anaesthetist !== f.anaes) return false;
      if (f.consultant && !(c.consultant || '').toLowerCase().includes(f.consultant.toLowerCase())) return false;
      if (f.hospital && c.hospital !== f.hospital) return false;
      if (f.mode && c.anaesthesia_mode !== f.mode) return false;
      if (q) {
        const hay = [c.patient_name, c.uhid, c.visit_number, c.consultant, c.surgery, c.anaesthesia_mode, c.anaesthetist, c.hospital, c.location, c.case_date, fmtDate(c.case_date)].join(' ').toLowerCase();
        return q.split(/\s+/).every((w) => hay.includes(w));
      }
      return true;
    });
  }

  function renderCases(screen) {
    const f = state.filters;
    const roster = state.settings.anaesthetists;
    screen.appendChild(pageHead('Cases', f.month ? monthLabel(f.month) : 'All time', h('button', { class: 'icon-btn', 'aria-label': 'Filters', onclick: openFilters }, ic('filter'))));

    screen.appendChild(h('div', { class: 'seg' }, [
      h('button', { class: state.casesView === 'list' ? 'on' : '', onclick: () => { state.casesView = 'list'; render(); } }, [ic('list'), 'List']),
      h('button', { class: state.casesView === 'calendar' ? 'on' : '', onclick: () => { state.casesView = 'calendar'; if (!f.month) f.month = todayISO().slice(0, 7); render(); } }, [ic('calendar'), 'Calendar']),
    ]));

    if (f.month) {
      screen.appendChild(h('div', { class: 'month-nav' }, [
        h('button', { class: 'icon-btn', 'aria-label': 'Previous month', onclick: () => { f.month = shiftMonth(f.month, -1); render(); } }, ic('left')),
        h('b', {}, monthLabel(f.month)),
        h('button', { class: 'icon-btn', 'aria-label': 'Next month', onclick: () => { f.month = shiftMonth(f.month, 1); render(); } }, ic('chev')),
      ]));
    }

    screen.appendChild(h('div', { class: 'chips' }, [
      h('button', { class: 'chip' + (f.anaes === 'ALL' ? ' on' : ''), onclick: () => { f.anaes = 'ALL'; render(); } }, 'All'),
      ...roster.map((n) => h('button', { class: `chip ${toneOf(n)}` + (f.anaes === n ? ' on' : ''), onclick: () => { f.anaes = n; render(); } }, shortName(n))),
      f.consultant ? h('button', { class: 'chip on', onclick: () => { f.consultant = ''; render(); } }, `${shortName(f.consultant)} ✕`) : null,
      f.hospital ? h('button', { class: 'chip on', onclick: () => { f.hospital = ''; render(); } }, `${f.hospital} ✕`) : null,
      f.mode ? h('button', { class: 'chip on', onclick: () => { f.mode = ''; render(); } }, `${f.mode} ✕`) : null,
      !f.month ? h('button', { class: 'chip on', onclick: () => { f.month = todayISO().slice(0, 7); render(); } }, 'All time ✕') : null,
    ]));

    const results = h('div');
    if (state.casesView === 'calendar') { screen.appendChild(results); paintCalendar(results); return; }
    const input = h('input', { class: 'input', type: 'search', placeholder: 'Search name, UHID, visit no, consultant, surgery…', value: f.q, oninput: (e) => { f.q = e.target.value; paintList(results); } });
    screen.appendChild(h('div', { class: 'search' }, [ic('search'), input]));
    screen.appendChild(results);
    paintList(results);
  }

  function paintList(box) {
    box.innerHTML = '';
    const list = applyFilters(activeCases(), state.filters).sort((a, b) => b.case_date.localeCompare(a.case_date) || a.created_at.localeCompare(b.created_at));
    box.appendChild(h('div', { class: 'muted', style: 'margin:4px 4px 0;font-size:13px' }, `${list.length} case${list.length === 1 ? '' : 's'}`));
    if (!list.length) { box.appendChild(h('div', { class: 'empty' }, [ic('search'), h('div', {}, 'No cases match these filters.')])); return; }
    let lastDate = '', n = 0;
    for (const c of list) {
      if (c.case_date !== lastDate) {
        lastDate = c.case_date; n = 0;
        const total = list.filter((x) => x.case_date === lastDate).length;
        box.appendChild(h('button', { class: 'group-head', onclick: () => go('day', c.case_date) }, [h('b', {}, fmtDay(c.case_date)), h('span', {}, `${total} case${total === 1 ? '' : 's'} ›`)]));
      }
      n++;
      box.appendChild(caseCard(c, n));
    }
  }

  function paintCalendar(box) {
    const ym = state.filters.month;
    const [y, m] = ym.split('-').map(Number);
    const days = new Date(y, m, 0).getDate();
    const start = new Date(y, m - 1, 1).getDay();
    const cases = applyFilters(activeCases(), { ...state.filters, q: '' });
    const byDate = Stats.byDay(cases);
    const grid = h('div', { class: 'cal' }, DOW.map((d) => h('div', { class: 'wd' }, d[0])));
    for (let i = 0; i < start; i++) grid.appendChild(h('div', { class: 'cal-cell blank' }));
    for (let d = 1; d <= days; d++) {
      const iso = `${ym}-${pad(d)}`;
      const dc = byDate.get(iso) || [];
      grid.appendChild(h('button', { class: 'cal-cell' + (dc.length ? ' has' : '') + (iso === todayISO() ? ' today' : ''), onclick: () => go('day', iso) }, [h('span', {}, d), dc.length ? h('em', {}, dc.length) : null, dc.length ? dotsFor(dc) : null]));
    }
    box.appendChild(grid);
    const roster = state.settings.anaesthetists;
    box.appendChild(h('div', { class: 'pill-row', style: 'margin-top:14px' }, [h('span', { class: 'pill' }, `${cases.length} cases`), ...roster.map((n) => h('span', { class: 'pill ' + toneOf(n) }, `${shortName(n)} · ${cases.filter((c) => c.anaesthetist === n).length}`))]));
  }

  function openFilters() {
    const f = state.filters;
    const cases = activeCases();
    const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort();
    const consultants = uniq(cases.flatMap((c) => (c.consultant || '').split('/').map((x) => x.trim())));
    const hospitals = uniq(cases.map((c) => c.hospital));
    const sel = (label, options, key) => h('div', { class: 'field' }, [h('label', {}, label), h('select', { class: 'input', onchange: (e) => (f[key] = e.target.value) }, [h('option', { value: '' }, 'Any'), ...options.map((o) => h('option', { value: o, ...(f[key] === o ? { selected: true } : {}) }, o))])]);
    const month = h('input', { class: 'input', type: 'month', value: f.month, onchange: (e) => (f.month = e.target.value) });
    const close = openSheet('Filters', h('div', {}, [
      h('div', { class: 'field' }, [h('label', {}, 'Month (clear for all time)'), month]),
      sel('Consultant', consultants, 'consultant'), sel('Hospital', hospitals, 'hospital'), sel('Mode of anaesthesia', ANAESTHESIA_MODES, 'mode'),
      h('div', { class: 'btn-row' }, [
        h('button', { class: 'btn', onclick: () => { state.filters = { month: todayISO().slice(0, 7), anaes: 'ALL', consultant: '', hospital: '', mode: '', q: '' }; close(); render(); } }, 'Reset'),
        h('button', { class: 'btn btn-primary', onclick: () => { close(); render(); } }, 'Apply'),
      ]),
    ]));
  }

  // ------------------------------------------------------------------
  // REPORTS
  // ------------------------------------------------------------------
  function donut(values, colors) {
    const total = values.reduce((a, b) => a + b, 0);
    const R = 42, C = 2 * Math.PI * R;
    let acc = 0;
    const segs = values.map((v, i) => { const len = total ? (v / total) * C : 0; const s = `<circle cx="60" cy="60" r="${R}" fill="none" stroke="${colors[i]}" stroke-width="16" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-acc}" transform="rotate(-90 60 60)"/>`; acc += len; return s; }).join('');
    return h('div', { html: `<svg class="donut" viewBox="0 0 120 120"><circle cx="60" cy="60" r="${R}" fill="none" stroke="var(--line)" stroke-width="16"/>${segs}<text x="60" y="58" text-anchor="middle" font-size="26" font-weight="800" fill="var(--ink)">${total}</text><text x="60" y="76" text-anchor="middle" font-size="10" fill="var(--muted)">CASES</text></svg>` });
  }

  function barRows(counts, tone, onclick) {
    const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const max = Math.max(1, ...rows.map((r) => r[1]));
    return rows.map(([name, n], i) => h('button', { class: 'bar-row', onclick: onclick ? () => onclick(name) : null }, [
      h('div', { class: 'top' }, [h('span', {}, name), h('b', {}, n)]),
      h('div', { class: 'track' }, h('div', { class: 'fill', style: `width:${(n / max) * 100}%;background:${tone};animation-delay:${i * 50}ms` })),
    ]));
  }

  function renderReports(screen) {
    const ym = state.reportMonth;
    const roster = state.settings.anaesthetists;
    const cases = activeCases().filter((c) => c.case_date.startsWith(ym));
    const st = Stats.monthlyStats(cases, roster);
    const cross = Stats.consultantByAnaesthetist(cases);
    const toCases = (patch) => { state.casesView = 'list'; state.filters = { month: ym, anaes: 'ALL', consultant: '', hospital: '', mode: '', q: '', ...patch }; go('cases'); };

    screen.appendChild(pageHead('Reports', monthLabel(ym)));
    screen.appendChild(h('div', { class: 'month-nav' }, [
      h('button', { class: 'icon-btn', 'aria-label': 'Previous month', onclick: () => { state.reportMonth = shiftMonth(ym, -1); render(); } }, ic('left')),
      h('b', {}, monthLabel(ym)),
      h('button', { class: 'icon-btn', 'aria-label': 'Next month', onclick: () => { state.reportMonth = shiftMonth(ym, 1); render(); } }, ic('chev')),
    ]));

    screen.appendChild(h('div', { class: 'tiles' }, [
      tile(st.totalCases, 'Total cases', 'mint', null), tile(st.workingDays, 'Working days', 'sky', null),
      tile(st.avgPerDay, 'Avg / day', 'amber', null), tile(`${st.maxPerDay} / ${st.minPerDay}`, 'Max / min day', 'violet', null),
    ]));

    const colors = roster.map((n) => TONE_VAR[toneOf(n)]);
    screen.appendChild(h('div', { class: 'card' }, [
      h('h3', {}, 'Anaesthetist split'),
      h('div', { class: 'donut-wrap' }, [donut(roster.map((n) => st.byAnaesthetist[n] || 0), colors),
        h('div', { class: 'legend' }, roster.map((n, i) => h('div', {}, [h('i', { style: `background:${colors[i]}` }), shortName(n), h('b', {}, st.byAnaesthetist[n] || 0)])))]),
      h('button', { class: 'btn btn-soft btn-block', style: 'margin-top:14px', onclick: () => toCases({ anaes: roster[0] }) }, `My cases — ${monthLabel(ym)}`),
    ]));

    if (Object.keys(st.byMode).length) screen.appendChild(h('div', { class: 'card' }, [h('h3', {}, 'Mode of anaesthesia'), ...barRows(st.byMode, 'var(--a2)', (name) => toCases({ mode: name }))]));
    if (Object.keys(st.bySurgery).length) screen.appendChild(h('div', { class: 'card' }, [h('h3', {}, 'Surgeries'), ...barRows(st.bySurgery, 'var(--a1)', (name) => toCases({ q: name }))]));

    if (Object.keys(st.byConsultant).length) {
      const max = Math.max(...Object.values(st.byConsultant));
      screen.appendChild(h('div', { class: 'card' }, [h('h3', {}, 'Consultant-wise'), ...Object.entries(st.byConsultant).sort((a, b) => b[1] - a[1]).map(([name, n]) => h('div', {}, [
        h('button', { class: 'bar-row', style: 'margin-bottom:4px', onclick: () => toCases({ consultant: name }) }, [
          h('div', { class: 'top' }, [h('span', {}, name), h('b', {}, n)]), h('div', { class: 'track' }, h('div', { class: 'fill', style: `width:${(n / max) * 100}%;background:var(--brand-2)` }))]),
        h('div', { class: 'sub', style: 'margin-bottom:12px' }, roster.map((r) => (cross[name]?.[r] ? h('span', { class: 'pill ' + toneOf(r) }, `${shortName(r)} · ${cross[name][r]}`) : null))),
      ]))]));
    }

    screen.appendChild(h('div', { class: 'card' }, [h('h3', {}, 'Insights'), h('ul', { class: 'insights' }, Stats.buildInsights(st, monthLabel(ym)).map((l) => h('li', {}, l)))]));

    const prefix = `anaesthesia-log-${ym}`;
    const mine = cases.filter((c) => c.anaesthetist === roster[0]);
    screen.appendChild(h('div', { class: 'card' }, [
      h('h3', {}, 'Export month'),
      h('div', { class: 'btn-row' }, [
        h('button', { class: 'btn btn-primary', onclick: () => safeExport(() => ExportModule.exportMonthExcel({ cases, roster, monthLabel: monthLabel(ym), fileNamePrefix: prefix })) }, [ic('download'), 'Excel']),
        h('button', { class: 'btn', onclick: () => safeExport(() => ExportModule.exportCasesCSV(cases, prefix + '.csv')) }, 'CSV'),
        h('button', { class: 'btn', onclick: () => safeExport(() => ExportModule.exportMonthPDF({ cases, roster, monthLabel: monthLabel(ym), hospitalLine: `${state.settings.hospital} – ${state.settings.location}`, fileNamePrefix: prefix })) }, 'PDF'),
      ]),
      h('button', { class: 'btn btn-soft btn-block', style: 'margin-top:10px', onclick: () => safeExport(() => ExportModule.exportCasesCSV(mine, `${prefix}-my-cases.csv`)) }, [ic('download'), `My cases only (${mine.length}) — CSV`]),
    ]));
  }

  function safeExport(fn) {
    try { fn(); toast('Export started'); } catch (e) { toast('Export failed — libraries not loaded (open once with internet)'); }
  }

  // ------------------------------------------------------------------
  // SETTINGS
  // ------------------------------------------------------------------
  function renderSettings(screen) {
    const s = state.settings;
    const draft = { a: [...s.anaesthetists], hospital: s.hospital, location: s.location };
    const inp = (label, get, set) => h('div', { class: 'field' }, [h('label', {}, label), h('input', { class: 'input', value: get(), oninput: (e) => set(e.target.value) })]);
    screen.appendChild(pageHead('Settings', 'Profile & security'));

    screen.appendChild(h('div', { class: 'card settings-group' }, [
      h('h3', {}, 'Profile'),
      inp('Anaesthetist 1 (you)', () => draft.a[0], (v) => (draft.a[0] = v)),
      inp('Anaesthetist 2', () => draft.a[1] || '', (v) => (draft.a[1] = v)),
      inp('Hospital', () => draft.hospital, (v) => (draft.hospital = v)),
      inp('Location', () => draft.location, (v) => (draft.location = v)),
      h('button', { class: 'btn btn-primary btn-block', onclick: async () => {
        const names = draft.a.map((x) => (x || '').trim());
        if (!names[0] || !names[1]) return toast('Both anaesthetist names are required');
        if (names[0] === names[1]) return toast('The two names must be different');
        // Renaming must also rename on existing cases, otherwise the stats split in two.
        let changed = 0;
        for (let i = 0; i < 2; i++) {
          const old = s.anaesthetists[i];
          if (old && old !== names[i]) for (const c of state.cases) if (c.anaesthetist === old) { c.anaesthetist = names[i]; changed++; await putCase(c); }
        }
        s.anaesthetists = names; s.hospital = draft.hospital.trim(); s.location = draft.location.trim();
        await saveSettings(); render();
        toast(changed ? `Saved · ${changed} existing case(s) renamed` : 'Settings saved');
      } }, 'Save profile'),
      h('div', { class: 'note' }, 'New cases use this hospital and location. Existing cases keep theirs.'),
    ]));

    const lockSel = h('select', { class: 'input', onchange: async (e) => { s.autoLockMin = Number(e.target.value); await saveSettings(); toast('Auto-lock updated'); } },
      [[1, '1 minute'], [2, '2 minutes'], [5, '5 minutes'], [0, 'Never']].map(([v, l]) => h('option', { value: v, ...(s.autoLockMin === v ? { selected: true } : {}) }, l)));
    screen.appendChild(h('div', { class: 'card' }, [
      h('h3', {}, 'Security'),
      h('div', { class: 'field' }, [h('label', {}, 'Auto-lock after leaving the app'), lockSel]),
      h('div', { class: 'btn-row' }, [
        h('button', { class: 'btn', onclick: lockNow }, [ic('lock'), 'Lock now']),
        h('button', { class: 'btn', onclick: openChangePin }, [ic('shield'), 'Change PIN']),
      ]),
    ]));

    screen.appendChild(h('div', { class: 'card' }, [
      h('h3', {}, 'Data'),
      h('button', { class: 'btn btn-block', onclick: () => go('backup') }, [ic('download'), 'Backup / Restore']),
      h('div', { class: 'note' }, 'Everything is stored encrypted on this device only. No account, no server.'),
    ]));

    const deleted = state.cases.filter((c) => c.deleted_at);
    screen.appendChild(h('div', { class: 'card' }, [
      h('h3', {}, `Recently deleted (${deleted.length})`),
      !deleted.length ? h('div', { class: 'muted' }, 'Nothing here.') : null,
      ...deleted.map((c) => h('div', { class: 'deleted-row' }, [
        h('div', {}, [h('b', {}, c.patient_name), h('small', {}, `${fmtDate(c.case_date)} · ${shortName(c.anaesthetist)}`)]),
        h('div', { class: 'btn-row', style: 'flex:none' }, [
          h('button', { class: 'btn btn-sm btn-soft', onclick: async () => { c.deleted_at = null; await putCase(c); render(); toast('Case restored'); } }, 'Restore'),
          h('button', { class: 'btn btn-sm btn-danger', onclick: () => confirmSheet({ title: 'Delete permanently?', text: 'This removes the case and its photo for good. It cannot be undone.', okLabel: 'Delete forever', danger: true, onOk: async () => { await DB.del('cases', c.case_id); await DB.del('images', c.case_id); state.cases = state.cases.filter((x) => x.case_id !== c.case_id); render(); } }) }, 'Forever'),
        ]),
      ])),
    ]));
  }

  function openChangePin() {
    const oldP = h('input', { class: 'input', type: 'password', inputmode: 'numeric', placeholder: 'Current PIN' });
    const n1 = h('input', { class: 'input', type: 'password', inputmode: 'numeric', placeholder: 'New PIN' });
    const n2 = h('input', { class: 'input', type: 'password', inputmode: 'numeric', placeholder: 'Confirm new PIN' });
    const err = h('div', { class: 'error' });
    const close = openSheet('Change PIN', h('div', {}, [
      h('p', {}, 'Everything is re-encrypted with the new PIN. Take a backup first and keep the app open until it finishes.'),
      oldP, n1, n2, err,
      h('button', { class: 'btn btn-primary btn-block', onclick: async (e) => {
        err.textContent = '';
        if (n1.value.length < 4) return (err.textContent = 'New PIN must be at least 4 characters.');
        if (n1.value !== n2.value) return (err.textContent = 'New PINs do not match.');
        const btn = e.currentTarget; btn.disabled = true; btn.textContent = 'Re-encrypting…';
        try { await changePin(oldP.value, n1.value); close(); toast('PIN changed'); }
        catch (ex) { err.textContent = ex.message; btn.disabled = false; btn.textContent = 'Change PIN'; }
      } }, 'Change PIN'),
    ]));
  }

  async function changePin(oldPin, newPin) {
    const salt = await DB.get('meta', 'salt');
    const verifier = await DB.get('meta', 'verifier');
    const oldKey = await CryptoModule.deriveKey(oldPin, salt.value);
    if (!(await CryptoModule.checkVerifier(oldKey, verifier.value))) throw new Error('Current PIN is incorrect.');
    const newSalt = CryptoModule.newSalt();
    const newKey = await CryptoModule.deriveKey(newPin, newSalt);
    // Prepare everything in memory first, then write, so the failure window is tiny.
    const caseRecs = await Promise.all(state.cases.map(async (c) => ({ case_id: c.case_id, value: await CryptoModule.encryptJSON(newKey, c) })));
    const imgs = await DB.getAll('images');
    const imgRecs = await Promise.all(imgs.map(async (r) => { const plain = await CryptoModule.decryptBinary(state.key, { iv: r.iv, data: r.data }); const enc = await CryptoModule.encryptBinary(newKey, plain); return { ...r, iv: enc.iv, data: enc.data }; }));
    const settingsRec = { key: 'settings', value: await CryptoModule.encryptJSON(newKey, state.settings) };
    const verifierRec = { key: 'verifier', value: await CryptoModule.makeVerifier(newKey) };
    for (const r of caseRecs) await DB.put('cases', r);
    for (const r of imgRecs) await DB.put('images', r);
    await DB.put('meta', settingsRec);
    await DB.put('meta', verifierRec);
    await DB.put('meta', { key: 'salt', value: newSalt });
    state.key = newKey;
  }

  // ------------------------------------------------------------------
  // BACKUP / RESTORE
  // ------------------------------------------------------------------
  function renderBackup(screen) {
    screen.appendChild(pageHead('Backup', 'Never depend on the app', null, 'settings'));
    screen.appendChild(h('div', { class: 'card' }, [
      h('p', { class: 'muted', style: 'margin-bottom:14px;line-height:1.45' }, 'The backup is one file, still encrypted with your PIN. Store it in your own cloud drive or computer. Restoring needs the PIN that was active when it was made.'),
      h('button', { class: 'btn btn-primary btn-block', onclick: doBackup }, [ic('download'), 'Backup data']),
    ]));
    screen.appendChild(h('div', { class: 'card' }, [
      h('p', { class: 'muted', style: 'margin-bottom:14px' }, 'Restoring replaces all data on this device.'),
      h('label', { class: 'btn btn-block' }, [ic('upload'), 'Restore data', h('input', { type: 'file', accept: 'application/json,.json', class: 'hidden-file', onchange: doRestore })]),
    ]));
  }

  async function doBackup() {
    const [meta, cases, images, consultants] = await Promise.all([DB.getAll('meta'), DB.getAll('cases'), DB.getAll('images'), DB.getAll('consultants')]);
    const imagesB64 = images.map((r) => ({ case_id: r.case_id, iv: r.iv, data: CryptoModule.bufToB64(r.data), mimeType: r.mimeType }));
    const blob = new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), meta, cases, images: imagesB64, consultants })], { type: 'application/json' });
    ExportModule.downloadBlob(blob, `anaesthesia-log-backup-${todayISO()}.json`);
    toast('Backup downloaded');
  }

  function doRestore(e) {
    const file = e.target.files[0];
    if (!file) return;
    confirmSheet({ title: 'Replace all data?', text: 'Everything currently on this device will be replaced by the backup file.', okLabel: 'Restore', danger: true, onOk: async () => {
      try {
        const payload = JSON.parse(await file.text());
        if (!payload.meta || !payload.cases) throw new Error('bad file');
        await DB.clearAll();
        for (const m of payload.meta) await DB.put('meta', m);
        for (const c of payload.cases) await DB.put('cases', c);
        for (const img of payload.images || []) await DB.put('images', { case_id: img.case_id, iv: img.iv, data: CryptoModule.b64ToBuf(img.data), mimeType: img.mimeType });
        for (const co of payload.consultants || []) await DB.put('consultants', co);
        toast('Restored — unlock with the PIN used for that backup');
        setTimeout(() => location.reload(), 1200);
      } catch (err) { toast('That file is not a valid backup'); }
    } });
  }

  return { boot };
})();

document.addEventListener('DOMContentLoaded', () => App.boot());
