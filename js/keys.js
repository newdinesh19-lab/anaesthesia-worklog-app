/**
 * keys.js — key management for PIN change, recovery and biometric unlock.
 *
 * Model ("wrapped" mode, LUKS-style): every record is encrypted with one random 256-bit DATA KEY (D).
 * D itself is stored only in encrypted ("wrapped") form, once per way of unlocking:
 *   pin  — wrapped by a key derived from the PIN (PBKDF2)         always present in wrapped mode
 *   rec  — wrapped by a key derived from a 100-bit recovery code   optional
 *   q    — wrapped by a key derived from two security answers      optional, WEAKER (low-entropy answers)
 *   bio  — wrapped by a WebAuthn PRF secret (strong) or by a non-extractable device key behind a fingerprint prompt (convenience)
 * Changing the PIN only re-wraps D; no record is re-encrypted. Databases created before V8 are "legacy":
 * D is the PIN-derived key itself, until the user turns on recovery or biometrics (which rotates D once, atomically).
 * No wrapping secret ever leaves the device. There is no server and no email reset link.
 */
const Keys = (() => {
  const C = typeof CryptoModule !== 'undefined' ? CryptoModule : require('./crypto.js');
  const enc = new TextEncoder(), b64 = (x) => C.bufToB64(x), unb64 = (s) => C.b64ToBuf(s);
  const rnd = (n) => crypto.getRandomValues(new Uint8Array(n));
  const aesKey = (raw) => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  async function bits(secret, saltB64, iter) {
    const base = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveBits']);
    return crypto.subtle.deriveBits({ name: 'PBKDF2', salt: unb64(saltB64), iterations: iter, hash: 'SHA-256' }, base, 256);
  }
  async function wrap(wrapKey, raw) { const e = await C.encryptBinary(wrapKey, raw); return { iv: e.iv, data: b64(e.data) }; }
  const unwrap = (wrapKey, w) => C.decryptBinary(wrapKey, { iv: w.iv, data: unb64(w.data) });
  const verifies = async (raw, verifier) => C.checkVerifier(await aesKey(raw), verifier);

  /** m = { salt, kdf:{iter}|null, verifier, keywrap|null } (plain values). -> raw data key (ArrayBuffer) or null. */
  async function rawWithPin(pin, m) {
    if (!m || !m.salt || !m.verifier) return null;
    const pb = await bits(pin, m.salt, (m.kdf && m.kdf.iter) || C.ITER);
    let raw = pb;
    if (m.keywrap && m.keywrap.pin) { try { raw = await unwrap(await aesKey(pb), m.keywrap.pin); } catch (e) { return null; } }
    return (await verifies(raw, m.verifier)) ? raw : null;
  }
  const isWrapped = (m) => !!(m && m.keywrap && m.keywrap.pin);

  /** New PIN wrapper for data key `raw`. -> { salt, kdf, pin } to be stored in meta. */
  async function pinWrapper(raw, pin) {
    const salt = C.newSalt(), iter = C.ITER_NEW;
    return { salt, kdf: { iter }, pin: await wrap(await aesKey(await bits(pin, salt, iter)), raw) };
  }
  const newDataKey = () => rnd(32).buffer;

  // ---- recovery code
  const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 symbols; no 0/O/1/I to avoid look-alikes
  function newRecoveryCode() { const b = rnd(20); let s = ''; for (const x of b) s += ALPHA[x & 31]; return s.match(/.{4}/g).join('-'); }
  const fixCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  async function recoveryWrapper(raw, code) { const salt = C.newSalt(), iter = C.ITER_NEW; return { salt, iter, wrap: await wrap(await aesKey(await bits(fixCode(code), salt, iter)), raw), created_at: new Date().toISOString() }; }
  async function rawWithRecovery(code, rec, verifier) {
    if (!rec) return null;
    try { const raw = await unwrap(await aesKey(await bits(fixCode(code), rec.salt, rec.iter)), rec.wrap); return (await verifies(raw, verifier)) ? raw : null; } catch (e) { return null; }
  }

  // ---- security questions (two answers; weaker than the code)
  const normAnswer = (a) => String(a || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');
  const answerSecret = (answers) => answers.map(normAnswer).join('|');
  const answersOk = (answers) => answers.length === 2 && answers.every((a) => normAnswer(a).length >= 4) && normAnswer(answers[0]) !== normAnswer(answers[1]);
  async function questionWrapper(raw, questions, answers) { const salt = C.newSalt(), iter = 600000; return { questions, salt, iter, wrap: await wrap(await aesKey(await bits(answerSecret(answers), salt, iter)), raw), created_at: new Date().toISOString() }; }
  async function rawWithAnswers(answers, q, verifier) {
    if (!q) return null;
    try { const raw = await unwrap(await aesKey(await bits(answerSecret(answers), q.salt, q.iter)), q.wrap); return (await verifies(raw, verifier)) ? raw : null; } catch (e) { return null; }
  }

  // ---- biometric (WebAuthn platform authenticator)
  const bio = {
    async available() { try { return !!(window.PublicKeyCredential && PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); } catch (e) { return false; } },
    async prf(credId, prfSalt) {
      const a = await navigator.credentials.get({ publicKey: { challenge: rnd(32), allowCredentials: [{ id: unb64(credId), type: 'public-key' }], userVerification: 'required', timeout: 60000, extensions: { prf: { eval: { first: unb64(prfSalt) } } } } });
      const r = a.getClientExtensionResults().prf; return r && r.results && r.results.first ? r.results.first : null;
    },
    /** Register the fingerprint/face credential and wrap `raw`. -> { rec, gateKey } ; rec.mode is 'prf' (strong) or 'gate' (convenience) */
    async enrol(raw, allowGate) {
      const prfSalt = b64(rnd(32));
      const cred = await navigator.credentials.create({ publicKey: { rp: { name: 'Anaesthesia Log' }, user: { id: rnd(16), name: 'anaesthesia-log', displayName: 'Anaesthesia Log' }, challenge: rnd(32), pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }], authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' }, timeout: 60000, attestation: 'none', extensions: { prf: { eval: { first: unb64(prfSalt) } } } } });
      const credId = b64(cred.rawId); const ext = cred.getClientExtensionResults().prf || {};
      let secret = ext.results && ext.results.first ? ext.results.first : null;
      if (!secret && ext.enabled) secret = await bio.prf(credId, prfSalt);
      if (secret) return { rec: { mode: 'prf', credId, prfSalt, wrap: await wrap(await aesKey(secret), raw), created_at: new Date().toISOString() } };
      if (!allowGate) { const e = new Error('NO_PRF'); e.code = 'NO_PRF'; throw e; }
      const gateKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      return { rec: { mode: 'gate', credId, prfSalt, wrap: await wrap(gateKey, raw), created_at: new Date().toISOString() }, gateKey };
    },
    /** Ask for the fingerprint and return the raw data key. gateKey is only needed for mode 'gate'. */
    async unlock(rec, gateKey) {
      if (rec.mode === 'prf') { const s = await bio.prf(rec.credId, rec.prfSalt); if (!s) throw new Error('This phone did not release the key.'); return unwrap(await aesKey(s), rec.wrap); }
      await navigator.credentials.get({ publicKey: { challenge: rnd(32), allowCredentials: [{ id: unb64(rec.credId), type: 'public-key' }], userVerification: 'required', timeout: 60000 } });
      if (!gateKey) throw new Error('Fingerprint key missing on this device.'); return unwrap(gateKey, rec.wrap);
    },
  };

  return { aesKey, rawWithPin, isWrapped, pinWrapper, newDataKey, newRecoveryCode, recoveryWrapper, rawWithRecovery, fixCode, normAnswer, answersOk, questionWrapper, rawWithAnswers, bio, verifies };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Keys;
if (typeof window !== 'undefined') window.Keys = Keys;
