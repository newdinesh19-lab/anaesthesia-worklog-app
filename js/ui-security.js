/**
 * ui-security.js — recovery code, security questions, fingerprint unlock and the "Forgot PIN" flow.
 * Screen: security. Hooks used by app.js: openForgotPin, decorateUnlock, recoveryNudge, homeNudge, refreshSecurityStatus.
 * There is no server: nothing is emailed automatically. "Email me the code" only opens your own mail app with a draft.
 */
(window.V8Ext = window.V8Ext || []).push((ctx) => {
  const { state, h, ic, go, toast, openSheet } = ctx, X = ctx.X;
  const DEFAULT_EMAIL = 'newdinesh19@yahoo.com';
  const QUESTIONS = ['What was the name of your first school?', 'In which town or city did you first work as a doctor?', 'What was the name of your first childhood friend?', 'What was your first mobile phone model?', 'What is the name of the street you grew up on?', 'What was the name of your favourite teacher?', 'What was your first pet’s name?', 'Which hospital did you do your internship in?'];
  const sec = { rec: false, q: false, bio: false };

  const readKw = async () => { const r = await DB.get('meta', 'keywrap'); return r ? r.value : null; };
  async function refreshSecurityStatus() { const kw = await readKw(); sec.rec = !!(kw && kw.rec); sec.q = !!(kw && kw.q); sec.bio = !!(kw && kw.bio); state.sec = { ...sec }; }
  const saveKw = async (patch) => { const m = await ctx.metaNow(); const kw = { ...(m.keywrap || {}), ...patch }; await DB.put('meta', { key: 'keywrap', value: kw }); await refreshSecurityStatus(); };

  /** Ask for the PIN (re-authentication) and run fn(pin). */
  function withPin(title, fn) {
    const pin = h('input', { class: 'input', id: 'secPin', type: 'password', inputmode: 'numeric', placeholder: 'Your current PIN', autocomplete: 'current-password' });
    const err = h('div', { class: 'error' }); let busy = false;
    const close = openSheet(title, h('div', {}, [h('p', {}, 'Enter your PIN to confirm it is you.'), pin, err,
      h('div', { class: 'btn-row', style: 'margin-top:10px' }, [h('button', { class: 'btn', onclick: () => close() }, 'Cancel'), h('button', { class: 'btn btn-primary', id: 'secPinOk', onclick: async (e) => {
        if (busy) return; busy = true; const b = e.currentTarget; b.disabled = true; err.textContent = '';
        try { const m = await ctx.metaNow(); if (!(await Keys.rawWithPin(pin.value, m))) { err.textContent = 'Incorrect PIN.'; busy = false; b.disabled = false; return; } close(); await fn(pin.value); }
        catch (ex) { err.textContent = ex.message || String(ex); busy = false; b.disabled = false; }
      } }, 'Continue')])]));
    setTimeout(() => pin.focus(), 80);
  }

  /** Make sure the data key is independent of the PIN (rotates it once, atomically). -> raw data key */
  async function ensureWrapped(pin) {
    const m = await ctx.metaNow(); const raw = await Keys.rawWithPin(pin, m); if (!raw) throw new Error('Incorrect PIN.');
    if (Keys.isWrapped(m)) return raw;
    const oldKey = await Keys.aesKey(raw), D = Keys.newDataKey(), newKey = await Keys.aesKey(D);
    const { ops } = await ctx.reencryptOps(oldKey, newKey);
    const w = await Keys.pinWrapper(D, pin);
    ops.push({ store: 'meta', op: 'put', value: { key: 'verifier', value: await CryptoModule.makeVerifier(newKey) } }, { store: 'meta', op: 'put', value: { key: 'salt', value: w.salt } }, { store: 'meta', op: 'put', value: { key: 'kdf', value: w.kdf } },
      { store: 'meta', op: 'put', value: { key: 'keywrap', value: { v: 1, pin: w.pin, rec: null, q: null, bio: null } } });
    await DB.batch(ops); state.key = newKey; // all records and the key change together, or nothing changes
    return D;
  }

  // ------------------------------------------------------------------ recovery code
  function setupCode() {
    withPin('Create a recovery code', async (pin) => {
      const toastBusy = toast('Preparing…');
      const raw = await ensureWrapped(pin); const code = Keys.newRecoveryCode();
      const email = h('input', { class: 'input', id: 'recEmail', type: 'email', value: state.settings.recoveryEmail || DEFAULT_EMAIL, placeholder: 'your@email' });
      const ack = h('input', { type: 'checkbox', id: 'recAck' });
      const go1 = h('button', { class: 'btn btn-primary btn-block', id: 'recActivate', disabled: true, onclick: async (e) => {
        e.currentTarget.disabled = true;
        try { await saveKw({ rec: await Keys.recoveryWrapper(raw, code) }); close(); toast('Recovery code is now active'); ctx.render(); } catch (ex) { toast('Could not save: ' + ex.message); e.currentTarget.disabled = false; }
      } }, [ic('check'), 'Activate this code']);
      ack.addEventListener('change', () => { go1.disabled = !ack.checked; });
      const close = openSheet('Your recovery code', h('div', {}, [
        h('div', { class: 'note' }, [ic('warn', 'inl'), ' This code opens ALL your data without the PIN. Anyone who finds it, plus your phone or a backup file, can read your records. Keep it somewhere private.']),
        h('div', { id: 'recCode', style: 'font:800 22px/1.3 ui-monospace,Menlo,monospace;letter-spacing:1px;text-align:center;padding:16px 8px;margin:12px 0;border:2px dashed var(--line);border-radius:14px;user-select:all' }, code),
        h('div', { class: 'btn-row' }, [
          h('button', { class: 'btn', id: 'recCopy', onclick: async () => { try { await navigator.clipboard.writeText(code); toast('Copied'); } catch (e) { toast('Select the code and copy it by hand'); } } }, [ic('copy'), 'Copy']),
          h('button', { class: 'btn', id: 'recMail', onclick: () => {
            const a = (email.value || '').trim(); if (!/^\S+@\S+\.\S+$/.test(a)) return toast('Enter a valid email address');
            state.settings.recoveryEmail = a; ctx.saveSettings();
            const body = `Anaesthesia Log recovery code:\n\n${code}\n\nThis code opens your data without the PIN. Keep this email private and delete it if you store the code elsewhere.`;
            location.href = `mailto:${encodeURIComponent(a).replace('%40', '@')}?subject=${encodeURIComponent('Anaesthesia Log recovery code')}&body=${encodeURIComponent(body)}`;
          } }, [ic('file'), 'Email it to me']),
        ]),
        h('div', { class: 'field', style: 'margin-top:10px' }, [h('label', {}, 'Email address for the draft'), email]),
        h('div', { class: 'muted', style: 'font-size:12px;margin-bottom:8px' }, 'This opens a draft in your mail app; the app itself never sends anything. A code kept in email is only as safe as that mailbox. Writing it on paper is safer.'),
        h('label', { class: 'toggle-row', style: 'margin-bottom:10px' }, [ack, h('span', { style: 'flex:1;margin-left:10px' }, 'I have saved this code. I understand it is shown only once.')]), go1]));
      void toastBusy;
    });
  }

  // ------------------------------------------------------------------ security questions
  function setupQuestions() {
    const sel = [0, 1].map((i) => h('select', { class: 'input', id: 'q' + i }, QUESTIONS.map((q, k) => h('option', { value: q, ...(k === i ? { selected: true } : {}) }, q))));
    const ans = [0, 1].map((i) => h('input', { class: 'input', id: 'a' + i, type: 'text', placeholder: 'Answer', autocomplete: 'off', autocapitalize: 'off' }));
    const err = h('div', { class: 'error' });
    const close = openSheet('Security questions', h('div', {}, [
      h('div', { class: 'note' }, [ic('warn', 'inl'), ' Weaker than a recovery code. Answers can be guessed by someone who knows you, and a copy of your data can be attacked offline. Choose answers only you know, and consider the recovery code instead.']),
      h('div', { class: 'field' }, [h('label', {}, 'Question 1'), sel[0], ans[0]]), h('div', { class: 'field' }, [h('label', {}, 'Question 2'), sel[1], ans[1]]), err,
      h('div', { class: 'muted', style: 'font-size:12px;margin-bottom:8px' }, 'Capitals, spaces and punctuation are ignored. You must give both answers to recover.'),
      h('button', { class: 'btn btn-primary btn-block', id: 'qSave', onclick: () => {
        err.textContent = ''; const qs = sel.map((s) => s.value), as = ans.map((a) => a.value);
        if (qs[0] === qs[1]) return (err.textContent = 'Pick two different questions.');
        if (!Keys.answersOk(as)) return (err.textContent = 'Each answer needs at least 4 letters or digits, and the two answers must differ.');
        close(); withPin('Save security questions', async (pin) => { const raw = await ensureWrapped(pin); await saveKw({ q: await Keys.questionWrapper(raw, qs, as) }); toast('Security questions saved'); ctx.render(); });
      } }, 'Continue'),
    ]));
  }

  // ------------------------------------------------------------------ fingerprint
  async function enableBio() {
    if (!(await Keys.bio.available())) return toast('This phone/browser has no fingerprint or screen-lock sign-in available to apps.');
    withPin('Turn on fingerprint unlock', async (pin) => {
      let raw; try { raw = await ensureWrapped(pin); } catch (e) { return toast(e.message); }
      const store = async (r) => { if (r.gateKey) await DB.put('meta', { key: 'biokey', value: r.gateKey }); await saveKw({ bio: r.rec }); toast(r.rec.mode === 'prf' ? 'Fingerprint unlock is on' : 'Fingerprint unlock is on (convenience mode)'); ctx.render(); };
      try { await store(await Keys.bio.enrol(raw, false)); }
      catch (e) {
        if (e.code !== 'NO_PRF') return toast(e.name === 'NotAllowedError' ? 'Cancelled — fingerprint unlock not turned on' : e.name === 'SecurityError' || /invalid domain/i.test(e.message || '') ? 'Fingerprint needs the app opened from its https web address (not an IP address or file).' : 'Could not set up fingerprint: ' + (e.message || e.name));
        const close = openSheet('Convenience mode only', h('div', {}, [
          h('p', {}, 'Your phone can check your fingerprint, but it cannot give this app a secret to protect the data with (a browser limitation).'),
          h('p', {}, 'Convenience mode keeps a key on this phone that the fingerprint prompt unlocks. It is fine against someone who just picks up your phone, but weaker than your PIN against someone who can run developer tools on an unlocked phone. Your PIN and recovery code keep working either way.'),
          h('div', { class: 'btn-row' }, [h('button', { class: 'btn', onclick: () => close() }, 'No thanks'), h('button', { class: 'btn btn-primary', id: 'bioGate', onclick: async () => { close(); try { await store(await Keys.bio.enrol(raw, true)); } catch (e2) { toast('Could not set up fingerprint: ' + (e2.message || e2.name)); } } }, 'Use convenience mode')])]));
      }
    });
  }
  async function disableBio() { await saveKw({ bio: null }); await DB.del('meta', 'biokey'); toast('Fingerprint unlock turned off'); ctx.render(); }

  /** Lock-screen button. */
  async function decorateUnlock() {
    const kw = await readKw(); if (!kw || !kw.bio) return;
    const box = document.querySelector('.lock .box'); if (!box || box.querySelector('#bioBtn')) return;
    const err = document.querySelector('#pinErr');
    const btn = h('button', { class: 'btn btn-block', id: 'bioBtn', style: 'margin-top:8px', onclick: async () => {
      if (err) err.textContent = '';
      try {
        const gk = kw.bio.mode === 'gate' ? ((await DB.get('meta', 'biokey')) || {}).value : null;
        const raw = await Keys.bio.unlock(kw.bio, gk); const m = await ctx.metaNow();
        if (!(await Keys.verifies(raw, m.verifier))) throw new Error('stale');
        await ctx.unlockWithRaw(raw);
      } catch (e) { if (err) err.textContent = 'Fingerprint not accepted or cancelled. Use your PIN.'; }
    } }, [ic('shield'), 'Unlock with fingerprint']);
    box.insertBefore(btn, box.querySelector('.link') || null);
  }

  // ------------------------------------------------------------------ forgot PIN
  function chooseNewPin(raw, closePrev) {
    const p1 = h('input', { class: 'input', id: 'np1', type: 'password', inputmode: 'numeric', placeholder: 'New PIN', autocomplete: 'new-password' });
    const p2 = h('input', { class: 'input', id: 'np2', type: 'password', inputmode: 'numeric', placeholder: 'Confirm new PIN', autocomplete: 'new-password' });
    const err = h('div', { class: 'error' });
    const close = openSheet('Choose a new PIN', h('div', {}, [h('p', {}, 'Recovery worked. Set a new PIN; your data stays exactly as it was.'), p1, p2, err,
      h('button', { class: 'btn btn-primary btn-block', id: 'npOk', style: 'margin-top:10px', onclick: async (e) => {
        if (p1.value.length < 4) return (err.textContent = 'PIN must be at least 4 characters.');
        if (p1.value !== p2.value) return (err.textContent = 'PINs do not match.');
        if (ctx.weakPin(p1.value)) return (err.textContent = 'That PIN is too easy to guess.');
        e.currentTarget.disabled = true;
        try { await ctx.setPinFromRaw(raw, p1.value, await ctx.metaNow()); close(); await ctx.unlockWithRaw(raw); toast('New PIN set'); } catch (ex) { err.textContent = ex.message; e.currentTarget.disabled = false; }
      } }, 'Set PIN and open')]));
    closePrev && closePrev();
  }
  async function openForgotPin() {
    const kw = await readKw(); const m = await ctx.metaNow();
    const parts = []; let fails = 0;
    const err = h('div', { class: 'error' });
    const throttle = async () => { fails++; if (fails > 2) await new Promise((r) => setTimeout(r, Math.min(8000, fails * 1000))); };
    if (kw && kw.rec) {
      const code = h('input', { class: 'input', id: 'recIn', placeholder: 'XXXX-XXXX-XXXX-XXXX-XXXX', autocapitalize: 'characters', autocomplete: 'off' });
      parts.push(h('div', { class: 'field' }, [h('label', {}, 'Recovery code'), code, h('button', { class: 'btn btn-primary btn-block', id: 'recGo', style: 'margin-top:8px', onclick: async (e) => {
        err.textContent = ''; const b = e.currentTarget; b.disabled = true; const raw = await Keys.rawWithRecovery(code.value, kw.rec, m.verifier); b.disabled = false;
        if (!raw) { await throttle(); return (err.textContent = 'That code does not open this data. Check each character.'); }
        chooseNewPin(raw, () => close());
      } }, 'Recover with code')]));
    }
    if (kw && kw.q) {
      const ins = kw.q.questions.map((q, i) => h('div', { class: 'field' }, [h('label', {}, q), h('input', { class: 'input', id: 'qa' + i, autocomplete: 'off', autocapitalize: 'off' })]));
      parts.push(h('div', {}, [...ins, h('button', { class: 'btn btn-primary btn-block', id: 'qGo', onclick: async (e) => {
        err.textContent = ''; const b = e.currentTarget; b.disabled = true; b.textContent = 'Checking…';
        const raw = await Keys.rawWithAnswers(ins.map((f) => f.querySelector('input').value), kw.q, m.verifier); b.disabled = false; b.textContent = 'Recover with answers';
        if (!raw) { await throttle(); return (err.textContent = 'Those answers do not open this data.'); }
        chooseNewPin(raw, () => close());
      } }, 'Recover with answers')]));
    }
    if (!parts.length) parts.push(h('div', { class: 'warnbar' }, [h('b', {}, 'No recovery was set up on this device.'), 'Without a recovery code or security answers the PIN cannot be reset: it is the encryption key. Try PINs you may have used, restore a backup (it asks for the PIN active when it was made), or erase.']));
    const typed = h('input', { class: 'input', placeholder: 'Type ERASE to confirm', id: 'eraseConfirm' });
    const close = openSheet('Forgot your PIN?', h('div', {}, [
      h('p', {}, 'No email link is possible: this app has no server, and your data can only be opened with a key that never leaves this phone.'),
      ...parts, err, h('div', { class: 'divider', style: 'height:1px;background:var(--line);margin:14px 0' }),
      h('label', { class: 'btn btn-block', style: 'margin-bottom:10px' }, [ic('upload'), 'Restore from a backup file', h('input', { type: 'file', accept: 'application/json,.json', class: 'hidden-file', onchange: (e) => { const f = e.target.files[0]; if (f) { close(); X.restoreFlow(f, { fromLock: true }); } } })]),
      h('div', { class: 'field' }, [h('label', {}, 'Erase everything on this device'), typed]),
      h('button', { class: 'btn btn-danger btn-block', onclick: async () => { if (typed.value.trim() !== 'ERASE') return toast('Type ERASE first'); await DB.clearAll(); close(); location.reload(); } }, [ic('trash'), 'Erase all data and start again']),
    ]));
  }

  // ------------------------------------------------------------------ settings screen + nudges
  function renderSecurity(screen) {
    state.settings.recoveryNudgeOff = true; ctx.saveSettings().catch(() => {});
    screen.appendChild(ctx.pageHead('Recovery & fingerprint', 'Security', null, 'settings'));
    const row = (label, ok, sub, buttons) => h('div', { class: 'card' }, [h('div', { class: 'kv' }, [h('b', {}, label), h('span', { class: ok ? 'tag' : 'muted' }, ok ? 'On' : 'Off')]), h('div', { class: 'muted', style: 'font-size:13px;margin:4px 0 10px' }, sub), h('div', { class: 'btn-row' }, buttons)]);
    screen.appendChild(h('div', { class: 'note' }, [ic('info', 'inl'), ' Your PIN is the encryption key. These options add other ways to open the same data. Nothing is sent to any server, and an automatic emailed reset link is not possible in an offline app.']));
    screen.appendChild(row('Recovery code', sec.rec, 'A 20-character code that opens your data if you forget the PIN. Strongest option. You can have the code drafted to your email, but that makes the mailbox part of your security.', [h('button', { class: 'btn btn-primary', id: 'setCode', onclick: setupCode }, sec.rec ? 'Make a new code' : 'Create code'), sec.rec ? h('button', { class: 'btn btn-danger', onclick: async () => { await saveKw({ rec: null }); toast('Recovery code removed'); ctx.render(); } }, 'Remove') : null]));
    screen.appendChild(row('Security questions', sec.q, 'Two personal questions. Weaker than the code because answers can be guessed.', [h('button', { class: 'btn', id: 'setQ', onclick: setupQuestions }, sec.q ? 'Change answers' : 'Set up'), sec.q ? h('button', { class: 'btn btn-danger', onclick: async () => { await saveKw({ q: null }); toast('Security questions removed'); ctx.render(); } }, 'Remove') : null]));
    const bioCard = row('Fingerprint unlock', sec.bio, 'Unlock with the fingerprint or screen lock you already use on this phone. The PIN always keeps working. It is not included in backups; set it up again after restoring.', [sec.bio ? h('button', { class: 'btn btn-danger', id: 'bioOff', onclick: disableBio }, 'Turn off') : h('button', { class: 'btn btn-primary', id: 'bioOn', onclick: enableBio }, 'Turn on')]);
    screen.appendChild(bioCard);
    Keys.bio.available().then((ok) => { if (!ok && !sec.bio) { const b = bioCard.querySelector('#bioOn'); if (b) { b.disabled = true; bioCard.insertBefore(h('div', { class: 'warnbar' }, 'No fingerprint or screen-lock sign-in is available to apps on this device/browser.'), bioCard.lastChild); } } });
    screen.appendChild(h('div', { class: 'note' }, 'Make a backup file too: it is the only protection against losing or breaking the phone.'));
  }
  function recoveryNudge() {
    const close = openSheet('Protect yourself against a forgotten PIN', h('div', {}, [h('p', {}, 'If you forget the PIN, nobody can open your data, including the developer. Set up a recovery code (or fingerprint unlock) now; it takes a minute.'),
      h('div', { class: 'btn-row' }, [h('button', { class: 'btn', onclick: () => close() }, 'Later'), h('button', { class: 'btn btn-primary', id: 'nudgeGo', onclick: () => { close(); go('security'); } }, 'Set up now')])]));
  }
  function homeNudge() {
    if (!state.sec || state.sec.rec || state.sec.q || state.settings.recoveryNudgeOff) return null;
    return h('button', { class: 'warnbar', id: 'recNudge', style: 'width:100%;text-align:left', onclick: () => go('security') }, [ic('shield', 'inl'), ' No PIN recovery set up. If you forget the PIN your data cannot be opened — tap to add a recovery code.']);
  }

  return { screens: { security: renderSecurity }, api: { openForgotPin, decorateUnlock, recoveryNudge, homeNudge, refreshSecurityStatus } };
});
