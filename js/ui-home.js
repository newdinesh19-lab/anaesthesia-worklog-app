/**
 * ui-home.js — redesigned Home dashboard (header, statistics, quick actions, analytics, recent cases, alerts).
 * Replaces the old Home screen; all data comes from the existing records. Charts appear only when there is data.
 */
(window.V8Ext = window.V8Ext || []).push((ctx) => {
  const { state, h, ic, go, toast, openSheet, todayISO, fmtDate, fmtDay, monthLabel, shiftDay, shortName, toneOf, TONE_VAR, DOW, parseISO } = ctx;
  const S = Schema, A = Analytics, X = ctx.X;
  const reduce = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isComplete = (c) => !!(c.surgery && c.asa && S.techniquesOf(c).length);
  const statusOf = (c) => (!isComplete(c) ? ['Incomplete', 'warn'] : c.notable ? ['Notable', 'star'] : ['Complete', 'ok']);
  const techShort = (c) => S.techniquesOf(c).join(' + ') || c.anaesthesia_mode || '—';
  const mins = (c) => { const i = c.intraop || {}; return S.minutesBetween(i.anaes_start, i.anaes_end); };
  const fmtHours = (m) => (m >= 600 ? Math.round(m / 60) + ' h' : (Math.round(m / 6) / 10) + ' h');

  /** Number that counts up once (skipped for reduced-motion users). */
  function countNum(n, suffix = '') {
    const el = h('span', { class: 'num' }, reduce() || n > 9999 ? String(n) + suffix : '0' + suffix);
    if (!reduce() && n <= 9999 && n > 0) { const t0 = performance.now(), dur = 450; const step = (t) => { const k = Math.min(1, (t - t0) / dur); el.textContent = Math.round(n * (1 - Math.pow(1 - k, 3))) + suffix; if (k < 1) requestAnimationFrame(step); }; requestAnimationFrame(step); }
    return el;
  }
  const statCard = (tone, icon, value, label, sub, onclick) => h(onclick ? 'button' : 'div', { class: `stat s-${tone}`, onclick }, [
    h('span', { class: 'stat-ic' }, ic(icon)), h('div', { class: 'stat-body' }, [h('div', { class: 'stat-num' }, typeof value === 'number' ? countNum(value) : (value instanceof Node ? value : h('span', { class: 'num' }, String(value)))), h('div', { class: 'stat-lbl' }, label), sub ? h('div', { class: 'stat-sub' }, sub) : null])]);

  // ---------------------------------------------------------------- alerts (the notification bell)
  function alerts() {
    const out = []; const st = state.settings, all = ctx.activeCases();
    const days = st.backupRemindDays, age = st.lastBackupAt ? Math.floor((Date.now() - new Date(st.lastBackupAt)) / 864e5) : null;
    if (days && all.length && (age === null || age >= days)) out.push({ tone: 'warn', icon: 'download', title: age === null ? 'You have never backed up' : `Last backup ${age} days ago`, text: 'Your data lives only on this phone.', action: 'Back up', go: () => go('backup') });
    if (X.schedAlerts) out.push(...X.schedAlerts());
    const inc = all.filter((c) => !isComplete(c));
    if (inc.length) out.push({ tone: 'info', icon: 'edit', title: `${inc.length} incomplete entr${inc.length === 1 ? 'y' : 'ies'}`, text: 'Missing surgery, ASA or technique.', action: 'Review', go: () => { state.casesView = 'list'; state.filters = { ...ctx.emptyFilters(''), incomplete: true }; go('cases'); } });
    if (state.corrupt && state.corrupt.length) out.push({ tone: 'warn', icon: 'warn', title: `${state.corrupt.length} unreadable record(s)`, text: 'See Data health.', action: 'Open', go: () => go('health') });
    if (state.sec && !state.sec.rec && !state.sec.q) out.push({ tone: 'info', icon: 'shield', title: 'No PIN recovery set up', text: 'A forgotten PIN cannot otherwise be reset.', action: 'Set up', go: () => go('security') });
    if (DB.status.mode === 'memory') out.push({ tone: 'warn', icon: 'warn', title: 'Storage is blocked', text: 'Records are only kept in temporary memory.', action: 'Info', go: () => toast('Open the app in Chrome (not private mode) to store data.') });
    return out;
  }
  function openAlerts() {
    const list = alerts();
    const close = openSheet('Notifications', h('div', {}, list.length ? list.map((a) => h('div', { class: 'alert-row ' + a.tone }, [h('span', { class: 'stat-ic' }, ic(a.icon)), h('div', { style: 'flex:1;min-width:0' }, [h('b', {}, a.title), h('small', { class: 'muted', style: 'display:block' }, a.text)]), h('button', { class: 'btn btn-sm', onclick: () => { close(); a.go(); } }, a.action)])) : [h('div', { class: 'empty', style: 'padding:24px' }, [ic('check'), h('div', {}, 'All clear. Nothing needs your attention.')])]));
  }

  // ---------------------------------------------------------------- screen
  function renderHome(screen) {
    const roster = state.settings.anaesthetists, today = todayISO(), ym = today.slice(0, 7);
    const all = ctx.activeCases(), monthCases = all.filter((c) => c.case_date.startsWith(ym)), todayCases = all.filter((c) => c.case_date === today);
    const openCases = (patch) => { state.casesView = 'list'; state.filters = { ...ctx.emptyFilters(ym), ...patch }; go('cases'); };
    const nAlerts = alerts().length;
    const hr = new Date().getHours(), greet = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
    const initials = (roster[0] || 'Me').replace(/^Dr\.?\s*/i, '').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

    // A. header
    screen.appendChild(h('header', { class: 'home-head' }, [
      h('div', { class: 'home-title' }, [h('small', {}, `${greet} · ${fmtDay(today)}`), h('h1', {}, 'Anaesthesia Log')]),
      h('div', { class: 'home-actions' }, [
        h('button', { class: 'icon-btn', id: 'hSearch', 'aria-label': 'Search', onclick: () => go('search') }, ic('search')),
        h('button', { class: 'icon-btn', id: 'hTheme', 'aria-label': 'Switch day / night mode', onclick: () => ctx.toggleDayNight() }, ic(ctx.isDarkNow() ? 'sun' : 'moon')),
        h('button', { class: 'icon-btn', id: 'hBell', 'aria-label': 'Notifications', onclick: openAlerts }, [ic('bell'), nAlerts ? h('i', { class: 'badge' }, String(nAlerts)) : null]),
        h('button', { class: 'icon-btn avatar-btn', id: 'hProfile', 'aria-label': 'Profile and settings', onclick: () => go('settings') }, initials),
      ]),
    ]));

    // B. anything awaiting attention — one slim line, details behind the bell
    if (nAlerts) screen.appendChild(h('button', { class: 'hm-attn', id: 'hAttn', onclick: openAlerts }, [ic('warn', 'inl'), h('span', {}, nAlerts === 1 ? alerts()[0].title : `${nAlerts} items need your attention`), h('b', {}, 'View')]));

    // C. four shortcuts (Scan Sheet is on the Add Case screen)
    const sc = (cls, icon, title, sub, fn, id) => h('button', { class: 'hm-sc ' + cls, id, onclick: fn }, [h('span', { class: 'hm-sc-ic' }, ic(icon)), h('span', { class: 'hm-sc-t' }, [h('b', {}, title), h('small', {}, sub)])]);
    screen.appendChild(h('div', { class: 'hm-grid' }, [
      sc('hm-add', 'plus', 'Add Case', 'Scan or type', () => go('add'), 'qaAdd'),
      sc('hm-cases', 'list', 'My Cases', `${monthCases.filter((c) => c.anaesthetist === roster[0]).length} this month`, () => openCases({ anaes: roster[0] }), 'qaMine'),
      sc('hm-preop', 'clip', 'Pre-op', 'Assessment', () => go('preop'), 'qaPreop'),
      sc('hm-plan', 'calendar', 'My Planner', 'Day · week · month', () => go('planner'), 'qaPlanner'),
    ]));

    // D. today's duty — one compact summary + quick marking
    if (X.thancToday) {
      const rows = X.thancToday(), meK = Thanc.canonKey(roster[0] || ''), resolve = Thanc.resolver(Thanc.config(state.settings.thanc));
      const mineRows = rows.filter((r) => r.doctors.some((n) => Thanc.canonKey(resolve(n)) === meK));
      const legacy = ctx.dutiesOn(today);
      const t12 = (t) => { if (!t) return ''; const [hh, mm] = t.split(':').map(Number); return `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'am' : 'pm'}`; };
      const ICON = { morning: 'sun', evening: 'cloud', night: 'moon' };
      const line = (r) => h('div', { class: 'hm-dline' + (r.saved ? ' ok' : ''), 'data-shift': r.shift }, [
        h('span', { class: 'hm-dic th-' + ({ morning: 'am', evening: 'pm', night: 'nt' }[r.shift]) }, ic(ICON[r.shift] || 'moon')),
        h('span', { class: 'hm-dt' }, [h('b', {}, r.label), h('small', {}, `${t12(r.start)}–${t12(r.end)} · ${r.doctors.length ? r.doctors.map(shortName).join(', ') : 'no doctors'}`)]),
        r.saved ? h('span', { class: 'hm-st ok' }, 'Saved') : h('button', { class: 'btn btn-sm hm-mark', 'data-mark': r.shift, onclick: (e) => { e.stopPropagation(); X.thancQuickMark(r.shift); } }, 'Mark')]);
      const card = h('div', { class: 'card hm-duty', id: 'homeDuty' }, [
        h('button', { class: 'hm-ch', id: 'homeDutyOpen', onclick: () => go('thanc') }, [h('h3', {}, "Today's duty"), h('small', {}, mineRows.length ? `You: ${mineRows.map((r) => r.label).join(' + ')} · THANC` : 'THANC'), h('span', { class: 'hm-go' }, ic('left'))]),
        ...rows.map(line),
        ...legacy.map((d) => h('div', { class: 'hm-dline ok' }, [h('span', { class: 'hm-dic th-nt' }, ic('moon')), h('span', { class: 'hm-dt' }, [h('b', {}, 'Night duty'), h('small', {}, `${d.hospital || ''} ${t12(d.start)}–${t12(d.end)}`)]), h('span', { class: 'hm-st ok' }, 'Logged')])),
      ]);
      screen.appendChild(card);
    }

    // E. my day — next two personal activities (and planned OT cases)
    if (X.plannerMyDay) screen.appendChild(X.plannerMyDay(2));

    // F. assistant — at most one: a pending "did you do it?" or one suggestion
    const assist = (X.plannerPromptCard && X.plannerPromptCard()) || (X.plannerSuggestion && X.plannerSuggestion());
    if (assist) screen.appendChild(assist);
  }

  return { screens: { home: renderHome }, api: { homeAlerts: alerts } };
});
