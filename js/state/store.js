import { openDatabase, getValue, setValue } from '../services/db.js';
import { sanitizeRecord } from '../utils/sanitize.js';
import { newId } from '../utils/id.js';
import seed from './seed.json';

const PERSIST_KEY = 'main';

/** @type {IDBDatabase|null} */
let dbHandle = null;

/** @type {Object|null} the single in-memory data object: accounts, transactions, etc. */
let data = null;

/** @type {Array<(data: Object) => void>} */
const listeners = [];

/**
 * Notifies every subscribed view that `data` has changed. Views re-render
 * from the fresh reference rather than being told what changed — the app is
 * small enough that a full re-render per view is simpler (KISS) than a diffing
 * layer, and matches the original app's render() model.
 */
function notify() {
  listeners.forEach((fn) => fn(data));
}

/**
 * Subscribes to state changes.
 * @param {(data: Object) => void} fn - called with the current data after every mutation
 * @returns {() => void} unsubscribe function
 */
export function subscribe(fn) {
  listeners.push(fn);
  return () => {
    const idx = listeners.indexOf(fn);
    if (idx >= 0) listeners.splice(idx, 1);
  };
}

/**
 * Returns the current data object. Callers should treat this as read-only —
 * all changes must go through addItem/upsertItem/updateItem/deleteItem so
 * every mutation gets sanitized, persisted, and broadcast consistently.
 * @returns {Object|null}
 */
export function getData() {
  return data;
}

/**
 * Writes the current data object to IndexedDB.
 * @returns {Promise<void>}
 */
async function persist() {
  try {
    await setValue(dbHandle, PERSIST_KEY, data);
  } catch (err) {
    console.error('Failed to persist ledger data:', err);
    throw err;
  }
}

/**
 * Applies one-time, structural migrations to data loaded from a previous
 * session — e.g. a field that didn't exist when that data was first saved.
 * Deliberately generic: no hardcoded personal account data or amounts
 * belong here (or anywhere in this codebase) — see the Phase 3 notes.
 * @param {Object} loaded
 * @returns {Object} the migrated data
 */
function applyMigrations(loaded) {
  // Backfill every collection the current schema expects, whatever the
  // source actually had. Covers a fresh seed missing a field added later,
  // and — just as importantly — a restored backup from an older version of
  // this app (or the pre-refactor single-file version) that predates a
  // collection entirely: without this, a view reading data.budgets (say) on
  // data that has no budgets key at all would crash outright rather than
  // just show nothing.
  Object.keys(seed).forEach((key) => {
    if (!loaded[key]) {
      loaded[key] = Array.isArray(seed[key]) ? [] : JSON.parse(JSON.stringify(seed[key]));
    }
  });
  if (!loaded.categories.length) loaded.categories = JSON.parse(JSON.stringify(seed.categories));
  // Added for the Loans phase: an existing dataset already has a non-empty
  // categories array (so the blanket replace above never runs for it), so
  // this new category needs its own explicit backfill to show up in older
  // saved data too.
  if (!loaded.categories.some((c) => c.name === 'Loan Payment')) {
    loaded.categories.push({ id: newId('cat'), name: 'Loan Payment' });
  }
  // Standardized against the person's own real-world category usage (their
  // pre-refactor backup used "Credit Card Payment" as its own category,
  // distinct from general Bank Fees) — same backfill pattern as Loan Payment
  // above, so it shows up in already-existing saved data too.
  if (!loaded.categories.some((c) => c.name === 'Credit Card Payment')) {
    loaded.categories.push({ id: newId('cat'), name: 'Credit Card Payment' });
  }

  loaded.accounts.forEach((a) => {
    if (!a.type) a.type = 'bank';
  });
  loaded.transactions.forEach((t) => {
    if (!t.direction && !t.toAccount) {
      t.direction = t.type === 'Income' || t.type === 'Received' ? 'in' : 'out';
    }
  });
  loaded.routines.forEach((r) => {
    if (r.expectedAmount == null && r.amount != null) r.expectedAmount = r.amount;
  });

  // holdings are keyed by their own ticker rather than a generated id — fill
  // that in first, from whichever of ticker/id the import actually has.
  loaded.holdings.forEach((h) => {
    if (!h.id) h.id = h.ticker;
    if (!h.ticker) h.ticker = h.id;
  });

  // Backfill missing ids everywhere else: a known failure mode in earlier
  // exports of this dataset (seeded transactions/lots with no unique id),
  // which silently breaks edit/delete since every mutator matches records
  // by id.
  Object.keys(loaded).forEach((key) => {
    if (key === 'holdings' || !Array.isArray(loaded[key])) return;
    loaded[key].forEach((record) => {
      if (record && !record.id) record.id = newId(key);
    });
  });

  return loaded;
}

