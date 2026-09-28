/**
 * investmentsService.js — pure calculations over MP2 funds and market fund
 * holdings/lots. Every function takes `data` as a parameter rather than
 * reading a global, so each is independently testable.
 */

/**
 * Total contributed to an MP2 fund, optionally only up to a given year.
 * @param {Object} data
 * @param {string} fundId
 * @param {number} [uptoYear]
 * @returns {number}
 */
export function mp2FundContribTotal(data, fundId, uptoYear) {
  return data.mp2Contrib
    .filter((c) => c.fund === fundId && (!uptoYear || c.year <= uptoYear))
    .reduce((sum, c) => sum + c.amount, 0);
}

/**
 * Total dividends credited to an MP2 fund, optionally only up to a given year.
 * @param {Object} data
 * @param {string} fundId
 * @param {number} [uptoYear]
 * @returns {number}
 */
export function mp2FundDividendTotal(data, fundId, uptoYear) {
  return data.mp2Yearly
    .filter((y) => y.fund === fundId && (!uptoYear || y.year <= uptoYear))
    .reduce((sum, y) => sum + (y.dividend || 0), 0);
}

/**
 * @param {Object} data
 * @param {string} fundId
 * @returns {number}
 */
export function mp2FundBalance(data, fundId) {
  return mp2FundContribTotal(data, fundId) + mp2FundDividendTotal(data, fundId);
}

/**
 * @param {Object} data
 * @returns {number} combined balance across every MP2 fund
 */
export function mp2Total(data) {
  return data.mp2Funds.reduce((sum, f) => sum + mp2FundBalance(data, f.id), 0);
}

/**
 * Most recent contribution logged for a fund, or null.
 * @param {Object} data
 * @param {string} fundId
 * @returns {Object|null}
 */
export function mp2LastEntry(data, fundId) {
  return (
    data.mp2Contrib
      .filter((x) => x.fund === fundId)
      .sort((a, b) => b.year - a.year || b.month - a.month)[0] || null
  );
}

/**
 * @param {Object} data
 * @param {string} ticker
 * @returns {Array<Object>}
 */
export function holdingLots(data, ticker) {
  return data.lots.filter((l) => l.ticker === ticker);
}

/**
 * Computes a holding's position summary using average-cost-basis accounting:
 * each Sell removes cost at the running average price rather than FIFO/LIFO,
 * which is the standard (and simplest, KISS) approach for a single-holder
 * fund position where individual lots aren't separately identified for tax
 * purposes.
 * @param {Object} data
 * @param {Object} h - the holding
 * @returns {{totalQty:number, totalCost:number, avgPrice:number, totalValue:number,
 *   gl:number, glPct:number, lastLot:Object|null, dividends:number, fees:number, realizedGL:number}}
 */
export function holdingSummary(data, h) {
  const hl = holdingLots(data, h.ticker)
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  let qty = 0;
  let cost = 0;
  let dividends = 0;
  let fees = 0;
  let realizedGL = 0;

  hl.forEach((l) => {
    const type = l.type || 'Buy';
    if (type === 'Buy') {
      qty += l.qty;
      cost += l.totalCost;
    } else if (type === 'Sell') {
      const avg = qty > 0 ? cost / qty : 0;
      const costRemoved = avg * l.qty;
      realizedGL += l.totalCost - costRemoved;
      qty -= l.qty;
      cost -= costRemoved;
    } else if (type === 'Dividend') {
      dividends += l.totalCost;
    } else if (type === 'Fee') {
      fees += l.totalCost;
    }
  });

  const avgPrice = qty > 0 ? cost / qty : 0;
  const totalValue = qty * (h.lastPrice || 0);
  const gl = totalValue - cost;
  const glPct = cost ? gl / cost : 0;
  const lastLot = hl[hl.length - 1] || null;

  return { totalQty: qty, totalCost: cost, avgPrice, totalValue, gl, glPct, lastLot, dividends, fees, realizedGL };
}

/**
 * Converts a native-currency amount on this holding into the app's base
 * currency (PHP), using the holding's own fxRate (₱ per 1 unit of the
 * holding's currency). A holding with no currency set, or set to 'PHP',
 * passes through unchanged.
 * @param {Object} h
 * @param {number} amount
 * @returns {number}
 */
