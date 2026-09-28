// Location note: this lives outside js/ (not part of the shipped app bundle)
// so Vite never tries to bundle a test script into the production build.

// Expanded verification for Loans / Goals / Reports, run against both the
// generated sample dataset (realistic, multi-year) and a set of hand-built
// edge cases the sample data doesn't otherwise exercise. Run with:
//   node verify-phase9-10.mjs
// Exits non-zero (and prints which assertion failed) on any failure, so it
// can be re-run after any future change to these three services.
import { buildSampleData } from '../js/state/sampleData.js';
import {
  monthlyPayment,
  outstandingBalance,
  payoffProgressPct,
  splitPayment,
  amortizationSchedule,
  totalInterestScheduled,
  estimatedPayoffDate,
  totalOutstandingAcrossLoans,
} from '../js/services/loansService.js';
import {
  goalMode,
  goalProgress,
  monthsRemaining,
  requiredMonthlyContribution,
} from '../js/services/goalsService.js';
import {
  yearSummary,
  availableYears,
  yearOverYearRows,
  yearInReview,
} from '../js/services/reportsService.js';
import { suggestedMatch, monthKey, isPaid } from '../js/services/routinesService.js';

let failures = 0;
function check(label, cond) {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`ok:   ${label}`);
  }
}
function approx(a, b, eps = 0.01) {
  return Math.abs(a - b) < eps;
}

const data = buildSampleData();

// ---------- Sanity: sample data itself is internally consistent ----------
check('sample data has >0 transactions', data.transactions.length > 20);
check('sample data has 2 loans', data.loans.length === 2);
check('sample data has 3 goals', data.goals.length === 3);

// ---------- Loans ----------
const carLoan = data.loans.find((l) => l.name.startsWith('Car Loan'));
const phoneLoan = data.loans.find((l) => l.name.startsWith('Phone Loan'));

check('car loan monthly payment is a sane positive number', monthlyPayment(carLoan) > 8000 && monthlyPayment(carLoan) < 10000);
check(
  'car loan outstanding balance decreased from principal after payments',
  outstandingBalance(data, carLoan) < carLoan.principal && outstandingBalance(data, carLoan) > 0
);
check('car loan payoff progress is between 0 and 1', payoffProgressPct(data, carLoan) > 0 && payoffProgressPct(data, carLoan) < 1);
check('car loan amortization schedule ends at ~0 balance', approx(amortizationSchedule(carLoan).slice(-1)[0].balance, 0, 0.02));
check('car loan schedule length equals term months', amortizationSchedule(carLoan).length === carLoan.termMonths);
check('car loan has a positive total scheduled interest', totalInterestScheduled(carLoan) > 0);
check('car loan has an estimated payoff date after its start date', estimatedPayoffDate(carLoan) > carLoan.startDate);

// 0%-interest loan path: every payment should be pure principal, no interest.
check('phone loan (0%) is fully paid off', outstandingBalance(data, phoneLoan) === 0);
check('phone loan (0%) payoff progress is exactly 1 (fully reached)', payoffProgressPct(data, phoneLoan) === 1);
{
  const { interestPortion, principalPortion } = splitPayment(phoneLoan, 2000, 2000);
  check('0% loan payment split has zero interest', interestPortion === 0);
  check('0% loan payment split is all principal', principalPortion === 2000);
}

// Overpayment: paying more than what's owed should cap principal at the
// outstanding balance rather than going negative or over-crediting.
{
  const split = splitPayment(carLoan, 5000, 999999);
  check('overpayment caps principal at outstanding balance', split.principalPortion <= 5000);
  check('overpayment never produces negative interest/principal', split.interestPortion >= 0 && split.principalPortion >= 0);
}

check(
  'totalOutstandingAcrossLoans excludes the archived, paid-off phone loan',
  approx(totalOutstandingAcrossLoans(data), outstandingBalance(data, carLoan))
);

// A brand-new loan (no payments logged yet) should owe exactly its principal.
{
  const freshLoan = { id: 'x', principal: 50000, annualRatePct: 6, termMonths: 24, startDate: '2026-01-01' };
  check('a loan with no payments logged owes its full principal', outstandingBalance(data, freshLoan) === 50000);
  check('a loan with no payments logged has 0% payoff progress', payoffProgressPct(data, freshLoan) === 0);
}

// A 0-term loan (edge case: user hasn't finished the form yet) shouldn't crash.
{
  const blankLoan = { id: 'y', principal: 10000, annualRatePct: 5, termMonths: 0, startDate: '2026-01-01' };
  check('0-term loan monthly payment is 0, not NaN/Infinity', monthlyPayment(blankLoan) === 0);
  check('0-term loan amortization schedule is empty, not a crash', amortizationSchedule(blankLoan).length === 0);
  check('0-term loan estimated payoff date is null', estimatedPayoffDate(blankLoan) === null);
}

// ---------- Goals ----------
const emergencyGoal = data.goals.find((g) => g.name.startsWith('Emergency'));
const japanGoal = data.goals.find((g) => g.name.startsWith('Japan'));
const laptopGoal = data.goals.find((g) => g.name.startsWith('New Laptop'));

check('emergency fund goal is linked mode', goalMode(emergencyGoal) === 'linked');
check('japan trip goal is manual mode', goalMode(japanGoal) === 'manual');
check('linked goal progress tracks the linked account balance, not manual contributions', goalProgress(data, emergencyGoal) > 0);
check(
  'manual goal progress equals sum of its logged contributions',
  approx(
    goalProgress(data, japanGoal),
    data.goalContributions.filter((c) => c.goalId === japanGoal.id).reduce((s, c) => s + c.amount, 0)
  )
);

