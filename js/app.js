/**
 * app.js — UI controller for the Anaesthesia Case Log.
 * Vanilla JS, no build step. Patient data lives only in IndexedDB
 * (AES-GCM encrypted) and, while unlocked, in memory.
 */
const App = (() => {
  // ------------------------------------------------------------------
  // constants & state
  // ------------------------------------------------------------------
  const ANAESTHESIA_MODES = ['GA', 'SA (Spinal)', 'Epidural', 'CSE', 'Regional Block', 'Sedation / MAC', 'Local + Standby', 'GA + Regional', 'Other'];
  const NOTABLE_TYPES = ['Difficult airway', 'Critical / unstable', 'Complication', 'Rare / interesting', 'Learning point'];
  const TONES = ['a0', 'a1', 'a2'];
  const TONE_VAR = { a0: 'var(--a0)', a1: 'var(--a1)', a2: 'var(--a2)' };
  const emptyFilters = (month) => ({ month, anaes: 'ALL', consultant: '', hospital: '', mode: '', q: '', notable: false, asa: '', speciality: '', urgency: '', complication: false, incomplete: false });

  const state = {
    key: null, settings: null,
    cases: [], // includes soft-deleted
    duties: [], // night duties
    preops: [], preopDraft: null, preopImage: null, preopImages: [], preopEditing: false, preopQ: '',
    procedures: [], templates: [], corrupt: [], lastBackupAt: null,
    route: 'home', param: null, casesView: 'list',
    filters: emptyFilters(''), reportMonth: '',
    pending: null, pendingImage: null, editingId: null, template: null, addDate: null, failedPins: 0,
  };

  // ------------------------------------------------------------------
  // tiny DOM helpers
  // ------------------------------------------------------------------
  const $ = (sel, r = document) => r.querySelector(sel);
  const root = () => $('#app');
  function h(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === false || v == null) continue;
      if (k === 'class') node.className = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k === 'value') node.value = v;
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
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
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
    moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
    star: '<path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    pulse: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
    syringe: '<path d="M18 2l4 4M17 7l3-3M19 9l-8.7 8.7a2 2 0 0 1-1.4.6H6v-2.9a2 2 0 0 1 .6-1.4L15 5M5 22l4-4M12 8l4 4"/>',
    folder: '<path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    pie: '<path d="M21 12A9 9 0 1 1 12 3v9z"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15z"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h8"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
    warn: '<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/>',
  };
  const ic = (name, extra = '') => h('span', { class: 'ic ' + extra, html: `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>` });

  // ------------------------------------------------------------------
  // dates (always LOCAL time — toISOString() is UTC and is wrong before 05:30 IST)
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
    setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 300); }, 4200);
  }

  function openSheet(title, body) {
    const back = h('div', { class: 'sheet-back', onclick: (e) => { if (e.target === back) close(); } });
    back.appendChild(h('div', { class: 'sheet' }, [h('div', { class: 'grab' }), title ? h('h3', { class: 'sheet-title' }, title) : null, body]));
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
    hospitals: ['THANC Hospital', 'Yaal Hospital'], hospitalsSeeded: true, consultants: [], surgeries: [],
    lastMode: '', autoLockMin: 2,
    // V8
    entryMode: 'quick', theme: 'auto', paedAgeMax: 16, geriatricAgeMin: 65, lastBackupAt: null, backupRemindDays: 30,
  });
  const hospitalList = () => [...new Set([state.settings.hospital, ...(state.settings.hospitals || [])].filter(Boolean))];

  /** Encrypt a record into the {id, value} shape the stores use, as a batch operation. */
  const encOp = async (store, obj) => ({ store, op: 'put', value: { [DB.KEYS[store]]: obj[DB.KEYS[store]], value: await CryptoModule.encryptJSON(state.key, obj) } });
  const settingsOp = async () => ({ store: 'meta', op: 'put', value: { key: 'settings', value: await CryptoModule.encryptJSON(state.key, state.settings) } });
  const imageOp = async (id, image) => { const enc = await CryptoModule.encryptBinary(state.key, image.arrayBuffer); return { store: 'images', op: 'put', value: { case_id: id, iv: enc.iv, data: enc.data, mimeType: image.mimeType } }; };
  const saveSettings = async () => DB.batch([await settingsOp()]);

  async function loadSettings() {
    const rec = await DB.get('meta', 'settings');
    state.settings = { ...defaultSettings(), ...(rec ? await CryptoModule.decryptJSON(state.key, rec.value) : {}) };
    if (!state.settings.hospitalsSeeded) { // one-time: add the hospitals you work at to existing installs
      for (const n of ['THANC Hospital', 'Yaal Hospital']) if (!state.settings.hospitals.includes(n)) state.settings.hospitals.push(n);
      state.settings.hospitalsSeeded = true; await saveSettings();
    }
  }
  /** Decrypt one store record by record. A record that cannot be read is listed in state.corrupt instead of blocking the app. */
  async function loadStore(store, upgrade) {
    const rows = await DB.getAll(store);
    const out = await Promise.all(rows.map(async (r) => {
      try { const v = await CryptoModule.decryptJSON(state.key, r.value); return upgrade ? upgrade(v) : v; }
      catch (e) { state.corrupt.push({ store, id: r[DB.KEYS[store]], error: (e && e.name) || 'decrypt failed' }); return null; }
    }));
    return out.filter(Boolean);
  }
  async function loadAllCases() { const l = await loadStore('cases', Schema.upgradeCase); l.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || '')); state.cases = l; }
  async function loadAllPreops() { state.preops = await loadStore('preops', Schema.upgradePreop); }
  async function loadAllDuties() { const l = await loadStore('duties'); l.sort((a, b) => (a.date || '').localeCompare(b.date || '')); state.duties = l; }
  async function loadAllProcedures() { state.procedures = await loadStore('procedures', Schema.upgradeProcedure); }
  async function loadAllTemplates() { state.templates = await loadStore('templates'); }
  const putCase = async (c) => DB.batch([await encOp('cases', c)]);
  const putDuty = async (d) => DB.batch([await encOp('duties', d)]);
  const putPreopRec = async (p) => DB.batch([await encOp('preops', p)]);
  const putProcedure = async (p) => DB.batch([await encOp('procedures', p)]);
  const putTemplate = async (t) => DB.batch([await encOp('templates', t)]);

  /** Remember surgeries/hospitals/consultants for the pick-lists. Returns true if settings changed (caller saves, ideally in the same batch). */
  function rememberLists({ hospital, surgery, mode, consultant }) {
    const s = state.settings; let dirty = false;
    if (mode && s.lastMode !== mode) { s.lastMode = mode; dirty = true; }
    const sg = (surgery || '').trim();
    if (sg && !s.surgeries.includes(sg)) { s.surgeries.push(sg); dirty = true; }
    const hp = (hospital || '').trim();
    if (hp && hp !== s.hospital && !s.hospitals.includes(hp)) { s.hospitals.push(hp); dirty = true; }
    for (const n of (consultant || '').split('/').map((x) => x.trim()).filter(Boolean)) if (!s.consultants.includes(n)) { s.consultants.push(n); dirty = true; }
    return dirty;
  }

  /** Case + photo + remembered lists are written in ONE transaction. */
  async function persistCase(c, image) {
    c.schema_version = Schema.VERSION;
    const ops = [await encOp('cases', c)];
    if (image) ops.push(await imageOp(c.case_id, image));
    if (rememberLists({ hospital: c.hospital, surgery: c.surgery, mode: c.anaesthesia_mode, consultant: c.consultant })) ops.push(await settingsOp());
    await DB.batch(ops);
  }

  const activeCases = () => state.cases.filter((c) => !c.deleted_at);
  const activePreops = () => state.preops.filter((p) => !p.deleted_at);
  const activeProcedures = () => state.procedures.filter((p) => !p.deleted_at);
  const casesForDate = (iso) => activeCases().filter((c) => c.case_date === iso).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const dutiesOn = (iso) => state.duties.filter((d) => d.date === iso);
  const dutiesInMonth = (ym) => state.duties.filter((d) => d.date.startsWith(ym));

  // ------------------------------------------------------------------
  // lock / unlock / setup
  // ------------------------------------------------------------------
  async function boot() {
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('popstate', onPop);
    for (const ev of ['pointerdown', 'keydown', 'touchstart', 'scroll']) document.addEventListener(ev, () => { lastActive = Date.now(); }, { passive: true, capture: true });
    setInterval(checkIdle, 15000);
    // An old (pre-V8) database is upgraded in place the moment it is opened, so offer a safety backup first.
    const pk = await DB.peek();
    if (pk.exists && pk.hasPin && pk.version < DB.VERSION) return renderUpgradeNotice(pk);
    await startStorage();
  }
  async function startStorage() {
    try { await DB.open(); } catch (e) { return renderFatal(e); }
    const salt = await DB.get('meta', 'salt');
    salt ? renderUnlock() : renderSetupPin();
  }

  let hiddenAt = 0, lastActive = Date.now();
  function onVisibility() {
    if (!state.key) return;
    if (document.hidden) { hiddenAt = Date.now(); return; }
    const min = state.settings?.autoLockMin ?? 2;
    if (min > 0 && hiddenAt && Date.now() - hiddenAt > min * 60000) lockNow();
    lastActive = Date.now();
  }
  /** Lock after N minutes with no touch/key/scroll, even if the app stays on screen. */
  function checkIdle() {
    if (!state.key) return;
    const min = state.settings?.autoLockMin ?? 2;
    if (min > 0 && Date.now() - lastActive > min * 60000) lockNow();
  }

  function lockNow() {
    state.key = null; state.settings = null; state.cases = []; state.duties = []; state.preops = []; state.procedures = []; state.templates = []; state.corrupt = [];
    state.preopDraft = null; X.clearPreopPending && X.clearPreopPending(); state.preopImages = []; state.pending = null; revokeImage();
    document.querySelectorAll('.sheet-back, .toast').forEach((n) => n.remove());
    renderUnlock();
  }

  function infoScreen(title, paras, buttons, tone) {
    root().innerHTML = '';
    root().appendChild(h('div', { class: 'lock' }, [
      h('div', { class: 'logo' }, ic(tone === 'warn' ? 'shield' : 'clip')), h('h1', {}, title),
      ...paras.map((t) => h('p', { class: 'muted', style: 'max-width:340px;line-height:1.5' }, t)),
      h('div', { class: 'box' }, buttons),
    ]));
  }

  /** Shown ONCE when a pre-V8 database is found: back it up before the in-place upgrade. */
  function renderUpgradeNotice(pk) {
    const msg = h('div', { class: 'error', style: 'min-height:20px' });
    const go1 = h('button', { class: 'btn btn-primary btn-block', onclick: async () => { go1.disabled = true; go1.textContent = 'Upgrading…'; await startStorage(); } }, 'Continue to V8');
    infoScreen('Upgrading to V8', [
      'Your existing records, photos, night duties and settings are kept. This upgrade only adds new storage areas (procedures and templates); nothing is deleted or rewritten.',
      'Once upgraded, an older version of the app can no longer open this data on this device. Download a safety backup first. It is still encrypted with your current PIN.',
    ], [
      h('button', { class: 'btn btn-block', style: 'margin-bottom:10px', onclick: async () => {
        try { const raw = await DB.rawExport(); const blob = new Blob([JSON.stringify(Backup.buildLegacy(raw))], { type: 'application/json' }); ExportModule.downloadBlob(blob, Backup.fileName()); msg.style.color = 'var(--teal-ink)'; msg.textContent = 'Safety backup downloaded. Check your Downloads folder, then continue.'; }
        catch (e) { msg.textContent = 'Could not create the backup: ' + (e.message || e); }
      } }, [ic('download'), 'Download safety backup']),
      msg, go1,
    ]);
  }

  /** The browser refused to open the database (not "storage blocked"): never show an empty app as if data were gone. */
  function renderFatal(e) {
    const n = (e && e.name) || 'Error';
    const why = n === 'VersionError' ? 'The data on this device was written by a newer version of the app than the one currently loaded. Your data is safe. Reload to fetch the latest version.' :
      n === 'QuotaExceededError' ? 'The device is out of storage space. Free some space, then reload. Your data has not been changed.' :
      'The browser could not open the database. Your data has not been changed. Close other tabs of this app and reload; if it keeps happening, restart the browser.';
    infoScreen('Cannot open the database', [why, `Technical detail: ${n}${e && e.message ? ' — ' + e.message : ''}`], [
      h('button', { class: 'btn btn-primary btn-block', style: 'margin-bottom:10px', onclick: () => location.reload() }, 'Reload'),
      h('button', { class: 'btn btn-block', onclick: async () => { try { for (const k of await caches.keys()) await caches.delete(k); const regs = await navigator.serviceWorker.getRegistrations(); for (const r of regs) await r.unregister(); } catch (x) { /* ignore */ } location.reload(); } }, 'Clear app cache and reload (keeps your data)'),
    ], 'warn');
  }

  function lockScreen(title, subtitle, fields, btnLabel, onSubmit, extra) {
    root().innerHTML = '';
    const err = h('div', { class: 'error', id: 'pinErr' });
    const btn = h('button', { class: 'btn btn-primary btn-block', onclick: async () => { err.textContent = ''; btn.classList.add('busy'); try { await onSubmit(err, btn); } catch (ex) { err.textContent = 'Error: ' + (ex && ex.message || ex); } btn.classList.remove('busy'); } }, btnLabel);
    root().appendChild(h('div', { class: 'lock' }, [
      h('div', { class: 'logo' }, ic('clip')), h('h1', {}, title),
      h('p', { class: 'muted', style: 'max-width:320px;line-height:1.45' }, subtitle),
      DB.status.mode === 'memory' ? h('div', { class: 'warnbar', style: 'max-width:340px;text-align:left' }, [h('b', {}, '⚠ Storage is blocked in this browser'), 'Records would be kept only in temporary memory and lost when you close this page. Open the app in Chrome (not a private or embedded window) before entering real data.']) : null,
      h('div', { class: 'box' }, [...fields, err, btn, extra]),
    ]));
    setTimeout(() => fields[0] && fields[0].focus(), 60);
  }

  const weakPin = (p) => /^(.)\1+$/.test(p) || '0123456789'.includes(p) || '9876543210'.includes(p) || ['1212', '2580', '1122', '2000', '1004'].includes(p);

  function renderSetupPin() {
    const p1 = h('input', { id: 'pin1', class: 'input', type: 'password', inputmode: 'numeric', placeholder: 'New PIN', autocomplete: 'new-password' });
    const p2 = h('input', { id: 'pin2', class: 'input', type: 'password', inputmode: 'numeric', placeholder: 'Confirm PIN', autocomplete: 'new-password' });
    lockScreen('Anaesthesia Log', 'Create a PIN (4+ characters, 6+ is much stronger). It encrypts all data on this device. You can add a recovery code or fingerprint unlock right after.', [p1, p2], 'Create PIN', async (err) => {
      if (p1.value.length < 4) return (err.textContent = 'PIN must be at least 4 characters.');
      if (p1.value !== p2.value) return (err.textContent = 'PINs do not match.');
      if (weakPin(p1.value)) return (err.textContent = 'That PIN is too easy to guess (repeated or sequential digits).');
      const salt = CryptoModule.newSalt(), iter = CryptoModule.ITER_NEW;
      const key = await CryptoModule.deriveKey(p1.value, salt, iter);
      await DB.batch([{ store: 'meta', op: 'put', value: { key: 'salt', value: salt } }, { store: 'meta', op: 'put', value: { key: 'kdf', value: { iter } } }, { store: 'meta', op: 'put', value: { key: 'verifier', value: await CryptoModule.makeVerifier(key) } }]);
      state.key = key; state.settings = defaultSettings(); state.cases = []; state.duties = []; state.preops = []; state.procedures = []; state.templates = []; state.corrupt = [];
      await saveSettings();
      await afterUnlock(true);
      if (X.recoveryNudge) X.recoveryNudge();
    });
  }

  /** Everything needed to open the data key, as plain values. */
  async function metaNow() {
    const g = async (k) => { const r = await DB.get('meta', k); return r ? r.value : null; };
    return { salt: await g('salt'), kdf: await g('kdf'), verifier: await g('verifier'), keywrap: await g('keywrap') };
  }
  /** Enter the app with a data key obtained some way other than typing the PIN (fingerprint, recovery). */
  async function unlockWithRaw(raw) { await clearLockout(); state.key = await Keys.aesKey(raw); await afterUnlock(false); }

  // Failed-PIN lockout is stored on the device, so reloading the page does not reset it.
  const getLockout = async () => { const r = await DB.get('meta', 'lockout'); return r ? r.value : { fails: 0, until: 0 }; };
  const delayFor = (fails) => (fails < 5 ? 0 : [30, 60, 300, 900, 3600][Math.min(fails - 5, 4)]);
  async function registerFail() {
    const l = await getLockout(); l.fails++; const d = delayFor(l.fails); l.until = d ? Date.now() + d * 1000 : 0;
    await DB.put('meta', { key: 'lockout', value: l }); return l;
  }
  const clearLockout = () => DB.del('meta', 'lockout');
  const fmtWait = (ms) => { const sec = Math.ceil(ms / 1000); return sec >= 60 ? `${Math.ceil(sec / 60)} min` : `${sec} s`; };

  function renderUnlock() {
    const pin = h('input', { id: 'pinIn', class: 'input', type: 'password', inputmode: 'numeric', placeholder: 'PIN', autocomplete: 'current-password', onkeydown: (e) => e.key === 'Enter' && $('.lock .btn-primary').click() });
    let timer = null;
    const countdown = (err, btn, until) => {
      clearInterval(timer);
      const tick = () => { const left = until - Date.now(); if (left <= 0) { clearInterval(timer); btn.disabled = false; err.textContent = ''; return; } btn.disabled = true; err.textContent = `Too many wrong attempts. Try again in ${fmtWait(left)}.`; };
      tick(); timer = setInterval(tick, 1000);
    };
    const forgot = h('button', { class: 'link', style: 'margin-top:6px', id: 'forgotPin', onclick: () => (X.openForgotPin || openForgotPin)() }, 'Forgot PIN?');
    lockScreen('Anaesthesia Log', 'Enter your PIN to unlock.', [pin], 'Unlock', async (err, btn) => {
      if (btn.disabled) return;
      const lo = await getLockout();
      if (lo.until > Date.now()) return countdown(err, btn, lo.until);
      const raw = await Keys.rawWithPin(pin.value, await metaNow());
      if (!raw) {
        const l = await registerFail(); pin.value = '';
        if (l.until > Date.now()) countdown(err, btn, l.until);
        else err.textContent = `Incorrect PIN. ${5 - l.fails} attempt${5 - l.fails === 1 ? '' : 's'} left before a delay.`;
        return;
      }
      clearInterval(timer); await clearLockout(); state.key = await Keys.aesKey(raw);
      await afterUnlock(false);
    }, forgot);
    if (X.decorateUnlock) X.decorateUnlock();
    getLockout().then((lo) => { if (lo.until > Date.now()) countdown($('#pinErr'), $('.lock .btn-primary'), lo.until); }).catch(() => {});
  }

  function openForgotPin() {
    const typed = h('input', { class: 'input', placeholder: 'Type ERASE to confirm', id: 'eraseConfirm' });
    const close = openSheet('Forgot your PIN?', h('div', {}, [
      h('p', {}, 'The PIN is the encryption key. It cannot be recovered or reset, by design, so nobody (including the developer) can open your data without it.'),
      h('p', {}, 'Your options: (1) keep trying PINs you may have used; (2) restore a backup file, which asks for the PIN that was active when that backup was made; (3) erase this device and start again.'),
      h('label', { class: 'btn btn-block', style: 'margin-bottom:10px' }, [ic('upload'), 'Restore from a backup file', h('input', { type: 'file', accept: 'application/json,.json', class: 'hidden-file', onchange: (e) => { const f = e.target.files[0]; if (f) { close(); restoreFlow(f, { fromLock: true }); } } })]),
      h('div', { class: 'field' }, [h('label', {}, 'Erase everything on this device'), typed]),
      h('button', { class: 'btn btn-danger btn-block', onclick: async () => { if (typed.value.trim() !== 'ERASE') return toast('Type ERASE first'); await DB.clearAll(); close(); location.reload(); } }, [ic('trash'), 'Erase all data and start again']),
    ]));
  }

  /** Everything after a successful PIN: load, record the schema version, ask for durable storage. */
  async function afterUnlock(fresh) {
    state.corrupt = [];
    if (!fresh) {
      await loadSettings();
      await Promise.all([loadAllCases(), loadAllDuties(), loadAllPreops(), loadAllProcedures(), loadAllTemplates()]);
    }
    await recordSchema(fresh);
    if (X.refreshSecurityStatus) await X.refreshSecurityStatus();
    DB.requestPersistence();
    applyTheme();
    lastActive = Date.now();
    enterApp();
    if (state.corrupt.length) toast(`${state.corrupt.length} stored record(s) could not be read — see Settings → Data health`);
  }
  async function recordSchema(fresh) {
    const rec = await DB.get('meta', 'schema');
    const prev = rec && rec.value ? rec.value : null;
    if (prev && prev.version >= Schema.VERSION) return;
    const from = prev ? prev.version : (fresh ? Schema.VERSION : 7);
    const value = { version: Schema.VERSION, app: Schema.APP_VERSION, from, migrated_at: new Date().toISOString(), counts: { cases: state.cases.length, preops: state.preops.length, duties: state.duties.length } };
    await DB.put('meta', { key: 'schema', value });
  }
  function applyTheme() {
    const t = state.settings?.theme || 'auto';
    if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t);
  }

  function enterApp() {
    state.filters = emptyFilters(todayISO().slice(0, 7));
    state.reportMonth = todayISO().slice(0, 7);
    try { history.replaceState({ route: 'home' }, ''); } catch (e) { /* ignore */ }
    go('home', null, { replace: true });
  }

  // ------------------------------------------------------------------
  // routing (with real browser back-button support)
  // ------------------------------------------------------------------
  function go(route, param = null, opts = {}) {
    if (route !== 'preopEdit') { state.preopDraft = null; X.clearPreopPending && X.clearPreopPending(); }
    if (route !== 'add') { state.pending = null; revokeImage(); state.editingId = null; state.template = null; state.addDate = null; }
    state.route = route; state.param = param;
    try { opts.replace ? history.replaceState({ route, param }, '') : history.pushState({ route, param }, ''); } catch (e) { /* ignore */ }
    window.scrollTo(0, 0);
    render();
  }
  function onPop(e) {
    if (!state.key) return;
    const s = e.state;
    state.pending = null; revokeImage(); state.editingId = null;
    if (s && s.route && s.route !== 'add') { state.route = s.route; state.param = s.param; } else { state.route = 'home'; state.param = null; }
    render();
  }
  function revokeImage() { if (state.pendingImage?.url) URL.revokeObjectURL(state.pendingImage.url); state.pendingImage = null; }

  const SCREENS = { home: renderHome, add: renderAdd, cases: renderCases, day: renderDay, monthly: renderReports, settings: renderSettings, preop: renderPreopList, preopEdit: renderPreopEdit };

  function banners() {
    const out = [];
    if (DB.status.mode === 'memory') out.push(h('div', { class: 'warnbar' }, [h('b', {}, '⚠ Records are NOT being saved'), 'This browser is blocking storage, so everything is held only in temporary memory and will be lost when you close or reload this page. Open the app in Chrome (not a private or embedded window), or download a backup before you leave. ', h('button', { class: 'link', style: 'padding:0 0 0 4px', onclick: () => X.doBackup && X.doBackup() }, 'Download backup')]));
    if (state.corrupt.length && ['home', 'settings'].includes(state.route)) out.push(h('button', { class: 'warnbar', style: 'width:100%;text-align:left', onclick: () => go('health') }, [h('b', {}, `⚠ ${state.corrupt.length} stored record(s) could not be read`), 'Tap for details. The rest of your data is unaffected.']));
    return out;
  }

  function render() {
    root().innerHTML = '';
    const screen = h('div', { class: 'screen' });
    root().appendChild(screen);
    banners().forEach((b) => screen.appendChild(b));
    (SCREENS[state.route] || renderHome)(screen);
    if (!['add', 'preopEdit', 'procEdit'].includes(state.route)) root().appendChild(dock());
  }

  const MORE_ROUTES = ['more', 'settings', 'backup', 'security', 'procedures', 'procEdit', 'portfolio', 'portfolioCat', 'analytics', 'reports', 'search', 'health', 'bin', 'templates'];
  function dock() {
    const item = (route, icon, label, on) => h('button', { class: on ? 'on' : '', 'aria-label': label, onclick: () => go(route) }, [ic(icon), label]);
    const r = state.route;
    return h('nav', { class: 'dock' }, [
      item('home', 'home', 'Home', r === 'home'),
      item('cases', 'list', 'Cases', r === 'cases' || r === 'day'),
      h('button', { class: 'add', 'aria-label': 'Add case', onclick: () => go('add') }, [ic('plus'), 'Add']),
      item('preop', 'clip', 'Pre-op', r === 'preop' || r === 'preopEdit'),
      item('more', 'grid', 'More', MORE_ROUTES.includes(r)),
    ]);
  }

  function pageHead(title, sub, right, back) {
    return h('div', { class: 'page-head' }, [
      back ? h('button', { class: 'icon-btn', 'aria-label': 'Back', onclick: () => (history.length > 1 ? history.back() : go(back)) }, ic('left')) : h('div', { class: 'logo' }, ic('clip')),
      h('div', { class: 'page-title' }, [h('small', {}, sub), h('h1', {}, title)]),
      right,
    ]);
  }

  // ------------------------------------------------------------------
  // shared pieces
  // ------------------------------------------------------------------
  const tile = (num, label, tone, onclick) => h(onclick ? 'button' : 'div', { class: `tile t-${tone}`, onclick }, [h('div', { class: 'num' }, num), h('div', { class: 'lbl' }, label)]);

  function caseCard(c, sno) {
    const tone = toneOf(c.anaesthetist);
    const card = h('div', { class: 'case ' + tone });
    const sub = [c.age ? `${c.age}/${(c.sex || '?')[0]}` : '', c.surgery, c.anaesthesia_mode, c.asa ? `ASA ${c.asa}${c.urgency === 'Emergency' ? 'E' : ''}` : ''].filter(Boolean).join(' · ') || '—';
    card.appendChild(h('button', { class: 'case-head', onclick: () => card.classList.toggle('open') }, [
      h('span', { class: 'avatar' }, sno ? String(sno) : initials(c.patient_name)),
      h('span', { class: 'case-main' }, [h('b', {}, [c.notable ? ic('star', 'fill-ic starmark') : null, c.patient_name || '(no name)']), h('small', {}, sub)]),
      h('span', { class: 'tag' }, shortName(c.anaesthetist)),
      ic('chev'),
    ]));
    const kv = (k, v) => h('div', { class: 'kv' }, [h('span', {}, k), h('span', {}, v || '—')]);
    card.appendChild(h('div', { class: 'case-body' }, [
      kv('Date', fmtDate(c.case_date)), kv('UHID', c.uhid), kv('Visit No', c.visit_number), kv('Consultant', c.consultant),
      kv('Surgery', c.surgery), kv('Mode', c.anaesthesia_mode), kv('Hospital', [c.hospital, c.location].filter(Boolean).join(', ')),
      kv('Anaesthetist', c.anaesthetist + (c.is_override ? ' (manual)' : '')),
      ...X.caseExtraRows(c).map(([k, v]) => kv(k, v)),
      c.notable ? h('div', { class: 'notable-box' }, [h('b', {}, [ic('star', 'fill-ic'), c.notable_type || 'Notable case']), c.notable_note || '']) : null,
      h('div', { class: 'case-actions' }, [
        h('button', { class: 'btn btn-sm', onclick: () => openEdit(c.case_id) }, [ic('edit'), 'Edit']),
        h('button', { class: 'btn btn-sm', onclick: () => viewImage(c.case_id) }, [ic('eye'), 'Photo']),
        h('button', { class: 'btn btn-sm btn-danger', onclick: () => confirmDelete(c.case_id) }, [ic('trash'), 'Delete']),
      ]),
      h('div', { class: 'case-actions', style: 'margin-top:8px' }, [
        h('button', { class: 'btn btn-sm btn-soft', onclick: () => X.logProcedureFor && X.logProcedureFor(c) }, [ic('syringe'), 'Log procedure']),
        h('button', { class: 'btn btn-sm btn-soft', onclick: () => X.saveTemplateSheet(c) }, [ic('bolt'), 'Template']),
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
  // NIGHT DUTY
  // ------------------------------------------------------------------
  /** Before 08:00 you are still on last evening's night duty, so the button uses yesterday's date. */
  const nightDutyDate = () => (new Date().getHours() < 8 ? shiftDay(todayISO(), -1) : todayISO());

  async function addNightDuty(date) {
    const d = { duty_id: uid(), date, hospital: state.settings.hospital, location: state.settings.location, start: '20:00', end: '08:00', notes: '', created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    state.duties.push(d);
    await putDuty(d);
    render();
    toast(`Night duty added · ${fmtDay(date)}`, 'Edit', () => openDutySheet(d));
  }

  function openDutySheet(duty) {
    const d = { ...duty };
    const dateIn = h('input', { class: 'input', type: 'date', value: d.date, onchange: (e) => e.target.value && (d.date = e.target.value) });
    const hosp = h('input', { class: 'input', list: 'hospList', value: d.hospital || '', oninput: (e) => (d.hospital = e.target.value) });
    const loc = h('input', { class: 'input', value: d.location || '', oninput: (e) => (d.location = e.target.value) });
    const st = h('input', { class: 'input', type: 'time', value: d.start || '20:00', onchange: (e) => (d.start = e.target.value) });
    const en = h('input', { class: 'input', type: 'time', value: d.end || '08:00', onchange: (e) => (d.end = e.target.value) });
    const notes = h('textarea', { class: 'input', placeholder: 'Cases, handover, anything to remember…', oninput: (e) => (d.notes = e.target.value) });
    notes.value = d.notes || '';
    const hospChips = h('div', { class: 'chip-grid', style: 'padding-top:8px' }, hospitalList().map((n) => h('button', { class: 'chip', onclick: () => { d.hospital = n; hosp.value = n; } }, n)));
    const close = openSheet('Night duty', h('div', {}, [
      h('div', { class: 'field' }, [h('label', {}, 'Duty starts on'), dateIn, h('div', { class: 'note' }, 'The evening the duty begins. It runs overnight into the next morning.')]),
      h('div', { class: 'field' }, [h('label', {}, 'Hospital'), hosp, h('datalist', { id: 'hospList' }, hospitalList().map((n) => h('option', { value: n }))), hospChips]),
      h('div', { class: 'field' }, [h('label', {}, 'Location'), loc]),
      h('div', { class: 'grid2' }, [h('div', { class: 'field' }, [h('label', {}, 'From'), st]), h('div', { class: 'field' }, [h('label', {}, 'To (next day)'), en])]),
      h('div', { class: 'field' }, [h('label', {}, 'Notes'), notes]),
      h('div', { class: 'btn-row' }, [
        h('button', { class: 'btn btn-danger', onclick: () => { close(); removeDuty(duty); } }, [ic('trash'), 'Remove']),
        h('button', { class: 'btn btn-primary', onclick: async () => {
          d.updated_at = new Date().toISOString();
          const i = state.duties.findIndex((x) => x.duty_id === d.duty_id);
          if (i >= 0) state.duties[i] = d;
          await putDuty(d);
          if (rememberLists({ hospital: d.hospital })) await saveSettings();
          close(); render(); toast('Night duty saved');
        } }, [ic('check'), 'Save']),
      ]),
    ]));
  }

  async function removeDuty(d) {
    state.duties = state.duties.filter((x) => x.duty_id !== d.duty_id);
    await DB.del('duties', d.duty_id);
    render();
    toast('Night duty removed', 'Undo', async () => { state.duties.push(d); await putDuty(d); render(); });
  }

  function dutyCard(d) {
    return h('button', { class: 'duty', onclick: () => openDutySheet(d) }, [
      h('span', { class: 'moon-badge' }, ic('moon')),
      h('span', { class: 'dmain' }, [h('b', {}, `Night duty · ${fmtDay(d.date)}`), h('small', {}, [d.hospital, d.location].filter(Boolean).join(', ') || '—'), h('small', {}, `${d.start || ''}${d.start ? ' → ' : ''}${d.end || ''}${d.notes ? ' · ' + d.notes : ''}`)]),
      ic('edit'),
    ]);
  }

  // ------------------------------------------------------------------
  // HOME
  // ------------------------------------------------------------------
  function recentTemplates(limit = 3) {
    const map = new Map();
    for (const c of [...activeCases()].sort((a, b) => b.created_at.localeCompare(a.created_at))) {
      if (!c.surgery && !c.anaesthesia_mode) continue;
      const k = (c.surgery || '') + '|' + (c.anaesthesia_mode || '');
      if (!map.has(k)) map.set(k, { surgery: c.surgery || '', mode: c.anaesthesia_mode || '' });
    }
    return [...map.values()].slice(0, limit);
  }

  function theatreSVG() {
    return `<svg viewBox="0 0 360 170" role="img" aria-label="Operating theatre illustration">
      <rect width="360" height="170" fill="var(--mint)"/><rect y="118" width="360" height="52" fill="var(--line)" opacity=".55"/><rect y="112" width="360" height="8" fill="var(--brand-2)" opacity=".45"/>
      <g class="lamp"><circle cx="150" cy="22" r="15" fill="#ffd96b"/><circle cx="150" cy="22" r="8" fill="#fff4c4"/><circle cx="196" cy="22" r="15" fill="#ffd96b"/><circle cx="196" cy="22" r="8" fill="#fff4c4"/></g>
      <path d="M120 0v8h110V0" stroke="var(--muted)" stroke-width="3" fill="none"/>
      <rect x="130" y="80" width="110" height="14" rx="6" fill="var(--card)" stroke="var(--muted)" stroke-width="2"/><rect x="180" y="94" width="10" height="26" fill="var(--muted)"/><rect x="164" y="118" width="42" height="6" rx="3" fill="var(--muted)"/>
      <ellipse cx="170" cy="74" rx="34" ry="8" fill="#9fd9c0"/><circle cx="142" cy="70" r="7" fill="#f2c9a5"/>
      <rect x="40" y="52" width="58" height="48" rx="6" fill="var(--card)" stroke="var(--muted)" stroke-width="2"/><rect x="47" y="59" width="44" height="26" rx="3" fill="#10231d"/>
      <polyline class="ecg" points="49,74 58,74 62,64 67,84 72,70 76,74 89,74" fill="none" stroke="#58e0a8" stroke-width="2"/><rect x="50" y="100" width="40" height="22" fill="var(--muted)" opacity=".5"/>
      <rect x="262" y="60" width="52" height="60" rx="6" fill="var(--card)" stroke="var(--muted)" stroke-width="2"/>
      <rect x="270" y="70" width="36" height="8" rx="3" fill="var(--brand-2)"/><rect x="270" y="84" width="36" height="8" rx="3" fill="var(--sky-ink)" opacity=".6"/><rect x="270" y="98" width="36" height="8" rx="3" fill="#e9a23b"/>
      <g><circle cx="116" cy="82" r="8" fill="#f2c9a5"/><rect x="106" y="90" width="20" height="30" rx="8" fill="#3f9a78"/></g>
      <g><circle cx="226" cy="82" r="8" fill="#f2c9a5"/><rect x="216" y="90" width="20" height="30" rx="8" fill="#2a6fb5"/></g></svg>`;
  }

  function renderHome(screen) {
    const roster = state.settings.anaesthetists;
    const today = todayISO(), ym = today.slice(0, 7);
    const all = activeCases();
    const monthCases = all.filter((c) => c.case_date.startsWith(ym));
    const ms = Stats.monthlyStats(monthCases, roster);
    const ts = Stats.dailySummary(all.filter((c) => c.case_date === today), roster);
    const openCases = (patch) => { state.casesView = 'list'; state.filters = { ...emptyFilters(ym), ...patch }; go('cases'); };

    screen.appendChild(pageHead('Anaesthesia Log', `${greeting()} · ${monthLabel(ym)}`, h('button', { class: 'icon-btn', 'aria-label': 'Lock', onclick: lockNow }, ic('lock'))));

    screen.appendChild(h('button', { class: 'hero', onclick: () => go('add') }, [
      h('span', { class: 'chev' }, ic('chev')), h('div', { class: 'hero-plus' }, ic('camera')),
      h('h2', {}, 'Add Case'), h('p', {}, 'Photo → auto-fill → save in seconds'),
    ]));

    // backup reminder
    {
      const st = state.settings, days = st.backupRemindDays;
      const age = st.lastBackupAt ? Math.floor((Date.now() - new Date(st.lastBackupAt).getTime()) / 86400000) : null;
      if (days && all.length && (age === null || age >= days)) screen.appendChild(h('button', { class: 'warnbar', id: 'backupRemind', style: 'width:100%;text-align:left', onclick: () => go('backup') }, [ic('warn', 'inl'), age === null ? ' You have never backed up. Your data lives only on this phone — tap to back up.' : ` Last backup was ${age} days ago. Tap to back up now.`]));
    }
    { const n = X.homeNudge && X.homeNudge(); if (n) screen.appendChild(n); }
    // one-tap night duty
    const nd = nightDutyDate(), existing = dutiesOn(nd)[0];
    screen.appendChild(h('button', { class: 'night-btn' + (existing ? ' on' : ''), id: 'nightBtn', onclick: () => (existing ? openDutySheet(existing) : addNightDuty(nd)) }, [
      h('span', { class: 'moon-badge' }, ic(existing ? 'check' : 'moon')),
      h('span', {}, [h('b', {}, existing ? 'On night duty' : 'Night duty'), h('small', {}, existing ? `${fmtDay(nd)} · ${existing.hospital || 'tap to edit'}` : `Tap once to mark ${nd === today ? 'tonight' : fmtDay(nd)} on your calendar`)]),
      h('span', { class: 'go' }, ic(existing ? 'edit' : 'plus')),
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

    screen.appendChild(h('div', { class: 'section-title' }, [h('h2', {}, monthLabel(ym)), h('button', { onclick: () => go('monthly') }, 'Full report')]));
    screen.appendChild(h('div', { class: 'tiles' }, [
      tile(ms.totalCases, 'Cases this month', 'mint', () => openCases({})),
      tile(ms.byAnaesthetist[roster[0]] || 0, shortName(roster[0]), 'sky', () => openCases({ anaes: roster[0] })),
      tile(ms.byAnaesthetist[roster[1]] || 0, shortName(roster[1] || '—'), 'amber', () => roster[1] && openCases({ anaes: roster[1] })),
      tile(ms.avgPerDay, `Avg / day · ${ms.workingDays} days`, 'violet', () => go('reports')),
      tile(dutiesInMonth(ym).length, 'Night duties', 'night', () => { state.casesView = 'calendar'; state.filters = emptyFilters(ym); go('cases'); }),
      tile(ms.notableCount, 'Notable cases', 'amber', () => openCases({ notable: true })),
    ]));

    const days = []; for (let i = 6; i >= 0; i--) days.push(shiftDay(today, -i));
    const max = Math.max(1, ...days.map((d) => casesForDate(d).length));
    screen.appendChild(h('div', { class: 'card' }, [
      h('h3', {}, 'Last 7 days'),
      h('div', { class: 'week' }, days.map((d, i) => {
        const dc = casesForDate(d);
        const bar = h('div', { class: 'wbar', style: `height:${Math.max(4, (dc.length / max) * 100)}px;animation-delay:${i * 60}ms` },
          roster.map((n) => h('i', { style: `height:${dc.length ? (dc.filter((c) => c.anaesthetist === n).length / dc.length) * 100 : 0}%;background:${TONE_VAR[toneOf(n)]}` })));
        return h('button', { class: 'wcol' + (d === today ? ' today' : ''), onclick: () => go('day', d) }, [h('b', {}, dc.length || ''), bar, dutiesOn(d).length ? ic('moon', 'wmoon') : null, h('small', {}, DOW[parseISO(d).getDay()][0])]);
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

    screen.appendChild(h('div', { class: 'cap-btns' }, [
      h('label', { class: 'btn btn-primary' }, [ic('camera'), 'Take photo', h('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'hidden-file', onchange: onImageChosen })]),
      h('label', { class: 'btn' }, [ic('image'), 'Upload photo', h('input', { type: 'file', accept: 'image/*', class: 'hidden-file', onchange: onImageChosen })]),
    ]));
    screen.appendChild(h('div', { id: 'ocrStatus', class: 'center' }));
    screen.appendChild(h('div', { class: 'center' }, h('button', { class: 'link', onclick: () => { buildReview({ fields: {}, confidence: {}, raw: '' }); render(); } }, 'Skip photo — enter manually')));
  }

  async function prepareImages(file) {
    // Downscale to ~1800px: faster OCR and smaller encrypted storage.
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      const scale = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
      const w = Math.round(bmp.width * scale), hh = Math.round(bmp.height * scale);
      const mk = (filter) => { const cv = document.createElement('canvas'); cv.width = w; cv.height = hh; const ctx = cv.getContext('2d'); if (filter) ctx.filter = filter; ctx.drawImage(bmp, 0, 0, w, hh); return new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.85)); };
      const [store, ocr] = await Promise.all([mk(''), mk('grayscale(1) contrast(1.25)')]);
      return { store: store || file, ocr: ocr || file };
    } catch (e) { return { store: file, ocr: file }; }
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
      techniques: Schema.techniquesFromMode(t?.mode || state.settings.lastMode || ''),
      urgency: '', asa: '', speciality: '', complexity: '', comorbidities: [], risk_factors: [], airway: {}, intraop: {}, postop: {}, schema_version: Schema.VERSION,
      notable: false, notable_type: '', notable_note: '',
      hospital: state.settings.hospital, location: state.settings.location,
      anaesthetist: seq.suggested, sequence_index: seq.sequence_index, is_override: false,
      payment_mode: fields.payment_mode || '', document_date: fields.doa || '',
      ocr_raw_text: raw, ocr_confidence: confidence || {},
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(), deleted_at: null,
    };
  }

  const suggestedFor = (c) => Sequence.nextSuggestedAnaesthetist(casesForDate(c.case_date).filter((x) => x.case_id !== c.case_id), state.settings.anaesthetists).suggested;

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

  function chipGroup(options, getVal, setVal, extra = '') {
    const wrap = h('div', { class: 'chip-grid' });
    const paint = () => { wrap.innerHTML = ''; options.forEach((o) => wrap.appendChild(h('button', { class: 'chip ' + extra + (getVal() === o ? ' on' : ''), onclick: () => { setVal(getVal() === o ? '' : o); paint(); } }, o))); };
    paint();
    return wrap;
  }

  /** "Sick / interesting case" flag — optional, with a type and a short note. */
  function notableCard(c) {
    const card = h('div', { class: 'card' });
    const paint = () => {
      card.innerHTML = '';
      card.appendChild(h('button', { class: 'toggle-row' + (c.notable ? ' on' : ''), id: 'notableToggle', onclick: () => { c.notable = !c.notable; paint(); } }, [
        ic('star', c.notable ? 'fill-ic' : ''), h('span', { style: 'flex:1' }, [h('b', {}, 'Sick / interesting case'), h('small', {}, c.notable ? 'Add the details below' : 'Turn on to add details about the case')]), h('span', { class: 'sw' }),
      ]));
      if (c.notable) {
        const note = h('textarea', { class: 'input', id: 'notableNote', rows: '6', placeholder: 'Write the case details here: what happened, how you managed it, outcome, learning points. e.g. Grade 4 view, needed bougie + video laryngoscope', oninput: (e) => (c.notable_note = e.target.value) });
        note.value = c.notable_note || '';
        card.appendChild(h('div', { class: 'notable-body' }, [
          h('div', { class: 'field' }, [h('label', {}, 'Type'), chipGroup(NOTABLE_TYPES, () => c.notable_type, (v) => (c.notable_type = v), 'star')]),
          h('div', { class: 'field' }, [h('label', {}, 'Case details'), note, h('div', { class: 'note' }, 'Keep it clinical. Avoid names or ID numbers here.')]),
        ]));
      }
    };
    paint();
    return card;
  }

  function renderReview(screen) {
    const c = state.pending;
    const editing = !!state.editingId;
    screen.appendChild(pageHead(editing ? 'Edit Case' : 'Review Case', editing ? 'Update details' : 'Step 2 of 2 · check & save', null, 'home'));

    if (state.pendingImage?.url) screen.appendChild(h('img', { class: 'thumb', src: state.pendingImage.url, alt: 'Registration sheet', onclick: () => openSheet('Original sheet', h('img', { src: state.pendingImage.url })) }));
    screen.appendChild(X.entryModeToggle());
    const strip = X.templateStrip(c); if (strip) screen.appendChild(strip);

    screen.appendChild(h('div', { class: 'card' }, [
      h('h3', {}, 'Patient'), field('Patient name', 'patient_name'),
      h('div', { class: 'grid2' }, [field('Age', 'age', { type: 'number', inputmode: 'numeric' }), h('div', { class: 'field' }, [h('label', {}, 'Sex'), chipGroup(['Male', 'Female', 'Other'], () => c.sex, (v) => (c.sex = v))])]),
      field('UHID', 'uhid'), field('Visit no', 'visit_number'), field('Consultant / Surgeon', 'consultant'),
    ]));

    const surgeryInput = h('input', { class: 'input', type: 'text', list: 'surgeryList', placeholder: 'e.g. Lap cholecystectomy', value: c.surgery || '', oninput: (e) => { c.surgery = e.target.value; document.dispatchEvent(new Event('surgery-changed')); } });
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
      h('div', { class: 'field' }, [h('label', {}, 'Surgery / procedure'), surgeryInput, h('datalist', { id: 'surgeryList' }, (state.settings.surgeries || []).map((n) => h('option', { value: n }))),
        recentSurg.length ? h('div', { class: 'chips', style: 'padding-top:8px' }, recentSurg.map((n) => h('button', { class: 'chip', onclick: () => { c.surgery = n; surgeryInput.value = n; document.dispatchEvent(new Event('surgery-changed')); } }, n))) : null]),
      X.techniqueField(c),
    ]));
    screen.appendChild(X.clinicalCard(c));
    X.detailSections(c, () => render()).forEach((n) => screen.appendChild(n));

    screen.appendChild(notableCard(c));

    const hospIn = h('input', { class: 'input', list: 'hospList', value: c.hospital || '', oninput: (e) => (c.hospital = e.target.value) });
    screen.appendChild(h('div', { class: 'card' }, [
      h('h3', {}, 'Location'),
      h('div', { class: 'field' }, [h('label', {}, 'Hospital'), hospIn, h('datalist', { id: 'hospList' }, hospitalList().map((n) => h('option', { value: n }))), h('div', { class: 'chip-grid', style: 'padding-top:8px' }, hospitalList().map((n) => h('button', { class: 'chip', onclick: () => { c.hospital = n; hospIn.value = n; } }, n)))]),
      field('Location', 'location'),
    ]));

    screen.appendChild(h('button', { class: 'btn btn-block', id: 'saveTpl', style: 'margin-bottom:14px', onclick: () => X.saveTemplateSheet(c) }, [ic('bolt'), 'Save as template']));
    screen.appendChild(h('div', { class: 'sticky-bar' }, h('div', { class: 'inner' }, [
      h('button', { class: 'btn', onclick: () => (history.length > 1 ? history.back() : go('home')) }, 'Cancel'),
      h('button', { class: 'btn btn-primary', id: 'saveBtn', onclick: () => saveCase(false) }, [ic('check'), editing ? 'Save changes' : 'Save case']),
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
    if (!c.notable) { c.notable_type = ''; c.notable_note = ''; }
    if ((c.techniques || []).length) c.anaesthesia_mode = Schema.modeFromTechniques(c.techniques);
    c.postop = c.postop || {}; if (c.postop.pain === '' || c.postop.pain == null) delete c.postop.pain;
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
    const strong = dups.some((d) => d.strength === 'strong');
    const list = h('div', {}, dups.map((d) => h('div', { class: 'card', style: 'box-shadow:none;margin-bottom:8px' }, [
      h('b', {}, d.case.patient_name), h('div', { class: 'muted', style: 'font-size:13px' }, `${fmtDate(d.case.case_date)} · ${d.case.uhid || ''} · ${shortName(d.case.anaesthetist)}`),
      h('div', { class: 'pill', style: 'margin-top:6px' }, (d.strength === 'strong' ? 'Strong match: ' : 'Weaker match: ') + d.matchedOn.join(', ')),
    ])));
    const close = openSheet(strong ? '⚠ Likely duplicate' : 'Seen before', h('div', {}, [
      h('p', {}, strong ? 'A very similar case already exists (same visit, or same patient on the same day):' : 'Same UHID on a different date. This is normal for a repeat visit, so save if this is a new procedure:'), list,
      h('div', { class: 'btn-row' }, [h('button', { class: 'btn', onclick: () => close() }, 'Cancel'), h('button', { class: 'btn btn-primary', id: 'dupSave', onclick: () => { close(); saveCase(true); } }, strong ? 'Save anyway' : 'Save')]),
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
    const duties = dutiesOn(date);

    screen.appendChild(pageHead(fmtDay(date), `${parseISO(date).getFullYear()} · daily log`, h('button', { class: 'icon-btn', 'aria-label': 'More', onclick: () => dayMenu(date, cases) }, ic('dots')), 'cases'));
    screen.appendChild(h('div', { class: 'month-nav' }, [
      h('button', { class: 'icon-btn', 'aria-label': 'Previous day', onclick: () => go('day', shiftDay(date, -1), { replace: true }) }, ic('left')),
      h('input', { class: 'input', type: 'date', value: date, style: 'max-width:200px;text-align:center;margin:0', onchange: (e) => e.target.value && go('day', e.target.value, { replace: true }) }),
      h('button', { class: 'icon-btn', 'aria-label': 'Next day', onclick: () => go('day', shiftDay(date, 1), { replace: true }) }, ic('chev')),
    ]));

    duties.forEach((d) => screen.appendChild(dutyCard(d)));
    if (!duties.length) screen.appendChild(h('button', { class: 'btn btn-night btn-block', style: 'margin-bottom:12px', id: 'markNight', onclick: () => addNightDuty(date) }, [ic('moon'), 'Mark night duty']));

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
      if (f.from && c.case_date < f.from) return false;
      if (f.to && c.case_date > f.to) return false;
      if (f.anaes !== 'ALL' && c.anaesthetist !== f.anaes) return false;
      if (f.consultant && !(c.consultant || '').toLowerCase().includes(f.consultant.toLowerCase())) return false;
      if (f.hospital && c.hospital !== f.hospital) return false;
      if (f.mode && c.anaesthesia_mode !== f.mode && !Schema.techniquesOf(c).includes(f.mode)) return false;
      if (f.asa && c.asa !== f.asa) return false;
      if (f.speciality && Schema.specialityOf(c).value !== f.speciality) return false;
      if (f.urgency && c.urgency !== f.urgency) return false;
      if (f.complication && !Schema.complicationsOf(c).length) return false;
      if (f.notable && !c.notable) return false;
      if (f.incomplete && c.surgery && c.asa && Schema.techniquesOf(c).length) return false;
      if (q) {
        const hay = [c.patient_name, c.uhid, c.visit_number, c.consultant, c.surgery, c.anaesthesia_mode, ...(c.techniques || []), c.asa && 'asa ' + c.asa, c.urgency, Schema.specialityOf(c).value, c.anaesthetist, c.hospital, c.location, c.case_date, fmtDate(c.case_date), c.notable_type, c.notable_note, ...Schema.complicationsOf(c)].join(' ').toLowerCase();
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
      h('button', { class: state.casesView === 'calendar' ? 'on' : '', id: 'calTab', onclick: () => { state.casesView = 'calendar'; if (!f.month) f.month = todayISO().slice(0, 7); render(); } }, [ic('calendar'), 'Calendar']),
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
      h('button', { class: 'chip star' + (f.notable ? ' on' : ''), id: 'notableChip', onclick: () => { f.notable = !f.notable; render(); } }, '★ Notable'),
      f.consultant ? h('button', { class: 'chip on', onclick: () => { f.consultant = ''; render(); } }, `${shortName(f.consultant)} ✕`) : null,
      f.hospital ? h('button', { class: 'chip on', onclick: () => { f.hospital = ''; render(); } }, `${f.hospital} ✕`) : null,
      f.mode ? h('button', { class: 'chip on', onclick: () => { f.mode = ''; render(); } }, `${f.mode} ✕`) : null,
      f.asa ? h('button', { class: 'chip on', onclick: () => { f.asa = ''; render(); } }, `ASA ${f.asa} ✕`) : null,
      f.speciality ? h('button', { class: 'chip on', onclick: () => { f.speciality = ''; render(); } }, `${f.speciality} ✕`) : null,
      f.urgency ? h('button', { class: 'chip on', onclick: () => { f.urgency = ''; render(); } }, `${f.urgency} ✕`) : null,
      f.complication ? h('button', { class: 'chip on', onclick: () => { f.complication = false; render(); } }, 'Complications ✕') : null,
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
    const duties = dutiesInMonth(ym);
    const grid = h('div', { class: 'cal' }, DOW.map((d) => h('div', { class: 'wd' }, d[0])));
    for (let i = 0; i < start; i++) grid.appendChild(h('div', { class: 'cal-cell blank' }));
    for (let d = 1; d <= days; d++) {
      const iso = `${ym}-${pad(d)}`;
      const dc = byDate.get(iso) || [];
      const night = dutiesOn(iso).length > 0;
      grid.appendChild(h('button', { class: 'cal-cell' + (dc.length ? ' has' : '') + (night ? ' night' : '') + (iso === todayISO() ? ' today' : ''), 'data-date': iso, onclick: () => go('day', iso) }, [
        night ? ic('moon', 'moon') : null, dc.some((c) => c.notable) ? ic('star', 'fill-ic stardot') : null,
        h('span', {}, d), dc.length ? h('em', {}, dc.length) : null, dc.length ? dotsFor(dc) : null,
      ]));
    }
    box.appendChild(grid);
    const roster = state.settings.anaesthetists;
    box.appendChild(h('div', { class: 'pill-row', style: 'margin-top:14px' }, [
      h('span', { class: 'pill' }, `${cases.length} cases`),
      ...roster.map((n) => h('span', { class: 'pill ' + toneOf(n) }, `${shortName(n)} · ${cases.filter((c) => c.anaesthetist === n).length}`)),
      h('span', { class: 'pill night' }, [ic('moon'), `${duties.length} night${duties.length === 1 ? '' : 's'}`]),
    ]));
    box.appendChild(h('div', { class: 'legend-row' }, [h('span', {}, [ic('moon'), 'Night duty']), h('span', {}, [ic('star', 'fill-ic'), 'Has a notable case']), h('span', {}, 'Tap a date to edit or add a night duty')]));
  }

  function openFilters() {
    const f = state.filters;
    const cases = activeCases();
    const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort();
    const consultants = uniq(cases.flatMap((c) => (c.consultant || '').split('/').map((x) => x.trim())));
    const sel = (label, options, key) => h('div', { class: 'field' }, [h('label', {}, label), h('select', { class: 'input', onchange: (e) => (f[key] = e.target.value) }, [h('option', { value: '' }, 'Any'), ...options.map((o) => h('option', { value: o, ...(f[key] === o ? { selected: true } : {}) }, o))])]);
    const month = h('input', { class: 'input', type: 'month', value: f.month, onchange: (e) => (f.month = e.target.value) });
    const close = openSheet('Filters', h('div', {}, [
      h('div', { class: 'field' }, [h('label', {}, 'Month (clear for all time)'), month]),
      sel('Consultant', consultants, 'consultant'), sel('Hospital', uniq(cases.map((c) => c.hospital)), 'hospital'), sel('Anaesthesia technique', Schema.TECHNIQUES, 'mode'),
      sel('ASA grade', Schema.ASA, 'asa'), sel('Surgical speciality', Schema.SPECIALITIES, 'speciality'), sel('Urgency', Schema.URGENCY, 'urgency'),
      h('label', { class: 'toggle-row', style: 'margin-bottom:12px' }, [h('input', { type: 'checkbox', id: 'fComp', ...(f.complication ? { checked: true } : {}), onchange: (e) => (f.complication = e.target.checked) }), h('span', { style: 'flex:1;margin-left:10px' }, 'Only cases with a recorded complication')]),
      h('div', { class: 'btn-row' }, [
        h('button', { class: 'btn', onclick: () => { state.filters = emptyFilters(todayISO().slice(0, 7)); close(); render(); } }, 'Reset'),
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
    const duties = dutiesInMonth(ym);
    const st = Stats.monthlyStats(cases, roster);
    const cross = Stats.consultantByAnaesthetist(cases);
    const toCases = (patch) => { state.casesView = 'list'; state.filters = { ...emptyFilters(ym), ...patch }; go('cases'); };

    screen.appendChild(pageHead('Reports', monthLabel(ym)));
    screen.appendChild(h('div', { class: 'month-nav' }, [
      h('button', { class: 'icon-btn', 'aria-label': 'Previous month', onclick: () => { state.reportMonth = shiftMonth(ym, -1); render(); } }, ic('left')),
      h('b', {}, monthLabel(ym)),
      h('button', { class: 'icon-btn', 'aria-label': 'Next month', onclick: () => { state.reportMonth = shiftMonth(ym, 1); render(); } }, ic('chev')),
    ]));

    screen.appendChild(h('div', { class: 'tiles' }, [
      tile(st.totalCases, 'Total cases', 'mint', null), tile(st.workingDays, 'Working days', 'sky', null),
      tile(st.avgPerDay, 'Avg / day', 'amber', null), tile(`${st.maxPerDay} / ${st.minPerDay}`, 'Max / min day', 'violet', null),
      tile(duties.length, 'Night duties', 'night', null), tile(st.notableCount, 'Notable cases', 'amber', null),
    ]));

    const colors = roster.map((n) => TONE_VAR[toneOf(n)]);
    screen.appendChild(h('div', { class: 'card' }, [
      h('h3', {}, 'Anaesthetist split'),
      h('div', { class: 'donut-wrap' }, [donut(roster.map((n) => st.byAnaesthetist[n] || 0), colors), h('div', { class: 'legend' }, roster.map((n, i) => h('div', {}, [h('i', { style: `background:${colors[i]}` }), shortName(n), h('b', {}, st.byAnaesthetist[n] || 0)])))]),
      h('button', { class: 'btn btn-soft btn-block', style: 'margin-top:14px', onclick: () => toCases({ anaes: roster[0] }) }, `My cases — ${monthLabel(ym)}`),
    ]));

    if (duties.length) screen.appendChild(h('div', { class: 'card' }, [h('h3', {}, `Night duties (${duties.length})`), ...duties.map(dutyCard)]));

    const notable = cases.filter((c) => c.notable).sort((a, b) => b.case_date.localeCompare(a.case_date));
    if (notable.length) screen.appendChild(h('div', { class: 'card', id: 'notableCard' }, [h('h3', {}, `Notable cases (${notable.length})`),
      ...notable.map((c) => h('button', { class: 'notable-item', onclick: () => go('day', c.case_date) }, [
        h('b', {}, [fmtDay(c.case_date), c.surgery ? ` · ${c.surgery}` : '', c.notable_type ? ` · ${c.notable_type}` : '']), h('small', {}, c.notable_note || 'No note')])),
      h('button', { class: 'btn btn-soft btn-block', style: 'margin-top:12px', onclick: () => toCases({ notable: true }) }, 'Open in Cases')]));

    if (Object.keys(st.byMode).length) screen.appendChild(h('div', { class: 'card' }, [h('h3', {}, 'Mode of anaesthesia'), ...barRows(st.byMode, 'var(--a2)', (name) => toCases({ mode: name }))]));
    if (Object.keys(st.bySurgery).length) screen.appendChild(h('div', { class: 'card' }, [h('h3', {}, 'Surgeries'), ...barRows(st.bySurgery, 'var(--a1)', (name) => toCases({ q: name }))]));

    if (Object.keys(st.byConsultant).length) {
      const max = Math.max(...Object.values(st.byConsultant));
      screen.appendChild(h('div', { class: 'card' }, [h('h3', {}, 'Consultant-wise'), ...Object.entries(st.byConsultant).sort((a, b) => b[1] - a[1]).map(([name, n]) => h('div', {}, [
        h('button', { class: 'bar-row', style: 'margin-bottom:4px', onclick: () => toCases({ consultant: name }) }, [h('div', { class: 'top' }, [h('span', {}, name), h('b', {}, n)]), h('div', { class: 'track' }, h('div', { class: 'fill', style: `width:${(n / max) * 100}%;background:var(--brand-2)` }))]),
        h('div', { class: 'sub', style: 'margin-bottom:12px' }, roster.map((r) => (cross[name]?.[r] ? h('span', { class: 'pill ' + toneOf(r) }, `${shortName(r)} · ${cross[name][r]}`) : null))),
      ]))]));
    }

    screen.appendChild(h('div', { class: 'card' }, [h('h3', {}, 'Insights'), h('ul', { class: 'insights' }, Stats.buildInsights(st, monthLabel(ym), duties.length).map((l) => h('li', {}, l)))]));

    const prefix = `anaesthesia-log-${ym}`;
    const mine = cases.filter((c) => c.anaesthetist === roster[0]);
    const hospitalLine = `${state.settings.hospital} – ${state.settings.location}`;
    screen.appendChild(h('div', { class: 'card' }, [
      h('h3', {}, 'Export month'),
      h('div', { class: 'btn-row' }, [
        h('button', { class: 'btn btn-primary', onclick: () => safeExport(() => ExportModule.exportMonthExcel({ cases, duties, roster, monthLabel: monthLabel(ym), fileNamePrefix: prefix })) }, [ic('download'), 'Excel']),
        h('button', { class: 'btn', onclick: () => safeExport(() => ExportModule.exportCasesCSV(cases, prefix + '.csv')) }, 'CSV'),
        h('button', { class: 'btn', onclick: () => safeExport(() => ExportModule.exportMonthPDF({ cases, duties, roster, monthLabel: monthLabel(ym), hospitalLine, fileNamePrefix: prefix })) }, 'PDF'),
      ]),
      h('button', { class: 'btn btn-soft btn-block', style: 'margin-top:10px', onclick: () => safeExport(() => ExportModule.exportCasesCSV(mine, `${prefix}-my-cases.csv`)) }, [ic('download'), `My cases only (${mine.length}) — CSV`]),
    ]));
  }

  function safeExport(fn) {
    const run = () => { try { fn(); toast('Export started'); } catch (e) { toast('Export failed — libraries not loaded (open once with internet)'); } };
    const close = openSheet('Export contains patient details', h('div', {}, [
      h('p', {}, 'This file includes patient names and UHIDs. The app’s PIN and encryption do not protect an exported file, so store and share it only as your hospital policy allows. For anonymous summaries use More → Reports.'),
      h('div', { class: 'btn-row' }, [h('button', { class: 'btn', onclick: () => close() }, 'Cancel'), h('button', { class: 'btn btn-primary', id: 'exportOk', onclick: () => { close(); run(); } }, 'Export')]),
    ]));
  }

  // ------------------------------------------------------------------
  // PRE-OP ASSESSMENT  (chart photo + structured pre-op data)
  // ------------------------------------------------------------------
  const ASA = ['I', 'II', 'III', 'IV', 'V', 'VI'];
  const FITNESS = ['Fit', 'Fit with risk', 'Needs optimisation', 'Unfit / defer'];  // chosen by the clinician only

  const newPreop = () => Schema.upgradePreop({
    preop_id: uid(), date: todayISO(), patient_name: '', age: '', sex: '', uhid: '', hospital: state.settings.hospital, surgery: '',
    asa: '', emergency: false, fitness: '', conditions: [], medications: [], meds_other: '', allergies: [], allergy_other: '',
    mallampati: '', mouth: '', tmd: '', neck: '', dentition: '', difficulties: [], difficulty_notes: '',
    weight: '', bp: '', pulse: '', spo2: '', hb: '', rbs: '', fasting: '', notes: '', schema_version: Schema.VERSION,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  });

  /** Simple bedside predictors from the airway exam. Prompts only; the clinician decides. */
  function airwayFlags(p) {
    const f = [];
    if (p.mallampati === 'III' || p.mallampati === 'IV') f.push(`Mallampati ${p.mallampati}`);
    if (p.mouth === '< 3 cm') f.push('Mouth opening < 3 cm');
    if (p.tmd === '< 6.5 cm') f.push('Thyromental distance < 6.5 cm');
    if (p.neck === 'Limited') f.push('Limited neck extension');
    if (p.dentition === 'Buck teeth' || p.dentition === 'Loose teeth') f.push(p.dentition);
    return f;
  }

  async function persistPreop(p, images = []) {
    p.schema_version = Schema.VERSION;
    const ops = [await encOp('preops', p)];
    for (const im of images) ops.push(await imageOp(im.key, im));
    if (rememberLists({ hospital: p.hospital, surgery: p.surgery })) ops.push(await settingsOp());
    await DB.batch(ops);
  }

  function renderPreopList(screen) {
    screen.appendChild(pageHead('Pre-op', 'Assessment charts', h('button', { class: 'icon-btn', id: 'preopAdd', 'aria-label': 'New pre-op', onclick: () => { state.preopDraft = newPreop(); state.preopEditing = false; go('preopEdit'); } }, ic('plus'))));
    screen.appendChild(h('button', { class: 'hero preop-hero', onclick: () => { state.preopDraft = newPreop(); state.preopEditing = false; go('preopEdit'); } }, [
      h('span', { class: 'chev' }, ic('chev')), h('div', { class: 'hero-plus' }, ic('clip')), h('h2', {}, 'New pre-op'), h('p', {}, 'Photo of the chart + conditions, medicines, airway'),
    ]));
    const q = h('input', { class: 'input', type: 'search', placeholder: 'Search name, UHID, condition, medicine…', value: state.preopQ || '', oninput: (e) => { state.preopQ = e.target.value; paint(); } });
    screen.appendChild(h('div', { class: 'search' }, [ic('search'), q]));
    const box = h('div'); screen.appendChild(box);
    const paint = () => {
      box.innerHTML = '';
      const words = (state.preopQ || '').toLowerCase().split(/\s+/).filter(Boolean);
      const list = [...activePreops()].filter((p) => { const hay = [p.patient_name, p.uhid, p.surgery, p.hospital, p.asa, ...p.conditions, ...p.medications, p.meds_other, ...p.difficulties, p.notes, X.preopSearchText(p)].join(' ').toLowerCase(); return words.every((w) => hay.includes(w)); }).sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at));
      box.appendChild(h('div', { class: 'muted', style: 'margin:4px 4px 0;font-size:13px' }, `${list.length} assessment${list.length === 1 ? '' : 's'}`));
      if (!list.length) box.appendChild(h('div', { class: 'empty' }, [ic('clip'), h('div', {}, 'No pre-op assessments yet. Tap New pre-op.')]));
      list.forEach((p) => box.appendChild(preopCard(p)));
    };
    paint();
  }

  function preopCard(p) {
    const flags = airwayFlags(p);
    const card = h('div', { class: 'case a2' });
    const sub = [p.age ? `${p.age}/${(p.sex || '?')[0]}` : '', p.surgery, p.asa ? 'ASA ' + p.asa + (p.emergency ? 'E' : '') : ''].filter(Boolean).join(' · ') || fmtDate(p.date);
    card.appendChild(h('button', { class: 'case-head', onclick: () => card.classList.toggle('open') }, [
      h('span', { class: 'avatar' }, initials(p.patient_name)),
      h('span', { class: 'case-main' }, [h('b', {}, [flags.length || p.difficulties.length ? h('span', { class: 'warnmark' }, '⚠ ') : null, p.patient_name || '(no name)']), h('small', {}, sub)]),
      h('span', { class: 'tag' }, fmtDate(p.date).slice(0, 6)),
      ic('chev'),
    ]));
    const kv = (k, v) => h('div', { class: 'kv' }, [h('span', {}, k), h('span', {}, v || '—')]);
    const hints = p.medications.map((m) => [m, MedData.hintFor(m)]).filter((x) => x[1]);
    card.appendChild(h('div', { class: 'case-body' }, [
      kv('Date', fmtDate(p.date)), kv('UHID', p.uhid), kv('Hospital', p.hospital), kv('Surgery', p.surgery), kv('ASA', p.asa ? p.asa + (p.emergency ? ' E' : '') : ''), kv('Fitness', p.fitness),
      kv('Conditions', p.conditions.join(', ')), kv('Medications', [...p.medications, p.meds_other].filter(Boolean).join(', ')),
      kv('Allergies', [...p.allergies, p.allergy_other].filter(Boolean).join(', ')),
      kv('Airway', [p.mallampati && 'MP ' + p.mallampati, p.mouth && 'MO ' + p.mouth, p.tmd && 'TMD ' + p.tmd, p.neck && 'Neck ' + p.neck, p.dentition].filter(Boolean).join(' · ')),
      kv('Vitals', [p.weight && p.weight + ' kg', p.bp && 'BP ' + p.bp, p.pulse && 'PR ' + p.pulse, p.spo2 && 'SpO₂ ' + p.spo2 + '%', p.hb && 'Hb ' + p.hb, p.rbs && 'RBS ' + p.rbs].filter(Boolean).join(' · ')),
      p.difficulties.length || flags.length ? h('div', { class: 'notable-box warnbox' }, [h('b', {}, '⚠ Difficulties'), [...p.difficulties, ...flags.filter((f) => !p.difficulties.length || true)].join(' · '), p.difficulty_notes ? h('div', {}, p.difficulty_notes) : null]) : null,
      hints.length ? h('div', { class: 'hint-box' }, [h('b', {}, 'Medicine prompts'), ...hints.map(([m, t]) => h('div', {}, `${m}: ${t}`))]) : null,
      ...X.preopExtraRows(p).map(([k, v]) => kv(k, v)),
      p.notes ? kv('Notes', p.notes) : null,
      h('div', { class: 'case-actions' }, [
        h('button', { class: 'btn btn-sm', onclick: () => { state.preopDraft = JSON.parse(JSON.stringify(p)); state.preopEditing = true; go('preopEdit'); } }, [ic('edit'), 'Edit']),
        h('button', { class: 'btn btn-sm', onclick: () => X.viewPreopPhotos(p) }, [ic('eye'), 'Photos']),
        h('button', { class: 'btn btn-sm btn-danger', onclick: () => confirmSheet({ title: 'Delete this pre-op?', text: 'It moves to the Recycle bin, where you can restore it.', okLabel: 'Delete', danger: true, onOk: async () => { p.deleted_at = new Date().toISOString(); await putPreopRec(p); render(); toast('Pre-op deleted', 'Undo', async () => { p.deleted_at = null; await putPreopRec(p); render(); }); } }) }, [ic('trash'), 'Delete']),
      ]),
    ]));
    return card;
  }

  /** Dropdown that adds to a list, shown as removable chips. groups = [[label, items]]. */
  function dropdownList({ label, groups, getList, setList, other, onChange }) {
    const wrap = h('div', { class: 'field' });
    const paint = () => {
      wrap.innerHTML = '';
      const sel = h('select', { class: 'input', 'aria-label': label, onchange: (e) => { const v = e.target.value; if (v && !getList().includes(v)) { setList([...getList(), v]); onChange && onChange(); } paint(); } }, [
        h('option', { value: '' }, `+ Add from list…`),
        ...groups.map(([g, items]) => h('optgroup', { label: g }, items.map((it) => { const n = MedData.norm(it); return h('option', { value: n.name, ...(getList().includes(n.name) ? { disabled: true } : {}) }, n.name); }))),
      ]);
      wrap.appendChild(h('label', {}, label));
      wrap.appendChild(sel);
      if (getList().length) wrap.appendChild(h('div', { class: 'chips sel-chips' }, getList().map((v) => h('button', { class: 'chip on', onclick: () => { setList(getList().filter((x) => x !== v)); onChange && onChange(); paint(); } }, `${v} ✕`))));
      if (other) {
        const o = h('input', { class: 'input', placeholder: other.placeholder, value: other.get(), oninput: (e) => other.set(e.target.value) });
        wrap.appendChild(h('div', { style: 'margin-top:8px' }, o));
      }
    };
    paint();
    return wrap;
  }

  function toggleChips(options, getList, setList, extra = '', onChange) {
    const wrap = h('div', { class: 'chip-grid' });
    const paint = () => { wrap.innerHTML = ''; options.forEach((o) => wrap.appendChild(h('button', { class: 'chip ' + extra + (getList().includes(o) ? ' on' : ''), onclick: () => { setList(getList().includes(o) ? getList().filter((x) => x !== o) : [...getList(), o]); onChange && onChange(); paint(); } }, o))); };
    paint();
    return wrap;
  }

  function renderPreopEdit(screen) {
    const p = state.preopDraft || (state.preopDraft = newPreop());
    const editing = state.preopEditing;
    screen.appendChild(pageHead(editing ? 'Edit Pre-op' : 'New Pre-op', 'Assessment chart', null, 'preop'));
    const pf = (label, key, opts = {}) => h('div', { class: 'field' }, [h('label', {}, label), h('input', { class: 'input', type: opts.type || 'text', inputmode: opts.inputmode, placeholder: opts.placeholder, value: p[key] ?? '', oninput: (e) => (p[key] = e.target.value) })]);
    const chips1 = (options, key, extra = '') => chipGroup(options, () => p[key], (v) => (p[key] = v), extra);

    screen.appendChild(X.preopDisclaimer());
    screen.appendChild(X.preopPhotoCard(p, editing));

    // patient
    const hospIn = h('input', { class: 'input', list: 'hospList', value: p.hospital || '', oninput: (e) => (p.hospital = e.target.value) });
    screen.appendChild(h('div', { class: 'card', id: 'preopPatient' }, [
      h('h3', {}, 'Patient'), pf('Patient name', 'patient_name'),
      h('div', { class: 'grid2' }, [pf('Age', 'age', { type: 'number', inputmode: 'numeric' }), h('div', { class: 'field' }, [h('label', {}, 'Sex'), chips1(['Male', 'Female', 'Other'], 'sex')])]),
      pf('UHID', 'uhid'),
      h('div', { class: 'field' }, [h('label', {}, 'Assessment date'), h('input', { class: 'input', type: 'date', value: p.date, onchange: (e) => e.target.value && (p.date = e.target.value) })]),
      h('div', { class: 'field' }, [h('label', {}, 'Hospital'), hospIn, h('datalist', { id: 'hospList' }, hospitalList().map((n) => h('option', { value: n }))), h('div', { class: 'chip-grid', style: 'padding-top:8px' }, hospitalList().map((n) => h('button', { class: 'chip', onclick: () => { p.hospital = n; hospIn.value = n; } }, n)))]),
      h('div', { class: 'field' }, [h('label', {}, 'Planned surgery'), h('input', { class: 'input', list: 'surgeryList', value: p.surgery || '', oninput: (e) => (p.surgery = e.target.value) }), h('datalist', { id: 'surgeryList' }, (state.settings.surgeries || []).map((n) => h('option', { value: n })))]),
    ]));

    // status
    const asaBox = h('div', { class: 'field' }, [h('label', {}, 'ASA grade'), chips1(Schema.ASA, 'asa'), h('div', { class: 'chips', style: 'padding-top:8px' }, [h('button', { class: 'chip', id: 'emgChip', onclick: (e) => { p.emergency = !p.emergency; e.currentTarget.classList.toggle('on', p.emergency); } }, 'Emergency (E)')])]);
    screen.appendChild(h('div', { class: 'card' }, [h('h3', {}, 'Status'), asaBox,
      h('div', { class: 'field' }, [h('label', {}, 'Your fitness decision (optional)'), chips1(FITNESS, 'fitness'), h('div', { class: 'note' }, 'Entered by you. The app never suggests a fitness category.')]),
      h('div', { class: 'field' }, [h('label', {}, 'Fasting'), chips1(['Adequate', 'Inadequate', 'Not applicable'], 'fasting'), X.preopFasting(p)])]));

    // system assessments
    screen.appendChild(X.preopSystems(p));
    screen.appendChild(X.preopFunctional(p));

    // conditions & medicines (dropdowns)
    const medsCard = h('div', { class: 'card' });
    const paintMeds = () => {
      medsCard.innerHTML = '';
      medsCard.appendChild(h('h3', {}, 'Medical conditions'));
      medsCard.appendChild(dropdownList({ label: 'Conditions', groups: MedData.CONDITIONS, getList: () => p.conditions, setList: (v) => (p.conditions = v) }));
      medsCard.appendChild(h('h3', { style: 'margin-top:6px' }, 'Medications'));
      medsCard.appendChild(dropdownList({ label: 'Current medicines', groups: MedData.MEDS, getList: () => p.medications, setList: (v) => (p.medications = v), other: { placeholder: 'Other medicines, doses, last dose time…', get: () => p.meds_other, set: (v) => (p.meds_other = v) }, onChange: paintMeds }));
      const hints = p.medications.map((m) => [m, MedData.hintFor(m)]).filter((x) => x[1]);
      if (hints.length) medsCard.appendChild(h('div', { class: 'hint-box' }, [h('b', {}, 'Prompts to review (follow your protocol)'), ...hints.map(([m, t]) => h('div', {}, `${m}: ${t}`))]));
    };
    paintMeds();
    screen.appendChild(medsCard);
    screen.appendChild(X.preopMedReview(p));
    screen.appendChild(X.preopAntithrombotic(p));
    screen.appendChild(X.preopPrevAnaes(p));

    // allergies
    screen.appendChild(h('div', { class: 'card' }, [h('h3', {}, 'Allergies'), toggleChips(MedData.ALLERGIES, () => p.allergies, (v) => (p.allergies = v)), h('div', { style: 'margin-top:8px' }, h('input', { class: 'input', placeholder: 'Other allergy / reaction', value: p.allergy_other, oninput: (e) => (p.allergy_other = e.target.value) }))]));

    // airway + difficulties
    const airCard = h('div', { class: 'card' });
    const paintAir = () => {
      airCard.innerHTML = '';
      airCard.appendChild(h('h3', {}, 'Airway & difficulties'));
      const row = (label, opts, key) => h('div', { class: 'field' }, [h('label', {}, label), chipGroup(opts, () => p[key], (v) => { p[key] = v; paintFlags(); }, '')]);
      const flagBox = h('div');
      const paintFlags = () => { const f = airwayFlags(p); flagBox.innerHTML = ''; if (f.length) flagBox.appendChild(h('div', { class: 'notable-box warnbox' }, [h('b', {}, '⚠ Bedside predictors you recorded'), f.join(' · ')])); };
      airCard.append(row('Mallampati', ['I', 'II', 'III', 'IV'], 'mallampati'), row('Mouth opening', ['≥ 3 cm', '< 3 cm'], 'mouth'), row('Thyromental distance', ['≥ 6.5 cm', '< 6.5 cm'], 'tmd'), row('Neck extension', ['Full', 'Limited'], 'neck'), row('Dentition', ['Normal', 'Loose teeth', 'Buck teeth', 'Dentures', 'Edentulous'], 'dentition'), flagBox, X.preopAirwayExtras(p));
      paintFlags();
      airCard.appendChild(h('div', { class: 'field' }, [h('label', {}, 'Difficulties anticipated'), toggleChips(MedData.DIFFICULTIES, () => p.difficulties, (v) => (p.difficulties = v), 'star')]));
      airCard.appendChild(h('div', { class: 'field' }, [h('label', {}, 'Details of the difficulty'), h('textarea', { class: 'input', rows: '4', placeholder: 'e.g. Short thick neck, prior failed intubation, thready veins, kyphoscoliosis…', oninput: (e) => (p.difficulty_notes = e.target.value) }, null)]));
      airCard.querySelector('textarea').value = p.difficulty_notes || '';
    };
    paintAir();
    screen.appendChild(airCard);

    // vitals & labs
    screen.appendChild(h('div', { class: 'card' }, [h('h3', {}, 'Vitals & basic labs'), h('div', { class: 'grid2' }, [pf('Weight (kg)', 'weight', { inputmode: 'decimal' }), pf('BP (mmHg)', 'bp', { placeholder: '120/80' })]), h('div', { class: 'grid2' }, [pf('Pulse (/min)', 'pulse', { inputmode: 'numeric' }), pf('SpO₂ (%)', 'spo2', { inputmode: 'numeric' })]), h('div', { class: 'grid2' }, [pf('Hb (g/dL)', 'hb', { inputmode: 'decimal' }), pf('RBS (mg/dL)', 'rbs', { inputmode: 'numeric' })])]));
    screen.appendChild(X.preopInvestigations(p));

    screen.appendChild(X.preopPlan(p));
    screen.appendChild(X.preopConsent(p));
    screen.appendChild(X.preopOptimisation(p));

    const notes = h('textarea', { class: 'input', rows: '4', placeholder: 'Investigations pending, advice given, anything else…', oninput: (e) => (p.notes = e.target.value) });
    notes.value = p.notes || '';
    screen.appendChild(h('div', { class: 'card' }, [h('h3', {}, 'Other notes'), notes]));

    screen.appendChild(h('div', { class: 'sticky-bar' }, h('div', { class: 'inner' }, [
      h('button', { class: 'btn', onclick: () => (history.length > 1 ? history.back() : go('preop')) }, 'Cancel'),
      h('button', { class: 'btn btn-primary', id: 'savePreop', onclick: savePreop }, [ic('check'), 'Save pre-op']),
    ])));
    if (p.emergency) { const e = $('#emgChip'); e && e.classList.add('on'); }
  }

  async function savePreop() {
    const p = state.preopDraft;
    if (!(p.patient_name || '').trim()) return toast('Patient name is required');
    p.updated_at = new Date().toISOString();
    const images = await X.collectPreopImages(p);
    await persistPreop(p, images);
    const i = state.preops.findIndex((x) => x.preop_id === p.preop_id);
    i >= 0 ? (state.preops[i] = p) : state.preops.push(p);
    state.preopDraft = null; X.clearPreopPending(); state.preopEditing = false;
    go('preop', null, { replace: true });
    toast('Pre-op saved');
  }

  // ------------------------------------------------------------------
  // SETTINGS
  // ------------------------------------------------------------------
  function renderSettings(screen) {
    const s = state.settings;
    const draft = { a: [...s.anaesthetists], hospital: s.hospital, location: s.location };
    const inp = (label, get, set) => h('div', { class: 'field' }, [h('label', {}, label), h('input', { class: 'input', value: get(), oninput: (e) => set(e.target.value) })]);
    screen.appendChild(pageHead('Settings', 'Profile & security', null, 'more'));
    const sel = (id, opts, get, set) => h('select', { class: 'input', id, onchange: async (e) => { await set(e.target.value); } }, opts.map(([v, l]) => h('option', { value: v, ...(String(get()) === String(v) ? { selected: true } : {}) }, l)));
    screen.appendChild(h('div', { class: 'card' }, [h('h3', {}, 'Appearance & entry'),
      h('div', { class: 'field' }, [h('label', {}, 'Theme'), sel('themeSel', [['auto', 'Match phone'], ['light', 'Light'], ['dark', 'Dark']], () => s.theme || 'auto', async (v) => { s.theme = v; applyTheme(); await saveSettings(); toast('Theme updated'); })]),
      h('div', { class: 'field' }, [h('label', {}, 'Case entry form'), sel('entrySel', [['quick', 'Quick (essentials first)'], ['detailed', 'Detailed (all sections)']], () => s.entryMode || 'quick', async (v) => { s.entryMode = v; await saveSettings(); toast('Saved'); })]),
      h('div', { class: 'grid2' }, [
        h('div', { class: 'field' }, [h('label', {}, 'Paediatric: under (years)'), h('input', { class: 'input', id: 'paedAge', type: 'number', inputmode: 'numeric', min: '1', max: '30', value: s.paedAgeMax ?? 16, onchange: async (e) => { const n = Number(e.target.value); if (n >= 1 && n <= 30) { s.paedAgeMax = n; await saveSettings(); toast('Saved'); } } })]),
        h('div', { class: 'field' }, [h('label', {}, 'Geriatric: from (years)'), h('input', { class: 'input', id: 'gerAge', type: 'number', inputmode: 'numeric', min: '50', max: '100', value: s.geriatricAgeMin ?? 65, onchange: async (e) => { const n = Number(e.target.value); if (n >= 50 && n <= 100) { s.geriatricAgeMin = n; await saveSettings(); toast('Saved'); } } })]),
      ]),
    ]));

    screen.appendChild(h('div', { class: 'card' }, [
      h('h3', {}, 'Profile'),
      inp('Anaesthetist 1 (you)', () => draft.a[0], (v) => (draft.a[0] = v)), inp('Anaesthetist 2', () => draft.a[1] || '', (v) => (draft.a[1] = v)),
      inp('Default hospital', () => draft.hospital, (v) => (draft.hospital = v)), inp('Default location', () => draft.location, (v) => (draft.location = v)),
      h('button', { class: 'btn btn-primary btn-block', onclick: async () => {
        const names = draft.a.map((x) => (x || '').trim());
        if (!names[0] || !names[1]) return toast('Both anaesthetist names are required');
        if (names[0] === names[1]) return toast('The two names must be different');
        let changed = 0; // renaming must also rename on existing cases, otherwise stats split in two
        for (let i = 0; i < 2; i++) { const old = s.anaesthetists[i]; if (old && old !== names[i]) for (const c of state.cases) if (c.anaesthetist === old) { c.anaesthetist = names[i]; changed++; await putCase(c); } }
        s.anaesthetists = names; s.hospital = draft.hospital.trim(); s.location = draft.location.trim();
        await saveSettings(); render();
        toast(changed ? `Saved · ${changed} existing case(s) renamed` : 'Settings saved');
      } }, 'Save profile'),
      h('div', { class: 'note' }, 'New cases and night duties start with this hospital and location; you can change them each time.'),
    ]));

    const hospCard = h('div', { class: 'card' });
    const paintHosp = () => {
      hospCard.innerHTML = '';
      hospCard.appendChild(h('h3', {}, 'Hospitals'));
      hospCard.appendChild(h('div', { class: 'chips' }, hospitalList().map((n) => h('button', { class: 'chip on', 'aria-label': 'Remove ' + n, onclick: async () => {
        if (n === s.hospital) return toast('That is your default hospital. Change it in Profile first.');
        s.hospitals = s.hospitals.filter((x) => x !== n); await saveSettings(); paintHosp();
      } }, n + (n === s.hospital ? ' (default)' : ' ✕')))));
      const add = h('input', { class: 'input', id: 'newHosp', placeholder: 'Add a hospital' });
      hospCard.appendChild(h('div', { class: 'hosp-edit' }, [add, h('button', { class: 'btn btn-primary', onclick: async () => { const v = add.value.trim(); if (!v) return; if (!hospitalList().includes(v)) { s.hospitals.push(v); await saveSettings(); } paintHosp(); } }, 'Add')]));
      hospCard.appendChild(h('div', { class: 'note' }, 'These appear as one-tap choices in cases, night duties and pre-op.'));
    };
    paintHosp();
    screen.appendChild(hospCard);

    const lockSel = h('select', { class: 'input', onchange: async (e) => { s.autoLockMin = Number(e.target.value); await saveSettings(); toast('Auto-lock updated'); } },
      [[1, '1 minute'], [2, '2 minutes'], [5, '5 minutes'], [0, 'Never']].map(([v, l]) => h('option', { value: v, ...(s.autoLockMin === v ? { selected: true } : {}) }, l)));
    screen.appendChild(h('div', { class: 'card' }, [
      h('h3', {}, 'Security'),
      h('div', { class: 'field' }, [h('label', {}, 'Auto-lock after leaving the app'), lockSel]),
      h('div', { class: 'btn-row' }, [h('button', { class: 'btn', onclick: lockNow }, [ic('lock'), 'Lock now']), h('button', { class: 'btn', onclick: openChangePin }, [ic('shield'), 'Change PIN'])]),
      h('button', { class: 'btn btn-block', id: 'set-security', style: 'margin-top:8px', onclick: () => go('security') }, [ic('shield'), 'Recovery & fingerprint']),
    ]));

    screen.appendChild(h('div', { class: 'card' }, [
      h('h3', {}, 'Data'),
      h('button', { class: 'btn btn-block', onclick: () => go('backup') }, [ic('download'), 'Backup / Restore']),
      h('div', { class: 'note' }, 'Everything is stored encrypted on this device only. No account, no server.'),
    ]));

    const nDel = state.cases.filter((c) => c.deleted_at).length + state.preops.filter((p) => p.deleted_at).length + state.procedures.filter((p) => p.deleted_at).length;
    const link = (id, icon, label, sub, route) => h('button', { class: 'btn btn-block', id, style: 'justify-content:flex-start;margin-bottom:8px', onclick: () => go(route) }, [ic(icon), h('span', { style: 'text-align:left' }, [h('b', {}, label), h('small', { class: 'muted', style: 'display:block' }, sub)])]);
    screen.appendChild(h('div', { class: 'card' }, [h('h3', {}, 'Manage'),
      link('set-bin', 'trash', `Recycle bin (${nDel})`, 'Restore or permanently delete', 'bin'), link('set-health', 'shield', 'Data health', 'Integrity check and storage', 'health'), link('set-templates', 'bolt', 'Templates', 'Surgery, anaesthesia and procedure favourites', 'templates')]));
  }

  function openChangePin() {
    const mk = (ph) => h('input', { class: 'input', type: 'password', inputmode: 'numeric', placeholder: ph });
    const oldP = mk('Current PIN'), n1 = mk('New PIN'), n2 = mk('Confirm new PIN');
    const err = h('div', { class: 'error' });
    const close = openSheet('Change PIN', h('div', {}, [
      h('p', {}, 'Everything (cases, pre-ops, procedures, photos, night duties) is re-encrypted with the new PIN in one step, so it either fully succeeds or changes nothing. Old backups still need the OLD PIN, so make a new backup afterwards.'),
      oldP, n1, n2, err,
      h('button', { class: 'btn btn-primary btn-block', onclick: async (e) => {
        err.textContent = '';
        if (n1.value.length < 4) return (err.textContent = 'New PIN must be at least 4 characters.');
        if (n1.value !== n2.value) return (err.textContent = 'New PINs do not match.');
        const btn = e.currentTarget; btn.disabled = true; btn.textContent = 'Re-encrypting…';
        try { const r = await changePin(oldP.value, n1.value); close(); toast(r.skipped ? `PIN changed · ${r.skipped} unreadable record(s) left as they were` : 'PIN changed'); }
        catch (ex) { err.textContent = ex.message; btn.disabled = false; btn.textContent = 'Change PIN'; }
      } }, 'Change PIN'),
    ]));
  }

  /**
   * Re-encrypt EVERYTHING under the new PIN in a single transaction: either every record changes or none does.
   * Works from the stored records (not from memory) so nothing the app has not loaded can be left behind.
   */
  /** Re-encrypt every stored record from oldKey to newKey. -> { ops, skipped }; the caller commits the ops in ONE batch. */
  async function reencryptOps(oldKey, newKey) {
    const ops = []; let skipped = 0;
    for (const store of ['cases', 'duties', 'preops', 'procedures', 'templates', 'consultants']) {
      for (const r of await DB.getAll(store)) {
        if (!r.value || !r.value.iv) continue;
        try { ops.push({ store, op: 'put', value: { ...r, value: await CryptoModule.encryptJSON(newKey, await CryptoModule.decryptJSON(oldKey, r.value)) } }); } catch (e) { skipped++; }
      }
    }
    for (const r of await DB.getAll('images')) {
      try { const enc = await CryptoModule.encryptBinary(newKey, await CryptoModule.decryptBinary(oldKey, { iv: r.iv, data: r.data })); ops.push({ store: 'images', op: 'put', value: { ...r, iv: enc.iv, data: enc.data } }); } catch (e) { skipped++; }
    }
    const sRec = await DB.get('meta', 'settings');
    if (sRec) ops.push({ store: 'meta', op: 'put', value: { key: 'settings', value: await CryptoModule.encryptJSON(newKey, await CryptoModule.decryptJSON(oldKey, sRec.value)) } });
    return { ops, skipped };
  }
  /** Put a new PIN around the (unchanged) data key. Used by Change PIN in wrapped mode and by recovery reset. */
  async function setPinFromRaw(raw, newPin, m) {
    const w = await Keys.pinWrapper(raw, newPin);
    const kw = { ...(m.keywrap || { v: 1, rec: null, q: null, bio: null }), pin: w.pin };
    await DB.batch([{ store: 'meta', op: 'put', value: { key: 'salt', value: w.salt } }, { store: 'meta', op: 'put', value: { key: 'kdf', value: w.kdf } }, { store: 'meta', op: 'put', value: { key: 'keywrap', value: kw } }]);
  }
  async function changePin(oldPin, newPin) {
    const m = await metaNow();
    const oldRaw = await Keys.rawWithPin(oldPin, m);
    if (!oldRaw) throw new Error('Current PIN is incorrect.');
    if (weakPin(newPin)) throw new Error('That PIN is too easy to guess (repeated or sequential digits).');
    if (Keys.isWrapped(m)) { await setPinFromRaw(oldRaw, newPin, m); return { skipped: 0 }; } // recovery code / fingerprint keep working
    const oldKey = await Keys.aesKey(oldRaw);
    const newSalt = CryptoModule.newSalt(), iter = CryptoModule.ITER_NEW;
    const newKey = await CryptoModule.deriveKey(newPin, newSalt, iter);
    const { ops, skipped } = await reencryptOps(oldKey, newKey);
    ops.push({ store: 'meta', op: 'put', value: { key: 'verifier', value: await CryptoModule.makeVerifier(newKey) } });
    ops.push({ store: 'meta', op: 'put', value: { key: 'salt', value: newSalt } });
    ops.push({ store: 'meta', op: 'put', value: { key: 'kdf', value: { iter } } });
    await DB.batch(ops); // all-or-nothing
    state.key = newKey;
    return { skipped };
  }

  // ------------------------------------------------------------------
  // FEATURE MODULES (js/ui-*.js register themselves in window.V8Ext and receive this context)
  // ------------------------------------------------------------------
  const X = {}; // functions provided by feature modules, filled in at start-up
  const restoreFlow = (...a) => X.restoreFlow(...a);
  /** Home → Add New Case: go straight to the blank form (the same as "Skip photo — enter manually"). */
  function startManualCase() { go('add'); buildReview({ fields: {}, confidence: {}, raw: '' }); render(); }
  function initExtensions() {
    const ctx = {
      state, h, ic, ICONS, $, root, go, render, toast, openSheet, confirmSheet, pageHead, tile, barRows, donut, caseCard, chipGroup, toggleChips, dropdownList, field,
      pad, isoOf, parseISO, todayISO, fmtDate, fmtDay, monthLabel, shiftMonth, shiftDay, uid, shortName, initials, toneOf, TONE_VAR, DOW, MON, MONTHS,
      hospitalList, activeCases, activePreops, activeProcedures, casesForDate, dutiesOn, dutiesInMonth, emptyFilters, applyFilters, suggestedFor,
      encOp, settingsOp, imageOp, saveSettings, putCase, putDuty, putPreopRec, putProcedure, putTemplate, persistCase, persistPreop, rememberLists,
      safeExport, openEdit, viewImage, confirmDelete, lockNow, defaultSettings, afterUnlock, reloadAll, prepareImages, applyTheme, openChangePin,
      loadStore, X, nightDutyDate, addNightDuty, openDutySheet, recentTemplates, startManualCase, metaNow, unlockWithRaw, reencryptOps, setPinFromRaw, weakPin, clearLockout,
    };
    for (const f of window.V8Ext || []) { const r = f(ctx) || {}; Object.assign(SCREENS, r.screens || {}); Object.assign(X, r.api || {}); }
  }
  async function reloadAll() {
    state.corrupt = [];
    await loadSettings();
    await Promise.all([loadAllCases(), loadAllDuties(), loadAllPreops(), loadAllProcedures(), loadAllTemplates()]);
  }
  initExtensions();

  return { boot };
})();

document.addEventListener('DOMContentLoaded', () => App.boot());
