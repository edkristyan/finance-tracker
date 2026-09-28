/**
 * charts.js — every chart in the app is hand-rolled inline SVG (per the
 * project's no-chart-library constraint), colored entirely via CSS custom
 * properties so it stays theme-aware in light/dark mode automatically.
 * Each function returns an HTML string to drop straight into a template.
 */

const W = 700;
const H = 220;
const PAD = { top: 16, right: 12, bottom: 26, left: 12 };

/**
 * Grouped bar chart: income (green) vs expense (rust) across any number of
 * equal-width groups — the shared renderer behind both the Dashboard's
 * 12-month chart and the Reports tab's year-over-year comparison, so the
 * two never drift into two slightly-different bar-chart implementations.
 * @param {number[]} income - one value per group
 * @param {number[]} expense - one value per group, same length as income
 * @param {string[]} labels - one short label per group, e.g. ["Jan", "Feb", ...] or ["2024", "2025", ...]
 * @param {string} [ariaLabel]
 * @returns {string}
 */
function buildGroupedBarChartSvg(income, expense, labels, ariaLabel, opts) {
  // fillHeight: false (default) keeps the old behavior — width:100%,
  // height set purely by the viewBox's own aspect ratio (700:220), which
  // is right for a chart sitting in a fixed-height context (e.g. Reports).
  // fillHeight: true instead stretches the SVG to 100% of whatever height
  // its container actually gives it (preserveAspectRatio="none" is what
  // allows the non-uniform stretch) — for the Dashboard's income-vs-expense
  // card, which now shares a flex layout with a sibling card whose height
  // varies with its own content (see flowChartHtml in dashboardView.js).
  const { fillHeight = false } = opts || {};
  const groupCount = Math.max(1, labels.length);
  const max = Math.max(1, ...income, ...expense);
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const groupW = plotW / groupCount;
  const barW = Math.min(groupW * 0.32, 48);
  const barRx = Math.min(6, barW / 2);

  const bars = labels
    .map((label, i) => {
      const gx = PAD.left + i * groupW;
      const incH = (income[i] / max) * plotH;
      const expH = (expense[i] / max) * plotH;
      const incX = gx + groupW / 2 - barW - 2;
      const expX = gx + groupW / 2 + 2;
      return `
        <rect x="${incX.toFixed(1)}" y="${(PAD.top + plotH - incH).toFixed(1)}" width="${barW.toFixed(1)}" height="${incH.toFixed(1)}" rx="${barRx.toFixed(1)}" fill="var(--green)" opacity="0.85"><title>${label} income</title></rect>
        <rect x="${expX.toFixed(1)}" y="${(PAD.top + plotH - expH).toFixed(1)}" width="${barW.toFixed(1)}" height="${expH.toFixed(1)}" rx="${barRx.toFixed(1)}" fill="var(--rust)" opacity="0.85"><title>${label} expense</title></rect>
        <text x="${(gx + groupW / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="9" fill="var(--ink-soft)">${label}</text>`;
    })
    .join('');

  const svgStyle = fillHeight ? 'width:100%; height:100%; display:block;' : 'width:100%; height:auto;';
  return `<svg viewBox="0 0 ${W} ${H}" style="${svgStyle}"${fillHeight ? ' preserveAspectRatio="none"' : ''} role="img" aria-label="${ariaLabel || 'Income vs expense'}">
    <line x1="${PAD.left}" y1="${PAD.top + plotH}" x2="${W - PAD.right}" y2="${PAD.top + plotH}" stroke="var(--line)" stroke-width="1"/>
    ${bars}
  </svg>`;
}

/**
 * Grouped monthly bar chart: income (green) vs expense (rust).
 * @param {number[]} income - 12 values, Jan first
 * @param {number[]} expense - 12 values, Jan first
 * @param {string[]} monthLabels - 12 short labels, e.g. ["Jan", "Feb", ...]
 * @returns {string}
 */
export function buildBarChartSvg(income, expense, monthLabels, opts) {
  return buildGroupedBarChartSvg(income, expense, monthLabels, 'Monthly income vs expense', opts);
}

/**
 * Grouped year-over-year bar chart: income (green) vs expense (rust), one
 * group per year. Same visual language as the Dashboard's monthly chart,
 * just with years as the groups instead of months.
 * @param {number[]} income - one total per year
 * @param {number[]} expense - one total per year
 * @param {Array<string|number>} yearLabels
 * @returns {string}
 */
export function buildYoyBarChartSvg(income, expense, yearLabels) {
  return buildGroupedBarChartSvg(income, expense, yearLabels.map(String), 'Year-over-year income vs expense');
}

