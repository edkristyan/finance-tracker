/**
 * db.js — thin IndexedDB wrapper.
 *
 * Deliberately knows nothing about accounts/transactions/etc. It's a generic
 * key-value store on top of IndexedDB; js/state/store.js is what gives the
 * stored blob financial meaning. Keeping this domain-agnostic is what makes
 * it independently testable and reusable if the app ever needs a second
 * piece of persisted state.
 *
 * Database/store names match the original single-file app ('LedgerOfflineDB'
 * / 'kv') for continuity — not that it matters for storage isolation (each
 * origin gets its own IndexedDB regardless), just for consistency if this
 * code is ever compared side-by-side with the original.
 */

const DB_NAME = 'LedgerOfflineDB';
const DB_VERSION = 1;
const STORE_NAME = 'kv';

/**
 * Opens (and, on first run, creates) the IndexedDB database.
 * @returns {Promise<IDBDatabase>}
 */
export function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Reads one value by key from the kv store.
 * @param {IDBDatabase} db
 * @param {string} key
 * @returns {Promise<*>} the stored value, or undefined if not present
 */
export function getValue(db, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Writes one value by key into the kv store.
 * @param {IDBDatabase} db
 * @param {string} key
 * @param {*} value - must be structured-clonable (plain objects/arrays/etc.)
 * @returns {Promise<void>}
 */
export function setValue(db, key, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
