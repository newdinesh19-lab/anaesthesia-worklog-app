/**
 * db.js — IndexedDB persistence layer. Every value written to the "cases",
 * "settings" and "images" stores is an AES-GCM ciphertext packet produced
 * by crypto.js; nothing patient-identifiable is ever written in the clear.
 */

const DB = (() => {
  const DB_NAME = 'anaesthesia_log_db';
  const DB_VERSION = 1;
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('cases')) db.createObjectStore('cases', { keyPath: 'case_id' });
        if (!db.objectStoreNames.contains('images')) db.createObjectStore('images', { keyPath: 'case_id' });
        if (!db.objectStoreNames.contains('consultants')) db.createObjectStore('consultants', { keyPath: 'name' });
      };
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = (e) => reject(e.target.error);
    });
    return dbPromise;
  }

  function tx(storeName, mode) {
    return open().then((db) => db.transaction(storeName, mode).objectStore(storeName));
  }

  async function get(storeName, key) {
    const store = await tx(storeName, 'readonly');
    return new Promise((resolve, reject) => {
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function put(storeName, value) {
    const store = await tx(storeName, 'readwrite');
    return new Promise((resolve, reject) => {
      const req = store.put(value);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async function del(storeName, key) {
    const store = await tx(storeName, 'readwrite');
    return new Promise((resolve, reject) => {
      const req = store.delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async function getAll(storeName) {
    const store = await tx(storeName, 'readonly');
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function clearAll() {
    const db = await open();
    const names = ['meta', 'cases', 'images', 'consultants'];
    await Promise.all(
      names.map(
        (n) =>
          new Promise((resolve, reject) => {
            const req = db.transaction(n, 'readwrite').objectStore(n).clear();
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
          })
      )
    );
  }

  return { open, get, put, del, getAll, clearAll };
})();

if (typeof window !== 'undefined') window.DB = DB;
