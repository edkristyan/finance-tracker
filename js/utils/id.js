/**
 * Generates a reasonably-unique id for a new record. Not cryptographically
 * unique — collisions are practically impossible for a single-user, local
 * app, and cryptographic strength isn't needed for a primary key that only
 * ever has to be unique within one person's own dataset.
 * @param {string} prefix - short label for the record type, e.g. "tx", "acct"
 * @returns {string}
 */
export function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
