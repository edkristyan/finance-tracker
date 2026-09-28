import { liquidBalance, accountBalance, accountType, accountLiquidity, toBaseCurrency } from './accountsService.js';
import { mp2Total, investmentsTotal } from './investmentsService.js';
import { unpaidTotal, monthKey } from './routinesService.js';

/**
 * @param {Object} data
 * @param {number} year
 * @returns {{income: number[], expense: number[]}} 12 entries each, Jan first
 */
export function monthlyIncomeExpense(data, year) {
  const income = new Array(12).fill(0);
  const expense = new Array(12).fill(0);
  data.transactions.forEach((t) => {
    if (parseInt(t.date.slice(0, 4), 10) !== year) return;
    const m = parseInt(t.date.slice(5, 7), 10) - 1;
    if (t.type === 'Expense') expense[m] += t.amount;
    else if (t.type === 'Income' || t.type === 'Received') income[m] += t.amount;
  });
  return { income, expense };
}

/**
 * Expense total per category for one calendar month, splitting split
 * transactions across their sub-categories.
 * @param {Object} data
 * @param {string} mk - "YYYY-MM"
 * @returns {Object<string, number>}
 */
export function expenseByCategory(data, mk) {
  const totals = {};
  data.transactions.forEach((t) => {
    if (t.type !== 'Expense' || !t.date.startsWith(mk)) return;
    if (t.splits && t.splits.length) {
      t.splits.forEach((s) => {
        totals[s.category] = (totals[s.category] || 0) + s.amount;
      });
    } else {
      const cat = t.category || 'Others';
      totals[cat] = (totals[cat] || 0) + t.amount;
    }
  });
  return totals;
}

/**
 * Income total per category for one calendar month (used as the Sankey's
 * income-side flows).
 * @param {Object} data
 * @param {string} mk
 * @returns {Object<string, number>}
 */
export function incomeByCategory(data, mk) {
  const totals = {};
  data.transactions.forEach((t) => {
    if ((t.type !== 'Income' && t.type !== 'Received') || !t.date.startsWith(mk)) return;
    const cat = t.category || t.type;
    totals[cat] = (totals[cat] || 0) + t.amount;
  });
  return totals;
}

/**
 * Projects the lowest balance the person is likely to see before the next
 * calendar month starts, by subtracting every routine not yet checked off
 * this month from the current liquid total. A simple, conservative estimate
 * (not a day-by-day simulation) — it answers "if I pay everything still
 * outstanding this month, what am I left with?"
 * @param {Object} data
 * @returns {{today: number, projected: number, unpaid: number, mk: string}}
 */
export function cashFlowForecast(data) {
  const mk = monthKey();
  const today = liquidBalance(data);
  const unpaid = unpaidTotal(data, mk);
  return { today, projected: today - unpaid, unpaid, mk };
}

/**
 * Every non-archived account's current balance, base-currency-converted,
 * sorted largest first — for the Dashboard's "Account balances" list.
 * @param {Object} data
 * @returns {Array<{id: string, name: string, balance: number, isCredit: boolean}>}
 */
export function accountBalancesList(data) {
  return data.accounts
    .filter((a) => !a.archived)
    .map((a) => ({
      id: a.id,
      name: a.name,
      balance: toBaseCurrency(a, accountBalance(data, a.id)),
      isCredit: accountType(a) === 'Liability',
    }))
    .sort((a, b) => b.balance - a.balance);
}

/**
 * Splits net worth into liquid vs illiquid. Liquid/illiquid-tagged accounts
 * (credit cards excluded, since they're a liability, not an asset) split by
 * their own tag; MP2 and market-fund holdings are always counted illiquid,
 * since both are inherently locked-in investment vehicles rather than
 * something you'd tag per-fund.
 * @param {Object} data
 * @returns {{liquid: number, illiquid: number, total: number, liquidPct: number, illiquidPct: number}}
 */
export function liquidityBreakdown(data) {
  let liquid = 0;
  let illiquid = 0;
  data.accounts.forEach((a) => {
    if (a.archived || accountType(a) === 'Liability') return;
    const bal = toBaseCurrency(a, accountBalance(data, a.id));
    if (accountLiquidity(a) === 'liquid') liquid += bal;
    else illiquid += bal;
  });
  illiquid += mp2Total(data) + investmentsTotal(data);
  const total = liquid + illiquid;
  return { liquid, illiquid, total, liquidPct: total ? liquid / total : 0, illiquidPct: total ? illiquid / total : 0 };
}

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Liquid balance as of the end of each month in a given year — for viewing
 * a past year's balance trend (current year stops at the current month,
 * since later months have no transactions yet to compute from).
 * @param {Object} data
 * @param {number} year
 * @returns {Array<{label: string, value: number}>} up to 12 points, Jan first
 */
export function monthEndBalanceSeries(data, year) {
  const now = new Date();
  const isCurrentYear = year === now.getFullYear();
  const lastMonth = isCurrentYear ? now.getMonth() : 11;
  const points = [];
  for (let m = 0; m <= lastMonth; m += 1) {
    const lastDay = new Date(year, m + 1, 0).getDate();
    const asOf = `${year}-${String(m + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    points.push({ label: MONTH_ABBR[m], value: liquidBalance(data, asOf) });
  }
  return points;
}

/**
 * Budget vs actual for every category that has a budget set, for one month.
 * @param {Object} data
 * @param {string} mk
 * @returns {Array<{category: string, budget: number, spent: number, pct: number}>}
 */
export function budgetProgress(data, mk) {
  const spendByCat = expenseByCategory(data, mk);
  return data.budgets
    .filter((b) => b.amount > 0)
    .map((b) => {
      const spent = spendByCat[b.category] || 0;
      return { category: b.category, budget: b.amount, spent, pct: spent / b.amount };
    })
    .sort((a, b) => b.pct - a.pct);
}
