/**
 * ui-shell.js — v11 dashboard shell: desktop sidebar + top bar + right panel, mobile drawer + week strip,
 * welcome banner, summary cards and the analytics chart for Home. Every number comes from saved records.
 */
(window.V8Ext = window.V8Ext || []).push((ctx) => {
  const { state, h, ic, go, todayISO, fmtDay, shortName, parseISO, MON, monthLabel, shiftDay, toneOf, TONE_VAR } = ctx;
  const X = ctx.X, Th = Thanc;
  const pad = (n) => String(n).padStart(2, '0');
  const isoOf = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
  const me = () => (state.settings.anaesthetists || [])[0] || 'Dr. Me';
  const initialsOf = (n) => n.replace(/^Dr\.?\s*/i, '').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || 'ME';
  const isComplete = (c) => !!(c.surgery && c.asa && Schema.techniquesOf(c).length);
  const thancRecs = () => Th.recordsOf(state.templates);
  const cfg = () => Th.config(state.settings.thanc);
  const dutyDoctors = (r) => Th.uniq(r.doctors || [], Th.resolver(cfg()));
  const timeRange = (r) => (r.start && r.end ? `${r.start}–${r.end}` : '');
  const docDot = (n) => { const c = Th.colorOf(cfg(), n); return h('span', { class: 'av', title: n, style: `background:${c};color:${Th.inkOn(c)}` }, Th.initials(n)); };
  const SHIFT_ICON = { morning: 'sun', evening: 'cloud', night: 'moon' };
  let calYM = null, rangeKey = 'year', picked = null;

  // ------------------------------------------------------------------ sidebar
  const NAV = [
    ['home', 'home', 'Dashboard', () => go('home'), (r) => r === 'home'],
    ['cases', 'list', 'Cases', () => { state.casesView = 'list'; go('cases'); }, (r) => (r === 'cases' && state.casesView !== 'calendar') || r === 'day', 'cases'],
    ['add', 'plus', 'Add Case', () => go('add'), (r) => r === 'add'],
    ['dutycal', 'calendar', 'Duty Calendar', () => { state.casesView = 'calendar'; go('cases'); }, (r) => r === 'cases' && state.casesView === 'calendar'],
    ['thanc', 'moon', 'THANC Duty', () => go('thanc'), (r) => r === 'thanc'],
    ['preop', 'clip', 'Preoperative Assessment', () => go('preop'), (r) => r === 'preop' || r === 'preopEdit'],
    ['analytics', 'pie', 'Analytics', () => go('analytics'), (r) => r === 'analytics' || r === 'monthly'],
    ['reports', 'file', 'Exports', () => go('reports'), (r) => r === 'reports'],
  ];
  const NAV2 = [
    ['settings', 'gear', 'Settings', () => go('settings'), (r) => r === 'settings' || r === 'security'],
    ['backup', 'download', 'Backup & restore', () => go('backup'), (r) => r === 'backup'],
    ['more', 'grid', 'All tools', () => go('more'), (r) => r === 'more'],
    ['lock', 'logout', 'Lock app', () => ctx.lockNow(), () => false],
  ];
  function sidebar() {
    const r = state.route, active = ctx.activeCases(), ym = todayISO().slice(0, 7), monthN = active.filter((c) => c.case_date.startsWith(ym)).length;
    const item = ([id, icon, label, fn, on, badge]) => h('button', { class: 'sb-item' + (on(r) ? ' on' : ''), id: 'nav-' + id, 'aria-current': on(r) ? 'page' : null, onclick: () => { document.getElementById('app').classList.remove('drawer-open'); fn(); } }, [ic(icon), h('span', { class: 'sb-l' }, label), badge === 'cases' && monthN ? h('i', { class: 'sb-badge' }, String(monthN)) : null]);
    return h('aside', { class: 'sidebar', 'aria-label': 'Main navigation' }, [
      h('div', { class: 'sb-brand' }, [h('div', { class: 'sb-logo' }, ic('pulse')), h('b', {}, 'Anaesthesia Log')]),
      h('div', { class: 'sb-sec' }, 'Workspace'),
      h('nav', { class: 'sb-nav' }, NAV.map(item)),
      h('div', { class: 'sb-div' }),
      h('nav', { class: 'sb-nav' }, NAV2.map(item)),
      h('div', { class: 'sb-foot' }, [
        h('small', { class: 'sb-ver' }, 'v' + Schema.APP_VERSION),
        h('button', { class: 'sb-profile', id: 'sbProfile', onclick: () => go('settings') }, [h('span', { class: 'sb-av' }, initialsOf(me())), h('span', { class: 'sb-who' }, [h('b', {}, me()), h('small', {}, state.settings.speciality || 'Anaesthesiologist')])]),
      ]),
    ]);
  }

  // ------------------------------------------------------------------ top bar
  function setTheme() {
    const cur = document.documentElement.getAttribute('data-theme') || 'dark';
    state.settings.theme = cur === 'light' ? 'dark' : 'light'; ctx.applyTheme(); ctx.saveSettings().catch(() => {}); ctx.render();
  }
  function topbar() {
    const n = X.homeAlerts ? X.homeAlerts().length : 0, dark = (document.documentElement.getAttribute('data-theme') || 'dark') !== 'light';
    return h('header', { class: 'topbar' }, [
      h('button', { class: 'tb-menu icon-btn', id: 'tbMenu', 'aria-label': 'Menu', onclick: () => document.getElementById('app').classList.toggle('drawer-open') }, ic('list')),
      h('button', { class: 'tb-search', id: 'tbSearch', onclick: () => go('search') }, [ic('search'), h('span', {}, 'Search cases, patients, duties…')]),
      h('div', { class: 'tb-right' }, [
        h('button', { class: 'icon-btn', id: 'tbTheme', 'aria-label': 'Toggle light / dark theme', onclick: setTheme }, ic(dark ? 'sun' : 'moon')),
        h('button', { class: 'icon-btn', id: 'tbBell', 'aria-label': 'Notifications', onclick: () => X.openAlerts && X.openAlerts() }, [ic('bell'), n ? h('i', { class: 'badge' }, String(n)) : null]),
        h('div', { class: 'tb-date' }, [ic('calendar'), h('span', {}, new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }))]),
        h('button', { class: 'tb-home', id: 'tbHome', onclick: () => go('home') }, [ic('home'), h('span', {}, 'Home')]),
      ]),
    ]);
  }

  // ------------------------------------------------------------------ right panel (desktop, Home only)
  function miniCalendar() {
    const today = todayISO(); if (!calYM) calYM = today.slice(0, 7);
    const [y, m] = calYM.split('-').map(Number), lead = (new Date(y, m - 1, 1).getDay() + 6) % 7, dim = new Date(y, m, 0).getDate(), prevDim = new Date(y, m - 1, 0).getDate();
    const recs = thancRecs(), all = ctx.activeCases();
    const caseDays = new Set(all.filter((c) => c.case_date.startsWith(calYM)).map((c) => c.case_date)), dutyDays = new Set(recs.filter((r) => r.date.startsWith(calYM)).map((r) => r.date));
    const nav = (d) => { const t = new Date(y, m - 1 + d, 1); calYM = `${t.getFullYear()}-${pad(t.getMonth() + 1)}`; ctx.render(); };
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push(h('span', { class: 'mc-d out' }, String(prevDim - lead + 1 + i)));
    for (let d = 1; d <= dim; d++) { const iso = isoOf(y, m, d); cells.push(h('button', { class: 'mc-d' + (iso === today ? ' today' : ''), 'data-date': iso, 'aria-label': fmtDay(iso), onclick: () => go('day', iso) }, [String(d), caseDays.has(iso) || dutyDays.has(iso) ? h('i', { class: 'mc-dots' }, [caseDays.has(iso) ? h('u', { class: 'c' }) : null, dutyDays.has(iso) ? h('u', { class: 'd' }) : null]) : null])); }
    for (let k = 1; cells.length % 7; k++) cells.push(h('span', { class: 'mc-d out' }, String(k)));
    return h('section', { class: 'rp-card', id: 'miniCal' }, [
      h('div', { class: 'rp-head' }, [h('h3', {}, MON[m - 1] ? `${MON[m - 1]} ${y}` : monthLabel(calYM)), h('div', { class: 'rp-nav' }, [h('button', { 'aria-label': 'Previous month', onclick: () => nav(-1) }, ic('left')), h('button', { 'aria-label': 'Next month', onclick: () => nav(1) }, h('span', { style: 'display:inline-flex;transform:rotate(180deg)' }, ic('left')))])]),
      h('div', { class: 'mc-grid' }, [...['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => h('span', { class: 'mc-w' }, d)), ...cells]),
      h('div', { class: 'mc-legend' }, [h('span', {}, [h('u', { class: 'c' }), ' Cases']), h('span', {}, [h('u', { class: 'd' }), ' THANC duty'])]),
    ]);
  }
  function dutyRow(r, showDate) {
    const meK = Th.canonKey(Th.resolver(cfg())(me())), mine = dutyDoctors(r).some((n) => Th.canonKey(n) === meK);
    return h('button', { class: 'rp-row', 'data-duty': r.id, onclick: () => go('thanc') }, [
      h('span', { class: 'rp-ic s-' + r.shift }, ic(SHIFT_ICON[r.shift] || 'moon')),
      h('span', { class: 'rp-t' }, [h('b', {}, `${Th.shiftMeta(r.shift).label}${mine ? ' · You' : ''}`), h('small', {}, [showDate ? fmtDay(r.date) + ' · ' : '', timeRange(r) || 'time not set'])]),
      h('span', { class: 'av-stack' }, dutyDoctors(r).slice(0, 4).map(docDot)),
    ]);
  }
  function todayDuty() {
    const today = todayISO(), list = Th.forDate(thancRecs(), today).sort((a, b) => Th.order(a.shift) - Th.order(b.shift)), legacy = ctx.dutiesOn(today);
    return h('section', { class: 'rp-card', id: 'rpToday' }, [h('div', { class: 'rp-head' }, [h('h3', {}, "Today's duty"), h('button', { class: 'rp-link', onclick: () => go('thanc') }, 'Manage')]),
      list.length || legacy.length ? h('div', { class: 'rp-list' }, [...list.map((r) => dutyRow(r, false)), ...legacy.map((d) => h('div', { class: 'rp-row' }, [h('span', { class: 'rp-ic s-night' }, ic('moon')), h('span', { class: 'rp-t' }, [h('b', {}, 'Night duty'), h('small', {}, `${d.hospital || ''} ${d.start || ''}–${d.end || ''}`)])]))]) : h('p', { class: 'rp-empty' }, 'No duty recorded for today.')]);
  }
  function upcomingDuty() {
    const today = todayISO(), until = shiftDay(today, 14), list = thancRecs().filter((r) => r.date > today && r.date <= until).sort(Th.sortAsc).slice(0, 5);
    return h('section', { class: 'rp-card', id: 'rpUpcoming' }, [h('div', { class: 'rp-head' }, [h('h3', {}, 'Upcoming duties'), h('span', { class: 'rp-sub' }, 'next 14 days')]),
      list.length ? h('div', { class: 'rp-list' }, list.map((r) => dutyRow(r, true))) : h('p', { class: 'rp-empty' }, 'No upcoming THANC duties scheduled.')]);
  }
  function reminders() {
    const items = (X.homeAlerts ? X.homeAlerts() : []).slice(0, 4);
    return h('section', { class: 'rp-card', id: 'rpReminders' }, [h('div', { class: 'rp-head' }, [h('h3', {}, 'Quick reminders')]),
      items.length ? h('div', { class: 'rp-list' }, items.map((a) => h('button', { class: 'rp-row rem ' + a.tone, onclick: () => (a.go ? a.go() : null) }, [h('span', { class: 'rp-ic' }, ic(a.icon || 'info')), h('span', { class: 'rp-t' }, [h('b', {}, a.title), h('small', {}, a.text || '')])]))) : h('p', { class: 'rp-empty' }, 'Nothing needs your attention.')]);
  }
  const rightPanel = () => h('aside', { class: 'rightpanel', 'aria-label': 'Calendar and duty schedule' }, [miniCalendar(), todayDuty(), upcomingDuty(), reminders()]);

  // ------------------------------------------------------------------ shell hook (called after every screen render)
  function shell(rootEl, screen) {
    rootEl.classList.add('shell'); rootEl.classList.toggle('has-right', state.route === 'home');
    rootEl.insertBefore(sidebar(), rootEl.firstChild); rootEl.insertBefore(topbar(), screen);
    if (state.route === 'home') rootEl.appendChild(rightPanel());
    rootEl.appendChild(h('div', { class: 'drawer-scrim', onclick: () => rootEl.classList.remove('drawer-open') }));
    rootEl.classList.remove('drawer-open');
  }

  // ------------------------------------------------------------------ Home: banner, cards, analytics
  const reduce = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  function welcome() {
    const today = todayISO(), all = ctx.activeCases(), nToday = all.filter((c) => c.case_date === today).length, pending = all.filter((c) => !isComplete(c)).length;
    const duty = Th.forDate(thancRecs(), today).sort((a, b) => Th.order(a.shift) - Th.order(b.shift));
    const bits = [`<b>${nToday}</b> case${nToday === 1 ? '' : 's'} today`];
    if (duty.length) bits.push(`THANC: <b>${duty.map((r) => Th.shiftMeta(r.shift).label).join(' · ')}</b>`);
    if (pending) bits.push(`<b>${pending}</b> entr${pending === 1 ? 'y' : 'ies'} to complete`);
    return h('section', { class: 'welcome', id: 'welcome' }, [
      h('div', {}, [h('h2', {}, `Welcome back, ${me()}`), h('p', { html: `${fmtDay(today)} · ` + bits.join(' · ') })]),
      h('span', { class: 'welcome-art', 'aria-hidden': 'true', html: '<svg viewBox="0 0 120 60"><path d="M0 34h26l8-22 12 40 10-30 8 12h56" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>' }),
    ]);
  }
  const monthKey = (y, m) => `${y}-${pad(m)}`;
  function casesTodayCard() {
    const roster = state.settings.anaesthetists || [], today = todayISO(), list = ctx.casesForDate(today);
    const by = roster.map((n) => [n, list.filter((c) => c.anaesthetist === n).length]).filter((e) => e[1] > 0);
    return h('button', { class: 'hc hc-today', id: 'hcToday', onclick: () => go('day', today) }, [
      h('div', { class: 'hc-big' }, String(list.length)),
      h('div', { class: 'hc-av' }, by.length ? by.slice(0, 4).map(([n, k]) => h('span', { class: 'av tone-' + toneOf(n), title: `${n}: ${k}`, style: `background:${TONE_VAR[toneOf(n)]}` }, initialsOf(n))) : h('span', { class: 'hc-hint' }, 'No cases logged yet today')),
      h('div', { class: 'hc-label' }, 'Cases today'),
    ]);
  }
  function monthlyCard() {
    const today = todayISO(), [y, m] = today.split('-').map(Number), all = ctx.activeCases();
    const count = (yy, mm) => all.filter((c) => c.case_date.startsWith(monthKey(yy, mm))).length;
    const cur = count(y, m), pm = new Date(y, m - 2, 1), prev = count(pm.getFullYear(), pm.getMonth() + 1);
    const bars = []; for (let i = 5; i >= 0; i--) { const t = new Date(y, m - 1 - i, 1); bars.push([MON[t.getMonth()], count(t.getFullYear(), t.getMonth() + 1)]); }
    const mx = Math.max(1, ...bars.map((b) => b[1])), delta = prev ? Math.round(((cur - prev) / prev) * 100) : null;
    return h('button', { class: 'hc hc-month', id: 'hcMonth', onclick: () => { state.casesView = 'list'; state.filters = { ...ctx.emptyFilters(today.slice(0, 7)) }; go('cases'); } }, [
      h('div', { class: 'hc-top' }, [h('div', { class: 'hc-big sm' }, String(cur)), delta === null ? null : h('span', { class: 'trend ' + (delta >= 0 ? 'up' : 'down') }, `${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta)}%`)]),
      h('div', { class: 'spark' }, bars.map(([l, v], i) => h('i', { class: i === bars.length - 1 ? 'on' : '', style: `height:${Math.max(6, (v / mx) * 100)}%`, title: `${l}: ${v}` }))),
      h('div', { class: 'hc-label' }, [`Cases · ${monthLabel(today.slice(0, 7))}`, prev ? h('small', {}, ` · ${prev} last month`) : null]),
    ]);
  }
  function thancCard() {
    const today = todayISO(), recs = thancRecs(), cf = cfg();
    const rows = Th.SHIFTS.map((sh) => { const r = Th.forDate(recs, today).find((x) => x.shift === sh.id); const docs = r ? dutyDoctors(r) : []; return h('button', { class: 'th-line', 'data-shift': sh.id, onclick: () => go('thanc') }, [
      h('span', { class: 'th-lic' }, ic(SHIFT_ICON[sh.id])), h('span', { class: 'th-lt' }, [h('b', {}, sh.label), h('small', {}, r ? (timeRange(r) || 'time not set') : (cf.shifts[sh.id].doctors.length ? 'Not saved yet' : 'Unassigned'))]),
      docs.length ? h('span', { class: 'av-stack' }, docs.slice(0, 4).map(docDot)) : null, h('span', { class: 'th-tag' + (r ? ' ok' : '') }, r ? 'Assigned' : 'Open')]); });
    return h('section', { class: 'hc hc-thanc', id: 'hcThanc' }, [h('div', { class: 'hc-hd' }, [h('h3', {}, 'THANC Duty'), h('button', { class: 'hc-link', 'aria-label': 'Open THANC duty', onclick: () => go('thanc') }, ic('chev'))]), h('div', { class: 'th-lines' }, rows)]);
  }
  function quickCard() {
    const qa = (icon, label, fn, id) => h('button', { class: 'qa-b', id, onclick: fn }, [ic(icon), h('span', {}, label)]);
    const recent = [...ctx.activeCases()].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')).slice(0, 3);
    return h('section', { class: 'hc hc-quick', id: 'hcQuick' }, [h('div', { class: 'hc-hd' }, [h('h3', {}, 'Quick actions')]),
      h('div', { class: 'qa-row' }, [qa('plus', 'Add case', () => ctx.startManualCase(), 'dqAdd'), qa('camera', 'Scan sheet', () => go('add'), 'dqScan'), qa('clip', 'Pre-op', () => go('preop'), 'dqPreop'), qa('moon', 'THANC', () => go('thanc'), 'dqThanc')]),
      h('div', { class: 'hc-sub' }, 'Recent activity'),
      recent.length ? h('div', { class: 'act-list' }, recent.map((c) => h('button', { class: 'act', onclick: () => go('day', c.case_date) }, [h('span', { class: 'act-dot', style: `background:${TONE_VAR[toneOf(c.anaesthetist)]}` }), h('span', { class: 'act-t' }, [h('b', {}, c.patient_name || c.uhid || 'Case'), h('small', {}, [c.surgery || 'Surgery not entered', ' · ', fmtDay(c.case_date)])])]))) : h('p', { class: 'rp-empty' }, 'Recent cases will appear here.')]);
  }

  // analytics chart: real counts only
  function buckets(key) {
    const all = ctx.activeCases(), today = todayISO(), [y, m] = today.split('-').map(Number), out = [];
    if (key === 'week') for (let i = 6; i >= 0; i--) { const d = shiftDay(today, -i); out.push({ l: ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'][parseISO(d).getDay()], t: fmtDay(d), n: all.filter((c) => c.case_date === d).length, cur: d === today }); }
    else if (key === 'month') { const dim = new Date(y, m, 0).getDate(); for (let d = 1; d <= dim; d++) { const iso = isoOf(y, m, d); out.push({ l: d % 5 === 1 || d === dim ? String(d) : '', t: fmtDay(iso), n: all.filter((c) => c.case_date === iso).length, cur: iso === today }); } }
    else if (key === '6m') for (let i = 5; i >= 0; i--) { const t = new Date(y, m - 1 - i, 1), k = monthKey(t.getFullYear(), t.getMonth() + 1); out.push({ l: MON[t.getMonth()], t: `${MON[t.getMonth()]} ${t.getFullYear()}`, n: all.filter((c) => c.case_date.startsWith(k)).length, cur: i === 0 }); }
    else if (key === 'year') for (let mm = 1; mm <= 12; mm++) out.push({ l: MON[mm - 1], t: `${MON[mm - 1]} ${y}`, n: all.filter((c) => c.case_date.startsWith(monthKey(y, mm))).length, cur: mm === m });
    else { const ys = all.map((c) => +c.case_date.slice(0, 4)), y0 = ys.length ? Math.min(...ys) : y; for (let yy = Math.max(y0, y - 11); yy <= y; yy++) out.push({ l: String(yy), t: String(yy), n: all.filter((c) => c.case_date.startsWith(String(yy))).length, cur: yy === y }); }
    return out;
  }
  function analyticsCard() {
    const card = h('section', { class: 'an-card', id: 'anCard' }), tabs = [['week', 'Week'], ['month', 'Month'], ['6m', '6 months'], ['year', 'Year'], ['all', 'All']];
    function paint() {
      const b = buckets(rangeKey), total = b.reduce((s, x) => s + x.n, 0), max = Math.max(1, ...b.map((x) => x.n)); const curIdx = b.findIndex((x) => x.cur); const sel = picked != null && picked < b.length ? picked : (curIdx >= 0 ? curIdx : b.length - 1);
      const prevN = sel > 0 ? b[sel - 1].n : null, delta = prevN ? Math.round(((b[sel].n - prevN) / prevN) * 100) : null;
      card.innerHTML = '';
      card.appendChild(h('div', { class: 'an-hd' }, [h('h3', {}, 'Analytics'), h('span', { class: 'an-sub' }, `Case volume · ${total} case${total === 1 ? '' : 's'} in view`), delta === null ? null : h('span', { class: 'trend ' + (delta >= 0 ? 'up' : 'down') }, `${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta)}%`)]));
      if (!ctx.activeCases().length) { card.appendChild(h('div', { class: 'empty' }, [ic('pie'), h('div', {}, 'No cases yet — volume bars appear as you log cases.')])); }
      else card.appendChild(h('div', { class: 'an-bars', role: 'img', 'aria-label': 'Monthly case volume chart' }, b.map((x, i) => h('button', { class: 'an-col' + (i === sel ? ' sel' : '') + (b.length > 14 ? ' thin' : ''), 'aria-label': `${x.t}: ${x.n} cases`, onclick: () => { picked = i; paint(); } }, [h('b', { class: 'an-val' }, i === sel ? String(x.n) : ''), h('span', { class: 'an-bar', style: `--h:${Math.max(x.n ? 8 : 5, (x.n / max) * 100)}%;animation-delay:${reduce() ? 0 : i * 25}ms` }), h('small', {}, x.l)]))));
      card.appendChild(h('div', { class: 'an-seg', role: 'tablist' }, tabs.map(([k, l]) => h('button', { class: k === rangeKey ? 'on' : '', 'data-range': k, role: 'tab', onclick: () => { rangeKey = k; picked = null; paint(); } }, l))));
    }
    paint(); return card;
  }
  function weekStrip() {
    const today = todayISO(), t = parseISO(today), lead = (t.getDay() + 6) % 7, mon = shiftDay(today, -lead), all = ctx.activeCases(), recs = thancRecs();
    return h('div', { class: 'weekstrip', id: 'weekStrip' }, Array.from({ length: 7 }, (_, i) => { const d = shiftDay(mon, i), n = all.filter((c) => c.case_date === d).length, du = recs.some((r) => r.date === d);
      return h('button', { class: 'ws-d' + (d === today ? ' today' : ''), 'data-date': d, onclick: () => go('day', d) }, [h('small', {}, ['M', 'T', 'W', 'T', 'F', 'S', 'S'][i]), h('b', {}, String(parseISO(d).getDate())), h('i', {}, [n ? h('u', { class: 'c' }) : null, du ? h('u', { class: 'd' }) : null])]); }));
  }
  function homeTop(screen) {
    screen.appendChild(welcome()); screen.appendChild(weekStrip());
    screen.appendChild(h('div', { class: 'hgrid' }, [casesTodayCard(), monthlyCard(), thancCard(), quickCard()]));
    screen.appendChild(analyticsCard());
  }

  return { api: { shell, homeTop } };
});
