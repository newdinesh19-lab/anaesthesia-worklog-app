/** crypto.js — PIN-derived AES-256-GCM encryption for everything stored locally. */
const CryptoModule = (() => {
  const ITER = 150000;      // iterations used by every PIN created before V8 (kept so old data still unlocks)
  const ITER_NEW = 310000;  // used for new PINs from V8 on; the value is stored in meta ('kdf') next to the salt
  const VERIFIER = 'anaesthesia-log-v1-ok';
  const rnd = (n) => crypto.getRandomValues(new Uint8Array(n));
  function bufToB64(buf) { const b = new Uint8Array(buf); let s = ''; for (let i = 0; i < b.byteLength; i++) s += String.fromCharCode(b[i]); return btoa(s); }
  function b64ToBuf(b64) { const s = atob(b64); const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b.buffer; }
  async function deriveKey(pin, saltB64, iterations) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b64ToBuf(saltB64), iterations: iterations || ITER, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  /** SHA-256 hex digest of a string or ArrayBuffer (used to detect a damaged backup file). */
  async function sha256Hex(input) {
    const buf = typeof input === 'string' ? new TextEncoder().encode(input) : input;
    const d = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
    return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  const newSalt = () => bufToB64(rnd(16));
  async function encryptJSON(key, value) {
    const iv = rnd(12);
    const c = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(value)));
    return { iv: bufToB64(iv), data: bufToB64(c) };
  }
  async function decryptJSON(key, p) {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(b64ToBuf(p.iv)) }, key, b64ToBuf(p.data));
    return JSON.parse(new TextDecoder().decode(plain));
  }
  async function encryptBinary(key, ab) {
    const iv = rnd(12);
    return { iv: bufToB64(iv), data: await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, ab) };
  }
  const decryptBinary = (key, p) => crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(b64ToBuf(p.iv)) }, key, p.data);
  const makeVerifier = (key) => encryptJSON(key, VERIFIER);
  async function checkVerifier(key, p) { try { return (await decryptJSON(key, p)) === VERIFIER; } catch (e) { return false; } }
  return { ITER, ITER_NEW, sha256Hex, newSalt, deriveKey, encryptJSON, decryptJSON, encryptBinary, decryptBinary, makeVerifier, checkVerifier, bufToB64, b64ToBuf };
})();
if (typeof window !== 'undefined') window.CryptoModule = CryptoModule;
if (typeof module !== 'undefined' && module.exports) module.exports = CryptoModule;
