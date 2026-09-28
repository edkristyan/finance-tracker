/**
 * sampleData.js — generates a realistic, fully-populated dataset for manual
 * QA. Not shipped as the default seed (new users still start empty); it's
 * offered as an explicit "Load sample data" action so the person (or a
 * future session) can click through every tab — Accounts, Transactions,
 * Investments, Loans, Goals, Reports, Dashboard — against believable numbers
 * instead of an empty ledger, without having to hand-enter dozens of rows
 * first. Spans two calendar years so year-over-year and multi-year charts
 * have something to compare.
 *
 * Every id is generated the same way the app itself generates ids
 * (newId from utils/id.js), so records here are indistinguishable from
 * ones a person entered by hand.
 */
import { newId } from '../utils/id.js';

const CATEGORIES = [
  { id: 'cat_0', name: 'Food & Groceries' },
  { id: 'cat_1', name: 'Transportation' },
  { id: 'cat_2', name: 'Utilities' },
  { id: 'cat_3', name: 'Subscription' },
  { id: 'cat_4', name: 'Shopping' },
  { id: 'cat_5', name: 'Health' },
  { id: 'cat_6', name: 'Insurance' },
  { id: 'cat_7', name: 'Credit Card Payment' },
  { id: 'cat_8', name: 'Loan Payment' },
  { id: 'cat_9', name: 'Bank Fees' },
  { id: 'cat_10', name: 'Savings' },
  { id: 'cat_11', name: 'Withdraw' },
  { id: 'cat_12', name: 'Investments' },
  { id: 'cat_13', name: 'Salary' },
  { id: 'cat_14', name: 'Received' },
  { id: 'cat_15', name: 'Gift' },
  { id: 'cat_16', name: 'Others' },
];

/** @returns {string} "YYYY-MM-DD" for the given y/m(1-based)/d */
function iso(y, m, d) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Every (year, month) pair from a start month through today (inclusive),
 * so the sample data always reaches "now" instead of going stale.
 * @returns {Array<{y:number, m:number}>}
 */