export function toBaseCurrency(h, amount) {
  if (!h.currency || h.currency === 'PHP') return amount;
  return amount * (h.fxRate || 1);
}

/**
 * @param {Object} data
 * @returns {number} combined current value across every market fund holding, in base currency (PHP)
 */
export function investmentsTotal(data) {
  return data.holdings.reduce(
    (sum, h) => sum + toBaseCurrency(h, holdingSummary(data, h).totalValue),
    0
  );
}

/**
 * @param {Object} data
 * @returns {number} MP2 dividends plus market-fund dividends (base currency), combined
 */
export function totalDividendsEarned(data) {
  const mp2Divs = data.mp2Funds.reduce((sum, f) => sum + mp2FundDividendTotal(data, f.id), 0);
  const lotDivs = data.holdings.reduce(
    (sum, h) => sum + toBaseCurrency(h, holdingSummary(data, h).dividends),
    0
  );
  return mp2Divs + lotDivs;
}

/**
 * XIRR via Newton-Raphson on a set of dated cash flows. Returns null if it
 * can't be computed (fewer than 2 flows, all flows the same sign, or the
 * method fails to converge).
 * @param {Array<{date: Date, amount: number}>} flows
 * @returns {number|null}
 */
export function xirr(flows) {
  if (flows.length < 2) return null;
  const hasPos = flows.some((f) => f.amount > 0);
  const hasNeg = flows.some((f) => f.amount < 0);
  if (!hasPos || !hasNeg) return null;

  const d0 = flows[0].date;
  const yrs = (f) => (f.date - d0) / (365 * 24 * 3600 * 1000);
  const npv = (r) => flows.reduce((sum, f) => sum + f.amount / (1 + r) ** yrs(f), 0);
  const dnpv = (r) => flows.reduce((sum, f) => sum - (yrs(f) * f.amount) / (1 + r) ** (yrs(f) + 1), 0);

  let rate = 0.1;
  for (let i = 0; i < 60; i += 1) {
    const f = npv(rate);
    const fp = dnpv(rate);
    if (!Number.isFinite(f) || !Number.isFinite(fp) || Math.abs(fp) < 1e-9) break;
    const next = rate - f / fp;
    if (!Number.isFinite(next) || next <= -0.999) {
      rate = null;
      break;
    }
    if (Math.abs(next - rate) < 1e-7) {
      rate = next;
      break;
    }
    rate = next;
  }
  return rate == null || !Number.isFinite(rate) ? null : rate;
}

/**
 * Annualized return for one holding, computed from its lot cash flows plus
 * its current value as a final synthetic "sell everything today" flow.
 * @param {Object} data
 * @param {Object} h
 * @returns {number|null}
 */
export function holdingXIRR(data, h) {
  const hl = holdingLots(data, h.ticker);
  if (!hl.length) return null;
  const flows = hl.map((l) => {
    const type = l.type || 'Buy';
    const amount = type === 'Buy' || type === 'Fee' ? -l.totalCost : l.totalCost;
    return { date: new Date(`${l.date}T00:00:00`), amount };
  });
  const s = holdingSummary(data, h);
  if (s.totalValue > 0.005) flows.push({ date: new Date(), amount: s.totalValue });
  flows.sort((a, b) => a.date - b.date);
  return xirr(flows);
}

/**
 * Renames a holding's ticker (its primary key), moving every lot that
 * references the old ticker along with it. Mutates `data` in place — call
 * via store.js's mutate() so the result gets persisted and broadcast.
 * @param {Object} data
 * @param {string} oldTicker
 * @param {string} newTicker
 * @returns {boolean} false (no changes made) if newTicker collides with an existing holding
 */
export function renameHolding(data, oldTicker, newTicker) {
  if (!newTicker || newTicker === oldTicker) return true;
  if (data.holdings.some((h) => h.ticker === newTicker)) return false;
  const h = data.holdings.find((x) => x.ticker === oldTicker);
  if (!h) return false;
  h.ticker = newTicker;
  h.id = newTicker;
  data.lots.forEach((l) => {
    if (l.ticker === oldTicker) l.ticker = newTicker;
  });
  return true;
}
