/**
 * sanitize.js — defense against stored XSS.
 *
 * Nothing in the original app escaped free-text fields (transaction notes,
 * category names, custom account names, etc.) before writing them to
 * IndexedDB, and several render functions build markup via template strings
 * and `innerHTML`. A note like `<img src=x onerror=alert(1)>` would sit in
 * storage and execute the next time that record renders. This module is the
 * single choke point every write goes through, so no view has to remember
 * to escape anything itself.
 */

const HTML_ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Escapes HTML-significant characters in a single string.
 * @param {string} value
 * @returns {string}
 */
export function sanitizeText(value) {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

/**
 * Returns a shallow copy of a record with every top-level string value
 * passed through sanitizeText. Non-string values (numbers, booleans,
 * nested objects/arrays) pass through unchanged — the app's records are
 * flat by design, so this covers every free-text field without needing a
 * deep recursive walk that could accidentally mangle numeric/date data.
 * @param {Object} record
 * @returns {Object}
 */
export function sanitizeRecord(record) {
  const clean = { ...record };
  for (const key of Object.keys(clean)) {
    if (typeof clean[key] === 'string') {
      clean[key] = sanitizeText(clean[key]);
    }
  }
  return clean;
}
