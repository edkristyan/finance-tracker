/**
 * autoBackup.js — an optional second backup path alongside the manual
 * "Export backup" button on the Accounts tab: once you pick a folder, a
 * dated backup JSON is written there automatically on the last day of
 * every month, in the same format the manual export already uses.
 *
 * Honest about the limits, since this is all client-side, in the browser:
 * - Requires a Chromium-based browser (Chrome, Edge, Brave, Opera, ...).
 *   The File System Access API this relies on (showDirectoryPicker, a
 *   directory handle the browser remembers permission for) isn't
 *   implemented in Firefox or Safari at all — isSupported() is false there
 *   and the feature stays hidden; manual export/import remains the backup
 *   path on those browsers.
 * - There's no true background job: a web page can't run code while it
 *   isn't open, and there's no OS-level scheduler here. runAutoBackupCheck()
 *   is called once at app startup (see boot() in main.js) and simply asks
 *   "is today the last day of the month, and have I already backed up this
 *   month?" — so a backup only actually gets written if the app happens to
 *   be opened (or left open) on that day. Opening the app on the 1st for a
 *   month you missed does NOT retroactively back up the last day you
 *   missed — there's nothing to recover once that day has passed.
 * - The browser can silently revoke a folder's write permission (e.g.
 *   after long disuse). When that happens the check can't just re-ask —
 *   re-requesting permission requires an actual click — so it instead
 *   flags `needsReauth`, and the Accounts tab shows a one-click
 *   "Re-authorize" button.
 */

import { openDatabase, getValue, setValue } from '../services/db.js';

const CONFIG_KEY = 'autoBackupConfig';
let dbHandle = null;

async function db() {
  if (!dbHandle) dbHandle = await openDatabase();
  return dbHandle;
}

/** @returns {boolean} whether this browser can offer the feature at all */
export function isSupported() {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

/**
 * @typedef {Object} BackupConfig
 * @property {boolean} enabled
 * @property {FileSystemDirectoryHandle|null} folderHandle
 * @property {string} folderName
 * @property {string} lastBackupMonth - "YYYY-MM" of the last successful auto-backup, or ""
 * @property {boolean} needsReauth
 */

/** @returns {Promise<BackupConfig>} */
export async function getBackupConfig() {
  const stored = await getValue(await db(), CONFIG_KEY);
  return stored || { enabled: false, folderHandle: null, folderName: '', lastBackupMonth: '', needsReauth: false };
}

async function saveBackupConfig(config) {
  await setValue(await db(), CONFIG_KEY, config);
}

/**
 * Opens the browser's folder picker and remembers the chosen folder as the
 * auto-backup destination. Must be called from a click handler — the File
 * System Access API refuses to show the picker without a user gesture.
 * @returns {Promise<{ok: boolean, name?: string, error?: string}>}
 */
export async function chooseBackupFolder() {
  if (!isSupported()) return { ok: false, error: 'not-supported' };
  try {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    await saveBackupConfig({
      enabled: true,
      folderHandle: handle,
      folderName: handle.name,
      lastBackupMonth: '',
      needsReauth: false,
    });
    return { ok: true, name: handle.name };
  } catch (err) {
    if (err && err.name === 'AbortError') return { ok: false, error: 'cancelled' };
    console.error('Failed to choose backup folder:', err);
    return { ok: false, error: 'failed' };
  }
}

/**
 * Turns auto-backup on/off without forgetting the chosen folder, so
 * turning it back on later doesn't require picking the folder again.
 * @param {boolean} enabled
 */
export async function setAutoBackupEnabled(enabled) {
  const config = await getBackupConfig();
  if (!config.folderHandle) return;
  await saveBackupConfig({ ...config, enabled });
}

/**
 * Re-requests write permission on the already-chosen folder. Must be
 * called from a click handler.
 * @returns {Promise<boolean>} whether permission was (re-)granted
 */
export async function reauthorizeBackupFolder() {
  const config = await getBackupConfig();
  if (!config.folderHandle) return false;
  try {
    const perm = await config.folderHandle.requestPermission({ mode: 'readwrite' });
    const granted = perm === 'granted';
    await saveBackupConfig({ ...config, needsReauth: !granted });
    return granted;
  } catch (err) {
    console.error('Failed to reauthorize backup folder:', err);
    return false;
  }
}

function isLastDayOfMonth(d) {
  const tomorrow = new Date(d);
  tomorrow.setDate(d.getDate() + 1);
  return tomorrow.getMonth() !== d.getMonth();
}

function monthKeyOf(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Called once at app startup. Writes a dated backup JSON into the chosen
 * folder if — and only if — auto-backup is enabled, a folder is set,
 * today is the last day of the calendar month, and this month hasn't
 * already been backed up. A silent no-op otherwise; never throws, since a
 * failed auto-backup check should never block the app from loading.
 * @param {Object} data - the current ledger data (same shape getData() returns)
 * @returns {Promise<{ran: boolean, reason?: string}>}
 */
export async function runAutoBackupCheck(data) {
  try {
    if (!isSupported() || !data) return { ran: false, reason: 'not-supported' };
    const config = await getBackupConfig();
    if (!config.enabled || !config.folderHandle) return { ran: false, reason: 'not-configured' };

    const now = new Date();
    if (!isLastDayOfMonth(now)) return { ran: false, reason: 'not-last-day' };

    const mk = monthKeyOf(now);
    if (config.lastBackupMonth === mk) return { ran: false, reason: 'already-done' };

    const perm = await config.folderHandle.queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted') {
      await saveBackupConfig({ ...config, needsReauth: true });
      return { ran: false, reason: 'needs-reauth' };
    }

    const dateStr = now.toISOString().slice(0, 10);
    const fileHandle = await config.folderHandle.getFileHandle(`ledger-backup-${dateStr}.json`, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(data, null, 2));
    await writable.close();

    await saveBackupConfig({ ...config, lastBackupMonth: mk, needsReauth: false });
    return { ran: true };
  } catch (err) {
    console.error('Auto-backup failed:', err);
    return { ran: false, reason: 'error' };
  }
}
