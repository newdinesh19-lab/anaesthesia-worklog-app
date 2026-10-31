/**
 * db.js — IndexedDB layer. Every record value is an AES-GCM ciphertext packet (see crypto.js).
 *
 * V8 (database version 4): ADDS the `procedures` and `templates` stores. It never deletes, renames or rewrites
 * an existing store, so a version-3 database upgrades in place with all records untouched.
 *
 * Safety features:
 *  - batch()/replaceAll(): several writes in ONE transaction, so they all happen or none do.
 *  - open() tells "browser blocks storage" (memory fallback, clearly flagged) apart from real errors such as
 *    VersionError, which are reported instead of silently showing an empty app.
 *  - peek()/rawExport(): inspect and export an old database BEFORE it is upgraded.
 */
const DB = (() => {
  const NAME = 'anaesthesia_log_db';
  const VERSION = 4;
  const STORES = [['meta', 'key'], ['cases', 'case_id'], ['images', 'case_id'], ['consultants', 'name'], ['duties', 'duty_id'], ['preops', 'preop_id'], ['procedures', 'proc_id'], ['templates', 'tpl_id']];
  const KEYS = Object.fromEntries(STORES);
  const NAMES = STORES.map((s) => s[0]);
  const status = { mode: 'pending', error: null, upgradedFrom: null };
  let p = null, mem = null;
  const memOpen = () => { mem = {}; for (const [n] of STORES) mem[n] = new Map(); };
  const hasIDB = () => { try { return typeof indexedDB !== 'undefined' && indexedDB !== null; } catch (e) { return false; } };

  function open() {
    if (p) return p;
    p = new Promise((res, rej) => {
      if (!hasIDB()) return rej(Object.assign(new Error('IndexedDB is not available'), { name: 'SecurityError' }));
      let r; try { r = indexedDB.open(NAME, VERSION); } catch (e) { return rej(e); }
      r.onupgradeneeded = (e) => {
        status.upgradedFrom = e.oldVersion;
        const db = e.target.result;
        for (const [n, k] of STORES) if (!db.objectStoreNames.contains(n)) db.createObjectStore(n, { keyPath: k }); // additive only
      };
      r.onblocked = () => { status.blocked = true; };
      r.onsuccess = (e) => { const db = e.target.result; db.onversionchange = () => db.close(); res(db); };
      r.onerror = (e) => { if (e.preventDefault) e.preventDefault(); rej(r.error || e.target.error); };
    }).then((db) => { status.mode = 'indexeddb'; return db; }, (err) => {
      const n = (err && err.name) || '';
      // Storage simply unavailable (sandboxed preview, some private modes): keep working in memory but SAY SO.
      if (n === 'SecurityError' || n === 'InvalidStateError' || n === 'NotSupportedError' || n === 'TypeError' || /not available/i.test(err && err.message)) {
        memOpen(); status.mode = 'memory'; status.error = err; window.__dbMemory = true; return null;
      }
      status.mode = 'error'; status.error = err; throw err; // VersionError, QuotaExceededError, upgrade failure…
    });
    return p;
  }

  const wrap = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

  /** Run several writes in one transaction. ops: {store, op:'put'|'del'|'clear', value?, key?}. */
  async function batch(ops) {
    if (!ops || !ops.length) return;
    const db = await open();
    if (!db) {
      for (const o of ops) { if (o.op === 'del') mem[o.store].delete(o.key); else if (o.op === 'clear') mem[o.store].clear(); else mem[o.store].set(o.value[KEYS[o.store]], o.value); }
      return;
    }
    const names = [...new Set(ops.map((o) => o.store))];
    await new Promise((res, rej) => {
      const tx = db.transaction(names, 'readwrite');
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error || new Error('Transaction aborted'));
      try {
        for (const o of ops) {
          const st = tx.objectStore(o.store);
          if (o.op === 'del') st.delete(o.key); else if (o.op === 'clear') st.clear(); else st.put(o.value);
        }
      } catch (e) { try { tx.abort(); } catch (x) { /* ignore */ } rej(e); }
    });
  }
  const put = (n, v) => batch([{ store: n, op: 'put', value: v }]);
  const del = (n, k) => batch([{ store: n, op: 'del', key: k }]);
  const get = async (n, k) => { const db = await open(); return db ? (await wrap(db.transaction(n, 'readonly').objectStore(n).get(k))) || null : mem[n].get(k) || null; };
  const getAll = async (n) => { const db = await open(); return db ? (await wrap(db.transaction(n, 'readonly').objectStore(n).getAll())) || [] : [...mem[n].values()]; };
  const count = async (n) => { const db = await open(); return db ? wrap(db.transaction(n, 'readonly').objectStore(n).count()) : mem[n].size; };
  /** Atomic restore: clear every store and write the new records in ONE transaction. If anything fails, nothing changes. */
  async function replaceAll(byStore) {
    const ops = NAMES.map((n) => ({ store: n, op: 'clear' }));
    for (const [n, list] of Object.entries(byStore)) if (KEYS[n]) for (const v of list) ops.push({ store: n, op: 'put', value: v });
    await batch(ops);
  }
  const clearAll = () => batch(NAMES.map((n) => ({ store: n, op: 'clear' })));

  /** Look at an existing database WITHOUT upgrading or creating it. -> {exists, version, hasPin} */
  function peek() {
    return new Promise((res) => {
      if (!hasIDB()) return res({ exists: false });
      let r; try { r = indexedDB.open(NAME); } catch (e) { return res({ exists: false }); }
      let created = false;
      r.onupgradeneeded = (e) => { created = true; try { e.target.transaction.abort(); } catch (x) { /* ignore */ } };
      r.onsuccess = (e) => {
        const db = e.target.result;
        if (created || !db.objectStoreNames.contains('meta')) { db.close(); return res({ exists: false }); }
        const q = db.transaction('meta', 'readonly').objectStore('meta').get('salt');
        q.onsuccess = () => { const v = db.version; db.close(); res({ exists: true, version: v, hasPin: !!q.result }); };
        q.onerror = () => { const v = db.version; db.close(); res({ exists: true, version: v, hasPin: false }); };
      };
      r.onerror = () => res({ exists: false });
    });
  }
  /** Read every existing store of the CURRENT on-disk database (no upgrade). Records stay encrypted. */
  function rawExport() {
    return new Promise((resolve, reject) => {
      let r; try { r = indexedDB.open(NAME); } catch (e) { return reject(e); }
      r.onerror = () => reject(r.error);
      r.onsuccess = async (e) => {
        const db = e.target.result; const out = {};
        try {
          for (const n of NAMES) out[n] = db.objectStoreNames.contains(n) ? (await wrap(db.transaction(n, 'readonly').objectStore(n).getAll())) || [] : [];
          db.close(); resolve(out);
        } catch (err) { db.close(); reject(err); }
      };
    });
  }
  async function storageInfo() {
    const o = { mode: status.mode, persisted: null, usage: null, quota: null };
    try { if (navigator.storage && navigator.storage.persisted) o.persisted = await navigator.storage.persisted(); } catch (e) { /* ignore */ }
    try { if (navigator.storage && navigator.storage.estimate) { const est = await navigator.storage.estimate(); o.usage = est.usage; o.quota = est.quota; } } catch (e) { /* ignore */ }
    return o;
  }
  async function requestPersistence() {
    try { if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist(); } catch (e) { /* ignore */ }
    return false;
  }
  return { NAME, VERSION, STORES, NAMES, KEYS, status, open, get, put, del, getAll, count, batch, replaceAll, clearAll, peek, rawExport, storageInfo, requestPersistence };
})();
if (typeof window !== 'undefined') window.DB = DB;