function monthRange(startY, startM) {
  const out = [];
  const now = new Date();
  let y = startY;
  let m = startM;
  while (y < now.getFullYear() || (y === now.getFullYear() && m <= now.getMonth() + 1)) {
    out.push({ y, m });
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

/**
 * Builds a complete, self-consistent sample dataset. Pure function — takes
 * no arguments, has no side effects, and is safe to call from a Node script
 * (for automated verification) as well as from the browser UI.
 * @returns {Object} a full data object matching the app's schema
 */
export function buildSampleData() {
  const accounts = [];
  const transactions = [];
  const mp2Funds = [];
  const mp2Contrib = [];
  const mp2Yearly = [];
  const holdings = [];
  const lots = [];
  const routines = [];
  const budgets = [];
  const loans = [];
  const loanPayments = [];
  const goals = [];
  const goalContributions = [];

  // ---------- Accounts ----------
  const bpi = { id: newId('acct'), name: 'BPI Savings', type: 'bank', liquidity: 'liquid', openingBalance: 42000, currency: 'PHP', fxRate: 1, order: 1 };
  const gotyme = { id: newId('acct'), name: 'GoTyme', type: 'bank', liquidity: 'liquid', openingBalance: 8000, currency: 'PHP', fxRate: 1, order: 2 };
  const maya = { id: newId('acct'), name: 'Maya Wallet', type: 'ewallet', liquidity: 'liquid', openingBalance: 2500, currency: 'PHP', fxRate: 1, order: 3 };
  const emergencyFund = { id: newId('acct'), name: 'Emergency Fund', type: 'savings', liquidity: 'illiquid', openingBalance: 0, currency: 'PHP', fxRate: 1, order: 4 };
  const creditCard = { id: newId('acct'), name: 'BPI Free+', type: 'credit', liquidity: 'liquid', openingBalance: 0, currency: 'PHP', fxRate: 1, order: 5 };
  accounts.push(bpi, gotyme, maya, emergencyFund, creditCard);

  const months = monthRange(2025, 1);

  // ---------- Transactions ----------
  months.forEach(({ y, m }, i) => {
    // Salary, 25th of each month.
    transactions.push({
      id: newId('tx'),
      date: iso(y, m, 25),
      type: 'Income',
      direction: 'in',
      account: bpi.id,
      category: 'Salary',
      details: 'Monthly salary',
      amount: 42000,
      createdAt: new Date(iso(y, m, 25)).toISOString(),
    });

    // Rent-adjacent routine payments, logged as expenses too (routines below
    // are the separate manual checklist — these are the actual ledger entries).
    transactions.push({
      id: newId('tx'),
      date: iso(y, m, 3),
      type: 'Expense',
      direction: 'out',
      account: bpi.id,
      category: 'Utilities',
      details: 'Meralco + water #householdbills',
      amount: 2450 + (i % 3) * 120,
      createdAt: new Date(iso(y, m, 3)).toISOString(),
    });
    transactions.push({
      id: newId('tx'),
      date: iso(y, m, 5),
      type: 'Expense',
      direction: 'out',
      account: gotyme.id,
      category: 'Subscription',
      details: 'Netflix + Spotify #subscriptions',
      amount: 549,
      createdAt: new Date(iso(y, m, 5)).toISOString(),
    });

    // A split transaction: one grocery run covering both groceries and
    // household shopping, exercising the Split Transactions feature.
    transactions.push({
      id: newId('tx'),
      date: iso(y, m, 10),
      type: 'Expense',
      direction: 'out',
      account: maya.id,
      details: 'SM Supermarket run #groceries',
      amount: 3200,
      splits: [
        { category: 'Food & Groceries', amount: 2100 },
        { category: 'Shopping', amount: 1100 },
      ],
      createdAt: new Date(iso(y, m, 10)).toISOString(),
    });

    // A couple more plain groceries/transport expenses through the month.
    transactions.push({
      id: newId('tx'),
      date: iso(y, m, 17),
      type: 'Expense',
      direction: 'out',
      account: maya.id,
      category: 'Food & Groceries',
      details: 'Weekly groceries #groceries',
      amount: 1450,
      createdAt: new Date(iso(y, m, 17)).toISOString(),
    });
    transactions.push({
      id: newId('tx'),
      date: iso(y, m, 20),
      type: 'Expense',
      direction: 'out',
      account: gotyme.id,
      category: 'Transportation',
      details: 'Grab + fuel',
      amount: 900 + (i % 4) * 50,
      cleared: i < months.length - 1, // most recent month left pending, for reconciliation testing
      createdAt: new Date(iso(y, m, 20)).toISOString(),
    });

    // Transfer into the Emergency Fund account — feeds the linked-mode goal.
    transactions.push({
      id: newId('tx'),
      date: iso(y, m, 26),
      type: 'Transfer',
      account: bpi.id,
      toAccount: emergencyFund.id,
      category: 'Transfer',
      details: 'Emergency fund top-up',
      amount: 2000,
      createdAt: new Date(iso(y, m, 26)).toISOString(),
    });

    // Occasional gift/received income (every 4th month) and a bank fee
    // (every 5th month), so Reports has more than one income/expense category.
    if (i % 4 === 0) {
      transactions.push({
        id: newId('tx'),
        date: iso(y, m, 14),
        type: 'Received',
        direction: 'in',
        account: maya.id,
        category: 'Gift',
        details: 'Birthday gift #family',
        amount: 1500,
        createdAt: new Date(iso(y, m, 14)).toISOString(),
      });
    }
    if (i % 5 === 0) {
      transactions.push({
        id: newId('tx'),
        date: iso(y, m, 28),
        type: 'Expense',
        direction: 'out',
        account: bpi.id,
        category: 'Bank Fees',
        details: 'Maintaining balance fee',
        amount: 150,
        createdAt: new Date(iso(y, m, 28)).toISOString(),
      });
    }

    // One larger, single "biggest expense" candidate near the middle of the
    // series, so Reports' biggestExpense has an interesting answer.
    if (i === Math.floor(months.length / 2)) {
      transactions.push({
        id: newId('tx'),
        date: iso(y, m, 8),
        type: 'Expense',
        direction: 'out',
        account: bpi.id,
        category: 'Health',
        details: 'Annual health checkup #health',
        amount: 9800,
        createdAt: new Date(iso(y, m, 8)).toISOString(),
      });
    }
  });

  // ---------- Routines ----------
  const paidRecentMonths = months.slice(-3).map(({ y, m }) => `${y}-${String(m).padStart(2, '0')}`);
  routines.push(
    { id: newId('rtn'), name: 'Rent', expectedAmount: 8000, group: 'Housing', paidMonths: paidRecentMonths.slice(0, 2) },
    { id: newId('rtn'), name: 'Meralco', expectedAmount: 2500, group: 'Housing', paidMonths: paidRecentMonths },
    { id: newId('rtn'), name: 'Internet', expectedAmount: 1500, group: 'Housing', paidMonths: [] }
  );

  // ---------- Budgets ----------
  budgets.push(
    { id: 'Food & Groceries', category: 'Food & Groceries', amount: 8000 },
    { id: 'Shopping', category: 'Shopping', amount: 5000 },
    { id: 'Subscription', category: 'Subscription', amount: 1000 }
  );

  // ---------- Investments: MP2 ----------
  const mp2House = { id: newId('mp2'), name: 'MP2 House Fund' };
  const mp2Personal = { id: newId('mp2'), name: 'MP2 Personal Plan' };
  mp2Funds.push(mp2House, mp2Personal);
  months.forEach(({ y, m }) => {
    mp2Contrib.push({ id: newId('mp2c'), fund: mp2House.id, year: y, month: m, amount: 500 });
    mp2Contrib.push({ id: newId('mp2c'), fund: mp2Personal.id, year: y, month: m, amount: 500 });
  });
  mp2Yearly.push(
    { id: newId('mp2y'), fund: mp2House.id, year: 2025, dividend: 720 },
    { id: newId('mp2y'), fund: mp2Personal.id, year: 2025, dividend: 655 }
  );

  // ---------- Investments: market fund holding ----------
  holdings.push({
    id: 'BPIABFPH',
    ticker: 'BPIABFPH',
    name: 'BPI ABF Philippines Fund',
    platform: 'BPI Investment',
    security: 'Mutual Fund',
    lastPrice: 1.42,
    currency: 'PHP',
    fxRate: 1,
  });
  lots.push(
    { id: newId('lot'), ticker: 'BPIABFPH', date: '2025-02-15', type: 'Buy', qty: 5000, price: 1.2, totalCost: 6000, notes: 'Initial lot' },
    { id: newId('lot'), ticker: 'BPIABFPH', date: '2025-08-10', type: 'Buy', qty: 3000, price: 1.3, totalCost: 3900, notes: '' },
    { id: newId('lot'), ticker: 'BPIABFPH', date: '2026-03-01', type: 'Dividend', qty: 0, price: 210, totalCost: 210, notes: 'Annual payout' },
    { id: newId('lot'), ticker: 'BPIABFPH', date: '2026-06-05', type: 'Sell', qty: 1000, price: 1.4, totalCost: 1400, notes: 'Partial sale' }
  );

  // ---------- Loans ----------
  // Loan A: active, ~20 months into a 36-month car loan, still has payments left.
  const carLoan = {
    id: newId('loan'),
    name: 'Car Loan — Toyota Vios',
    principal: 300000,
    annualRatePct: 8,
    termMonths: 36,
    startDate: '2025-01-01',
    paymentAccount: bpi.id,
    notes: '',
    archived: false,
  };
  loans.push(carLoan);
  {
    // Replay real payments against the loan's own split logic so the seed
    // data is internally consistent (outstanding balance, interest/principal
    // split) rather than hand-typed numbers that could silently drift from
    // what loansService.js itself would compute.
    const r = carLoan.annualRatePct / 100 / 12;
    const n = carLoan.termMonths;
    const pmt = Math.round(((carLoan.principal * r) / (1 - Math.pow(1 + r, -n))) * 100) / 100;
    let outstanding = carLoan.principal;
    const paymentMonths = months.slice(0, Math.min(months.length, 20));
    paymentMonths.forEach(({ y, m }) => {
      const interestPortion = Math.round(Math.min(pmt, outstanding * r) * 100) / 100;
      const principalPortion = Math.round(Math.min(outstanding, Math.max(0, pmt - interestPortion)) * 100) / 100;
      outstanding = Math.round(Math.max(0, outstanding - principalPortion) * 100) / 100;
      loanPayments.push({
        id: newId('lp'),
        loanId: carLoan.id,
        date: iso(y, m, 15),
        amount: Math.round((interestPortion + principalPortion) * 100) / 100,
        principalPortion,
        interestPortion,
        account: bpi.id,
        note: '',
      });
    });
  }

  // Loan B: fully paid off, small 0%-interest loan — exercises the 0% path
  // and the "archived, can't delete because it has payments" guard.
  const phoneLoan = {
    id: newId('loan'),
    name: 'Phone Loan (0% installment)',
    principal: 20000,
    annualRatePct: 0,
    termMonths: 10,
    startDate: '2024-06-01',
    paymentAccount: gotyme.id,
    notes: 'Paid off early',
    archived: true,
  };
  loans.push(phoneLoan);
  for (let i = 0; i < 10; i++) {
    loanPayments.push({
      id: newId('lp'),
      loanId: phoneLoan.id,
      date: iso(2024, 6 + i > 12 ? 6 + i - 12 : 6 + i, 1),
      amount: 2000,
      principalPortion: 2000,
      interestPortion: 0,
      account: gotyme.id,
      note: '',
    });
  }

  // ---------- Goals ----------
  // Linked-mode: tied to the Emergency Fund account itself.
  goals.push({
    id: newId('goal'),
    name: 'Emergency Fund (3 months expenses)',
    targetAmount: 100000,
    targetDate: iso(new Date().getFullYear() + 1, 12, 31),
    linkedAccount: emergencyFund.id,
    notes: 'Linked to the Emergency Fund account balance',
    archived: false,
  });

  // Manual-mode: in progress, sharing space in a pooled account on paper only.
  const japanGoal = {
    id: newId('goal'),
    name: 'Japan Trip 2026',
    targetAmount: 80000,
    targetDate: '2026-12-01',
    linkedAccount: '',
    notes: 'Sinking fund — money is nominally set aside, not physically separated',
    archived: false,
  };
  goals.push(japanGoal);
  [5000, 5000, 6000, 4000, 5000, 6000, 5000, 4500].forEach((amount, idx) => {
    goalContributions.push({
      id: newId('gc'),
      goalId: japanGoal.id,
      date: iso(2025, 3 + idx, 1),
      amount,
      note: '',
    });
  });

  // Manual-mode: fully reached — exercises the "reached" (0 required/month) path.
  const laptopGoal = {
    id: newId('goal'),
    name: 'New Laptop',
    targetAmount: 60000,
    targetDate: '2025-12-31',
    linkedAccount: '',
    notes: '',
    archived: false,
  };
  goals.push(laptopGoal);
  [20000, 20000, 20000].forEach((amount, idx) => {
    goalContributions.push({
      id: newId('gc'),
      goalId: laptopGoal.id,
      date: iso(2025, 9 + idx, 15),
      amount,
      note: '',
    });
  });

  return {
    accounts,
    transactions,
    mp2Funds,
    mp2Contrib,
    mp2Yearly,
    holdings,
    lots,
    routines,
    budgets,
    loans,
    loanPayments,
    goals,
    goalContributions,
    categories: CATEGORIES,
  };
}