// The line chart is meant to read as a small, compact indicator rather than
// a full-width chart, so it gets its own (shorter, more generously padded)
// dimensions instead of sharing the bar chart's W/H/PAD. The generous
// left/right padding specifically leaves room for a peso-value label
// centered over the first/last point without it running off the edge.
const LINE_W = 420;
const LINE_H = 140;
const LINE_PAD = { top: 30, right: 60, bottom: 24, left: 60 };

/**
 * A line chart, in two modes: a compact 2-point "forecast" indicator
 * (Today → projected), or a wider historical trend with many points (e.g.
 * a full year of month-end balances). Points are read-only data markers,
 * not draggable controls — there's no slider here to interact with, just a
 * chart with a dot at each data point (hover a dot for its exact value).
 * @param {Array<{label: string, value: number}>} points
 * @param {{negativeIsWarning?: boolean, compact?: boolean}} [opts]
 *   negativeIsWarning: a negative final value renders the line in --rust.
 *   compact: true (default) = small, max-width:400px, every point labeled
 *   with its peso value (the 2-point forecast use case). false = full card
 *   width, only the first/last points get a peso-value label (everything
 *   else just gets a month tick + hover tooltip) so a 12-point trend
 *   doesn't turn into an unreadable pile of overlapping numbers.
 * @returns {string}
 */
export function buildLineChartSvg(points, opts) {
  const { negativeIsWarning = false, compact = true } = opts || {};
  const w = compact ? LINE_W : W;
  const h = compact ? LINE_H : H;
  const pad = compact ? LINE_PAD : { top: 24, right: 40, bottom: 26, left: 40 };
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;
  const values = points.map((p) => p.value);
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const stepX = points.length > 1 ? plotW / (points.length - 1) : 0;
  const y = (v) => pad.top + plotH - ((v - min) / range) * plotH;
  const x = (i) => pad.left + i * stepX;

  const last = values[values.length - 1];
  const lineColor = negativeIsWarning && last < 0 ? 'var(--rust)' : 'var(--gold)';
  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(' ');
  const zeroY = y(0);

  const dots = points
    .map((p, i) => {
      const isEnd = i === 0 || i === points.length - 1;
      const showValue = compact || isEnd;
      // Anchor the first/last labels toward the inside of the chart rather
      // than dead-centering every label — centering the endpoints is what
      // pushed text past the left/right edges before.
      const anchor = i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle';
      const labelX = anchor === 'start' ? x(i) - 4 : anchor === 'end' ? x(i) + 4 : x(i);
      const r = compact ? 4 : isEnd ? 3.5 : 2.5;
      return `<circle cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="${r}" fill="${p.value < 0 ? 'var(--rust)' : 'var(--gold)'}"><title>${p.label}: ₱${p.value.toFixed(2)}</title></circle>
      <text x="${labelX.toFixed(1)}" y="${h - 6}" text-anchor="${anchor}" font-size="${compact ? 10 : 9}" fill="var(--ink-soft)">${p.label}</text>
      ${showValue ? `<text x="${labelX.toFixed(1)}" y="${(y(p.value) - (compact ? 12 : 9)).toFixed(1)}" text-anchor="${anchor}" font-size="${compact ? 13 : 11}" fill="var(--ink)" font-family="var(--font-mono)" font-weight="600">₱${Math.round(p.value).toLocaleString()}</text>` : ''}`;
    })
    .join('');

  return `<svg viewBox="0 0 ${w} ${h}" style="width:100%; ${compact ? 'max-width:400px;' : ''} height:auto; display:block; margin:0 auto;" role="img" aria-label="Balance over time">
    ${min < 0 && max > 0 ? `<line x1="${pad.left}" y1="${zeroY.toFixed(1)}" x2="${w - pad.right}" y2="${zeroY.toFixed(1)}" stroke="var(--line)" stroke-dasharray="3,3"/>` : ''}
    <path d="${pathD}" fill="none" stroke="${lineColor}" stroke-width="2.5"/>
    ${dots}
  </svg>`;
}

/**
 * A simplified two-stage Sankey: income category flows converge into one
 * "Income" hub, which fans back out into expense category flows (plus a
 * "Net savings" flow when income exceeds expenses for the period). Flow
 * ribbon widths are proportional to amount. This visualizes proportional
 * budget allocation, not a literal trace of which peso came from which
 * source — the app has no way to know that, and no personal-finance app
 * meaningfully does without labeling every transaction by funding source.
 * @param {Array<{label: string, value: number}>} incomeFlows
 * @param {Array<{label: string, value: number}>} expenseFlows
 * @param {number} netSavings - income minus expense for the period; a
 *   positive value is drawn as an extra "Net savings" flow on the right
 * @returns {string}
 */
