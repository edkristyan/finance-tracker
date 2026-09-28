/**
 * privacy.js — the "Hide amounts" toggle (peso figures replaced with a
 * fixed placeholder wherever peso() is used). Mirrors theme.js's shape: a
 * persisted boolean plus a tiny pub-sub so any interested code (currently
 * just main.js's nav router, to force a re-render) can react to a flip.
 *
 * Deliberately global rather than per-view — someone reaching for "hide
 * amounts" usually wants the whole screen safe to glance at (e.g. someone
 * looked over at a graveyard-shift desk), not just the view they're on.
 */

const STORAGE_KEY = 'ledger-hide-amounts';

/** @type {Array<(masked: boolean) => void>} */
const listeners = [];

/** Safe localStorage read — see theme.js for why this can throw. */
function safeGet(key) {
  try {
    return localStorage.getItem(key);
  } catch (err) {
    return null;
  }
}

/** Safe localStorage write. */
function safeSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (err) {
    // Intentionally swallowed — a failed write should never crash the app.
  }
}

let masked = safeGet(STORAGE_KEY) === '1';

/**
 * @returns {boolean} true if amounts should currently render masked
 */
export function isPrivacyMode() {
  return masked;
}

/**
 * Flips privacy mode, persists it, and notifies every subscriber.
 */
export function togglePrivacyMode() {
  masked = !masked;
  safeSet(STORAGE_KEY, masked ? '1' : '0');
  listeners.forEach((fn) => fn(masked));
}

/**
 * @param {(masked: boolean) => void} fn
 * @returns {() => void} unsubscribe function
 */
export function subscribePrivacy(fn) {
  listeners.push(fn);
  return () => {
    const idx = listeners.indexOf(fn);
    if (idx >= 0) listeners.splice(idx, 1);
  };
}
