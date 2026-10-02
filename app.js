/**
 * app.js — UI controller / screen router for the Anaesthesia Case Log.
 * Vanilla JS, no build step. All patient data lives only in IndexedDB
 * (encrypted) and, while unlocked, in the in-memory `state.cases` array.
 */

const App = (() => {
  const state = {
    key: null,
    settings: null,
    cases: [],
    route: '#home',
    pendingReview: null,
    pendingImage: null,
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const el = (tag, attrs = {}, children = []) => {
    const node = document.createElement(tag);

    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') node.className = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') {
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
      'settings'
    );

    state.settings = rec
      ? await CryptoModule.decryptJSON(
          state.key,
          rec.value
        )
      : defaultSettings();
  }

  async function saveSettings() {
    const packet = await CryptoModule.encryptJSON(
      state.key,
      state.settings
    );

    await DB.put('meta', {
      key: 'settings',
      value: packet
    });
  }

  async function loadAllCases() {
    const records = await DB.getAll('cases');

    const decrypted = await Promise.all(
      records.map((r) =>
        CryptoModule.decryptJSON(
          state.key,
          r.value
        )
      )
    );

    decrypted.sort(
      (a, b) =>
        (a.created_at || '').localeCompare(
          b.created_at || ''
        )
    );

    state.cases = decrypted;
  }

  async function enterApp() {
    navigate('#home');
  }

  function activeCases() {
    return state.cases.filter(
      (c) => !c.deleted_at
    );
  }

  // ---------------------------------------------------------------------
  // Routing
  // ---------------------------------------------------------------------

  const routes = {
    '#home': renderHome,
    '#add': renderAdd,
    '#day': renderDay,
    '#calendar': renderCalendar,
    '#dashboard': renderDashboard,
    '#mycases': renderMyCases,
    '#consultants': renderConsultants,
    '#search': renderSearch,
    '#settings': renderSettings,
    '#backup': renderBackup,
  };

  function navigate(hash, param) {
    state.route = hash;
    state.routeParam = param;

    if (hash !== '#add') {
      state.editingOriginalId = null;
      state.pendingReview = null;
      state.pendingImage = null;
    }

    window.scrollTo(0, 0);
    render();
  }

  function render() {
    const fn =
      routes[state.route] || renderHome;

    root().innerHTML = '';

    root().appendChild(navBar());

    const content = el(
      'div',
      { class: 'content' }
    );

    root().appendChild(content);

    fn(content);
  }

  function navBar() {
    const items = [
      ['#home', 'Home'],
      ['#calendar', 'Calendar'],
      ['#dashboard', 'Dashboard'],
      ['#mycases', 'My Cases'],
      ['#search', 'Search'],
      ['#settings', 'Settings'],
    ];

    return el(
      'nav',
      { class: 'navbar' },
      items.map(
        ([hash, label]) =>
          el(
            'button',
            {
              class:
                'navbtn' +
                (state.route === hash
                  ? ' active'
                  : ''),
              onclick: () =>
                navigate(hash)
            },
            label
          )
      )
    );
  }

  // ---------------------------------------------------------------------
  // Home
  // ---------------------------------------------------------------------

  function renderHome(content) {
    const cases = activeCases();
    const today = todayISO();
    const ym = today.slice(0, 7);

    const monthCases = cases.filter(
      (c) => c.case_date.startsWith(ym)
    );

    const todayCases = cases.filter(
      (c) => c.case_date === today
    );

    const roster =
      state.settings.anaesthetists;

    const monthStats =
      Stats.monthlyStats(
        monthCases,
        roster
      );

    const todaySummary =
      Stats.dailySummary(
        todayCases,
        roster
      );

    content.appendChild(
      el('div', { class: 'home' }, [
        el(
          'div',
          { class: 'brand-header' },
          [
            el(
              'div',
              { class: 'brand-title' },
              'ANAESTHESIA LOG'
            ),
            el(
              'div',
              { class: 'brand-sub' },
              monthLabel(ym)
            ),
          ]
        ),

        el(
          'div',
          { class: 'stat-row' },
          [
            statTile(
              String(
                monthStats.totalCases
              ),
              'CASES'
            ),

            ...roster.map((name) =>
              statTile(
                String(
                  monthStats
                    .byAnaesthetist[name] ||
                    0
                ),
                shortName(
                  name
                ).toUpperCase()
              )
            ),
          ]
        ),

        el(
          'button',
          {
            class: 'add-case-btn',
            onclick: () =>
              navigate('#add')
          },
          '+ ADD CASE'
        ),

        el(
          'div',
          { class: 'today-card' },
          [
            el(
              'div',
              {
                class:
                  'today-card-head'
              },
              [
                el(
                  'span',
                  {},
                  'TODAY'
                ),
                el(
                  'span',
                  {},
                  fmtDate(today)
                ),
              ]
            ),

            el(
              'div',
              {
                class: 'today-count'
              },
              `${todaySummary.total} CASE${
                todaySummary.total === 1
                  ? ''
                  : 'S'
              }`
            ),

            el(
              'div',
              {
                class:
                  'today-breakdown'
              },
              roster.map((name) =>
                el(
                  'div',
                  {
                    class:
                      'breakdown-row'
                  },
                  [
                    el(
                      'span',
                      {},
                      name
                    ),
                    el(
                      'span',
                      {},
                      String(
                        todaySummary
                          .byAnaesthetist[
                          name
                        ] || 0
                      )
                    ),
                  ]
                )
              )
            ),

            el(
              'button',
              {
                class:
                  'btn btn-secondary btn-block',
                onclick: () =>
                  navigate(
                    '#day',
                    today
                  )
              },
              'VIEW TODAY'
            ),
          ]
        ),
      ])
    );
  }

  function statTile(value, label) {
    return el(
      'div',
      { class: 'stat-tile' },
      [
        el(
          'div',
          { class: 'stat-value' },
          value
        ),
        el(
          'div',
          { class: 'stat-label' },
          label
        ),
      ]
    );
  }

  function shortName(name) {
    return name.replace(
      /^Dr\.?\s*/i,
      ''
    );
  }

  // ---------------------------------------------------------------------
  // Add Case: photo -> OCR -> review -> save
  // ---------------------------------------------------------------------
  function renderAdd(content) {
    content.appendChild(
      el('div', { class: 'add-screen' }, [
        el('h2', {}, 'Add Case'),

        el('div', { class: 'capture-buttons' }, [
          el(
            'label',
            {
              class:
                'btn btn-primary btn-block capture-label'
            },
            [
              'TAKE PHOTO',
              el('input', {
                type: 'file',
                accept: 'image/*',
                capture: 'environment',
                class: 'hidden-file',
                onchange: onImageChosen
              })
            ]
          ),

          el(
            'label',
            {
              class:
                'btn btn-secondary btn-block capture-label'
            },
            [
              'UPLOAD PHOTO',
              el('input', {
                type: 'file',
                accept: 'image/*',
                class: 'hidden-file',
                onchange: onImageChosen
              })
            ]
          )
        ]),

        el('div', {
          id: 'ocrStatus',
          class: 'ocr-status'
        }),

        el(
          'button',
          {
            class: 'btn btn-link',
            onclick: () =>
              navigate('#home')
          },
          'Cancel'
        )
      ])
    );
  }

  async function onImageChosen(e) {
    const file = e.target.files[0];

    if (!file) return;

    const statusEl = $('#ocrStatus');

    statusEl.innerHTML = '';

    statusEl.appendChild(
      el('div', {
        class: 'spinner'
      })
    );

    const progressText = el(
      'div',
      {
        class: 'muted center'
      },
      'Reading image…'
    );

    statusEl.appendChild(progressText);

    const arrayBuffer =
      await file.arrayBuffer();

    state.pendingImage = {
      arrayBuffer,
      mimeType:
        file.type || 'image/jpeg'
    };

    try {
      const { text } =
        await OCR.recognize(
          file,
          (p) => {
            progressText.textContent =
              `Recognizing text… ${Math.round(
                p * 100
              )}%`;
          }
        );

      const parsed =
        Parser.parseRegistrationSheet(
          text
        );

      buildReviewCase(parsed);

      renderReview();
    } catch (err) {
      statusEl.innerHTML = '';

      statusEl.appendChild(
        el(
          'div',
          { class: 'error' },
          'OCR failed: ' +
            err.message +
            '. You can still enter the case manually.'
        )
      );

      buildReviewCase({
        fields: {},
        confidence: {},
        raw: ''
      });

      renderReview();
    }
  }

  function buildReviewCase(parsed) {
    const {
      fields,
      confidence,
      raw
    } = parsed;

    const caseDate =
      fields.procedure_date ||
      todayISO();

    const seq =
      Sequence.nextSuggestedAnaesthetist(
        casesForDate(caseDate),
        state.settings.anaesthetists
      );

    state.pendingReview = {
      case_id: uid(),

      case_date: caseDate,

      upload_date: todayISO(),

      patient_name:
        fields.patient_name || '',

      age:
        fields.age ?? '',

      sex:
        fields.sex || '',

      uhid:
        fields.uhid || '',

      visit_number:
        fields.visit_number || '',

      consultant:
        fields.consultant || '',

      procedure: '',

      hospital:
        state.settings.hospital,

      location:
        state.settings.location,

      anaesthetist:
        seq.suggested,

      sequence_index:
        seq.sequence_index,

      is_override: false,

      payment_mode:
        fields.payment_mode || '',

      document_date:
        fields.doa || '',

      ocr_raw_text:
        raw,

      ocr_confidence:
        confidence || {},

      created_at:
        new Date().toISOString(),

      updated_at:
        new Date().toISOString(),

      deleted_at: null
    };
  }

  function casesForDate(dateISO) {
    return activeCases()
      .filter(
        (c) =>
          c.case_date === dateISO
      )
      .sort(
        (a, b) =>
          (a.created_at || '').localeCompare(
            b.created_at || ''
          )
      );
  }

  // ---------------------------------------------------------------------
  // Review form
  // ---------------------------------------------------------------------

  function fieldRow(
    label,
    key,
    opts = {}
  ) {
    const c =
      state.pendingReview;

    if (!c.ocr_confidence) {
      c.ocr_confidence = {};
    }

    const conf =
      c.ocr_confidence[key];

    const warn =
      conf === 'low';

    const inputAttrs = {
      class:
        'input' +
        (warn
          ? ' input-warn'
          : ''),

      value:
        c[key] ?? '',

      oninput: (e) => {
        c[key] =
          e.target.value;

        if (!c.ocr_confidence) {
          c.ocr_confidence = {};
        }

        // Any manual edit means the clinician
        // has explicitly verified/entered this value.
        c.ocr_confidence[key] =
          'high';
      }
    };

    let inputEl;

    if (opts.select) {
      const options = [];

      // If OCR did not determine the value,
      // explicitly show a placeholder instead of
      // allowing the browser to visually select
      // the first real option.
      if (!c[key]) {
        options.push(
          el(
            'option',
            {
              value: '',
              selected:
                'selected',
              disabled:
                'disabled'
            },
            `Select ${label}`
          )
        );
      }

      options.push(
        ...opts.select.map(
          (optVal) =>
            el(
              'option',
              {
                value: optVal,
                ...(c[key] ===
                optVal
                  ? {
                      selected:
                        'selected'
                    }
                  : {})
              },
              optVal
            )
        )
      );

      inputEl = el(
        'select',
        {
          class:
            'input' +
            (warn
              ? ' input-warn'
              : ''),

          onchange: (e) => {
            c[key] =
              e.target.value;

            if (
              !c.ocr_confidence
            ) {
              c.ocr_confidence =
                {};
            }

            // Explicit selection = verified.
            c.ocr_confidence[
              key
            ] = 'high';

            renderReview();
          }
        },
        options
      );
    } else if (opts.date) {
      inputEl = el(
        'input',
        {
          type: 'date',
          ...inputAttrs
        }
      );
    } else if (opts.number) {
      inputEl = el(
        'input',
        {
          type: 'number',
          ...inputAttrs
        }
      );
    } else {
      inputEl = el(
        'input',
        {
          type: 'text',
          ...inputAttrs
        }
      );
    }

    return el(
      'div',
      {
        class: 'field-row'
      },
      [
        el(
          'label',
          {},
          [
            label,

            warn
              ? el(
                  'span',
                  {
                    class:
                      'warn-badge'
                  },
                  ' ⚠ Verify'
                )
              : null
          ]
        ),

        inputEl
      ]
    );
  }

  function renderReview() {
    const content =
      $('.content');

    content.innerHTML = '';

    const c =
      state.pendingReview;

    content.appendChild(
      el(
        'div',
        {
          class:
            'review-screen'
        },
        [
          el(
            'h2',
            {},
            'Review Case'
          ),

          fieldRow(
            'Patient Name',
            'patient_name'
          ),

          fieldRow(
            'Age',
            'age',
            {
              number: true
            }
          ),

          fieldRow(
            'Sex',
            'sex',
            {
              select: [
                'Male',
                'Female',
                'Other'
              ]
            }
          ),

          fieldRow(
            'UHID',
            'uhid'
          ),

          fieldRow(
            'Visit No',
            'visit_number'
          ),

          fieldRow(
            'Consultant / Surgeon',
            'consultant'
          ),

          el(
            'div',
            {
              class:
                'field-row'
            },
            [
              el(
                'label',
                {},
                'Case Date'
              ),

              el(
                'input',
                {
                  type: 'date',

                  class:
                    'input',

                  value:
                    c.case_date,

                  onchange: (e) => {
                    c.case_date =
                      e.target.value;

                    if (
                      !c.ocr_confidence
                    ) {
                      c.ocr_confidence =
                        {};
                    }

                    c.ocr_confidence[
                      'procedure_date'
                    ] = 'high';

                    const seq =
                      Sequence.nextSuggestedAnaesthetist(
                        casesForDate(
                          c.case_date
                        ),
                        state.settings
                          .anaesthetists
                      );

                    c.anaesthetist =
                      seq.suggested;

                    c.sequence_index =
                      seq.sequence_index;

                    c.is_override =
                      false;

                    renderReview();
                  }
                }
              )
            ]
          ),

          fieldRow(
            'Hospital',
            'hospital'
          ),

          fieldRow(
            'Location',
            'location'
          ),

          el(
            'div',
            {
              class:
                'field-row'
            },
            [
              el(
                'label',
                {},
                [
                  'Anaesthetist',

                  el(
                    'span',
                    {
                      class:
                        'seq-badge'
                    },
                    ` (sequence suggests ${suggestedFor(
                      c
                    )})`
                  )
                ]
              ),

              el(
                'select',
                {
                  class:
                    'input',

                  onchange: (e) => {
                    c.anaesthetist =
                      e.target.value;

                    c.is_override =
                      e.target.value !==
                      suggestedFor(
                        c
                      );

                    renderReview();
                  }
                },

                state.settings.anaesthetists.map(
                  (name) =>
                    el(
                      'option',
                      {
                        value:
                          name,

                        ...(c.anaesthetist ===
                        name
                          ? {
                              selected:
                                'selected'
                            }
                          : {})
                      },
                      name
                    )
                )
              )
            ]
          ),

          el(
            'div',
            {
              class:
                'btn-row'
            },
            [
              el(
                'button',
                {
                  class:
                    'btn btn-primary',

                  onclick: () =>
                    saveReviewedCase(
                      false
                    )
                },

                state.editingOriginalId
                  ? 'SAVE CHANGES'
                  : 'SAVE CASE'
              ),

              el(
                'button',
                {
                  class:
                    'btn btn-secondary',

                  onclick: () => {
                    state.editingOriginalId =
                      null;

                    navigate(
                      '#home'
                    );
                  }
                },

                'CANCEL'
              )
            ]
          )
        ]
      )
    );
  }

  function suggestedFor(c) {
    const seq =
      Sequence.nextSuggestedAnaesthetist(
        casesForDate(
          c.case_date
        ).filter(
          (x) =>
            x.case_id !==
            c.case_id
        ),
        state.settings
          .anaesthetists
      );

    return seq.suggested;
  }

  async function saveReviewedCase(
    skipDuplicateCheck
  ) {
    const c =
      state.pendingReview;

    const requiredFields = [
      [
        'patient_name',
        'Patient name'
      ],
      [
        'age',
        'Age'
      ],
      [
        'sex',
        'Sex'
      ],
      [
        'uhid',
        'UHID'
      ],
      [
        'visit_number',
        'Visit number'
      ],
      [
        'consultant',
        'Consultant / Surgeon'
      ]
    ];

    for (
      const [
        key,
        label
      ] of requiredFields
    ) {
      if (
        c[key] ===
          undefined ||
        c[key] === null ||
        String(c[key]).trim() ===
          ''
      ) {
        alert(
          `Please verify/enter ${label} before saving.`
        );

        return;
      }
    }

    if (!skipDuplicateCheck) {
      const dups =
        Duplicates.findPossibleDuplicates(
          c,
          activeCases()
        );

      if (dups.length) {
        showDuplicateWarning(
          dups,
          () =>
            saveReviewedCase(
              true
            )
        );

        return;
      }
    }

    const isEdit =
      !!state.editingOriginalId;

    c.updated_at =
      new Date().toISOString();

    await persistCase(
      c,
      state.pendingImage
    );

    if (isEdit) {
      const idx =
        state.cases.findIndex(
          (x) =>
            x.case_id ===
            c.case_id
        );

      if (idx !== -1) {
        state.cases[idx] =
          c;
      } else {
        state.cases.push(c);
      }
    } else {
      state.cases.push(c);
    }

    state.pendingReview =
      null;

    state.pendingImage =
      null;

    state.editingOriginalId =
      null;

    navigate(
      '#day',
      c.case_date
    );
  }

  function showDuplicateWarning(
    dups,
    onConfirm
  ) {
    const content =
      $('.content');

    const overlay = el(
      'div',
      {
        class:
          'overlay'
      },
      [
        el(
          'div',
          {
            class:
              'overlay-card'
          },
          [
            el(
              'h3',
              {},
              '⚠ Possible Duplicate'
            ),

            el(
              'p',
              {},
              'This patient/case may already exist:'
            ),

            el(
              'ul',
              {
                class:
                  'dup-list'
              },
              dups.map(
                (d) =>
                  el(
                    'li',
                    {},
                    `${d.case.patient_name} — ${fmtDate(
                      d.case.case_date
                    )} — matched on ${d.matchedOn.join(
                      ', '
                    )}`
                  )
              )
            ),

            el(
              'div',
              {
                class:
                  'btn-row'
              },
              [
                el(
                  'button',
                  {
                    class:
                      'btn btn-primary',

                    onclick: () => {
                      overlay.remove();
                      onConfirm();
                    }
                  },
                  'SAVE ANYWAY'
                ),

                el(
                  'button',
                  {
                    class:
                      'btn btn-secondary',

                    onclick: () =>
                      overlay.remove()
                  },
                  'CANCEL'
                )
              ]
            )
          ]
        )
      ]
    );

    content.appendChild(
      overlay
    );
  }

  async function persistCase(
    caseObj,
    imagePacketSrc
  ) {
    const packet =
      await CryptoModule.encryptJSON(
        state.key,
        caseObj
      );

    await DB.put(
      'cases',
      {
        case_id:
          caseObj.case_id,
        value: packet
      }
    );

    if (imagePacketSrc) {
      const encImg =
        await CryptoModule.encryptBinary(
          state.key,
          imagePacketSrc.arrayBuffer
        );

      await DB.put(
        'images',
        {
          case_id:
            caseObj.case_id,

          iv: encImg.iv,

          data: encImg.data,

          mimeType:
            imagePacketSrc.mimeType
        }
      );
    }

    // Remember consultant for autocomplete.
    if (caseObj.consultant) {
      const names =
        caseObj.consultant
          .split('/')
          .map((s) =>
            s.trim()
          )
          .filter(Boolean);

      for (
        const n of names
      ) {
        if (
          !state.settings
            .consultants
            .includes(n)
        ) {
          state.settings
            .consultants
            .push(n);
        }
      }

      await saveSettings();
    }
  }

  // ---------------------------------------------------------------------
  // Daily log
  // ---------------------------------------------------------------------

  function renderDay(content) {
    const date =
      state.routeParam ||
      todayISO();

    const cases =
      casesForDate(date);

    const roster =
      state.settings.anaesthetists;

    const summary =
      Stats.dailySummary(
        cases,
        roster
      );

    content.appendChild(
      el(
        'div',
        {
          class:
            'day-screen'
        },
        [
          el(
            'div',
            {
              class:
                'day-header'
            },
            [
              el(
                'input',
                {
                  type:
                    'date',

                  class:
                    'input',

                  value:
                    date,

                  onchange:
                    (e) =>
                      navigate(
                        '#day',
                        e.target
                          .value
                      )
                }
              ),

              el(
                'div',
                {
                  class:
                    'day-total'
                },
                `Total cases: ${summary.total}`
              ),

              el(
                'div',
                {
                  class:
                    'day-breakdown'
                },
                roster.map(
                  (name) =>
                    el(
                      'span',
                      {},
                      `${name}: ${
                        summary
                          .byAnaesthetist[
                          name
                        ] || 0
                      }`
                    )
                )
              )
            ]
          ),

          renderCaseList(
            cases
          )
        ]
      )
    );
  }

  function renderCaseList(
    cases
  ) {
    if (!cases.length) {
      return el(
        'p',
        {
          class:
            'muted center'
        },
        'No cases recorded.'
      );
    }

    return el(
      'div',
      {
        class:
          'case-list'
      },
      cases.map(
        (c, i) =>
          caseCard(
            c,
            i + 1
          )
      )
    );
  }

  function caseCard(
    c,
    sno
  ) {
    const card = el(
      'div',
      {
        class:
          'case-card'
      }
    );

    const head = el(
      'div',
      {
        class:
          'case-card-head',

        onclick: () =>
          card.classList.toggle(
            'expanded'
          )
      },
      [
        el(
          'div',
          {
            class:
              'case-card-title'
          },
          [
            el(
              'span',
              {
                class:
                  'sno'
              },
              `${sno}.`
            ),

            el(
              'span',
              {},
              c.patient_name ||
                '(no name)'
            )
          ]
        ),

        el(
          'div',
          {
            class:
              'case-card-sub'
          },
          `${c.age || '?'}/${(
            c.sex || '?'
          )[0] || '?'} · ${
            c.anaesthetist
          }`
        )
      ]
    );

    const details =
      el(
        'div',
        {
          class:
            'case-card-details'
        },
        [
          detailRow(
            'UHID',
            c.uhid
          ),

          detailRow(
            'Visit No',
            c.visit_number
          ),

          detailRow(
            'Consultant',
            c.consultant
          ),

          detailRow(
            'Case Date',
            fmtDate(
              c.case_date
            )
          ),

          detailRow(
            'Hospital',
            c.hospital
          ),

          detailRow(
            'Location',
            c.location
          ),

          detailRow(
            'Anaesthetist',
            c.anaesthetist
          ),

          el(
            'div',
            {
              class:
                'btn-row'
            },
            [
              el(
                'button',
                {
                  class:
                    'btn btn-small',

                  onclick: (e) => {
                    e.stopPropagation();
                    openEdit(
                      c.case_id
                    );
                  }
                },
                'Edit'
              ),

              el(
                'button',
                {
                  class:
                    'btn btn-small',

                  onclick: (e) => {
                    e.stopPropagation();
                    viewOriginalImage(
                      c.case_id
                    );
                  }
                },
                'View Image'
              ),

              el(
                'button',
                {
                  class:
                    'btn btn-small btn-danger',

                  onclick: (e) => {
                    e.stopPropagation();
                    confirmDelete(
                      c.case_id
                    );
                  }
                },
                'Delete'
              )
            ]
          )
        ]
      );

    card.appendChild(head);
    card.appendChild(details);

    return card;
  }

  function detailRow(
    label,
    value
  ) {
    return el(
      'div',
      {
        class:
          'detail-row'
      },
      [
        el(
          'span',
          {
            class:
              'detail-label'
          },
          label
        ),

        el(
          'span',
          {},
          value || '—'
        )
      ]
    );
  }

  function openEdit(
    caseId
  ) {
    const c =
      state.cases.find(
        (x) =>
          x.case_id ===
          caseId
      );

    if (!c) return;

    state.pendingReview = {
      ...c,

      ocr_confidence:
        {
          ...(c.ocr_confidence ||
            {})
        }
    };

    state.pendingImage =
      null;

    state.editingOriginalId =
      caseId;

    state.route =
      '#add';

    root().innerHTML = '';

    root().appendChild(
      navBar()
    );

    root().appendChild(
      el(
        'div',
        {
          class:
            'content'
        }
      )
    );

    renderReview();
  }

  async function viewOriginalImage(
    caseId
  ) {
    const rec =
      await DB.get(
        'images',
        caseId
      );

    if (!rec) {
      alert(
        'No image stored for this case.'
      );

      return;
    }

    const buf =
      await CryptoModule.decryptBinary(
        state.key,
        {
          iv: rec.iv,
          data: rec.data
        }
      );

    const blob =
      new Blob(
        [buf],
        {
          type:
            rec.mimeType
        }
      );

    const url =
      URL.createObjectURL(
        blob
      );

    const overlay =
      el(
        'div',
        {
          class:
            'overlay',

          onclick: (e) => {
            if (
              e.target ===
              overlay
            ) {
              URL.revokeObjectURL(
                url
              );

              overlay.remove();
            }
          }
        },
        [
          el(
            'div',
            {
              class:
                'overlay-card image-overlay'
            },
            [
              el(
                'img',
                {
                  src:
                    url,

                  class:
                    'orig-image'
                }
              ),

              el(
                'button',
                {
                  class:
                    'btn btn-secondary btn-block',

                  onclick: () => {
                    URL.revokeObjectURL(
                      url
                    );

                    overlay.remove();
                  }
                },
                'Close'
              )
            ]
          )
        ]
      );

    $('.content').appendChild(
      overlay
    );
  }

  function confirmDelete(
    caseId
  ) {
    const overlay =
      el(
        'div',
        {
          class:
            'overlay'
        },
        [
          el(
            'div',
            {
              class:
                'overlay-card'
            },
            [
              el(
                'h3',
                {},
                'Delete this case?'
              ),

              el(
                'p',
                {},
                'This can be recovered from Settings → Recently Deleted.'
              ),

              el(
                'div',
                {
                  class:
                    'btn-row'
                },
                [
                  el(
                    'button',
                    {
                      class:
                        'btn btn-danger',

                      onclick: () => {
                        softDelete(
                          caseId
                        );

                        overlay.remove();
                      }
                    },
                    'Delete'
                  ),

                  el(
                    'button',
                    {
                      class:
                        'btn btn-secondary',

                      onclick: () =>
                        overlay.remove()
                    },
                    'Cancel'
                  )
                ]
              )
            ]
          )
        ]
      );

    $('.content').appendChild(
      overlay
    );
  }

  async function softDelete(
    caseId
  ) {
    const c =
      state.cases.find(
        (x) =>
          x.case_id ===
          caseId
      );

    if (!c) return;

    c.deleted_at =
      new Date().toISOString();

    await persistCase(
      c,
      null
    );

    render();
  }

  async function restoreCase(
    caseId
  ) {
    const c =
      state.cases.find(
        (x) =>
          x.case_id ===
          caseId
      );

    if (!c) return;

    c.deleted_at =
      null;

    await persistCase(
      c,
      null
    );

    render();
  }

  // ---------------------------------------------------------------------
  // Calendar
  // ---------------------------------------------------------------------
  function renderCalendar(content) {
    const ym =
      state.routeParam ||
      todayISO().slice(0, 7);

    const [y, m] =
      ym.split('-').map(Number);

    const first =
      new Date(y, m - 1, 1);

    const daysInMonth =
      new Date(y, m, 0).getDate();

    const startWeekday =
      first.getDay();

    const roster =
      state.settings.anaesthetists;

    const cases =
      activeCases().filter(
        (c) =>
          c.case_date.startsWith(ym)
      );

    const byDate =
      Stats.byDay(cases);

    const grid = el(
      'div',
      {
        class:
          'calendar-grid'
      }
    );

    for (
      let i = 0;
      i < startWeekday;
      i++
    ) {
      grid.appendChild(
        el(
          'div',
          {
            class:
              'cal-cell empty'
          }
        )
      );
    }

    for (
      let d = 1;
      d <= daysInMonth;
      d++
    ) {
      const dateStr =
        `${ym}-${String(d).padStart(
          2,
          '0'
        )}`;

      const dayCases =
        byDate.get(dateStr) ||
        [];

      const summary =
        Stats.dailySummary(
          dayCases,
          roster
        );

      grid.appendChild(
        el(
          'div',
          {
            class:
              'cal-cell' +
              (dayCases.length
                ? ' has-cases'
                : ''),

            onclick: () =>
              navigate(
                '#day',
                dateStr
              )
          },
          [
            el(
              'div',
              {
                class:
                  'cal-day-num'
              },
              String(d)
            ),

            dayCases.length
              ? el(
                  'div',
                  {
                    class:
                      'cal-count'
                  },
                  `${summary.total}`
                )
              : null
          ]
        )
      );
    }

    content.appendChild(
      el(
        'div',
        {
          class:
            'calendar-screen'
        },
        [
          el(
            'div',
            {
              class:
                'month-nav'
            },
            [
              el(
                'button',
                {
                  class:
                    'btn btn-small',

                  onclick: () =>
                    navigate(
                      '#calendar',
                      shiftMonth(
                        ym,
                        -1
                      )
                    )
                },
                '‹'
              ),

              el(
                'div',
                {},
                monthLabel(ym)
              ),

              el(
                'button',
                {
                  class:
                    'btn btn-small',

                  onclick: () =>
                    navigate(
                      '#calendar',
                      shiftMonth(
                        ym,
                        1
                      )
                    )
                },
                '›'
              )
            ]
          ),

          weekdayHeader(),

          grid
        ]
      )
    );
  }

  function weekdayHeader() {
    return el(
      'div',
      {
        class:
          'calendar-grid weekday-header'
      },
      [
        'S',
        'M',
        'T',
        'W',
        'T',
        'F',
        'S'
      ].map(
        (d) =>
          el(
            'div',
            {
              class:
                'cal-cell weekday'
            },
            d
          )
      )
    );
  }

  function shiftMonth(
    ym,
    delta
  ) {
    const [y, m] =
      ym.split('-').map(Number);

    const d =
      new Date(
        y,
        m - 1 + delta,
        1
      );

    return `${d.getFullYear()}-${String(
      d.getMonth() + 1
    ).padStart(2, '0')}`;
  }

  // ---------------------------------------------------------------------
  // Monthly dashboard
  // ---------------------------------------------------------------------

  function renderDashboard(
    content
  ) {
    const ym =
      state.routeParam ||
      todayISO().slice(0, 7);

    const roster =
      state.settings.anaesthetists;

    const cases =
      activeCases().filter(
        (c) =>
          c.case_date.startsWith(ym)
      );

    const stats =
      Stats.monthlyStats(
        cases,
        roster
      );

    const insights =
      Stats.buildInsights(
        stats,
        monthLabel(ym)
      );

    content.appendChild(
      el(
        'div',
        {
          class:
            'dashboard-screen'
        },
        [
          el(
            'div',
            {
              class:
                'month-nav'
            },
            [
              el(
                'button',
                {
                  class:
                    'btn btn-small',

                  onclick: () =>
                    navigate(
                      '#dashboard',
                      shiftMonth(
                        ym,
                        -1
                      )
                    )
                },
                '‹'
              ),

              el(
                'div',
                {},
                monthLabel(ym)
              ),

              el(
                'button',
                {
                  class:
                    'btn btn-small',

                  onclick: () =>
                    navigate(
                      '#dashboard',
                      shiftMonth(
                        ym,
                        1
                      )
                    )
                },
                '›'
              )
            ]
          ),

          el(
            'div',
            {
              class:
                'stat-row wrap'
            },
            [
              statTile(
                String(
                  stats.totalCases
                ),
                'TOTAL CASES'
              ),

              ...roster.map(
                (name) =>
                  statTile(
                    String(
                      stats
                        .byAnaesthetist[
                        name
                      ] || 0
                    ),
                    shortName(
                      name
                    ).toUpperCase()
                  )
              ),

              statTile(
                String(
                  stats.workingDays
                ),
                'WORKING DAYS'
              ),

              statTile(
                String(
                  stats.avgPerDay
                ),
                'AVG/DAY'
              )
            ]
          ),

          el(
            'h3',
            {},
            'Insights'
          ),

          el(
            'ul',
            {
              class:
                'insight-list'
            },
            insights.map(
              (line) =>
                el(
                  'li',
                  {},
                  line
                )
            )
          ),

          el(
            'h3',
            {},
            'Export'
          ),

          el(
            'div',
            {
              class:
                'btn-row wrap'
            },
            [
              el(
                'button',
                {
                  class:
                    'btn btn-primary',

                  onclick: () =>
                    ExportModule.exportMonthExcel(
                      {
                        cases,
                        roster,
                        monthLabel:
                          monthLabel(
                            ym
                          ),
                        fileNamePrefix:
                          `anaesthesia-log-${ym}`
                      }
                    )
                },
                'Excel (.xlsx)'
              ),

              el(
                'button',
                {
                  class:
                    'btn btn-secondary',

                  onclick: () =>
                    ExportModule.exportCasesCSV(
                      cases,
                      `anaesthesia-log-${ym}.csv`
                    )
                },
                'CSV'
              ),

              el(
                'button',
                {
                  class:
                    'btn btn-secondary',

                  onclick: () =>
                    ExportModule.exportMonthPDF(
                      {
                        cases,
                        roster,
                        monthLabel:
                          monthLabel(
                            ym
                          ),
                        hospitalLine:
                          `${state.settings.hospital} – ${state.settings.location}`,
                        fileNamePrefix:
                          `anaesthesia-log-${ym}`
                      }
                    )
                },
                'PDF'
              )
            ]
          )
        ]
      )
    );
  }

  // ---------------------------------------------------------------------
  // My Cases
  // ---------------------------------------------------------------------

  function renderMyCases(
    content
  ) {
    const roster =
      state.settings.anaesthetists;

    const selected =
      state.routeParam ||
      'ALL';

    const ym =
      todayISO().slice(0, 7);

    let cases =
      activeCases().filter(
        (c) =>
          c.case_date.startsWith(ym)
      );

    if (
      selected !== 'ALL'
    ) {
      cases =
        cases.filter(
          (c) =>
            c.anaesthetist ===
            selected
        );
    }

    cases = [
      ...cases
    ].sort(
      (a, b) =>
        a.case_date.localeCompare(
          b.case_date
        )
    );

    content.appendChild(
      el(
        'div',
        {
          class:
            'mycases-screen'
        },
        [
          el(
            'h2',
            {},
            `${
              selected === 'ALL'
                ? 'All Cases'
                : selected
            } — ${monthLabel(
              ym
            )}`
          ),

          el(
            'div',
            {
              class:
                'filter-row'
            },
            [
              el(
                'button',
                {
                  class:
                    'chip' +
                    (selected ===
                    'ALL'
                      ? ' active'
                      : ''),

                  onclick: () =>
                    navigate(
                      '#mycases',
                      'ALL'
                    )
                },
                'ALL'
              ),

              ...roster.map(
                (name) =>
                  el(
                    'button',
                    {
                      class:
                        'chip' +
                        (selected ===
                        name
                          ? ' active'
                          : ''),

                      onclick: () =>
                        navigate(
                          '#mycases',
                          name
                        )
                    },
                    shortName(
                      name
                    )
                  )
              )
            ]
          ),

          el(
            'div',
            {
              class:
                'total-line'
            },
            `Total: ${cases.length} cases`
          ),

          casesTable(cases)
        ]
      )
    );
  }

  function casesTable(
    cases
  ) {
    if (!cases.length) {
      return el(
        'p',
        {
          class:
            'muted center'
        },
        'No cases.'
      );
    }

    return el(
      'div',
      {
        class:
          'table-wrap'
      },
      [
        el(
          'table',
          {
            class:
              'data-table'
          },
          [
            el(
              'thead',
              {},
              el(
                'tr',
                {},
                [
                  'Date',
                  'Patient',
                  'Age/Sex',
                  'UHID',
                  'Visit No',
                  'Consultant',
                  'Hospital',
                  'Anaesthetist'
                ].map(
                  (h) =>
                    el(
                      'th',
                      {},
                      h
                    )
                )
              )
            ),

            el(
              'tbody',
              {},
              cases.map(
                (c) =>
                  el(
                    'tr',
                    {
                      onclick: () =>
                        navigate(
                          '#day',
                          c.case_date
                        )
                    },
                    [
                      fmtDate(
                        c.case_date
                      ),

                      c.patient_name,

                      `${c.age || '?'}/${(
                        c.sex || '?'
                      )[0] || '?'}`,

                      c.uhid,

                      c.visit_number,

                      c.consultant,

                      c.hospital,

                      c.anaesthetist
                    ].map(
                      (v) =>
                        el(
                          'td',
                          {},
                          v || '—'
                        )
                    )
                  )
              )
            )
          ]
        )
      ]
    );
  }

  // ---------------------------------------------------------------------
  // Consultant-wise analysis
  // ---------------------------------------------------------------------

  function renderConsultants(
    content
  ) {
    const ym =
      todayISO().slice(0, 7);

    const cases =
      activeCases().filter(
        (c) =>
          c.case_date.startsWith(ym)
      );

    const stats =
      Stats.monthlyStats(
        cases,
        state.settings
          .anaesthetists
      );

    const crossTab =
      Stats.consultantByAnaesthetist(
        cases
      );

    const sorted =
      Object.entries(
        stats.byConsultant
      ).sort(
        (a, b) =>
          b[1] - a[1]
      );

    content.appendChild(
      el(
        'div',
        {
          class:
            'consultants-screen'
        },
        [
          el(
            'h2',
            {},
            `Consultant Case Volume — ${monthLabel(
              ym
            )}`
          ),

          el(
            'div',
            {
              class:
                'consultant-list'
            },
            sorted.map(
              ([
                name,
                count
              ]) =>
                el(
                  'div',
                  {
                    class:
                      'consultant-card'
                  },
                  [
                    el(
                      'div',
                      {
                        class:
                          'consultant-head'
                      },
                      [
                        el(
                          'span',
                          {},
                          name
                        ),

                        el(
                          'span',
                          {
                            class:
                              'badge'
                          },
                          `${count} cases`
                        )
                      ]
                    ),

                    el(
                      'div',
                      {
                        class:
                          'consultant-breakdown'
                      },
                      Object.entries(
                        crossTab[
                          name
                        ] || {}
                      ).map(
                        ([
                          anaes,
                          n
                        ]) =>
                          el(
                            'div',
                            {},
                            `${anaes} → ${n} cases`
                          )
                      )
                    )
                  ]
                )
            )
          )
        ]
      )
    );
  }

  // ---------------------------------------------------------------------
  // Search
  // ---------------------------------------------------------------------

  function renderSearch(
    content
  ) {
    const box =
      el(
        'input',
        {
          type:
            'text',

          class:
            'input',

          placeholder:
            'Search patient, UHID, visit no, consultant, anaesthetist, date...'
        }
      );

    const results =
      el(
        'div',
        {
          class:
            'search-results'
        }
      );

    box.addEventListener(
      'input',
      () =>
        runSearch(
          box.value,
          results
        )
    );

    content.appendChild(
      el(
        'div',
        {
          class:
            'search-screen'
        },
        [
          el(
            'h2',
            {},
            'Search'
          ),

          box,

          results
        ]
      )
    );

    setTimeout(
      () =>
        box.focus(),
      50
    );
  }

  function runSearch(
    query,
    resultsEl
  ) {
    resultsEl.innerHTML =
      '';

    const q =
      query
        .trim()
        .toLowerCase();

    if (!q) return;

    const fields = [
      'patient_name',
      'uhid',
      'visit_number',
      'consultant',
      'anaesthetist',
      'hospital',
      'location',
      'case_date'
    ];

    const matches =
      activeCases().filter(
        (c) =>
          fields.some(
            (f) =>
              (
                c[f] || ''
              )
                .toString()
                .toLowerCase()
                .includes(q)
          )
      );

    resultsEl.appendChild(
      el(
        'div',
        {
          class:
            'total-line'
        },
        `${matches.length} result(s)`
      )
    );

    resultsEl.appendChild(
      casesTable(
        matches.sort(
          (a, b) =>
            b.case_date.localeCompare(
              a.case_date
            )
        )
      )
    );
  }

  // ---------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------

  function renderSettings(
    content
  ) {
    const s =
      state.settings;

    const deletedCases =
      state.cases.filter(
        (c) => c.deleted_at
      );

    content.appendChild(
      el(
        'div',
        {
          class:
            'settings-screen'
        },
        [
          el(
            'h2',
            {},
            'Settings'
          ),

          el(
            'div',
            {
              class:
                'field-row'
            },
            [
              el(
                'label',
                {},
                'Anaesthetist 1'
              ),

              el(
                'input',
                {
                  class:
                    'input',

                  value:
                    s.anaesthetists[0],

                  oninput: (e) =>
                    (s.anaesthetists[0] =
                      e.target.value)
                }
              )
            ]
          ),

          el(
            'div',
            {
              class:
                'field-row'
            },
            [
              el(
                'label',
                {},
                'Anaesthetist 2'
              ),

              el(
                'input',
                {
                  class:
                    'input',

                  value:
                    s.anaesthetists[1] ||
                    '',

                  oninput: (e) =>
                    (s.anaesthetists[1] =
                      e.target.value)
                }
              )
            ]
          ),

          el(
            'div',
            {
              class:
                'field-row'
            },
            [
              el(
                'label',
                {},
                'Hospital'
              ),

              el(
                'input',
                {
                  class:
                    'input',

                  value:
                    s.hospital,

                  oninput: (e) =>
                    (s.hospital =
                      e.target.value)
                }
              )
            ]
          ),

          el(
            'div',
            {
              class:
                'field-row'
            },
            [
              el(
                'label',
                {},
                'Location'
              ),

              el(
                'input',
                {
                  class:
                    'input',

                  value:
                    s.location,

                  oninput: (e) =>
                    (s.location =
                      e.target.value)
                }
              )
            ]
          ),

          el(
            'button',
            {
              class:
                'btn btn-primary',

              onclick:
                async () => {
                  await saveSettings();

                  alert(
                    'Saved.'
                  );

                  render();
                }
            },
            'Save Settings'
          ),

          el(
            'hr'
          ),

          el(
            'button',
            {
              class:
                'btn btn-secondary btn-block',

              onclick: () =>
                navigate(
                  '#backup'
                )
            },
            'Backup / Restore'
          ),

          el(
            'hr'
          ),

          el(
            'h3',
            {},
            `Recently Deleted (${deletedCases.length})`
          ),

          el(
            'div',
            {
              class:
                'case-list'
            },
            deletedCases.map(
              (c) =>
                el(
                  'div',
                  {
                    class:
                      'case-card'
                  },
                  [
                    el(
                      'div',
                      {
                        class:
                          'case-card-head'
                      },
                      [
                        el(
                          'div',
                          {},
                          `${c.patient_name} — ${fmtDate(
                            c.case_date
                          )}`
                        ),

                        el(
                          'button',
                          {
                            class:
                              'btn btn-small',

                            onclick: () =>
                              restoreCase(
                                c.case_id
                              )
                          },
                          'Restore'
                        )
                      ]
                    )
                  ]
                )
            )
          )
        ]
      )
    );
  }

  // ---------------------------------------------------------------------
  // Backup / Restore
  // ---------------------------------------------------------------------
  // ---------------------------------------------------------------------
  // Backup / Restore
  // ---------------------------------------------------------------------

  function renderBackup(content) {
    content.appendChild(
      el('div', { class: 'backup-screen' }, [
        el('h2', {}, 'Backup & Restore'),

        el(
          'p',
          { class: 'muted' },
          'The backup file remains fully encrypted with your current PIN. Keep it somewhere safe (cloud drive, computer). You will need the same PIN to restore it.'
        ),

        el(
          'button',
          {
            class: 'btn btn-primary btn-block',
            onclick: doBackup
          },
          'BACKUP DATA'
        ),

        el('hr'),

        el(
          'label',
          {
            class: 'btn btn-secondary btn-block capture-label'
          },
          [
            'RESTORE DATA',
            el('input', {
              type: 'file',
              accept: 'application/json',
              class: 'hidden-file',
              onchange: doRestore
            })
          ]
        ),

        el(
          'button',
          {
            class: 'btn btn-link',
            onclick: () => navigate('#settings')
          },
          'Back'
        )
      ])
    );
  }

  async function doBackup() {
    const [meta, cases, images, consultants] = await Promise.all([
      DB.getAll('meta'),
      DB.getAll('cases'),
      DB.getAll('images'),
      DB.getAll('consultants')
    ]);

    // Images store raw ArrayBuffers for `data`;
    // convert to base64 for JSON.
    const imagesB64 = images.map((r) => ({
      case_id: r.case_id,
      iv: r.iv,
      data: CryptoModule.bufToB64(r.data),
      mimeType: r.mimeType
    }));

    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      meta,
      cases,
      images: imagesB64,
      consultants
    };

    const blob = new Blob(
      [JSON.stringify(payload)],
      { type: 'application/json' }
    );

    ExportModule.downloadBlob(
      blob,
      `anaesthesia-log-backup-${todayISO()}.json`
    );
  }

  async function doRestore(e) {
    const file = e.target.files[0];

    if (!file) return;

    if (
      !confirm(
        'Restoring will replace ALL current data on this device with the backup file. Continue?'
      )
    ) {
      return;
    }

    const text = await file.text();
    const payload = JSON.parse(text);

    await DB.clearAll();

    for (const m of payload.meta) {
      await DB.put('meta', m);
    }

    for (const c of payload.cases) {
      await DB.put('cases', c);
    }

    for (const img of payload.images) {
      await DB.put('images', {
        case_id: img.case_id,
        iv: img.iv,
        data: CryptoModule.b64ToBuf(img.data),
        mimeType: img.mimeType
      });
    }

    for (const co of payload.consultants || []) {
      await DB.put('consultants', co);
    }

    alert(
      'Restore complete. Please unlock with the PIN used for this backup.'
    );

    location.reload();
  }

  // ---------------------------------------------------------------------

  return { boot };
})();

document.addEventListener('DOMContentLoaded', () => App.boot());