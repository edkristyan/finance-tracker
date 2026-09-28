import { txDelta } from '../utils/transactionMath.js';

/** Account type -> display label. */
export const ACCOUNT_TYPES = {
  bank: 'Bank',
  savings: 'Savings',
  ewallet: 'E-wallet',
  credit: 'Credit card',
};

/**
 * Coarse double-entry classification derived from an account's granular
 * `type`, rather than replacing that field — credit cards are the only
 * liability; everything else is an asset.
 * @param {Object} account
 * @returns {'Asset'|'Liability'}
 */
export function accountType(account) {
  return account.type === 'credit' ? 'Liability' : 'Asset';
}

/**
 * @param {Object} account
 * @returns {'liquid'|'illiquid'}
 */
export function accountLiquidity(account) {
  return account.liquidity || 'liquid';
}

/**
 * Converts a native-currency amount on this account into the app's base
 * currency (PHP), using the account's own fxRate (units of PHP per 1 unit
 * of the account's currency). Accounts with no currency set, or set to
 * 'PHP', pass through unchanged.
 * @param {Object} account
 * @param {number} amount
 * @returns {number}
 */
export function toBaseCurrency(account, amount) {
  if (!account.currency || account.currency === 'PHP') return amount;
  return amount * (account.fxRate || 1);
}

/**
 * Running balance for one account: opening balance plus every transaction's
 * effect on it, optionally only counting transactions up to a given date.
 * In the account's own (native) currency — see toBaseCurrency for rollups.
 * @param {Object} data - the store's data object
 * @param {string} accountId
 * @param {string} [asOfISO] - inclusive cutoff date (YYYY-MM-DD)
 * @returns {number}
 */
export function accountBalance(data, accountId, asOfISO) {
  const acc = data.accounts.find((a) => a.id === accountId);
  if (!acc) return 0;
  let bal = acc.openingBalance || 0;
  for (const t of data.transactions) {
    if (asOfISO && t.date > asOfISO) continue;
    bal += txDelta(t, accountId);
  }
  return bal;
}

/**
 * Same as accountBalance, but only counting transactions marked cleared
 * (a transaction with no `cleared` field is treated as cleared by default —
 * only explicit `cleared: false` marks it pending). Meant to be compared
 * against a bank statement; will equal accountBalance until some
 * transactions are actually marked pending in the Transactions view.
 * @param {Object} data
 * @param {string} accountId
 * @param {string} [asOfISO]
 * @returns {number}
 */
export function accountClearedBalance(data, accountId, asOfISO) {
  const acc = data.accounts.find((a) => a.id === accountId);
  if (!acc) return 0;
  let bal = acc.openingBalance || 0;
  for (const t of data.transactions) {
    if (asOfISO && t.date > asOfISO) continue;
    if (t.cleared === false) continue;
    bal += txDelta(t, accountId);
  }
  return bal;
}

/**
 * Sum of every non-archived account's balance, converted to base currency
 * (PHP) so multi-currency accounts roll up correctly.
 * @param {Object} data
 * @param {boolean} [excludeCredit] - if true, skip liability (credit card) accounts
 * @returns {number}
 */
export function totalBalance(data, excludeCredit) {
  return data.accounts
    .filter((a) => !a.archived && (!excludeCredit || accountType(a) !== 'Liability'))
    .reduce((sum, a) => sum + toBaseCurrency(a, accountBalance(data, a.id)), 0);
}

/**
 * Sum of every non-archived, non-credit account tagged "liquid" — the
 * actually-spendable total, as opposed to totalBalance()'s broader "every
 * asset account" figure. Used for the Dashboard's cash-flow-relevant KPIs.
 * @param {Object} data
 * @returns {number}
 */
export function liquidBalance(data, asOfISO) {
  return data.accounts
    .filter((a) => !a.archived && accountType(a) !== 'Liability' && accountLiquidity(a) === 'liquid')
    .reduce((sum, a) => sum + toBaseCurrency(a, accountBalance(data, a.id, asOfISO)), 0);
}

/**
 * Total amount currently owed across all credit card accounts, in base currency.
 * @param {Object} data
 * @param {string} [asOfISO]
 * @returns {number}
 */
export function creditOwed(data, asOfISO) {
  return data.accounts
    .filter((a) => accountType(a) === 'Liability')
    .reduce((sum, a) => sum + Math.max(0, toBaseCurrency(a, -accountBalance(data, a.id, asOfISO))), 0);
}

/**
 * Most recent Savings/Received activity on an account, or null.
 * @param {Object} data
 * @param {string} accountId
 * @returns {Object|null}
 */
export function savingsLastActivity(data, accountId) {
  return (
    data.transactions
      .filter(
        (t) =>
          (t.account === accountId || t.toAccount === accountId) &&
          (t.type === 'Savings' || t.type === 'Received')
      )
      .sort((a, b) => (a.date < b.date ? 1 : -1))[0] || null
  );
}