// Fully-reached manual goal: progress should be capped conceptually at/near
// target, and required-monthly-contribution should be 0 (nothing left to save).
check('fully funded goal has reached its target amount', goalProgress(data, laptopGoal) >= laptopGoal.targetAmount);
check('fully funded goal requires $0/month going forward', requiredMonthlyContribution(data, laptopGoal) === 0);

// Past-due target date should floor months-remaining at 0, not go negative.
check('a target date in the past floors monthsRemaining at 0', monthsRemaining('2020-01-01') === 0);
// A date exactly N months out should read as N (verified against a fixed
// reference rather than "now", so this assertion doesn't drift with the
// clock the way a relative-date check would).
{
  const ref = new Date();
  ref.setMonth(ref.getMonth() + 9);
  const dateStr = ref.toISOString().slice(0, 10);
  check('a date 9 months out reports monthsRemaining === 9', monthsRemaining(dateStr) === 9);
}

// A goal with no target date set at all shouldn't produce a required-monthly figure.
{
  const noDateGoal = { id: 'z', targetAmount: 10000, targetDate: '', linkedAccount: '' };
  check('a goal with no target date has requiredMonthlyContribution === null', requiredMonthlyContribution(data, noDateGoal) === null);
}

// A brand-new manual goal with zero contributions logged should read 0 progress, not crash/NaN.
{
  const emptyGoal = { id: 'w', targetAmount: 5000, targetDate: '2027-01-01', linkedAccount: '' };
  check('a fresh manual goal with no contributions has 0 progress', goalProgress(data, emptyGoal) === 0);
}

// ---------- Reports ----------
const years = availableYears(data);
check('availableYears includes every year that actually has transactions', years.length >= 2);

years.forEach((y) => {
  const s = yearSummary(data, y);
  check(`yearSummary(${y}) income and expense are non-negative`, s.totalIncome >= 0 && s.totalExpense >= 0);
  check(`yearSummary(${y}) net equals income minus expense`, approx(s.net, s.totalIncome - s.totalExpense));
  check(
    `yearSummary(${y}) savingsRate is 0 when income is 0, else a finite ratio`,
    s.totalIncome === 0 ? s.savingsRate === 0 : Number.isFinite(s.savingsRate)
  );
  check(`yearSummary(${y}) narrative paragraphs are non-empty strings`, yearInReview(data, y).every((p) => typeof p === 'string' && p.length > 0));
});

// Year-over-year rows: oldest year has no prior-year comparison (null), every
// later year does, and the rows stay sorted ascending regardless of input order.
{
  const rows = yearOverYearRows(data, [...years].reverse());
  check('yearOverYearRows sorts ascending regardless of input order', rows.every((r, i) => i === 0 || r.year > rows[i - 1].year));
  check('yearOverYearRows: oldest year has no % change (null)', rows[0].incomeChangePct === null);
  if (rows.length > 1) {
    check('yearOverYearRows: later years have a numeric % change', rows[1].incomeChangePct === null || Number.isFinite(rows[1].incomeChangePct));
  }
}

// Single-year dataset: yearOverYearRows with one year should return exactly
// one row (with null deltas) rather than crashing on an "empty" comparison.
{
  const oneYearData = { ...data, transactions: data.transactions.filter((t) => t.date.startsWith(String(years[0]))) };
  const rows = yearOverYearRows(oneYearData, [years[0]]);
  check('single-year YoY input returns exactly one row', rows.length === 1);
  check('single-year YoY row has null (not NaN/undefined) deltas', rows[0].incomeChangePct === null);
}

// A year with zero transactions at all shouldn't crash yearSummary — it
// should come back as all-zero, not throw.
{
  const emptySummary = yearSummary(data, 1999);
  check('yearSummary for a year with no data returns zeroed totals, not a crash', emptySummary.totalIncome === 0 && emptySummary.totalExpense === 0);
}

// ---------- Routines: suggested match (never auto-checks) ----------
{
  const mk = monthKey();
  // An already-paid routine never gets a suggestion, even if a matching
  // transaction exists this month — no point suggesting what's already done.
  const paidMeralco = data.routines.find((r) => r.name === 'Meralco');
  check('an already-paid routine never returns a suggested match', suggestedMatch(data, paidMeralco, mk) === null);

  // A routine whose name doesn't appear in any transaction's details this
  // month should get no suggestion — no false positives.
  const internet = data.routines.find((r) => r.name === 'Internet');
  check('an unpaid routine with no matching transaction text returns null', suggestedMatch(data, internet, mk) === null);

  // A synthetic unpaid routine whose name does appear in a real transaction
  // this month's Details text should be suggested.
  const synthetic = { name: 'meralco', paidMonths: [] };
  const match = suggestedMatch(data, synthetic, mk);
  check('an unpaid routine whose name appears in a transaction detail gets suggested', !!match && match.details.toLowerCase().includes('meralco'));

  // A transfer should never be suggested as a routine payment, even if its
  // details happen to contain the routine's name — money moving between the
  // person's own accounts isn't "paying" anything.
  const transferData = {
    ...data,
    transactions: [
      { id: 'x', date: `${mk}-15`, type: 'Transfer', account: 'a', toAccount: 'b', details: 'rent transfer test', amount: 100 },
    ],
  };
  check('a Transfer transaction is never suggested as a routine match, even on a name hit', suggestedMatch(transferData, { name: 'rent', paidMonths: [] }, mk) === null);

  // isPaid() itself, sanity check against the real routine data.
  check('isPaid reflects the routine record\'s own paidMonths array', isPaid(paidMeralco, mk) === true && isPaid(internet, mk) === false);
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
