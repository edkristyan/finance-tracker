/**
 * reportsService.js — read-only aggregations for the Reports/Analytics tab:
 * a year-over-year comparison and an automated "Year in Review" summary.
 * Everything here derives from data other views already maintain
 * (transactions, budgets, loans, goals) — Reports adds no collection of its
 * own and no CRUD, only ways of looking at what's already there.
 */
import { monthlyIncomeExpense, expenseByCategory, incomeByCategory } from './dashboardService.js';
import { years as txYears, extractTags } from './transactionsService.js';
import { totalOutstandingAcrossLoans } from './loansService.js';
import { goalsTotals, isGoalReached } from './goalsService.js';
import { fmtDate } from '../utils/format.js';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Every month key ("YYYY-MM") within a calendar year that has at least one
 * transaction, used to build the category totals for a full year.
 * @param {Object} data
 * @param {number} year
 * @returns {Array<string>}
 */
function monthKeysInYear(year) {
  return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
}

/**
 * Full-year expense/income totals per category, by summing every month's
 * breakdown (expenseByCategory/incomeByCategory are already per-month, so
 * this reuses them rather than re-deriving category totals a second way).
 * @param {Object} data
 * @param {number} year
 * @returns {{expense: Object<string, number>, income: Object<string, number>}}
 */
function yearCategoryTotals(data, year) {
  const expense = {};
  const income = {};
  monthKeysInYear(year).forEach((mk) => {
    const e = expenseByCategory(data, mk);
    Object.entries(e).forEach(([cat, amt]) => {
      expense[cat] = (expense[cat] || 0) + amt;
    });
    const inc = incomeByCategory(data, mk);
    Object.entries(inc).forEach(([cat, amt]) => {
      income[cat] = (income[cat] || 0) + amt;
    });
  });
  return { expense, income };
}

/**
 * One year's headline numbers: totals, savings rate, and top categories.
 * @param {Object} data
 * @param {number} year
 * @returns {Object}
 */
export function yearSummary(data, year) {
  const { income, expense } = monthlyIncomeExpense(data, year);
  const totalIncome = income.reduce((s, v) => s + v, 0);
  const totalExpense = expense.reduce((s, v) => s + v, 0);
  const net = totalIncome - totalExpense;
  const savingsRate = totalIncome > 0 ? net / totalIncome : 0;
  const { expense: expenseByCat, income: incomeByCat } = yearCategoryTotals(data, year);
  const topExpenseCategories = Object.entries(expenseByCat)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([category, amount]) => ({ category, amount }));
  const topIncomeCategories = Object.entries(incomeByCat)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([category, amount]) => ({ category, amount }));

  const txCount = data.transactions.filter((t) => parseInt(t.date.slice(0, 4), 10) === year).length;

  // Busiest month by transaction count, and single biggest expense — the
  // kind of "huh, didn't realize that" details a year-in-review calls out.
  const txThisYear = data.transactions.filter((t) => parseInt(t.date.slice(0, 4), 10) === year);
  const byMonthCount = new Array(12).fill(0);
  txThisYear.forEach((t) => {
    byMonthCount[parseInt(t.date.slice(5, 7), 10) - 1] += 1;
  });
  const busiestMonthIdx = byMonthCount.reduce((best, v, i) => (v > byMonthCount[best] ? i : best), 0);
  const biggestExpense = txThisYear
    .filter((t) => t.type === 'Expense')
    .sort((a, b) => b.amount - a.amount)[0];

  const tagTotals = {};
  txThisYear
    .filter((t) => t.type === 'Expense')
    .forEach((t) => {
      extractTags(t.details).forEach((tag) => {
        tagTotals[tag] = (tagTotals[tag] || 0) + t.amount;
      });
    });
  const topTag = Object.entries(tagTotals).sort((a, b) => b[1] - a[1])[0];

  return {
    year,
    income,
    expense,
    totalIncome,
    totalExpense,
    net,
    savingsRate,
    topExpenseCategories,
    topIncomeCategories,
    transactionCount: txCount,
    busiestMonth: txCount ? MONTH_NAMES[busiestMonthIdx] : null,
    biggestExpense: biggestExpense || null,
    topTag: topTag ? { tag: topTag[0], amount: topTag[1] } : null,
  };
}

