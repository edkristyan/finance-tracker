/**
 * loansService.js — amortization math and payment-splitting for the
 * Loans/Liabilities tab. A loan is a fixed-rate, fixed-term installment
 * loan (personal loan, auto loan, mortgage, etc.) tracked separately from
 * accounts: it isn't money you have, it's money you owe, so it never
 * appears in totalBalance()/liquidBalance() — only its logged payments
 * touch a real account, as ordinary Expense transactions.
 */

/**
 * @param {Object} loan
 * @returns {number} the loan's monthly interest rate as a fraction (e.g. 0.01 for 12%/yr)
 */
function monthlyRate(loan) {
  return (loan.annualRatePct || 0) / 100 / 12;
}

/**
 * Rounds to the nearest centavo — every money figure this service returns
 * goes through this, so repeated additions never drift by fractions of a
 * centavo the UI would otherwise display as a rounding artifact.
 * @param {number} n
 * @returns {number}
 */
function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * The fixed monthly installment for a standard fully-amortizing loan
 * (the textbook annuity formula). A 0% loan just divides principal evenly
 * across the term, since the formula itself divides by zero at r=0.
 * @param {Object} loan - {principal, annualRatePct, termMonths}
 * @returns {number}
 */
export function monthlyPayment(loan) {
  const r = monthlyRate(loan);
  const n = loan.termMonths || 0;
  if (!n) return 0;
  if (r === 0) return round2(loan.principal / n);
  return round2((loan.principal * r) / (1 - Math.pow(1 + r, -n)));
}

/**
 * @param {Object} data
 * @param {string} loanId
 * @returns {Array<Object>} this loan's logged payments, most recent first
 */
export function loanPaymentsFor(data, loanId) {
  return data.loanPayments.filter((p) => p.loanId === loanId).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/**
 * @param {Object} data
 * @param {string} loanId
 * @param {string} [excludePaymentId] - leave out one payment (used while editing it)
 * @returns {number} total principal actually paid down so far
 */
export function principalPaidTotal(data, loanId, excludePaymentId) {
  return data.loanPayments
    .filter((p) => p.loanId === loanId && p.id !== excludePaymentId)
    .reduce((sum, p) => sum + p.principalPortion, 0);
}

/**
 * @param {Object} data
 * @param {string} loanId
 * @returns {number} total interest actually paid so far
 */
export function interestPaidTotal(data, loanId) {
  return data.loanPayments.filter((p) => p.loanId === loanId).reduce((sum, p) => sum + p.interestPortion, 0);
}

/**
 * What's still owed on the loan right now, based on actual logged payments
 * (not the theoretical schedule) — the figure that matters for "can I pay
 * this off" and for computing the next payment's interest/principal split.
 * @param {Object} data
 * @param {Object} loan
 * @param {string} [excludePaymentId]
 * @returns {number}
 */
export function outstandingBalance(data, loan, excludePaymentId) {
  return Math.max(0, round2(loan.principal - principalPaidTotal(data, loan.id, excludePaymentId)));
}

/**
 * @param {Object} data
 * @param {Object} loan
 * @returns {number} 0–1, fraction of the original principal paid down so far
 */
export function payoffProgressPct(data, loan) {
  if (!loan.principal) return 0;
  return Math.min(1, principalPaidTotal(data, loan.id) / loan.principal);
}

/**
 * Splits a real-world payment amount into its interest and principal
 * portions, the way any installment loan actually works: interest is
 * whatever has accrued on the *current outstanding balance* since the last
 * payment (approximated here as one month's worth, since payments are
 * assumed roughly monthly), and every peso beyond that reduces principal.
 * A payment bigger than what's owed just pays it off — principal is capped
 * at the outstanding balance rather than going negative.
 * @param {Object} loan
 * @param {number} outstanding - balance owed right before this payment
 * @param {number} amount - the payment amount being logged
 * @returns {{interestPortion:number, principalPortion:number}}
 */
export function splitPayment(loan, outstanding, amount) {
  const interestPortion = round2(Math.min(amount, outstanding * monthlyRate(loan)));
  const principalPortion = round2(Math.min(outstanding, Math.max(0, amount - interestPortion)));
  return { interestPortion, principalPortion };
}

/**
 * The theoretical, full month-by-month amortization schedule for a loan —
 * not what was actually paid, but what a perfectly on-time, exact-payment
 * schedule would look like from the start date. Used for the schedule
 * table and the estimated payoff date; actual progress is tracked
 * separately via loanPayments.
 * @param {Object} loan
 * @returns {Array<{period:number, date:string, payment:number, principal:number, interest:number, balance:number}>}
 */
export function amortizationSchedule(loan) {
  const r = monthlyRate(loan);
  const pmt = monthlyPayment(loan);
  const start = loan.startDate ? new Date(`${loan.startDate}T00:00:00`) : new Date();
  let balance = loan.principal || 0;
  const rows = [];
  for (let i = 1; i <= (loan.termMonths || 0) && balance > 0.005; i++) {
    const interest = round2(balance * r);
    let principal = round2(pmt - interest);
    if (principal > balance || i === loan.termMonths) principal = round2(balance);
    balance = round2(Math.max(0, balance - principal));
    const date = new Date(start);
    date.setMonth(date.getMonth() + i);
    rows.push({
      period: i,
      date: date.toISOString().slice(0, 10),
      payment: round2(principal + interest),
      principal,
      interest,
      balance,
    });
  }
  return rows;
}

/**
 * @param {Object} loan
 * @returns {number} total interest that would be paid over the full theoretical schedule
 */
export function totalInterestScheduled(loan) {
  return round2(amortizationSchedule(loan).reduce((sum, row) => sum + row.interest, 0));
}

/**
 * @param {Object} loan
 * @returns {string|null} the schedule's final payment date, or null for a 0-term loan
 */
export function estimatedPayoffDate(loan) {
  const schedule = amortizationSchedule(loan);
  return schedule.length ? schedule[schedule.length - 1].date : null;
}

/**
 * Combined outstanding balance across every non-archived loan — the
 * liability figure a Dashboard/net-worth card would want.
 * @param {Object} data
 * @returns {number}
 */
export function totalOutstandingAcrossLoans(data) {
  return data.loans.filter((l) => !l.archived).reduce((sum, l) => sum + outstandingBalance(data, l), 0);
}
