/**
 * crypto.js — PIN-derived AES-GCM encryption for everything this app
 * stores locally (case records + registration-sheet photos). Nothing here
 * ever leaves the device; there is no server component.
 *
 * Key derivation: PBKDF2(PIN, salt, 150000 rounds) -> AES-256-GCM key.
 * A random salt is generated once and stored in IndexedDB (plaintext —
 * a salt is not a secret). A "verifier" (a known plaintext string,
 * encrypted) is stored alongside it so a wrong PIN can be detected before
 * touching real data.
 */

const CryptoModule = (() => {
  const PBKDF2_ITERATIONS = 150000;
  const VERIFIER_PLAINTEXT = 'anaesthesia-log-v1-ok';

  function randomBytes(len) {
    return crypto.getRandomValues(new Uint8Array(len));
  }

  function bufToB64(buf) {
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  function b64ToBuf(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }

  async function deriveKey(pin, saltB64) {
    const enc = new TextEncoder();
    const salt = b64ToBuf(saltB64);
    const baseKey = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  function newSalt() {
    return bufToB64(randomBytes(16));
  }

  /** Encrypt a JS value (JSON-serializable) -> { iv, data } both base64. */
  async function encryptJSON(key, value) {
    const iv = randomBytes(12);
    const enc = new TextEncoder();
    const plaintext = enc.encode(JSON.stringify(value));
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
    return { iv: bufToB64(iv), data: bufToB64(cipher) };
  }

  async function decryptJSON(key, packet) {
    const iv = new Uint8Array(b64ToBuf(packet.iv));
    const cipherBuf = b64ToBuf(packet.data);
    const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipherBuf);
    const dec = new TextDecoder();
    return JSON.parse(dec.decode(plainBuf));
  }

  /** Encrypt raw binary (e.g. an image Blob's ArrayBuffer). */
  async function encryptBinary(key, arrayBuffer) {
    const iv = randomBytes(12);
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, arrayBuffer);
    return { iv: bufToB64(iv), data: cipher }; // keep ciphertext as raw ArrayBuffer for IDB storage efficiency
  }

  async function decryptBinary(key, packet) {
    const iv = new Uint8Array(b64ToBuf(packet.iv));
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, packet.data);
  }

  async function makeVerifier(key) {
    return encryptJSON(key, VERIFIER_PLAINTEXT);
  }

  async function checkVerifier(key, verifierPacket) {
    try {
      const val = await decryptJSON(key, verifierPacket);
      return val === VERIFIER_PLAINTEXT;
    } catch (e) {
      return false;
    }
  }

  return { newSalt, deriveKey, encryptJSON, decryptJSON, encryptBinary, decryptBinary, makeVerifier, checkVerifier, bufToB64, b64ToBuf };
})();

if (typeof window !== 'undefined') window.CryptoModule = CryptoModule;
if (typeof module !== 'undefined' && module.exports) module.exports = CryptoModule;
