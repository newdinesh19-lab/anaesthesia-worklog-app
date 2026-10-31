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
        h('button', { class: 'icon-btn', id: 'hBell', 'aria-label': 'Notifications', onclick: openAlerts }, [ic('bell'), nAlerts ? h('i', { class: 'badge' }, String(nAlerts)) : null]),
        h('button', { class: 'icon-btn', 'aria-label': 'Lock', onclick: ctx.lockNow }, ic('lock')),
        h('button', { class: 'icon-btn avatar-btn', id: 'hProfile', 'aria-label': 'Profile and settings', onclick: () => go('settings') }, initials),
      ]),
    ]));

    // reminders that need a direct tap
    const rem = state.settings, days = rem.backupRemindDays, age = rem.lastBackupAt ? Math.floor((Date.now() - new Date(rem.lastBackupAt)) / 864e5) : null;
    if (days && all.length && (age === null || age >= days)) screen.appendChild(h('button', { class: 'warnbar', id: 'backupRemind', style: 'width:100%;text-align:left', onclick: () => go('backup') }, [ic('warn', 'inl'), age === null ? ' You have never backed up. Your data lives only on this phone — tap to back up.' : ` Last backup was ${age} days ago. Tap to back up now.`]));
    else { const n = X.homeNudge && X.homeNudge(); if (n) screen.appendChild(n); }

    // C. quick actions
    const qa = (cls, icon, title, sub, fn, id) => h('button', { class: 'qa ' + cls, id, onclick: fn }, [h('span', { class: 'qa-ic' }, ic(icon)), h('span', { class: 'qa-t' }, [h('b', {}, title), h('small', {}, sub)])]);
    screen.appendChild(h('div', { class: 'qa-grid' }, [
      qa('hero qa-primary', 'plus', 'Add New Case', 'Manual entry', () => ctx.startManualCase(), 'qaAdd'),
      qa('qa-teal', 'camera', 'Scan Sheet', 'Photo → auto-fill', () => { go('add'); }, 'qaScan'),
      qa('qa-blue', 'list', 'My Cases', shortName(roster[0] || 'me'), () => openCases({ anaes: roster[0] }), 'qaMine'),
      qa('qa-purple', 'clip', 'Pre-op', 'Assessment', () => go('preop'), 'qaPreop'),
    ]));

    // night duty one-tap (unchanged behaviour)
    const nd = ctx.nightDutyDate(), existing = ctx.dutiesOn(nd)[0];
    screen.appendChild(h('button', { class: 'night-btn' + (existing ? ' on' : ''), id: 'nightBtn', onclick: () => (existing ? ctx.openDutySheet(existing) : ctx.addNightDuty(nd)) }, [
      h('span', { class: 'moon-badge' }, ic(existing ? 'check' : 'moon')),
      h('span', {}, [h('b', {}, existing ? 'On night duty' : 'Night duty'), h('small', {}, existing ? `${fmtDay(nd)} · ${existing.hospital || 'tap to edit'}` : `Tap once to mark ${nd === today ? 'tonight' : fmtDay(nd)}`)]),
      h('span', { class: 'go' }, ic(existing ? 'edit' : 'plus')),
    ]));

    // B. statistics
    const duties = ctx.dutiesInMonth(ym), procsM = ctx.activeProcedures().filter((p) => (p.date || '').startsWith(ym));
    const pending = all.filter((c) => !isComplete(c));
    const timed = monthCases.map(mins).filter((m) => m != null && m > 0), totalMin = timed.reduce((a, b) => a + b, 0);
    const cards = [
      statCard('blue', 'list', monthCases.length, 'Cases this month', monthLabel(ym), () => openCases({})),
      statCard('teal', 'calendar', todayCases.length, 'Cases today', fmtDay(today), () => go('day', today)),
      statCard('indigo', 'moon', duties.length, 'Night duties', 'this month', () => { state.casesView = 'calendar'; state.filters = ctx.emptyFilters(ym); go('cases'); }),
      statCard('coral', 'warn', pending.length, 'Pending entries', pending.length ? 'missing surgery, ASA or technique' : 'all complete', pending.length ? () => { state.casesView = 'list'; state.filters = { ...ctx.emptyFilters(''), incomplete: true }; go('cases'); } : null),
      statCard('purple', 'syringe', procsM.length, 'Procedures', 'logged this month', () => go('procedures')),
    ];
    if (timed.length) cards.push(statCard('navy', 'pulse', h('span', { class: 'num' }, fmtHours(totalMin)), 'Anaesthesia hours', `${timed.length} timed case${timed.length === 1 ? '' : 's'}`));
    screen.appendChild(h('div', { class: 'stats' }, cards));

    // quick repeat
    const tpls = ctx.recentTemplates(3);
    if (tpls.length) {
      screen.appendChild(h('div', { class: 'section-title' }, [h('h2', {}, 'Repeat a recent case'), h('span', { class: 'muted', style: 'font-size:13px' }, 'surgery + technique')]));
      screen.appendChild(h('div', { class: 'chips' }, tpls.map((t) => h('button', { class: 'chip', onclick: () => { state.template = t; go('add'); } }, [ic('bolt', 'inl'), ' ', t.surgery || t.mode]))));
    }

    // D. analytics (only with real data)
    screen.appendChild(h('div', { class: 'section-title' }, [h('h2', {}, 'Analytics'), h('button', { onclick: () => go('analytics') }, 'Full report →')]));
    const grid = h('div', { class: 'an-grid' }); let shown = 0;
    const last7 = []; for (let i = 6; i >= 0; i--) last7.push(shiftDay(today, -i));
    const dayCount = (d) => ctx.casesForDate(d).length;
    if (last7.some((d) => dayCount(d))) {
      shown++; const max = Math.max(1, ...last7.map(dayCount));
      grid.appendChild(h('div', { class: 'card' }, [h('h3', {}, 'Weekly activity'), h('div', { class: 'week' }, last7.map((d, i) => {
        const dc = ctx.casesForDate(d);
        const bar = h('div', { class: 'wbar', style: `height:${Math.max(4, (dc.length / max) * 100)}px;animation-delay:${i * 50}ms` }, roster.map((n) => h('i', { style: `height:${dc.length ? (dc.filter((c) => c.anaesthetist === n).length / dc.length) * 100 : 0}%;background:${TONE_VAR[toneOf(n)]}` })));
        return h('button', { class: 'wcol' + (d === today ? ' today' : ''), 'aria-label': `${fmtDay(d)}: ${dc.length} cases`, onclick: () => go('day', d) }, [h('b', {}, dc.length || ''), bar, ctx.dutiesOn(d).length ? ic('moon', 'wmoon') : null, h('small', {}, DOW[parseISO(d).getDay()][0])]);
      }))]));
    }
    const months = []; { const d = parseISO(today + ''); for (let i = 5; i >= 0; i--) { const t = new Date(d.getFullYear(), d.getMonth() - i, 1); months.push(`${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`); } }
    const mvals = months.map((m) => all.filter((c) => c.case_date.startsWith(m)).length);
    if (mvals.filter((v) => v > 0).length >= 2) { shown++; grid.appendChild(h('div', { class: 'card' }, [h('h3', {}, 'Monthly trend'), X.columnChart(mvals, months.map((m) => A.MONTH_ABBR[Number(m.slice(5)) - 1]), { unit: 'cases', active: 5, color: 'var(--c1)' })])); }
    const sum = A.caseSummary(monthCases, { paedAgeMax: state.settings.paedAgeMax, geriatricAgeMin: state.settings.geriatricAgeMin });
    const split = roster.map((n) => [shortName(n), monthCases.filter((c) => c.anaesthetist === n).length]).filter((e) => e[1] > 0);
    if (monthCases.length && split.length) { shown++; grid.appendChild(h('div', { class: 'card' }, [h('h3', {}, `Anaesthetist split · ${monthLabel(ym)}`), X.donutChart(split, { onTap: (n) => { const full = roster.find((r) => shortName(r) === n); full && openCases({ anaes: full }); } })])); }
    const tech = A.entries(sum.techniques);
    if (tech.length) { shown++; grid.appendChild(h('div', { class: 'card' }, [h('h3', {}, `Technique · ${monthLabel(ym)}`), X.hbars(tech, { pct: true, onTap: (n) => openCases({ mode: n }) })])); }
    if (sum.urgencyKnown) { shown++; grid.appendChild(h('div', { class: 'card' }, [h('h3', {}, `Elective vs emergency · ${monthLabel(ym)}`), X.donutChart([['Elective', sum.elective], ['Emergency', sum.emergency]].filter((e) => e[1] > 0), { onTap: (n) => openCases({ urgency: n }) })])); }
    screen.appendChild(shown ? grid : h('div', { class: 'empty' }, [ic('pie'), h('div', {}, 'Charts appear here once you have logged some cases.')]));

    // E. recent cases
    const recent = [...all].sort((a, b) => b.case_date.localeCompare(a.case_date) || b.created_at.localeCompare(a.created_at)).slice(0, 6);
    screen.appendChild(h('div', { class: 'section-title' }, [h('h2', {}, 'Recent cases'), h('button', { onclick: () => go('cases') }, 'All cases →')]));
    if (!recent.length) {
      screen.appendChild(h('div', { class: 'empty' }, [ic('clip'), h('div', {}, 'No cases yet. Add your first case to get started.'), h('button', { class: 'btn btn-primary', style: 'margin-top:12px', onclick: () => ctx.startManualCase() }, [ic('plus'), 'Add a case'])]));
      return;
    }
    const pillFor = (c) => { const [t, k] = statusOf(c); return h('span', { class: 'status st-' + k }, t); };
    const id = (c) => c.uhid || c.patient_name || '—';
    screen.appendChild(h('div', { class: 'recent-cards' }, recent.map((c) => h('button', { class: 'rc ' + toneOf(c.anaesthetist), onclick: () => go('day', c.case_date) }, [
      h('div', { class: 'rc-top' }, [h('b', {}, c.patient_name || id(c)), pillFor(c)]),
      h('div', { class: 'rc-sub' }, [fmtDate(c.case_date), c.uhid ? ` · ${c.uhid}` : '', c.surgery ? ` · ${c.surgery}` : '']),
      h('div', { class: 'rc-meta' }, [h('span', { class: 'pill ' + toneOf(c.anaesthetist) }, shortName(c.anaesthetist)), h('span', { class: 'muted' }, techShort(c))]),
    ]))));
    const th = (t) => h('th', {}, t);
    screen.appendChild(h('div', { class: 'recent-table card' }, h('table', { class: 'rtable' }, [
      h('thead', {}, h('tr', {}, ['Date', 'Patient', 'Surgery', 'Technique', 'Anaesthetist', 'Status'].map(th))),
      h('tbody', {}, recent.map((c) => h('tr', { tabindex: '0', onclick: () => go('day', c.case_date), onkeydown: (e) => e.key === 'Enter' && go('day', c.case_date) }, [
        h('td', {}, fmtDate(c.case_date)), h('td', {}, [h('b', {}, c.patient_name || '—'), c.uhid ? h('small', { class: 'muted', style: 'display:block' }, c.uhid) : null]), h('td', {}, c.surgery || '—'), h('td', {}, techShort(c)),
        h('td', {}, h('span', { class: 'pill ' + toneOf(c.anaesthetist) }, shortName(c.anaesthetist))), h('td', {}, pillFor(c))])))])));
  }

  return { screens: { home: renderHome }, api: { homeAlerts: alerts } };
});
