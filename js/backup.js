/**
 * backup.js — backup file format, integrity checking and restore planning. No DOM, no database access:
 * pure functions so they can be unit-tested.
 *
 * Format 3 (V8):  { format, version:3, app_version, schema_version, created_at, counts, stores:{…}, checksum:'sha256:…' }
 *   stores.images[].data is base64. Every other record is still the AES-GCM packet exactly as stored,
 *   so the file is as private as the database itself and needs the PIN that was active when it was made.
 * Format 2 (V4–V7): flat { version:2, exportedAt, meta, cases, images, consultants, duties, preops }. Still readable.
 */
const Backup = (() => {
  const FORMAT = 'anaesthesia-log-backup';
  const SKIP_META = new Set(['lockout', 'biokey']); // device-local, never restored
  /** The fingerprint wrapper belongs to this phone only; everything else in 'keywrap' (PIN, recovery code, questions) travels with the backup. */
  const stripBio = (m) => (m.key === 'keywrap' && m.value ? { ...m, value: { ...m.value, bio: null } } : m);
  const STORE_NAMES = ['meta', 'cases', 'images', 'consultants', 'duties', 'preops', 'procedures', 'templates'];

  /** raw = { storeName: [records…] } straight from IndexedDB (images carry ArrayBuffer data). */
  async function build(raw, info = {}) {
    const stores = {};
    for (const n of STORE_NAMES) {
      let list = raw[n] || [];
      if (n === 'meta') list = list.filter((m) => !SKIP_META.has(m.key)).map(stripBio);
      if (n === 'images') list = list.map((r) => ({ case_id: r.case_id, iv: r.iv, data: CryptoModule.bufToB64(r.data), mimeType: r.mimeType }));
      stores[n] = list;
    }
    const counts = {}; for (const n of STORE_NAMES) counts[n] = stores[n].length;
    const checksum = 'sha256:' + (await CryptoModule.sha256Hex(JSON.stringify(stores)));
    return { format: FORMAT, version: 3, app_version: info.appVersion || '', schema_version: info.schemaVersion || 0, created_at: new Date().toISOString(), counts, stores, checksum };
  }
  /** Old-style flat file (used for the pre-upgrade safety backup so V7 can still restore it). */
  function buildLegacy(raw) {
    const images = (raw.images || []).map((r) => ({ case_id: r.case_id, iv: r.iv, data: CryptoModule.bufToB64(r.data), mimeType: r.mimeType }));
    return { version: 2, exportedAt: new Date().toISOString(), meta: (raw.meta || []).filter((m) => !SKIP_META.has(m.key)).map(stripBio), cases: raw.cases || [], images, consultants: raw.consultants || [], duties: raw.duties || [], preops: raw.preops || [] };
  }

  /**
   * Parse and structurally validate a backup file's text.
   * -> { ok, fatal:[…], warnings:[…], format, version, created_at, app_version, counts, stores } (stores have binary images)
   */
  async function read(text) {
    const out = { ok: false, fatal: [], warnings: [], format: 'unknown', version: 0, created_at: '', app_version: '', counts: {}, stores: null, checksum: 'none' };
    let j;
    try { j = JSON.parse(text); } catch (e) { out.fatal.push('The file is not valid JSON. It may be incomplete or damaged.'); return out; }
    if (!j || typeof j !== 'object' || Array.isArray(j)) { out.fatal.push('This is not an Anaesthesia Log backup.'); return out; }
    let src;
    if (j.stores && typeof j.stores === 'object') {
      out.format = 'v3'; out.version = j.version || 3; out.created_at = j.created_at || ''; out.app_version = j.app_version || '';
      if (j.format && j.format !== FORMAT) out.fatal.push('This file is not an Anaesthesia Log backup.');
      src = j.stores;
      if (j.checksum) {
        const calc = 'sha256:' + (await CryptoModule.sha256Hex(JSON.stringify(j.stores)));
        if (calc !== j.checksum) out.fatal.push('Integrity check FAILED: the contents do not match the checksum written when the backup was made. The file is damaged or was edited.');
        else out.checksum = 'valid';
      } else out.warnings.push('No checksum in this file.');
    } else if (j.meta && j.cases) {
      out.format = 'v2'; out.version = j.version || 2; out.created_at = j.exportedAt || '';
      out.warnings.push('Older backup format (no checksum). It can be restored, but file damage cannot be ruled out until the PIN check below.');
      src = j;
    } else { out.fatal.push('This is not an Anaesthesia Log backup (no cases / meta sections).'); return out; }
    if (out.fatal.length) return out;

    const stores = {};
    for (const n of STORE_NAMES) {
      const list = src[n];
      if (list == null) { stores[n] = []; continue; }
      if (!Array.isArray(list)) { out.fatal.push(`Section "${n}" is damaged.`); continue; }
      stores[n] = list;
    }
    if (out.fatal.length) return out;
    const key = { meta: 'key', cases: 'case_id', images: 'case_id', consultants: 'name', duties: 'duty_id', preops: 'preop_id', procedures: 'proc_id', templates: 'tpl_id' };
    for (const n of STORE_NAMES) for (const r of stores[n]) if (!r || r[key[n]] == null) { out.fatal.push(`A record in "${n}" has no id; the file is damaged.`); break; }
    if (out.fatal.length) return out;
    try { stores.images = stores.images.map((r) => ({ case_id: r.case_id, iv: r.iv, data: typeof r.data === 'string' ? CryptoModule.b64ToBuf(r.data) : r.data, mimeType: r.mimeType })); }
    catch (e) { out.fatal.push('A photo in the backup is damaged.'); return out; }
    if (!stores.meta.some((m) => m.key === 'salt') || !stores.meta.some((m) => m.key === 'verifier')) out.fatal.push('The backup has no PIN information, so it could never be unlocked.');
    for (const n of STORE_NAMES) out.counts[n] = stores[n].length;
    out.stores = stores; out.ok = out.fatal.length === 0;
    return out;
  }

  const metaValue = (stores, k) => { const m = stores.meta.find((x) => x.key === k); return m ? m.value : null; };
  /** Key for the backup's own PIN, or null if the PIN is wrong. */
  async function keyFor(stores, pin) {
    const K = typeof Keys !== 'undefined' ? Keys : require('./keys.js');
    const raw = await K.rawWithPin(pin, { salt: metaValue(stores, 'salt'), kdf: metaValue(stores, 'kdf'), verifier: metaValue(stores, 'verifier'), keywrap: metaValue(stores, 'keywrap') });
    return raw ? K.aesKey(raw) : null;
  }
  /** Decrypt every record with `key` and summarise it (never returns patient details). */
  async function inspect(stores, key) {
    const sum = { okCount: 0, failed: [], cases: 0, deletedCases: 0, preops: 0, procedures: 0, duties: 0, templates: 0, from: '', to: '', imagesOk: 0, imagesFailed: 0 };
    const kinds = [['cases', 'case_id'], ['preops', 'preop_id'], ['procedures', 'proc_id'], ['duties', 'duty_id'], ['templates', 'tpl_id']];
    for (const [store, idKey] of kinds) {
      for (const r of stores[store]) {
        try {
          const v = await CryptoModule.decryptJSON(key, r.value); sum.okCount++;
          if (store === 'cases') { v.deleted_at ? sum.deletedCases++ : sum.cases++; const d = v.case_date || ''; if (d && (!sum.from || d < sum.from)) sum.from = d; if (d && d > sum.to) sum.to = d; }
          else sum[store]++;
        } catch (e) { sum.failed.push({ store, id: r[idKey] }); }
      }
    }
    for (const r of stores.images) { try { await CryptoModule.decryptBinary(key, { iv: r.iv, data: r.data }); sum.imagesOk++; } catch (e) { sum.imagesFailed++; } }
    return sum;
  }
  /** Records to hand to DB.replaceAll(). Device-local meta (lockout) is dropped. */
  function toRecords(stores) {
    const o = {}; for (const n of STORE_NAMES) o[n] = stores[n];
    o.meta = o.meta.filter((m) => !SKIP_META.has(m.key)).map(stripBio);
    return o;
  }
  const fileName = (d = new Date()) => `anaesthesia-log-backup-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}.json`;
  return { FORMAT, STORE_NAMES, build, buildLegacy, read, keyFor, inspect, toRecords, fileName };
})();
if (typeof window !== 'undefined') window.Backup = Backup;
if (typeof module !== 'undefined' && module.exports) module.exports = Backup;
