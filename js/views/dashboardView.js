import { getData, addItem, upsertItem, updateItem, deleteItem } from '../state/store.js';
import { totalBalance, liquidBalance, creditOwed, accountType, accountLiquidity, accountBalance, toBaseCurrency } from '../services/accountsService.js';
import {
  mp2Total,
  investmentsTotal,
  totalDividendsEarned,
  mp2FundBalance,
  holdingSummary,
  toBaseCurrency as invToBaseCurrency,
} from '../services/investmentsService.js';
import { totalOutstandingAcrossLoans } from '../services/loansService.js';
import {
  monthlyIncomeExpense,
  expenseByCategory,
  incomeByCategory,
  cashFlowForecast,
  budgetProgress,
  accountBalancesList,
  liquidityBreakdown,
  monthEndBalanceSeries,
} from '../services/dashboardService.js';
import { years as txYears, CATEGORY_ICONS } from '../services/transactionsService.js';
import { openAccountDetail } from './accountsView.js';
import { monthKey, isPaid, groupedRoutines, suggestedMatch } from '../services/routinesService.js';
import { peso, parseAmount } from '../utils/format.js';
import { MONTH_NAMES } from '../utils/constants.js';
import { buildBarChartSvg, buildLineChartSvg, buildSankeySvg } from '../components/charts.js';
import { openModal, onModalSubmit, confirmModal, infoModal } from '../components/modal.js';

const SHORT_MONTHS = MONTH_NAMES.map((m) => m.slice(0, 3));

/** View-local UI state — not persisted. */
let flowChartYear = new Date().getFullYear();
let flowChartMode = 'bar'; // 'bar' | 'sankey'
let forecastYear = new Date().getFullYear(); // current year = live 2-point forecast; a past year = that year's month-end trend

// ---------- Routines ----------

function openRoutineModal(routine) {
  const isEdit = !!routine;
  const overlay = openModal(
    isEdit ? 'Edit routine' : 'Add a routine',
    `<div class="field"><label>Name</label><input name="name" required placeholder="e.g. Rent, Netflix, Electric bill" value="${isEdit ? routine.name : ''}"></div>
     <div class="field"><label>Group (optional)</label><input name="group" placeholder="e.g. Bills, Subscriptions" value="${isEdit ? routine.group || '' : ''}"></div>
     <div class="field"><label>Expected amount</label><input type="text" inputmode="decimal" class="amount-input" name="expectedAmount" placeholder="0.00" ${isEdit ? `value="${routine.expectedAmount}"` : ''}></div>`,
    isEdit ? 'Save changes' : 'Add routine'
  );
  onModalSubmit(overlay, async (fd) => {
    const name = fd.get('name').trim();
    if (!name) return;
    const payload = { name, group: fd.get('group').trim(), expectedAmount: parseAmount(fd.get('expectedAmount')) };
    if (isEdit) await updateItem('routines', routine.id, payload);
    else await addItem('routines', { ...payload, paidMonths: [] });
  });
}

