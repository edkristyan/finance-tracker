/**
 * transactionMath.js — pure helpers for reading a transaction's effect on
 * account balances. Lives outside accountsService because Transactions
 * (Phase 5) will need the exact same logic to compute its own totals; having
 * one shared source avoids two copies drifting apart (DRY).
 */

/**
 * True if a transaction is a plain outgoing expense (not a transfer).
 * @param {Object} t
 * @returns {boolean}
 */
export function isExpenseLike(t) {
  return !t.toAccount && t.direction === 'out' && t.type === 'Expense';
}

/**
 * True if a transaction is a plain incoming income/received (not a transfer).
 * @param {Object} t
 * @returns {boolean}
 */
export function isIncomeLike(t) {
  return !t.toAccount && t.direction === 'in' && (t.type === 'Income' || t.type === 'Received');
}

/**
 * The signed effect of one transaction on one account's balance.
 * @param {Object} t
 * @param {string} accountId
 * @returns {number}
 */
export function txDelta(t, accountId) {
  let d = 0;
  if (t.account === accountId) {
    if (t.toAccount) d -= t.amount;
    else d += t.direction === 'in' ? t.amount : -t.amount;
  }
  if (t.toAccount === accountId) d += t.amount;
  return d;
}
