import { getData } from '../state/store.js';
import { availableYears, yearOverYearRows, yearInReview } from '../services/reportsService.js';
import { peso, pct } from '../utils/format.js';
import { buildYoyBarChartSvg } from '../components/charts.js';

/** View-local UI state — not persisted, resets on reload. */
let reviewYear = null;

/**
 * @param {number|null} val - a percent-change fraction, or null (no prior year to compare against)
 * @returns {string}
 */
function changeCellHtml(val) {
  if (val == null) return '<span class="muted">—</span>';
  return `<span class="${val >= 0 ? 'pos' : 'neg'}">${pct(val)}</span>`;
}

function yoyTableHtml(rows) {
  return `<div class="card" style="margin-bottom:20px;">
    <table>
      <thead><tr><th>Year</th><th class="num">Income</th><th class="num">Expense</th><th class="num">Net</th><th class="num">Savings rate</th><th class="num">Income Δ</th><th class="num">Expense Δ</th></tr></thead>
      <tbody>
        ${[...rows]
          .reverse()
          .map(
            (r) => `<tr>
          <td style="font-weight:600;">${r.year}</td>
          <td class="num">${peso(r.totalIncome)}</td>
          <td class="num">${peso(r.totalExpense)}</td>
          <td class="num ${r.net >= 0 ? 'pos' : 'neg'}" style="font-weight:600;">${peso(r.net)}</td>
          <td class="num">${r.totalIncome ? pct(r.savingsRate) : '—'}</td>
          <td class="num">${changeCellHtml(r.incomeChangePct)}</td>
          <td class="num">${changeCellHtml(r.expenseChangePct)}</td>
        </tr>`
          )
          .join('')}
      </tbody>
    </table>
  </div>`;
}

function reviewCardHtml(paragraphs, year) {
  return `<div class="card" style="margin-bottom:20px;">
    <h3 style="margin-bottom:12px;">Year in review — ${year}</h3>
    ${paragraphs.map((p) => `<p style="font-size:13.5px; line-height:1.6; margin-bottom:10px;">${p}</p>`).join('')}
  </div>`;
}

/**
 * Renders the Reports view into `container`. Purely a read-only lens over
 * data other views own (transactions, loans, goals) — no CRUD, no data of
 * its own, so it just re-derives everything fresh from getData() every time.
 * @param {HTMLElement} container
 */
export function renderReportsView(container) {
  const data = getData();
  if (!data) {
    container.innerHTML = '<div class="empty">Loading…</div>';
    return;
  }

  const years = availableYears(data);
  if (!reviewYear || !years.includes(reviewYear)) reviewYear = years[years.length - 1];

  const rows = yearOverYearRows(data, years);
  const paragraphs = yearInReview(data, reviewYear);

  container.innerHTML = `
    <div class="page-head">
      <div><h1>Reports &amp; Analytics</h1><div class="sub">Year-over-year trends and an automated recap, built from your existing transactions — nothing to set up here.</div></div>
    </div>

    <div class="section-title"><h2 style="font-size:15px;">Year in review</h2><div class="rule"></div>
      <select id="review-year-select" style="height:32px; font-size:12.5px; padding:4px 8px;">${years
        .slice()
        .reverse()
        .map((y) => `<option value="${y}" ${y === reviewYear ? 'selected' : ''}>${y}</option>`)
        .join('')}</select>
    </div>
    ${reviewCardHtml(paragraphs, reviewYear)}

    <div class="section-title"><h2 style="font-size:15px;">Year-over-year comparison</h2><div class="rule"></div></div>
    <div class="card" style="margin-bottom:20px;">
      ${
        rows.length > 1
          ? buildYoyBarChartSvg(
              rows.map((r) => r.totalIncome),
              rows.map((r) => r.totalExpense),
              rows.map((r) => r.year)
            )
          : '<div class="empty">Log transactions across more than one year to see a comparison chart.</div>'
      }
    </div>
    ${yoyTableHtml(rows)}
  `;

  container.querySelector('#review-year-select').onchange = (e) => {
    reviewYear = parseInt(e.target.value, 10);
    renderReportsView(container);
  };
}