export function buildSankeySvg(incomeFlows, expenseFlows, netSavings) {
  const rightFlows = expenseFlows.slice();
  if (netSavings > 0) rightFlows.push({ label: 'Net savings', value: netSavings, savings: true });

  const total = Math.max(
    1,
    incomeFlows.reduce((s, f) => s + f.value, 0),
    rightFlows.reduce((s, f) => s + f.value, 0)
  );
  const plotH = H - PAD.top - PAD.bottom;
  const gap = 4;
  const hubX = W / 2;
  const leftX = PAD.left + 90;
  const rightX = W - PAD.right - 90;

  /**
   * Lays out a column of flows top-to-bottom proportional to value, with a
   * small gap between each, returning each flow's vertical span.
   * @param {Array<{label:string, value:number}>} flows
   * @returns {Array<{label:string, value:number, y0:number, y1:number}>}
   */
  function layout(flows) {
    const usableH = plotH - gap * (flows.length - 1);
    let y = PAD.top;
    return flows.map((f) => {
      const h = Math.max(2, (f.value / total) * usableH);
      const seg = { ...f, y0: y, y1: y + h };
      y += h + gap;
      return seg;
    });
  }

  const left = layout(incomeFlows);
  const right = layout(rightFlows);
  const hubTotalH = Math.min(plotH, Math.max(left.length ? left[left.length - 1].y1 : 0, right.length ? right[right.length - 1].y1 : 0) - PAD.top);
  const hubY0 = PAD.top;
  const hubY1 = PAD.top + hubTotalH;

  /**
   * A cubic-bezier ribbon from one x/y-span to another, width = the span height.
   */
  function ribbon(x0, y0a, y0b, x1, y1a, y1b, fill) {
    const mx = (x0 + x1) / 2;
    return `<path d="M ${x0} ${y0a} C ${mx} ${y0a}, ${mx} ${y1a}, ${x1} ${y1a}
      L ${x1} ${y1b} C ${mx} ${y1b}, ${mx} ${y0b}, ${x0} ${y0b} Z" fill="${fill}" opacity="0.45"/>`;
  }

  // Distribute each income flow proportionally across the hub's height, and
  // likewise for the hub feeding each expense flow.
  let hubCursorL = hubY0;
  const leftRibbons = left
    .map((f) => {
      const h = ((f.y1 - f.y0) / (left[left.length - 1] ? left[left.length - 1].y1 - hubY0 : 1)) * hubTotalH;
      const seg = ribbon(leftX, f.y0, f.y1, hubX, hubCursorL, hubCursorL + h, 'var(--green)');
      hubCursorL += h;
      return seg;
    })
    .join('');

  let hubCursorR = hubY0;
  const rightRibbons = right
    .map((f) => {
      const h = ((f.y1 - f.y0) / (right[right.length - 1] ? right[right.length - 1].y1 - hubY0 : 1)) * hubTotalH;
      const color = f.savings ? 'var(--info)' : 'var(--rust)';
      const seg = ribbon(hubX, hubCursorR, hubCursorR + h, rightX, f.y0, f.y1, color);
      hubCursorR += h;
      return seg;
    })
    .join('');

  const leftLabels = left
    .map(
      (f) =>
        `<text x="${leftX - 6}" y="${((f.y0 + f.y1) / 2 + 3).toFixed(1)}" text-anchor="end" font-size="10" fill="var(--ink)">${f.label} <tspan fill="var(--ink-soft)">₱${Math.round(f.value).toLocaleString()}</tspan></text>`
    )
    .join('');
  const rightLabels = right
    .map(
      (f) =>
        `<text x="${rightX + 6}" y="${((f.y0 + f.y1) / 2 + 3).toFixed(1)}" text-anchor="start" font-size="10" fill="var(--ink)">${f.label} <tspan fill="var(--ink-soft)">₱${Math.round(f.value).toLocaleString()}</tspan></text>`
    )
    .join('');

  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%; height:auto;" role="img" aria-label="Cash flow map">
    ${leftRibbons}
    ${rightRibbons}
    <rect x="${hubX - 4}" y="${hubY0}" width="8" height="${hubTotalH}" fill="var(--gold)" rx="2"/>
    ${leftLabels}
    ${rightLabels}
  </svg>`;
}
