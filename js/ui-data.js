/**
 * ui-data.js — backup, restore (with preview), data-health check and the recycle bin.
 * Registers screens: backup, health, bin. Provides X.doBackup / X.restoreFlow to the core.
 */
(window.V8Ext = window.V8Ext || []).push((ctx) => {
  const { state, h, ic, go, toast, openSheet, confirmSheet, pageHead, fmtDate, shortName } = ctx;
  const fmtBytes = (n) => (n == null ? '—' : n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
  const fmtWhen = (iso) => { if (!iso) return 'never'; const d = new Date(iso); return isNaN(d) ? iso : `${fmtDate(ctx.isoOf(d))} ${ctx.pad(d.getHours())}:${ctx.pad(d.getMinutes())}`; };
  const daysSince = (iso) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : null);

  async function gatherRaw() { const raw = {}; for (const n of DB.NAMES) raw[n] = await DB.getAll(n); return raw; }

  async function doBackup() {
    const file = await Backup.build(await gatherRaw(), { appVersion: Schema.APP_VERSION, schemaVersion: Schema.VERSION });
    ExportModule.downloadBlob(new Blob([JSON.stringify(file)], { type: 'application/json' }), Backup.fileName());
    if (state.settings) { state.settings.lastBackupAt = file.created_at; await ctx.saveSettings(); }
    toast('Backup downloaded');
    return file;
  }

  // ------------------------------------------------------------------ restore flow
  const kv = (k, v, cls) => h('div', { class: 'kv' + (cls ? ' ' + cls : '') }, [h('span', {}, k), h('span', {}, v == null || v === '' ? '—' : String(v))]);

  /** opts: { fromLock, verifyOnly } */
  async function restoreFlow(file, opts = {}) {
    let parsed;
    try { parsed = await Backup.read(await file.text()); } catch (e) { parsed = { ok: false, fatal: ['The file could not be read: ' + (e.message || e)], warnings: [] }; }
    if (!parsed.ok) {
      openSheet('Cannot use this file', h('div', {}, [h('div', { class: 'warnbar' }, parsed.fatal.map((t) => h('div', {}, t))), h('p', {}, 'Nothing on this device was changed.')]));
      return;
    }
    // same key = the backup carries the very same PIN check record as this device, so the current key opens it
    const curVer = !opts.fromLock && state.key ? await DB.get('meta', 'verifier') : null;
    const bkVer = (parsed.stores.meta.find((m) => m.key === 'verifier') || {}).value;
    const sameSalt = !!(curVer && bkVer && curVer.value && curVer.value.iv === bkVer.iv && curVer.value.data === bkVer.data);
    const pin = h('input', { class: 'input', type: 'password', inputmode: 'numeric', placeholder: 'PIN used when this backup was made', id: 'restorePin' });
    const out = h('div');
    const err = h('div', { class: 'error' });
    const head = h('div', {}, [
      kv('Backup made', fmtWhen(parsed.created_at)), kv('App version', parsed.app_version || (parsed.format === 'v2' ? 'V4–V7 (older format)' : '')),
      kv('Integrity checksum', parsed.checksum === 'valid' ? '✓ valid' : parsed.checksum === 'none' ? 'not present (older format)' : parsed.checksum),
      kv('Records in file', `${parsed.counts.cases} cases · ${parsed.counts.preops} pre-ops · ${parsed.counts.procedures} procedures · ${parsed.counts.duties} night duties · ${parsed.counts.images} photos`),
      ...parsed.warnings.map((w) => h('div', { class: 'note' }, w)),
    ]);
    let key = sameSalt ? state.key : null;
    const go1 = h('button', { class: 'btn btn-primary btn-block', onclick: async (e) => {
      err.textContent = ''; const b = e.currentTarget; b.disabled = true; b.textContent = 'Checking…';
      try {
        key = sameSalt ? state.key : await Backup.keyFor(parsed.stores, pin.value);
        if (!key) { err.textContent = 'That PIN does not open this backup.'; b.disabled = false; b.textContent = 'Check backup'; return; }
        const sum = await Backup.inspect(parsed.stores, key);
        b.remove(); pin.remove(); showPreview(sum);
      } catch (ex) { err.textContent = ex.message || String(ex); b.disabled = false; b.textContent = 'Check backup'; }
    } }, 'Check backup');
    const entry = h('div', {}, [sameSalt ? h('p', { class: 'note' }, 'This backup uses your current PIN.') : pin, err, go1]);

    function showPreview(sum) {
      out.innerHTML = '';
      const cur = { cases: state.cases.filter((c) => !c.deleted_at).length, preops: ctx.activePreops().length, procedures: ctx.activeProcedures().length, duties: state.duties.length };
      const unreadable = sum.failed.length + sum.imagesFailed;
      out.appendChild(h('div', { class: 'card', style: 'box-shadow:none;margin:12px 0' }, [
        h('h3', {}, 'Preview — nothing has been changed yet'),
        kv('Cases', `${sum.cases}${sum.deletedCases ? ` (+${sum.deletedCases} in recycle bin)` : ''}`), kv('Date range', sum.from ? `${fmtDate(sum.from)} → ${fmtDate(sum.to)}` : '—'),
        kv('Pre-op assessments', sum.preops), kv('Procedures', sum.procedures), kv('Night duties', sum.duties), kv('Templates', sum.templates), kv('Photos readable', `${sum.imagesOk}${sum.imagesFailed ? ` · ${sum.imagesFailed} damaged` : ''}`),
        !opts.fromLock ? kv('On this device now', `${cur.cases} cases · ${cur.preops} pre-ops · ${cur.procedures} procedures · ${cur.duties} night duties`) : null,
      ]));
      if (unreadable) out.appendChild(h('div', { class: 'warnbar' }, [h('b', {}, `${unreadable} item(s) in this backup cannot be read`), 'They would be restored as they are but will stay unreadable.']));
      if (!opts.fromLock && (sum.cases < cur.cases || sum.procedures < cur.procedures)) out.appendChild(h('div', { class: 'warnbar' }, [h('b', {}, 'This backup is older than your current data'), `It has fewer ${sum.cases < cur.cases ? 'cases' : 'procedures'} than this device. Restoring would discard anything entered since.`]));
      if (opts.verifyOnly) { out.appendChild(h('div', { class: 'okbar' }, unreadable ? 'Backup checked, with the problems above.' : '✓ This backup is complete and readable with that PIN.')); return; }
      const ack = h('input', { type: 'checkbox', id: 'restoreAck' });
      const doIt = h('button', { class: 'btn btn-danger btn-block', id: 'restoreGo', disabled: true, onclick: async (e) => {
        const b = e.currentTarget; b.disabled = true; b.textContent = 'Restoring…';
        try {
          await DB.replaceAll(Backup.toRecords(parsed.stores)); // one transaction: all or nothing
          toast('Restored. Unlock with the PIN of that backup.'); setTimeout(() => location.reload(), 900);
        } catch (ex) { b.disabled = false; b.textContent = 'Replace data on this device'; err.textContent = 'Restore failed and nothing was changed: ' + (ex.message || ex); }
      } }, 'Replace data on this device');
      ack.addEventListener('change', () => { doIt.disabled = !ack.checked; });
      if (!opts.fromLock && state.key) out.appendChild(h('button', { class: 'btn btn-block', style: 'margin-bottom:10px', onclick: doBackup }, [ic('download'), 'First: download a backup of current data']));
      out.appendChild(h('label', { class: 'toggle-row', style: 'margin-bottom:10px' }, [ack, h('span', { style: 'flex:1;margin-left:10px' }, 'I understand that all data currently on this device will be replaced by this backup.')]));
      out.appendChild(err); out.appendChild(doIt);
    }
    openSheet(opts.verifyOnly ? 'Check a backup file' : 'Restore a backup', h('div', {}, [head, entry, out]));
  }

  // ------------------------------------------------------------------ screens
  function renderBackup(screen) {
    const s = state.settings;
    const age = daysSince(s.lastBackupAt);
    screen.appendChild(pageHead('Backup', 'Never depend on the app alone', null, 'settings'));
    screen.appendChild(h('div', { class: 'card' }, [
      h('h3', {}, 'Back up'),
      h('div', { class: 'kv' }, [h('span', {}, 'Last backup'), h('span', {}, s.lastBackupAt ? `${fmtWhen(s.lastBackupAt)} · ${age} day${age === 1 ? '' : 's'} ago` : 'Never')]),
      h('button', { class: 'btn btn-primary btn-block', id: 'backupNow', style: 'margin:12px 0 8px', onclick: doBackup }, [ic('download'), 'Back up now']),
      h('div', { class: 'note' }, 'One file with cases, pre-ops, procedures, night duties, templates, settings and photos. It stays encrypted with your PIN, carries a checksum, and needs the PIN that was active when it was made. Keep copies somewhere other than this phone.'),
      h('div', { class: 'field', style: 'margin-top:12px' }, [h('label', {}, 'Remind me if my last backup is older than'), (() => {
        const sel = h('select', { class: 'input', id: 'remindSel', onchange: async (e) => { s.backupRemindDays = Number(e.target.value); await ctx.saveSettings(); toast('Reminder updated'); } },
          [[7, '7 days'], [14, '14 days'], [30, '30 days'], [0, 'Never remind me']].map(([v, l]) => h('option', { value: v, ...(s.backupRemindDays === v ? { selected: true } : {}) }, l)));
        return sel; })()]),
    ]));
    screen.appendChild(h('div', { class: 'card' }, [
      h('h3', {}, 'Restore'),
      h('p', { class: 'muted', style: 'margin-bottom:12px;line-height:1.45' }, 'You always see a preview first (counts, date range, integrity, readable or not) and nothing is replaced until you confirm. The restore is a single transaction, so it either completes fully or changes nothing.'),
      h('label', { class: 'btn btn-block', style: 'margin-bottom:10px' }, [ic('upload'), 'Restore from backup file', h('input', { type: 'file', accept: 'application/json,.json', class: 'hidden-file', id: 'restoreFile', onchange: (e) => { const f = e.target.files[0]; if (f) restoreFlow(f); e.target.value = ''; } })]),
      h('label', { class: 'btn btn-soft btn-block' }, [ic('shield'), 'Only check a backup file (no restore)', h('input', { type: 'file', accept: 'application/json,.json', class: 'hidden-file', id: 'verifyFile', onchange: (e) => { const f = e.target.files[0]; if (f) restoreFlow(f, { verifyOnly: true }); e.target.value = ''; } })]),
    ]));
    screen.appendChild(h('div', { class: 'card' }, [
      h('h3', {}, 'About exports'),
      h('div', { class: 'note', style: 'font-size:13px' }, 'Backups are encrypted. Excel, CSV and PDF reports are NOT encrypted: once downloaded they can be read by anyone with the file. Reports default to de-identified (no names, UHID or visit numbers). Local encryption protects the data on this device; it does not by itself make the app compliant with any healthcare privacy law or hospital policy.'),
    ]));
    screen.appendChild(h('button', { class: 'btn btn-block', onclick: () => go('health') }, [ic('info'), 'Data health & storage']));
  }

  async function runCheck(box) {
    box.innerHTML = ''; box.appendChild(h('div', { class: 'spinner' }));
    const kinds = [['cases', 'case', 'case_id'], ['preops', 'preop', 'preop_id'], ['procedures', 'procedure', 'proc_id'], ['duties', 'duty', 'duty_id'], ['templates', 'template', 'tpl_id']];
    const rows = []; const bad = []; const caseIds = new Set(), photoIds = new Set();
    for (const [store, kind, idKey] of kinds) {
      const list = await DB.getAll(store); let ok = 0, unreadable = 0, structural = 0;
      for (const r of list) {
        try {
          const v = await CryptoModule.decryptJSON(state.key, r.value);
          const pr = ['templates'].includes(store) ? [] : Schema.validate(kind, v);
          if (store === 'cases') caseIds.add(v.case_id); if (store === 'preops') { photoIds.add(v.preop_id); (v.photos || []).forEach((k) => photoIds.add(k)); }
          if (pr.length) { structural++; bad.push({ store, id: r[idKey], what: pr.join(', ') }); } else ok++;
        } catch (e) { unreadable++; bad.push({ store, id: r[idKey], what: 'cannot be decrypted with the current PIN (damaged, or written under another PIN)' }); }
      }
      rows.push([store, list.length, ok, unreadable, structural]);
    }
    let imgOk = 0, imgBad = 0, orphan = 0;
    for (const r of await DB.getAll('images')) {
      try { await CryptoModule.decryptBinary(state.key, { iv: r.iv, data: r.data }); imgOk++; } catch (e) { imgBad++; bad.push({ store: 'images', id: r.case_id, what: 'photo cannot be decrypted' }); }
      if (!caseIds.has(r.case_id) && !photoIds.has(r.case_id)) orphan++;
    }
    const info = await DB.storageInfo();
    box.innerHTML = '';
    const problems = bad.length;
    box.appendChild(h('div', { class: problems ? 'warnbar' : 'okbar', id: 'checkResult' }, problems ? `${problems} problem${problems === 1 ? '' : 's'} found. Nothing was changed or deleted.` : '✓ Every stored record and photo was read and checked. No problems found.'));
    box.appendChild(h('div', { class: 'card' }, [h('h3', {}, 'Records'), ...rows.map(([n, t, ok, un, st]) => kv(n, `${t} total · ${ok} ok${un ? ` · ${un} unreadable` : ''}${st ? ` · ${st} malformed` : ''}`)), kv('photos', `${imgOk + imgBad} total · ${imgOk} ok${imgBad ? ` · ${imgBad} unreadable` : ''}`), orphan ? kv('Unlinked photos', `${orphan} (kept; nothing is deleted automatically)`) : null]));
    if (bad.length) box.appendChild(h('div', { class: 'card' }, [h('h3', {}, 'Problems'), ...bad.slice(0, 30).map((b) => h('div', { class: 'note', style: 'margin-bottom:6px' }, `${b.store} · ${String(b.id).slice(0, 8)}… — ${b.what}`)), h('div', { class: 'note' }, 'Unreadable items are left exactly as they are. If you have a backup made before the problem, restoring it may recover them.')]));
    box.appendChild(h('div', { class: 'card' }, [h('h3', {}, 'Storage'),
      kv('Mode', info.mode === 'indexeddb' ? 'Saved on this device (IndexedDB)' : info.mode === 'memory' ? '⚠ TEMPORARY MEMORY ONLY — not saved' : info.mode),
      kv('Protected from automatic clean-up', info.persisted == null ? 'unknown' : info.persisted ? 'Yes' : 'No — keep regular backups'), kv('Used / available', `${fmtBytes(info.usage)} / ${fmtBytes(info.quota)}`),
      kv('Database version', `${DB.VERSION} (schema ${Schema.VERSION}, app ${Schema.APP_VERSION})`)]));
  }
  function renderHealth(screen) {
    screen.appendChild(pageHead('Data health', 'Integrity & storage', null, 'settings'));
    const box = h('div');
    screen.appendChild(h('button', { class: 'btn btn-primary btn-block', id: 'runCheck', style: 'margin-bottom:14px', onclick: () => runCheck(box) }, [ic('shield'), 'Run full integrity check']));
    if (state.corrupt.length) screen.appendChild(h('div', { class: 'warnbar' }, [h('b', {}, `${state.corrupt.length} record(s) could not be read at sign-in`), 'Run the check below for details.']));
    screen.appendChild(box);
    runCheck(box);
  }

  // ------------------------------------------------------------------ recycle bin (cases, pre-ops, procedures)
  function renderBin(screen) {
    screen.appendChild(pageHead('Recycle bin', 'Restore or remove for good', null, 'settings'));
    const groups = [
      ['Cases', state.cases.filter((c) => c.deleted_at), (c) => `${c.patient_name || '(no name)'} · ${fmtDate(c.case_date)}`, (c) => ctx.putCase(c), (c) => [['cases', c.case_id], ['images', c.case_id]], (c) => { state.cases = state.cases.filter((x) => x !== c); }],
      ['Pre-op assessments', state.preops.filter((p) => p.deleted_at), (p) => `${p.patient_name || '(no name)'} · ${fmtDate(p.date)}`, (p) => ctx.putPreopRec(p), (p) => [['preops', p.preop_id], ['images', p.preop_id], ...(p.photos || []).map((k) => ['images', k])], (p) => { state.preops = state.preops.filter((x) => x !== p); }],
      ['Procedures', state.procedures.filter((p) => p.deleted_at), (p) => `${p.procedure} · ${fmtDate(p.date)}`, (p) => ctx.putProcedure(p), (p) => [['procedures', p.proc_id]], (p) => { state.procedures = state.procedures.filter((x) => x !== p); }],
    ];
    let any = false;
    for (const [title, items, label, save, keysOf, drop] of groups) {
      if (!items.length) continue; any = true;
      screen.appendChild(h('div', { class: 'card' }, [h('h3', {}, `${title} (${items.length})`), ...items.map((it) => h('div', { class: 'deleted-row' }, [
        h('div', {}, [h('b', {}, label(it)), h('small', {}, `Deleted ${fmtWhen(it.deleted_at)}`)]),
        h('div', { class: 'btn-row', style: 'flex:none' }, [
          h('button', { class: 'btn btn-sm btn-soft', onclick: async () => { it.deleted_at = null; await save(it); render(); toast('Restored'); } }, 'Restore'),
          h('button', { class: 'btn btn-sm btn-danger', onclick: () => confirmSheet({ title: 'Delete permanently?', text: 'This removes the record and its photos for good. It cannot be undone.', okLabel: 'Delete forever', danger: true, onOk: async () => { await DB.batch(keysOf(it).map(([store, key]) => ({ store, op: 'del', key }))); drop(it); render(); toast('Deleted permanently'); } }) }, 'Forever'),
        ]),
      ]))]));
    }
    if (!any) screen.appendChild(h('div', { class: 'empty' }, [ic('trash'), h('div', {}, 'The recycle bin is empty.')]));
    function render() { ctx.render(); }
  }

  return { screens: { backup: renderBackup, health: renderHealth, bin: renderBin }, api: { doBackup, restoreFlow, daysSince } };
});
