/**
 * goalsService.js — savings goals / sinking funds. A goal tracks progress
 * toward a target amount in one of two modes:
 *  - "linked": tied to one real account; progress is just that account's
 *    live balance. Best when the goal has (or will get) its own dedicated
 *    account — no separate bookkeeping needed, it can never drift from
 *    what the account actually holds.
 *  - "manual": not tied to any account; progress is the running total of
 *    contributions logged directly against the goal. Best for a sinking
 *    fund that shares space inside a bigger account (the peso is
 *    spoken-for on paper, not physically separated) — logging a
 *    contribution here is a bookkeeping entry only and deliberately does
 *    NOT create a Transaction, since the actual money movement (if any)
 *    already happened, or lives across a shared balance no single
 *    transaction could represent without double-counting.
 */
import { accountBalance, toBaseCurrency } from './accountsService.js';

/**
 * @param {Object} goal
 * @returns {'linked'|'manual'}
 */
export function goalMode(goal) {
  return goal.linkedAccount ? 'linked' : 'manual';
}

/**
 * @param {Object} data
 * @param {string} goalId
 * @returns {Array<Object>} this goal's logged manual contributions, most recent first
 */
export function goalContributionsFor(data, goalId) {
  return data.goalContributions
    .filter((c) => c.goalId === goalId)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/**
 * @param {Object} data
 * @param {string} goalId
 * @param {string} [excludeId] - leave out one contribution (used while editing it)
 * @returns {number}
 */
export function manualContributionTotal(data, goalId, excludeId) {
  return data.goalContributions
    .filter((c) => c.goalId === goalId && c.id !== excludeId)
    .reduce((sum, c) => sum + c.amount, 0);
}

/**
 * Current progress toward a goal, in base currency (₱).
 * @param {Object} data
 * @param {Object} goal
 * @returns {number}
 */
export function goalProgress(data, goal) {
  if (goalMode(goal) === 'linked') {
    const account = data.accounts.find((a) => a.id === goal.linkedAccount);
    if (!account) return 0;
    return toBaseCurrency(account, accountBalance(data, account.id));
  }
  return manualContributionTotal(data, goal.id);
}

/**
 * @param {Object} data
 * @param {Object} goal
 * @returns {number} 0–1
 */
export function goalProgressPct(data, goal) {
  if (!goal.targetAmount) return 0;
  return Math.min(1, Math.max(0, goalProgress(data, goal) / goal.targetAmount));
}

/**
 * @param {Object} data
 * @param {Object} goal
 * @returns {boolean} true once progress has reached (or passed) the target
 */
export function isGoalReached(data, goal) {
  return goalProgress(data, goal) >= goal.targetAmount - 0.005;
}

/**
 * Whole calendar months remaining until a goal's target date, counting the
 * current month if it isn't over yet. Floors at 0 for a past-due date
 * rather than going negative, since "how much more per month" stops
 * meaning anything once the deadline has already passed.
 * @param {string} targetDateISO
 * @returns {number}
 */
export function monthsRemaining(targetDateISO) {
  if (!targetDateISO) return null;
  const now = new Date();
  const target = new Date(`${targetDateISO}T00:00:00`);
  const months = (target.getFullYear() - now.getFullYear()) * 12 + (target.getMonth() - now.getMonth());
  return Math.max(0, months + (target.getDate() >= now.getDate() ? 1 : 0));
}

/**
 * How much would need to be added per month, from now, to hit the target by
 * its target date. Null when the goal has no target date set (there's
 * nothing to divide by) or is already reached.
 * @param {Object} data
 * @param {Object} goal
 * @returns {number|null}
 */
export function requiredMonthlyContribution(data, goal) {
  if (!goal.targetDate) return null;
  if (isGoalReached(data, goal)) return 0;
  const remaining = Math.max(0, goal.targetAmount - goalProgress(data, goal));
  const months = monthsRemaining(goal.targetDate) || 1;
  return remaining / months;
}

/**
 * @param {Object} data
 * @returns {{target: number, progress: number}} combined totals across every non-archived goal
 */
export function goalsTotals(data) {
  const active = data.goals.filter((g) => !g.archived);
  return {
    target: active.reduce((sum, g) => sum + (g.targetAmount || 0), 0),
    progress: active.reduce((sum, g) => sum + goalProgress(data, g), 0),
  };
}
