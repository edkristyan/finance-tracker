import { isExpenseLike, isIncomeLike } from '../utils/transactionMath.js';

// Grouped for how the add-entry Type select reads: money out (Expense),
// money in (Income, Received), then the three "moving money around"
// types (Transfer between own accounts, Savings, Investments) — matches
// how the person's own real ledger data actually uses these six.
export const TX_TYPES = ['Expense', 'Income', 'Received', 'Transfer', 'Savings', 'Investments'];

// Every category in the default seed (see seed.json) gets an icon here, so
// "identify at a glance" holds for the whole list, not just whichever ones
// happened to get one first.
export const CATEGORY_ICONS = {
  'Food & Groceries': '🍽️',
  'Transportation': '🚗',
  'Utilities': '💡',
  'Subscription': '📺',
  'Shopping': '🛒',
  'Health': '💊',
  'Insurance': '🛡️',
  'Credit Card Payment': '💳',
  'Loan Payment': '🏷️',
  'Bank Fees': '🏦',
  'Savings': '💰',
  'Withdraw': '💵',
  'Investments': '📈',
  'Salary': '💵',
  'Received': '📥',
  'Gift': '🎁',
  'Others': '🔖',
  'Transfer': '↔️',
};

/**
 * @param {Object} t
 * @returns {string} a small emoji hinting at the transaction's category/type
 */
export function txIcon(t) {
  if (t.category && CATEGORY_ICONS[t.category]) return CATEGORY_ICONS[t.category];
  if (t.type === 'Transfer') return '↔️';
  return '💳';
}

/**
 * Every year that appears in the data, plus the current year (so a brand
 * new dataset still has something to select).
 * @param {Object} data
 * @returns {Array<number>}
 */
export function years(data) {
  const ys = new Set([new Date().getFullYear()]);
  data.transactions.forEach((t) => ys.add(parseInt(t.date.slice(0, 4), 10)));
  return Array.from(ys).sort();
}

/**
 * @param {Object} data
 * @returns {Array<string>} every distinct category name on record
 */
export function allCategoryNames(data) {
  return data.categories.map((c) => c.name);
}

/**
 * Extracts #hashtags from free text (case-insensitive, stored lowercase so
 * "#JapanTrip2026" and "#japantrip2026" are treated as the same tag).
 * @param {string} text
 * @returns {Array<string>}
 */
export function extractTags(text) {
  if (!text) return [];
  const matches = text.match(/#(\w+)/g) || [];
  return matches.map((m) => m.slice(1).toLowerCase());
}

/**
 * @param {Object} data
 * @returns {Array<string>} every distinct tag used across all transactions' Details, sorted
 */
export function allTags(data) {
  const set = new Set();
  data.transactions.forEach((t) => extractTags(t.details).forEach((tag) => set.add(tag)));
  return Array.from(set).sort();
}

/**
 * Effective category label for display: the single category, or a
 * split-count summary when the transaction was split across several.
 * @param {Object} t
 * @returns {string}
 */
export function categoryLabel(t) {
  if (t.splits && t.splits.length) {
    return t.splits.map((s) => s.category).join(', ');
  }
  return t.category || '';
}

/**
 * Filters and sorts transactions for the list view.
 * @param {Object} data
 * @param {{year:string|number, month:string|number, accounts:Array<string>, type:string, tag:string, sort:string}} filters
 * @returns {Array<Object>}
 */
export function filterTransactions(data, filters) {
  const { year, month, accounts, type, tag, sort } = filters;
  const SORTERS = {
    'date-desc': (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0),
    'date-asc': (a, b) => (a.date > b.date ? 1 : a.date < b.date ? -1 : 0),
    type: (a, b) => a.type.localeCompare(b.type) || (a.date < b.date ? 1 : -1),
    category: (a, b) => categoryLabel(a).localeCompare(categoryLabel(b)) || (a.date < b.date ? 1 : -1),
    recent: (a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''),
  };

  return data.transactions
    .filter((t) => {
      const ty = parseInt(t.date.slice(0, 4), 10);
      if (year !== 'all' && ty !== year) return false;
      if (month !== 'all' && parseInt(t.date.slice(5, 7), 10) !== month) return false;
      if (accounts.length && !accounts.includes(t.account) && !accounts.includes(t.toAccount)) return false;
      if (type !== 'all' && t.type !== type) return false;
      if (tag && tag !== 'all' && !extractTags(t.details).includes(tag)) return false;
      return true;
    })
    .sort(SORTERS[sort] || SORTERS['date-desc']);
}

/**
 * Total cost of a set of rows (all Expense-type transactions among them) —
 * used for the "total cost of #JapanTrip2026" tag-filter summary.
 * @param {Array<Object>} rows
 * @returns {number}
 */
export function expenseTotal(rows) {
  return rows.filter((t) => t.type === 'Expense').reduce((sum, t) => sum + t.amount, 0);
}

export { isExpenseLike, isIncomeLike };
