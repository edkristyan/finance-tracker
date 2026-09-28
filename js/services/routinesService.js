/**
 * routinesService.js — the "this month's routines" checklist. A routine is
 * a recurring expected payment (rent, a subscription, a bill) the person
 * checks off each month. Checking one off is always a manual click — never
 * automatic — because guessing which transaction "is" a given routine from
 * category/amount/date alone is fragile and would silently mis-tick things.
 * What this module *will* do is suggest: if an expense logged this month
 * plausibly matches an unpaid routine (its name shows up in the
 * transaction's own details text), surface it as a hint the person can
 * confirm with one click — never something that ticks itself.
 */

/**
 * @param {Date} [d]
 * @returns {string} "YYYY-MM" for the given date (default: today)
 */
export function monthKey(d) {
  const date = d || new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * @param {Object} routine
 * @param {string} mk - a monthKey() value
 * @returns {boolean}
 */
export function isPaid(routine, mk) {
  return !!(routine.paidMonths || []).includes(mk);
}

/**
 * @param {Object} data
 * @param {string} mk
 * @returns {Array<Object>} routines not yet checked off for that month
 */
export function unpaidRoutines(data, mk) {
  return data.routines.filter((r) => !isPaid(r, mk));
}

/**
 * @param {Object} data
 * @param {string} mk
 * @returns {number} combined expected amount of every unpaid routine
 */
export function unpaidTotal(data, mk) {
  return unpaidRoutines(data, mk).reduce((sum, r) => sum + (r.expectedAmount || 0), 0);
}

/**
 * Looks for one expense transaction this month that plausibly *is* this
 * routine — a suggestion only, never applied automatically. The only
 * signal used is the routine's own name showing up in the transaction's
 * Details text (case-insensitive substring), the same way a person would
 * eyeball it themselves ("Netflix" the routine vs. a transaction whose
 * details read "Netflix subscription #entertainment"). Deliberately does
 * NOT match on category, group, or amount alone — a routine's `group` is a
 * freeform label ("Bills") that many unrelated transactions could share,
 * and matching by amount/date without a name signal is exactly the fragile
 * guessing this module's docstring warns against. A routine already marked
 * paid for the month, or with a blank name, is never matched.
 * @param {Object} data
 * @param {Object} routine
 * @param {string} mk - a monthKey() value
 * @returns {Object|null} the matching transaction, or null
 */
export function suggestedMatch(data, routine, mk) {
  const name = (routine.name || '').trim().toLowerCase();
  if (!name || isPaid(routine, mk)) return null;
  return (
    data.transactions.find((t) => {
      if (!t.date || !t.date.startsWith(mk)) return false;
      if (t.toAccount) return false; // a transfer is never "paying" a routine
      if (t.direction !== 'out') return false; // routines are bills — money going out
      return (t.details || '').toLowerCase().includes(name);
    }) || null
  );
}

/**
 * Groups routines by their (freely-named) group label, "Ungrouped" for
 * routines with none, preserving each group's first-seen order.
 * @param {Object} data
 * @returns {Array<{group: string, routines: Array<Object>}>}
 */
export function groupedRoutines(data) {
  const order = [];
  const map = {};
  data.routines.forEach((r) => {
    const g = r.group || 'Ungrouped';
    if (!map[g]) {
      map[g] = [];
      order.push(g);
    }
    map[g].push(r);
  });
  return order.map((g) => ({ group: g, routines: map[g] }));
}