function routinesSectionHtml(data) {
  const mk = monthKey();
  const groups = groupedRoutines(data);
  return `
    <div class="card">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <h3>This month's routines</h3>
        <button class="btn small secondary" id="add-routine-btn">+ Add routine</button>
      </div>
      ${
        groups.length
          ? groups
              .map(
                (g) => `<div style="margin-bottom:14px;">
          <div class="muted" style="font-size:11.5px; text-transform:uppercase; letter-spacing:0.03em; margin-bottom:6px;">${g.group}</div>
          ${g.routines
            .map((r) => {
              const paid = isPaid(r, mk);
              const match = paid ? null : suggestedMatch(data, r, mk);
              return `<div style="display:flex; align-items:center; gap:10px; padding:6px 0; border-bottom:1px solid var(--line); flex-wrap:wrap;">
              <input type="checkbox" class="routine-check" data-id="${r.id}" ${paid ? 'checked' : ''} style="width:16px; height:16px;">
              <div style="flex:1; min-width:120px; ${paid ? 'text-decoration:line-through; color:var(--ink-soft);' : ''}">${r.name}</div>
              ${
                match
                  ? `<button type="button" class="btn small accent suggest-paid-btn" data-id="${r.id}" title="${(match.details || '').replace(/"/g, '&quot;')} — ${peso(match.amount)} on ${match.date}">💡 Looks paid — mark it?</button>`
                  : ''
              }
              <div class="mono ${!r.expectedAmount ? 'muted' : ''}" style="font-size:13px;" title="${!r.expectedAmount ? 'No expected amount set yet — click ✎ to add one' : ''}">${r.expectedAmount ? peso(r.expectedAmount) : '—'}</div>
              <button class="icon-btn edit-routine" data-id="${r.id}" title="Edit">✎</button>
              <button class="icon-btn danger-hover del-routine" data-id="${r.id}" title="Delete">✕</button>
            </div>`;
            })
            .join('')}
        </div>`
              )
              .join('')
          : '<div class="empty">No routines yet — add rent, subscriptions, or bills you pay every month.</div>'
      }
    </div>`;
}

function wireRoutinesSection(container, data) {
  const mk = monthKey();
  container.querySelector('#add-routine-btn').onclick = () => openRoutineModal();
  container.querySelectorAll('.edit-routine').forEach((btn) => {
    btn.onclick = () => openRoutineModal(data.routines.find((r) => r.id === btn.dataset.id));
  });
  container.querySelectorAll('.del-routine').forEach((btn) => {
    btn.onclick = () =>
      confirmModal('Delete this routine?', true, async () => {
        await deleteItem('routines', btn.dataset.id);
      });
  });
  container.querySelectorAll('.routine-check').forEach((cb) => {
    cb.onchange = async () => {
      const r = data.routines.find((x) => x.id === cb.dataset.id);
      if (!r) return;
      const months = new Set(r.paidMonths || []);
      if (cb.checked) months.add(mk);
      else months.delete(mk);
      await updateItem('routines', r.id, { paidMonths: Array.from(months) });
    };
  });
  // The "Looks paid — mark it?" suggestion button is still a manual
  // confirmation, not an auto-check — clicking it does exactly what
  // checking the box by hand would do, just pre-filled with the guess.
  container.querySelectorAll('.suggest-paid-btn').forEach((btn) => {
    btn.onclick = async () => {
      const r = data.routines.find((x) => x.id === btn.dataset.id);
      if (!r) return;
      const months = new Set(r.paidMonths || []);
      months.add(mk);
      await updateItem('routines', r.id, { paidMonths: Array.from(months) });
    };
  });
}

// ---------- Budgets ----------

function openBudgetsModal(data, onSaved) {
  const rows = data.categories
    .map((c) => {
      const existing = data.budgets.find((b) => b.category === c.name);
      return `<div class="field" style="flex-direction:row; align-items:center; gap:8px;">
      <label style="flex:1; color:var(--ink); font-weight:400;">${c.name}</label>
      <input type="text" inputmode="decimal" class="amount-input budget-input" data-category="${c.name}" placeholder="No budget" value="${existing && existing.amount ? existing.amount : ''}" style="width:120px;">
    </div>`;
    })
    .join('');
  const overlay = openModal('Monthly category budgets', `<div style="max-height:50vh; overflow-y:auto;">${rows}</div>`, 'Save budgets');
  onModalSubmit(overlay, async () => {
    const inputs = overlay.querySelectorAll('.budget-input');
    for (const input of inputs) {
      const category = input.dataset.category;
      const amount = parseAmount(input.value);
      if (amount > 0) await upsertItem('budgets', category, { category, amount });
      else if (data.budgets.some((b) => b.category === category)) await deleteItem('budgets', category);
    }
    if (onSaved) onSaved();
  });
}

function budgetBarHtml(row) {
  const pct = Math.min(1, row.pct);
  const color = row.pct >= 0.8 ? 'var(--rust)' : 'var(--gold)';
  const icon = CATEGORY_ICONS[row.category] || '🔖';
  return `<div style="margin-bottom:10px;">
    <div style="display:flex; justify-content:space-between; font-size:12.5px; margin-bottom:4px;">
      <span>${icon} ${row.category}</span>
      <span class="mono ${row.pct >= 1 ? 'neg' : ''}">${peso(row.spent)} / ${peso(row.budget)}</span>
    </div>
    <div style="background:var(--surface-2); border-radius:6px; height:8px; overflow:hidden;">
      <div style="width:${(pct * 100).toFixed(1)}%; height:100%; background:${color}; border-radius:6px;"></div>
    </div>
  </div>`;
}

// ---------- Where it went (category breakdown + budgets) ----------

function whereItWentHtml(data) {
  const mk = monthKey();
  const spend = expenseByCategory(data, mk);
  const categories = Object.entries(spend).sort((a, b) => b[1] - a[1]);
  const budgets = budgetProgress(data, mk);
  const budgetedCats = new Set(budgets.map((b) => b.category));
  const unbudgeted = categories.filter(([cat]) => !budgetedCats.has(cat));

  return `<div class="card">
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
      <h3>Where it went — ${MONTH_NAMES[parseInt(mk.slice(5, 7), 10) - 1]}</h3>
      <button class="btn small secondary" id="manage-budgets-btn">Manage budgets</button>
    </div>
    ${
      budgets.length
        ? `<div style="margin-bottom:16px;">${budgets.map(budgetBarHtml).join('')}</div>`
        : '<p class="muted" style="font-size:12.5px; margin-bottom:12px;">No budgets set yet — click "Manage budgets" to set a monthly limit per category and track progress here.</p>'
    }
    ${
      unbudgeted.length
        ? `<div class="muted" style="font-size:11.5px; text-transform:uppercase; margin-bottom:6px;">No budget set</div>
      ${unbudgeted.map(([cat, amt]) => `<div style="display:flex; justify-content:space-between; font-size:12.5px; padding:4px 0;"><span>${CATEGORY_ICONS[cat] || '🔖'} ${cat}</span><span class="mono">${peso(amt)}</span></div>`).join('')}`
        : ''
    }
    ${!categories.length ? '<div class="empty">No expenses logged this month yet.</div>' : ''}
  </div>`;
}

// ---------- Account balances ----------

function accountBalancesHtml(data) {
  const rows = accountBalancesList(data);
  return `<div class="card">
    <h3 style="margin-bottom:10px;">Account balances</h3>
    ${
      rows.length
        ? rows
            .map(
              (r) => `<div class="clickable-row" data-open-account="${r.id}" style="display:flex; justify-content:space-between; padding:7px 4px; border-bottom:1px solid var(--line); border-radius:6px;">
          <span>${r.name}</span>
          <span class="mono ${r.isCredit && r.balance < 0 ? 'neg' : ''}" style="font-weight:600;">${peso(r.isCredit ? Math.abs(r.balance) : r.balance)}</span>
        </div>`
            )
            .join('')
        : '<div class="empty">No accounts yet.</div>'
    }
  </div>`;
}

function wireAccountBalances(container) {
  container.querySelectorAll('[data-open-account]').forEach((row) => {
    row.onclick = () => {
      openAccountDetail(row.dataset.openAccount);
      const accountsTab = document.querySelector('#nav button[data-view="accounts"]');
      if (accountsTab) accountsTab.click();
    };
  });
}

// ---------- Liquid vs. illiquid ----------

function liquidityHtml(data) {
  const l = liquidityBreakdown(data);

  // Per-account breakdown backing the two totals above, so the card has
  // something to show beyond the bar once accounts exist — and so "which
  // accounts count as illiquid" is visible, not just the total. MP2/market
  // funds have no single account, so they're listed as their own line
  // under Illiquid, matching how liquidityBreakdown() counts them.
  const liquidAccts = [];
  const illiquidAccts = [];
  data.accounts.forEach((a) => {
    if (a.archived || accountType(a) === 'Liability') return;
    const bal = toBaseCurrency(a, accountBalance(data, a.id));
    (accountLiquidity(a) === 'liquid' ? liquidAccts : illiquidAccts).push({ name: a.name, balance: bal });
  });
  // MP2 and market-fund holdings have no single "account" of their own, so
  // rather than one lumped "Investments & MP2" line, break each out by its
  // own fund/holding — same per-fund/per-holding math the Investments tab
  // itself uses, just re-shown here.
  data.mp2Funds.forEach((f) => {
    const bal = mp2FundBalance(data, f.id);
    if (bal) illiquidAccts.push({ name: `MP2 — ${f.name}`, balance: bal });
  });
  data.holdings.forEach((h) => {
    const val = invToBaseCurrency(h, holdingSummary(data, h).totalValue);
    if (val) illiquidAccts.push({ name: h.name || h.ticker, balance: val });
  });
  liquidAccts.sort((a, b) => b.balance - a.balance);
  illiquidAccts.sort((a, b) => b.balance - a.balance);

  const acctRow = (a) => `<div style="display:flex; justify-content:space-between; font-size:12px; padding:3px 0;"><span class="muted">${a.name}</span><span class="mono">${peso(a.balance)}</span></div>`;

  return `<div class="card">
    <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:4px;">
      <h3>Liquid vs. illiquid</h3>
      <span class="mono" style="font-weight:600;">${peso(l.total)}</span>
    </div>
    <p class="muted" style="font-size:12px; margin-bottom:12px;">Spendable today vs. locked up in MP2, funds, or tagged illiquid.</p>
    <div style="display:flex; height:14px; border-radius:7px; overflow:hidden; background:var(--surface-2); margin-bottom:10px;">
      <div style="width:${(l.liquidPct * 100).toFixed(1)}%; background:var(--gold);"></div>
      <div style="width:${(l.illiquidPct * 100).toFixed(1)}%; background:var(--ink-soft);"></div>
    </div>
    <div style="display:flex; gap:18px; font-size:12.5px; margin-bottom:16px;">
      <div><span style="display:inline-block; width:9px; height:9px; border-radius:50%; background:var(--gold); margin-right:6px;"></span>Liquid ${peso(l.liquid)} (${(l.liquidPct * 100).toFixed(1)}%)</div>
      <div><span style="display:inline-block; width:9px; height:9px; border-radius:50%; background:var(--ink-soft); margin-right:6px;"></span>Illiquid ${peso(l.illiquid)} (${(l.illiquidPct * 100).toFixed(1)}%)</div>
    </div>
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:20px;">
      <div>
        <div class="muted" style="font-size:11px; text-transform:uppercase; letter-spacing:0.03em; margin-bottom:4px;">Liquid</div>
        ${liquidAccts.length ? liquidAccts.map(acctRow).join('') : '<div class="muted" style="font-size:12px;">None</div>'}
      </div>
      <div>
        <div class="muted" style="font-size:11px; text-transform:uppercase; letter-spacing:0.03em; margin-bottom:4px;">Illiquid</div>
        ${illiquidAccts.length ? illiquidAccts.map(acctRow).join('') : '<div class="muted" style="font-size:12px;">None</div>'}
      </div>
    </div>
  </div>`;
}

// ---------- Cash flow forecast ----------

function forecastHtml(data) {
  const currentYear = new Date().getFullYear();
  const isLive = forecastYear === currentYear;
  const yearOptions = Array.from(new Set([currentYear, ...txYears(data)])).sort((a, b) => b - a);

  const yearSelectHtml = `<select id="forecast-year-select" style="height:32px; font-size:12.5px; padding:4px 8px;">${yearOptions
    .map((y) => `<option value="${y}" ${y === forecastYear ? 'selected' : ''}>${y === currentYear ? `${y} (live forecast)` : y}</option>`)
    .join('')}</select>`;

  let bodyHtml;
  if (isLive) {
    const f = cashFlowForecast(data);
    const warn = f.projected < 0;
    const totalExpected = data.routines.reduce((s, r) => s + (r.expectedAmount || 0), 0);
    const paidAmount = Math.max(0, totalExpected - f.unpaid);
    const points = [
      { label: 'Today', value: f.today },
      { label: 'Month end (if all routines paid)', value: f.projected },
    ];
    bodyHtml = `
    <div style="display:flex; gap:22px; flex-wrap:wrap; margin:6px 0 14px;">
      <div>
        <div class="muted" style="font-size:11px; text-transform:uppercase; letter-spacing:0.03em; margin-bottom:3px;">Paid so far</div>
        <div class="mono" style="font-size:15px; font-weight:600;">${peso(paidAmount)}</div>
      </div>
      <div>
        <div class="muted" style="font-size:11px; text-transform:uppercase; letter-spacing:0.03em; margin-bottom:3px;">Remaining due</div>
        <div class="mono" style="font-size:15px; font-weight:600;">${peso(f.unpaid)}</div>
      </div>
      <div>
        <div class="muted" style="font-size:11px; text-transform:uppercase; letter-spacing:0.03em; margin-bottom:3px;">Projected month-end</div>
        <div class="mono ${warn ? 'neg' : ''}" style="font-size:21px; font-weight:700;">${peso(f.projected)}</div>
      </div>
    </div>
    <p class="${warn ? 'neg' : 'muted'}" style="font-size:12.5px; margin:0 0 10px;">
      ${
        f.unpaid > 0
          ? `${peso(f.unpaid)} in unpaid routines still due this month${warn ? ' — projected balance would go negative.' : '.'}`
          : 'All routines for this month are checked off — no drag on your projected balance.'
      }
    </p>
    ${buildLineChartSvg(points, { negativeIsWarning: true, compact: true })}`;
  } else {
    const series = monthEndBalanceSeries(data, forecastYear);
    bodyHtml = series.length
      ? `<p class="muted" style="font-size:12.5px; margin:4px 0 10px;">Liquid balance at the end of each month in ${forecastYear}. Hover a point for its exact figure.</p>
         ${buildLineChartSvg(series, { compact: false })}`
      : `<div class="empty">No transactions recorded in ${forecastYear} yet.</div>`;
  }

  return `<div class="card">
    <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;">
      <h3>${isLive ? 'Cash flow forecast' : `Balance history — ${forecastYear}`}</h3>
      ${yearSelectHtml}
    </div>
    ${bodyHtml}
  </div>`;
}

// ---------- Income vs Expense / Sankey ----------

function flowChartHtml(data) {
  const { income, expense } = monthlyIncomeExpense(data, flowChartYear);
  const mk = monthKey();
  const inc = incomeByCategory(data, mk);
  const exp = expenseByCategory(data, mk);
  const incomeFlows = Object.entries(inc).map(([label, value]) => ({ label, value }));
  const expenseFlows = Object.entries(exp).map(([label, value]) => ({ label, value }));
  const netSavings = Object.values(inc).reduce((s, v) => s + v, 0) - Object.values(exp).reduce((s, v) => s + v, 0);

  // display:flex column + the chart wrapper's flex:1 is what lets the
  // chart itself grow/shrink with the card — and the card's own height
  // comes from the .duo-grid row it sits in (align-items:stretch), which
  // is set by whichever sibling is taller. In practice that sibling is
  // "Where it went": more (or fewer) budgeted categories there makes that
  // card taller (or shorter), this card stretches to match via the grid,
  // and then the chart wrapper's flex:1 + buildBarChartSvg's fillHeight
  // option let the SVG itself actually fill that space instead of sitting
  // pinned to a fixed aspect ratio with dead space below it.
  return `<div class="card" style="display:flex; flex-direction:column;">
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px; flex-wrap:wrap; gap:8px;">
      <h3>${flowChartMode === 'bar' ? `Income vs. expense — ${flowChartYear}` : `Cash flow map — ${MONTH_NAMES[parseInt(mk.slice(5, 7), 10) - 1]}`}</h3>
      <div style="display:flex; gap:8px; align-items:center;">
        ${flowChartMode === 'bar' ? `<select id="flow-year-select">${[flowChartYear - 1, flowChartYear, flowChartYear + 1].map((y) => `<option value="${y}" ${y === flowChartYear ? 'selected' : ''}>${y}</option>`).join('')}</select>` : ''}
        <button class="btn small secondary" id="flow-mode-toggle">${flowChartMode === 'bar' ? 'Show as cash flow map' : 'Show as bar chart'}</button>
      </div>
    </div>
    ${
      flowChartMode === 'bar'
        ? `<div style="display:flex; gap:16px; align-items:center; margin-bottom:8px; font-size:12.5px;">
            <span style="display:flex; align-items:center; gap:6px;"><span style="width:10px; height:10px; border-radius:3px; background:var(--green); display:inline-block;"></span>Income</span>
            <span style="display:flex; align-items:center; gap:6px;"><span style="width:10px; height:10px; border-radius:3px; background:var(--rust); display:inline-block;"></span>Expense</span>
          </div>`
        : ''
    }
    <div style="flex:1; min-height:180px; display:flex;">
      ${
        flowChartMode === 'bar'
          ? buildBarChartSvg(income, expense, SHORT_MONTHS, { fillHeight: true })
          : incomeFlows.length || expenseFlows.length
            ? buildSankeySvg(incomeFlows, expenseFlows, netSavings)
            : '<div class="empty">No income or expenses logged this month yet.</div>'
      }
    </div>
  </div>`;
}

// ---------- Entry point ----------

/**
 * Renders the Dashboard view into `container`. Re-invoked on every store
 * change and local UI-state change (chart mode/year), so it always
 * reflects current data.
 * @param {HTMLElement} container
 */
export function renderDashboardView(container) {
  const data = getData();
  if (!data) {
    container.innerHTML = '<div class="empty">Loading…</div>';
    return;
  }

  const liquid = liquidBalance(data);
  const loansOutstanding = totalOutstandingAcrossLoans(data);
  // Net worth = everything owned (accounts, already net of credit-card debt
  // since a card's own balance goes negative as it's charged, plus MP2 and
  // market-fund investments) minus everything owed on installment loans.
  // Loans live in their own collection and never touch an account balance
  // directly (see loansService.js), so without this subtraction a person
  // with an active loan would see an inflated net worth that ignores real
  // debt entirely.
  const netWorth = totalBalance(data) + mp2Total(data) + investmentsTotal(data) - loansOutstanding;
  const invT = mp2Total(data) + investmentsTotal(data);

  container.innerHTML = `
    <div class="page-head"><div><h1>Dashboard</h1><div class="sub">Everything at a glance.</div></div></div>

    <!-- 2 hero cards (the numbers that matter most at a glance) + a lighter
         chip row for the rest, instead of 6 same-weight boxes. -->
    <div class="kpi-hero-row" style="margin-bottom:12px;">
      <div class="card kpi hero"><div class="label">Net worth</div><div class="value">${peso(netWorth)}</div></div>
      <div class="card kpi hero"><div class="label">Liquid balance</div><div class="value">${peso(liquid)}</div></div>
    </div>
    <div class="kpi-chip-row" style="margin-bottom:16px;">
      <div class="kpi-chip"><span class="chip-label">Investments + MP2</span><span class="chip-value mono">${peso(invT)}</span></div>
      <div class="kpi-chip"><span class="chip-label">Credit owed</span><span class="chip-value mono ${creditOwed(data) > 0 ? 'neg' : ''}">${peso(creditOwed(data))}</span></div>
      <div class="kpi-chip"><span class="chip-label">Dividends earned</span><span class="chip-value mono pos">${peso(totalDividendsEarned(data))}</span></div>
      <div class="kpi-chip"><span class="chip-label">Loans outstanding</span><span class="chip-value mono ${loansOutstanding > 0 ? 'neg' : ''}">${peso(loansOutstanding)}</span></div>
    </div>

    <!-- Account balances / This month's routines: 1 col phone, 2 col from
         tablet up. align-items left at its grid default (stretch) so both
         cards in a row share the taller one's height, instead of ragged
         bottoms. -->
    <div class="duo-grid" style="margin-bottom:16px;">
      ${accountBalancesHtml(data)}
      ${routinesSectionHtml(data)}
    </div>

    <!-- Income vs expense / Where it went: same 2-up treatment, in its own
         row below the first, rather than all 4 crammed into one row. The
         chart card stretches to match whatever height "Where it went"
         ends up needing (more/fewer budgeted categories) — see
         flowChartHtml()'s flex layout and buildBarChartSvg's fillHeight
         option, which is what actually lets the chart fill that height
         instead of leaving empty space or getting clipped. -->
    <div class="duo-grid" style="margin-bottom:16px;">
      ${flowChartHtml(data)}
      ${whereItWentHtml(data)}
    </div>

    <!-- Liquid vs. illiquid / Cash flow forecast: 1 col phone, 2 col from
         tablet through desktop. -->
    <div class="duo-grid">
      ${liquidityHtml(data)}
      ${forecastHtml(data)}
    </div>
  `;

  wireAccountBalances(container);
  wireRoutinesSection(container, data);
  const forecastYearSel = container.querySelector('#forecast-year-select');
  if (forecastYearSel) {
    forecastYearSel.onchange = (e) => {
      forecastYear = parseInt(e.target.value, 10);
      renderDashboardView(container);
    };
  }

  const yearSel = container.querySelector('#flow-year-select');
  if (yearSel) {
    yearSel.onchange = (e) => {
      flowChartYear = parseInt(e.target.value, 10);
      renderDashboardView(container);
    };
  }
  container.querySelector('#flow-mode-toggle').onclick = () => {
    flowChartMode = flowChartMode === 'bar' ? 'sankey' : 'bar';
    renderDashboardView(container);
  };

  container.querySelector('#manage-budgets-btn').onclick = () => {
    openBudgetsModal(data, () => renderDashboardView(container));
  };
}