/**
 * @param {Object} data
 * @returns {Array<number>} every year that has at least one transaction, plus the current year, ascending
 */
export function availableYears(data) {
  return txYears(data);
}

/**
 * Year-over-year rows for a set of years, newest first, each with its own
 * yearSummary() plus the percent change from the prior year in the list
 * (null for the oldest row, since there's nothing before it to compare to).
 * @param {Object} data
 * @param {Array<number>} years - ascending
 * @returns {Array<Object>}
 */
export function yearOverYearRows(data, years) {
  const sorted = [...years].sort((a, b) => a - b);
  const rows = sorted.map((y) => yearSummary(data, y));
  return rows.map((row, i) => {
    const prev = i > 0 ? rows[i - 1] : null;
    return {
      ...row,
      incomeChangePct: prev && prev.totalIncome ? (row.totalIncome - prev.totalIncome) / prev.totalIncome : null,
      expenseChangePct: prev && prev.totalExpense ? (row.totalExpense - prev.totalExpense) / prev.totalExpense : null,
      netChangePct: prev && prev.net ? (row.net - prev.net) / Math.abs(prev.net) : null,
    };
  });
}

/**
 * Builds the plain-language "Year in Review" summary paragraphs for one
 * year, using only what's already been computed elsewhere (yearSummary,
 * loan/goal totals) — no separate data source of its own.
 * @param {Object} data
 * @param {number} year
 * @returns {Array<string>} one string per paragraph
 */
export function yearInReview(data, year) {
  const s = yearSummary(data, year);
  const paras = [];

  if (!s.transactionCount) {
    return [`No transactions were logged in ${year} yet — come back once the year has some activity to review.`];
  }

  paras.push(
    `In ${year}, you logged ${s.transactionCount} transaction${s.transactionCount === 1 ? '' : 's'}, bringing in ${peso0(s.totalIncome)} and spending ${peso0(s.totalExpense)} — a net ${s.net >= 0 ? 'surplus' : 'shortfall'} of ${peso0(Math.abs(s.net))}${s.totalIncome > 0 ? ` (a ${(s.savingsRate * 100).toFixed(1)}% savings rate)` : ''}.`
  );

  if (s.topExpenseCategories.length) {
    const top = s.topExpenseCategories[0];
    paras.push(
      `Your biggest expense category was ${top.category} at ${peso0(top.amount)}${s.topExpenseCategories[1] ? `, followed by ${s.topExpenseCategories[1].category} (${peso0(s.topExpenseCategories[1].amount)})` : ''}.`
    );
  }

  if (s.busiestMonth) {
    paras.push(`${s.busiestMonth} was your busiest month for transactions.`);
  }

  if (s.biggestExpense) {
    paras.push(
      `The single largest expense was ${peso0(s.biggestExpense.amount)} on ${fmtDate(s.biggestExpense.date)}${s.biggestExpense.category ? ` (${s.biggestExpense.category})` : ''}.`
    );
  }

  if (s.topTag) {
    paras.push(`Your most expensive #tag was #${s.topTag.tag}, totaling ${peso0(s.topTag.amount)}.`);
  }

  const outstandingLoans = totalOutstandingAcrossLoans(data);
  if (outstandingLoans > 0) {
    paras.push(`As of today, you still owe ${peso0(outstandingLoans)} across your active loans.`);
  }

  const goals = goalsTotals(data);
  const reachedCount = data.goals.filter((g) => !g.archived && isGoalReached(data, g)).length;
  if (data.goals.length) {
    paras.push(
      `Your savings goals are ${goals.target ? `${((goals.progress / goals.target) * 100).toFixed(1)}% funded overall` : 'set up'}${reachedCount ? `, with ${reachedCount} goal${reachedCount === 1 ? '' : 's'} fully reached` : ''}.`
    );
  }

  return paras;
}

/**
 * Formats a number as whole-peso currency (no centavos) for narrative text,
 * where "₱45,230.00" reads clunkier than "₱45,230".
 * @param {number} n
 * @returns {string}
 */
function peso0(n) {
  const sign = n < 0 ? '-' : '';
  return `${sign}₱${Math.round(Math.abs(n || 0)).toLocaleString('en-PH')}`;
}
