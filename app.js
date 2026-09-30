/**
 * app.js — UI controller / screen router for the Anaesthesia Case Log.
 * Vanilla JS, no build step. All patient data lives only in IndexedDB
 * (encrypted) and, while unlocked, in the in-memory `state.cases` array.
 */

const App = (() => {
  const state = {
    key: null, // CryptoKey, in-memory only
    settings: null, // { anaesthetists: [name1, name2], hospital, location, consultants: [] }
    cases: [], // decrypted, non-deleted first; includes deleted (filtered on render)
    route: '#home',
    pendingReview: null, // case object being reviewed after OCR, before save
    pendingImage: null, // { arrayBuffer, mimeType } for the case being reviewed
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const el = (tag, attrs = {}, children = []) => {
    const node = document.createElement(tag);

    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') {
        node.className = v;
      } else if (k === 'html') {
        node.innerHTML = v;
      } else if (k.startsWith('on') && typeof v === 'function') {
        node.addEventListener(k.slice(2), v);
      } else {
        node.setAttribute(k, v);
      }
    }

    for (const c of [].concat(children)) {
      if (c == null) continue;
      node.appendChild(
        typeof c === 'string'
          ? document.createTextNode(c)
          : c
      );
    }

    return node;
  };

  const uid = () =>
    crypto.randomUUID
      ? crypto.randomUUID()
      : 'c' + Date.now() + Math.random().toString(16).slice(2);

  const todayISO = () =>
    new Date().toISOString().slice(0, 10);

  const fmtDate = (iso) => {
    if (!iso) return '';

    const [y, m, d] = iso.split('-');

    const months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec'
    ];

    return `${d} ${months[Number(m) - 1]} ${y}`;
  };

  const monthLabel = (ym) => {
    const [y, m] = ym.split('-');

    const months = [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December'
    ];

    return `${months[Number(m) - 1]} ${y}`;
  };

  const root = () => $('#app');

  // ---------------------------------------------------------------------
  // Bootstrapping / lock screen
  // ---------------------------------------------------------------------

  async function boot() {
    const salt = await DB.get('meta', 'salt');

    if (!salt) {
      renderSetupPin();
    } else {
      renderUnlock();
    }
  }

  function renderSetupPin() {
    root().innerHTML = '';

    root().appendChild(
      el('div', { class: 'lock-screen' }, [
        el('div', { class: 'lock-card' }, [
          el('h1', {}, 'Anaesthesia Log'),

          el(
            'p',
            { class: 'muted' },
            'Create a PIN to encrypt your case data on this device. There is no way to recover data if this PIN is lost — write it down somewhere safe.'
          ),

          el('input', {
            id: 'pin1',
            type: 'password',
            inputmode: 'numeric',
            placeholder: 'New PIN (min 4 digits)',
            class: 'input'
          }),

          el('input', {
            id: 'pin2',
            type: 'password',
            inputmode: 'numeric',
            placeholder: 'Confirm PIN',
            class: 'input'
          }),

          el('div', {
            id: 'pinErr',
            class: 'error'
          }),

          el(
            'button',
            {
              class: 'btn btn-primary btn-block',
              onclick: setupPin
            },
            'Create PIN & Continue'
          )
        ])
      ])
    );
  }

  async function setupPin() {
    const p1 = $('#pin1').value;
    const p2 = $('#pin2').value;
    const errEl = $('#pinErr');

    if (p1.length < 4) {
      errEl.textContent = 'PIN must be at least 4 digits.';
      return;
    }

    if (p1 !== p2) {
      errEl.textContent = 'PINs do not match.';
      return;
    }

    const salt = CryptoModule.newSalt();
    const key = await CryptoModule.deriveKey(p1, salt);
    const verifier = await CryptoModule.makeVerifier(key);

    await DB.put('meta', {
      key: 'salt',
      value: salt
    });

    await DB.put('meta', {
      key: 'verifier',
      value: verifier
    });

    state.key = key;
    state.settings = defaultSettings();

    await saveSettings();
    await enterApp();
  }

  function renderUnlock() {
    root().innerHTML = '';

    root().appendChild(
      el('div', { class: 'lock-screen' }, [
        el('div', { class: 'lock-card' }, [
          el('h1', {}, 'Anaesthesia Log'),

          el(
            'p',
            { class: 'muted' },
            'Enter your PIN to unlock.'
          ),

          el('input', {
            id: 'pinIn',
            type: 'password',
            inputmode: 'numeric',
            placeholder: 'PIN',
            class: 'input',
            onkeydown: (e) =>
              e.key === 'Enter' && unlock()
          }),

          el('div', {
            id: 'pinErr',
            class: 'error'
          }),

          el(
            'button',
            {
              class: 'btn btn-primary btn-block',
              onclick: unlock
            },
            'Unlock'
          )
        ])
      ])
    );

    setTimeout(() => {
      if ($('#pinIn')) {
        $('#pinIn').focus();
      }
    }, 50);
  }

  async function unlock() {
    const pin = $('#pinIn').value;

    const salt = await DB.get('meta', 'salt');
    const verifier = await DB.get('meta', 'verifier');

    const key = await CryptoModule.deriveKey(
      pin,
      salt.value
    );

    const ok = await CryptoModule.checkVerifier(
      key,
      verifier.value
    );

    if (!ok) {
      $('#pinErr').textContent = 'Incorrect PIN.';
      return;
    }

    state.key = key;

    await loadSettings();
    await loadAllCases();
    await enterApp();
  }

  function defaultSettings() {
    return {
      anaesthetists: [
        'Dr. Me',
        'Dr. Jagadeesh'
      ],
      hospital: 'Apollo Spectra Hospital',
      location: 'MRC Nagar, Chennai',
      consultants: []
    };
  }

  async function loadSettings() {
    const rec = await DB.get(
      'meta',
      '