/**
 * Opens the database, loads existing data (running migrations) or seeds a
 * fresh dataset, and persists the result. Throws if IndexedDB itself is
 * unavailable (e.g. blocked by browser settings/private mode) — the caller
 * (main.js) decides how to surface that to the user, since this module
 * intentionally has no DOM access.
 * @returns {Promise<Object>} the ready-to-use data object
 */
export async function initStore() {
  dbHandle = await openDatabase();

  const existing = await getValue(dbHandle, PERSIST_KEY);
  if (existing) {
    data = applyMigrations(existing);
  } else {
    data = JSON.parse(JSON.stringify(seed));
  }

  await persist();
  notify();
  return data;
}

/**
 * Adds a new record to a collection.
 * @param {string} collection - e.g. "accounts", "transactions"
 * @param {Object} record - the record to add; an id is generated if absent
 * @param {string} [idPrefix] - prefix for the generated id (defaults to the collection name)
 * @returns {Promise<string>} the record's id
 */
export async function addItem(collection, record, idPrefix) {
  const clean = sanitizeRecord(record);
  if (!clean.id) clean.id = newId(idPrefix || collection);
  data[collection].push(clean);
  await persist();
  notify();
  return clean.id;
}

/**
 * Replaces a record entirely (or adds it if the id isn't found).
 * @param {string} collection
 * @param {string} id
 * @param {Object} record
 * @returns {Promise<void>}
 */
export async function upsertItem(collection, id, record) {
  const clean = sanitizeRecord({ ...record, id });
  const idx = data[collection].findIndex((x) => x.id === id);
  if (idx >= 0) {
    data[collection][idx] = clean;
  } else {
    data[collection].push(clean);
  }
  await persist();
  notify();
}

/**
 * Merges a partial patch into an existing record.
 * @param {string} collection
 * @param {string} id
 * @param {Object} patch
 * @returns {Promise<void>}
 */
export async function updateItem(collection, id, patch) {
  const idx = data[collection].findIndex((x) => x.id === id);
  if (idx >= 0) {
    data[collection][idx] = { ...data[collection][idx], ...sanitizeRecord(patch) };
  }
  await persist();
  notify();
}

/**
 * Removes a record from a collection.
 * @param {string} collection
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deleteItem(collection, id) {
  data[collection] = data[collection].filter((x) => x.id !== id);
  await persist();
  notify();
}

/**
 * Replaces the entire dataset (e.g. restoring a backup, or resetting to a
 * fresh seed) and persists the result. Always runs the same migrations as
 * normal startup, so an imported backup from an older schema version — or
 * from the pre-refactor single-file app — gets backfilled the same way a
 * carried-forward IndexedDB dataset would, rather than being trusted as-is.
 * @param {Object} newData
 * @returns {Promise<void>}
 */
export async function replaceData(newData) {
  data = applyMigrations(newData);
  await persist();
  notify();
}

/**
 * Wipes all data back to the starting seed (empty collections + default
 * categories). Used by the "Reset all data" action.
 * @returns {Promise<void>}
 */
export async function resetStore() {
  await replaceData(JSON.parse(JSON.stringify(seed)));
}

/**
 * Runs an arbitrary synchronous mutation against the live data object, then
 * persists and notifies. Escape hatch for mutations that don't fit the
 * simple add/upsert/update/delete shape (e.g. renaming a holding's ticker,
 * which has to move every referencing lot along with it) — the mutation
 * logic itself stays in the relevant service as a pure function; this just
 * gives it write access.
 * @param {(data: Object) => *} mutatorFn
 * @returns {Promise<*>} whatever mutatorFn returns
 */
export async function mutate(mutatorFn) {
  const result = mutatorFn(data);
  await persist();
  notify();
  return result;
}
