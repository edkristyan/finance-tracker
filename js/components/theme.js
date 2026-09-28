/**
 * Theme handling — a manual dark/light override that sits on top of the
 * OS-level `prefers-color-scheme` media query (see css/tokens.css). Needed
 * because the user works a graveyard schedule and wants control independent
 * of whatever their OS happens to be set to.
 */

const STORAGE_KEY = 'ledger-theme';

/**
 * Reads localStorage safely — Safari private mode and some locked-down
 * environments throw on access rather than just returning null.
 * @param {string} key
 * @returns {string|null}
 */
function safeGet(key) {
  try {
    return localStorage.getItem(key);
  } catch (err) {
    return null;
  }
}

/**
 * Writes localStorage safely; a failed write (e.g. storage full or blocked)
 * should never crash the app, just silently not persist the preference.
 * @param {string} key
 * @param {string} value
 */
function safeSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (err) {
    // Intentionally swallowed — see safeGet's docstring above.
  }
}

/**
 * Applies whatever theme was last persisted, if any. Call once on startup
 * before first paint-relevant work so there's no flash of the wrong theme.
 */
export function applyStoredTheme() {
  const stored = safeGet(STORAGE_KEY);
  if (stored === 'dark' || stored === 'light') {
    document.documentElement.setAttribute('data-theme', stored);
  }
}

/**
 * Flips between light and dark, persists the choice, and applies it
 * immediately to the document root.
 */
export function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  safeSet(STORAGE_KEY, next);
}
