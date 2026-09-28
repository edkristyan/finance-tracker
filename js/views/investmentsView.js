import { getData, addItem, upsertItem, updateItem, deleteItem, mutate } from '../state/store.js';
import {
  mp2FundContribTotal,
  mp2FundDividendTotal,
  mp2FundBalance,
  mp2Total,
  mp2LastEntry,
  holdingLots,
  holdingSummary,
  investmentsTotal,
  totalDividendsEarned,
  holdingXIRR,
  renameHolding,
  toBaseCurrency,
} from '../services/investmentsService.js';
import { accountBalance, savingsLastActivity } from '../services/accountsService.js';
import { peso, pct, fmtDate, parseAmount } from '../utils/format.js';
import { MONTH_NAMES } from '../utils/constants.js';
import { openModal, onModalSubmit, confirmModal, infoModal } from '../components/modal.js';

/** View-local UI state — which detail screen (if any) is open, and the MP2 year filter. */
let detail = null; // { kind: 'mp2'|'holding', id: string } | null
let mp2YearState = {};

/** @type {HTMLElement|null} the container passed to the currently-mounted render */
let mountedContainer = null;

function goBack() {
  detail = null;
  if (mountedContainer) renderInvestmentsView(mountedContainer);
}

/**
 * @param {Object} data
 * @param {string} [selectedId]
 * @returns {string} <option> tags: a blank "not linked" choice plus every
 *   non-archived account — same shape as loansView's accountOptions(), used
 *   for MP2 contributions and lots to (optionally) link them to a real
 *   Transaction the same way logging a loan payment does.
 */
function accountOptions(data, selectedId) {
  const blank = `<option value="" ${!selectedId ? 'selected' : ''}>— none (not tracked in Transactions) —</option>`;
  const opts = data.accounts
    .filter((a) => !a.archived)
    .map((a) => `<option value="${a.id}" ${a.id === selectedId ? 'selected' : ''}>${a.name}</option>`)
    .join('');
  return blank + opts;
}

/**
 * Creates, updates, or removes the Transaction linked to an investment
 * entry (an MP2 contribution or a lot) — the exact same one-directional
 * sync pattern loansView.js uses for logged payments: picking an account
 * creates/updates an ordinary Expense or Income transaction and remembers
 * its id as `txId`; clearing the account deletes that transaction. Edits
 * made directly in the Transactions tab do NOT flow back here (documented
 * limitation, same as Loans).
 * @param {{txId?: string}} existing - the record being replaced, if editing
 * @param {string} account - selected account id, or '' for "not linked"
 * @param {{type:string, category:string, amount:number, date:string, details:string, direction:string}} txFields
 * @returns {Promise<string|undefined>} the resulting txId (or undefined if unlinked)
 */
async function syncLinkedTransaction(existing, account, txFields) {
  let txId = existing ? existing.txId : undefined;
  if (account) {
    const payload = { ...txFields, account };
    if (txId) await updateItem('transactions', txId, payload);
    else txId = await addItem('transactions', payload);
  } else if (txId) {
    await deleteItem('transactions', txId);
    txId = undefined;
  }
  return txId;
}

/**
 * Transaction type/direction for a lot, based on which way the cash moves:
 * Buy/Fee take money out of an account, Sell/Dividend bring money in.
 * @param {string} lotType - 'Buy'|'Sell'|'Dividend'|'Fee'
 * @returns {{type:string, direction:string}}
 */
function lotTxDirection(lotType) {
  return lotType === 'Sell' || lotType === 'Dividend' ? { type: 'Income', direction: 'in' } : { type: 'Expense', direction: 'out' };
}

// ---------- Top-level list ----------

function renderList(container, data) {
  const mp2T = mp2Total(data);
  const invT = investmentsTotal(data);
  const savingsAccounts = data.accounts.filter((a) => a.type === 'savings' && !a.archived);

  const mp2Sorted = data.mp2Funds.slice().sort((a, b) => {
    const la = mp2LastEntry(data, a.id);
    const lb = mp2LastEntry(data, b.id);
    const ka = la ? `${la.year}-${String(la.month).padStart(2, '0')}` : '';
    const kb = lb ? `${lb.year}-${String(lb.month).padStart(2, '0')}` : '';
    return kb.localeCompare(ka);
  });
  const holdingsSorted = data.holdings.slice().sort((a, b) => {
    const la = holdingSummary(data, a).lastLot;
    const lb = holdingSummary(data, b).lastLot;
    return (lb ? lb.date : '').localeCompare(la ? la.date : '');
  });

  container.innerHTML = `
    <div class="page-head"><div><h1>Investments</h1><div class="sub">PAG-IBIG MP2 and market funds, kept separate. Click a card for full history.</div></div></div>
    <div class="grid kpis" style="grid-template-columns:repeat(4,1fr); display:grid; gap:16px; margin-bottom:20px;">
      <div class="card kpi"><div class="label">MP2 total balance</div><div class="value">${peso(mp2T)}</div></div>
      <div class="card kpi"><div class="label">Market funds total value</div><div class="value">${peso(invT)}</div></div>
      <div class="card kpi"><div class="label">Combined portfolio</div><div class="value">${peso(mp2T + invT)}</div></div>
      <div class="card kpi"><div class="label">Dividends earned</div><div class="value pos">${peso(totalDividendsEarned(data))}</div></div>
    </div>
    <div class="section-title"><h2 style="font-size:16px;">PAG-IBIG MP2</h2><div class="rule"></div><button class="btn small secondary" id="add-fund-btn">+ Add fund</button></div>
    <div class="grid" style="display:grid; gap:16px; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); margin-bottom:20px;">
      ${
        mp2Sorted
          .map((f) => {
            const bal = mp2FundBalance(data, f.id);
            const last = mp2LastEntry(data, f.id);
            return `<div class="card fund-card" data-mp2="${f.id}">
          <h3 style="font-size:15px;">${f.name}</h3><div class="tag" style="margin:6px 0 10px;">MP2 fund</div>
          <div class="mono" style="font-size:20px; font-weight:600;">${peso(bal)}</div>
          <div class="muted" style="font-size:12px; margin-top:8px;">${last ? `Last: ${MONTH_NAMES[last.month - 1]} ${last.year} — ${peso(last.amount)}` : 'No contributions yet'}</div>
          <div style="margin-top:10px; display:flex; gap:4px;">
            <button class="icon-btn edit-fund" data-id="${f.id}" title="Edit">✎</button>
            <button class="icon-btn danger-hover del-fund" data-id="${f.id}" title="Delete">✕</button>
          </div></div>`;
          })
          .join('') || '<div class="empty">No MP2 funds yet.</div>'
      }
    </div>
    <div class="section-title"><h2 style="font-size:16px;">Market funds</h2><div class="rule"></div><button class="btn small secondary" id="add-holding-btn">+ Add holding</button></div>
    <div class="grid" style="display:grid; gap:16px; grid-template-columns:repeat(auto-fit,minmax(240px,1fr));">
      ${
        holdingsSorted
          .map((h) => {
            const s = holdingSummary(data, h);
            const netProfit = s.gl + (s.realizedGL || 0) + (s.dividends || 0) - (s.fees || 0);
            const isForeign = h.currency && h.currency !== 'PHP';
            const netProfitBase = toBaseCurrency(h, netProfit);
            return `<div class="card fund-card" data-holding="${h.ticker}">
          <h3 style="font-size:15px;">${h.name || h.ticker}</h3><div class="tag" style="margin:4px 0 10px;">${h.ticker}${h.platform ? ` · ${h.platform}` : ''}${isForeign ? ` · ${h.currency}` : ''}</div>
          <div class="mono" style="font-size:20px; font-weight:600;">${isForeign ? `${h.currency} ${s.totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : peso(s.totalValue)}</div>
          ${isForeign ? `<div class="muted" style="font-size:11px;">≈ ${peso(toBaseCurrency(h, s.totalValue))}</div>` : ''}
          <div class="${s.gl >= 0 ? 'pos' : 'neg'}" style="font-size:12.5px; margin-top:2px;">${pct(s.glPct)} G/L</div>
          <div class="${netProfit >= 0 ? 'pos' : 'neg'}" style="font-size:12px; margin-top:2px;">Net profit: ${peso(netProfitBase)}${isForeign ? ' <span class="muted">(₱ equiv.)</span>' : ''}</div>
          <div class="muted" style="font-size:12px; margin-top:8px;">${s.lastLot ? `Last: ${fmtDate(s.lastLot.date)} — ${peso(s.lastLot.totalCost)}` : 'No lots yet'}</div>
          <div style="margin-top:10px; display:flex; gap:4px;">
            <button class="icon-btn edit-holding" data-id="${h.ticker}" title="Edit fund details">✎</button>
            <button class="icon-btn danger-hover del-holding" data-id="${h.ticker}" title="Delete">✕</button>
          </div></div>`;
          })
          .join('') || '<div class="empty">No market fund holdings yet.</div>'
      }
    </div>
    <div class="section-title"><h2 style="font-size:16px;">Savings accounts</h2><div class="rule"></div></div>
    <div class="grid" style="display:grid; gap:16px; grid-template-columns:repeat(auto-fit,minmax(240px,1fr));">
      ${
        savingsAccounts
          .map((a) => {
            const bal = accountBalance(data, a.id);
            const last = savingsLastActivity(data, a.id);
            return `<div class="card fund-card" style="cursor:default;"><h3 style="font-size:15px;">${a.name}</h3><div class="tag" style="margin:6px 0 10px;">Savings account</div>
          <div class="mono" style="font-size:20px; font-weight:600;">${peso(bal)}</div>
          <div class="muted" style="font-size:12px; margin-top:8px;">${last ? `Last: ${fmtDate(last.date)} — ${peso(last.amount)}` : 'No activity yet'}</div></div>`;
          })
          .join('') ||
        '<div class="empty">No savings accounts yet — add one in Accounts, or mark an existing account as type "Savings."</div>'
      }
    </div>
  `;

  container.querySelectorAll('[data-mp2]').forEach((el) => {
    el.onclick = (e) => {
      if (e.target.closest('button')) return;
      detail = { kind: 'mp2', id: el.dataset.mp2 };
      renderInvestmentsView(container);
    };
  });
  container.querySelectorAll('[data-holding]').forEach((el) => {
    el.onclick = (e) => {
      if (e.target.closest('button')) return;
      detail = { kind: 'holding', id: el.dataset.holding };
      renderInvestmentsView(container);
    };
  });

  container.querySelector('#add-fund-btn').onclick = () => {
    const overlay = openModal(
      'New MP2 fund',
      '<div class="field"><label>Fund name</label><input name="name" required placeholder="e.g. MP2 - Personal Plan"></div>',
      'Add fund'
    );
    onModalSubmit(overlay, async (fd) => {
      const name = fd.get('name').trim();
      if (!name) return;
      await addItem('mp2Funds', { name });
    });
  };

  container.querySelectorAll('.edit-fund').forEach((btn) => {
    btn.onclick = () => {
      const f = data.mp2Funds.find((x) => x.id === btn.dataset.id);
      if (!f) return;
      const overlay = openModal(
        'Edit MP2 fund',
        `<div class="field"><label>Fund name</label><input name="name" required value="${f.name}"></div>`,
        'Save changes'
      );
      onModalSubmit(overlay, async (fd) => {
        const name = fd.get('name').trim();
        if (!name) return;
        await updateItem('mp2Funds', f.id, { name });
      });
    };
  });

  container.querySelectorAll('.del-fund').forEach((btn) => {
    btn.onclick = () => {
      const id = btn.dataset.id;
      const used = data.mp2Contrib.some((c) => c.fund === id) || data.mp2Yearly.some((y) => y.fund === id);
      if (used) {
        infoModal(
          'Can&rsquo;t remove this fund',
          '<p class="muted">This fund has contributions or dividends on record — remove those first (open the fund to clear its history).</p>'
        );
        return;
      }
      confirmModal('Remove this MP2 fund?', true, async () => {
        await deleteItem('mp2Funds', id);
      });
    };
  });

  container.querySelector('#add-holding-btn').onclick = () => {
    const overlay = openModal(
      'New market fund holding',
      `<div class="field"><label>Fund name</label><input name="name" required placeholder="e.g. BPI ABF Philippines Fund"></div>
       <div class="field"><label>Ticker / fund code</label><input name="ticker" required placeholder="e.g. BPIABFPH"></div>
       <div class="field"><label>Platform</label><input name="platform" placeholder="e.g. BPI, COL Financial, GInvest"></div>
       <div class="field"><label>Security type</label><input name="security" placeholder="e.g. UITF Bond, Stock, ETF"></div>
       <div class="field"><label>Current price per unit</label><input type="text" inputmode="decimal" class="amount-input" name="lastPrice" placeholder="0.00"></div>
       <div class="field"><label>Currency</label><input name="currency" placeholder="PHP" value="PHP" style="text-transform:uppercase;" maxlength="3"></div>
       <div class="field"><label>Exchange rate (₱ per 1 unit, if not PHP)</label><input type="number" name="fxRate" step="0.0001" min="0" placeholder="e.g. 56.50"></div>`,
      'Add holding'
    );
    onModalSubmit(overlay, async (fd) => {
      const ticker = fd.get('ticker').trim();
      if (!ticker) return;
      if (data.holdings.some((h) => h.ticker === ticker)) {
        infoModal('Ticker already exists', '<p class="muted">A holding with that ticker already exists.</p>');
        return;
      }
      const currency = (fd.get('currency') || 'PHP').trim().toUpperCase() || 'PHP';
      const fxRateRaw = fd.get('fxRate');
      await upsertItem('holdings', ticker, {
        ticker,
        name: fd.get('name').trim() || ticker,
        platform: fd.get('platform') || '',
        security: fd.get('security') || '',
        lastPrice: parseAmount(fd.get('lastPrice')),
        currency,
        fxRate: currency === 'PHP' ? 1 : fxRateRaw !== '' ? parseFloat(fxRateRaw) : 1,
      });
    });
  };

  container.querySelectorAll('.edit-holding').forEach((btn) => {
    btn.onclick = () => openEditHoldingModal(data.holdings.find((h) => h.ticker === btn.dataset.id));
  });

  container.querySelectorAll('.del-holding').forEach((btn) => {
    btn.onclick = () => {
      const ticker = btn.dataset.id;
      const hasLots = data.lots.some((l) => l.ticker === ticker);
      if (hasLots) {
        infoModal(
          'Can&rsquo;t remove this holding',
          '<p class="muted">This holding has lots on record — open it and remove those first.</p>'
        );
        return;
      }
      confirmModal('Remove this holding?', true, async () => {
        await deleteItem('holdings', ticker);
      });
    };
  });
}

/**
 * Shared "edit fund details" modal for a holding, including ticker renaming
 * (which has to move every referencing lot along with it — see
 * investmentsService.renameHolding).
 * @param {Object} h
 */
function openEditHoldingModal(h) {
  if (!h) return;
  const overlay = openModal(
    'Edit fund details',
    `<div class="field"><label>Fund name</label><input name="name" required value="${h.name || h.ticker}"></div>
     <div class="field"><label>Ticker / fund code</label><input name="ticker" required value="${h.ticker}"></div>
     <div class="field"><label>Platform</label><input name="platform" value="${h.platform || ''}"></div>
     <div class="field"><label>Security type</label><input name="security" value="${h.security || ''}"></div>
     <div class="field"><label>Currency</label><input name="currency" value="${h.currency || 'PHP'}" style="text-transform:uppercase;" maxlength="3"></div>
     <div class="field"><label>Exchange rate (₱ per 1 unit, if not PHP)</label><input type="number" name="fxRate" step="0.0001" min="0" value="${h.fxRate != null ? h.fxRate : ''}"></div>`,
    'Save changes'
  );
  onModalSubmit(overlay, async (fd) => {
    const newTicker = fd.get('ticker').trim() || h.ticker;
    if (newTicker !== h.ticker) {
      const ok = await mutate((d) => renameHolding(d, h.ticker, newTicker));
      if (!ok) {
        infoModal(
          'Can&rsquo;t rename',
          `<p class="muted">"${newTicker}" is already used by another holding — pick a different code.</p>`
        );
        return;
      }
      if (detail && detail.kind === 'holding' && detail.id === h.ticker) detail.id = newTicker;
    }
    const currency = (fd.get('currency') || 'PHP').trim().toUpperCase() || 'PHP';
    const fxRateRaw = fd.get('fxRate');
    await updateItem('holdings', newTicker, {
      name: fd.get('name').trim() || newTicker,
      platform: fd.get('platform') || '',
      security: fd.get('security') || '',
      currency,
      fxRate: currency === 'PHP' ? 1 : fxRateRaw !== '' ? parseFloat(fxRateRaw) : 1,
    });
  });
}

// ---------- MP2 fund detail ----------

function renderMp2Detail(container, data, fundId) {
  const f = data.mp2Funds.find((x) => x.id === fundId);
  if (!f) {
    goBack();
    return;
  }
  const years = Array.from(
    new Set(
      data.mp2Contrib
        .filter((c) => c.fund === fundId)
        .map((c) => c.year)
        .concat(data.mp2Yearly.filter((y) => y.fund === fundId).map((y) => y.year))
    )
  ).sort();
  const contribTotal = mp2FundContribTotal(data, fundId);
  const divTotal = mp2FundDividendTotal(data, fundId);

  container.innerHTML = `
    <div class="page-head"><div><button class="btn small secondary" id="back-btn" style="margin-bottom:10px;">← Back to investments</button>
      <h1>${f.name}</h1><div class="sub">PAG-IBIG MP2 fund — full contribution and dividend history.</div></div></div>
    <div class="grid kpis" style="display:grid; gap:16px; grid-template-columns:repeat(3,1fr); margin-bottom:16px;">
      <div class="card kpi"><div class="label">Contributions</div><div class="value">${peso(contribTotal)}</div></div>
      <div class="card kpi"><div class="label">Dividends</div><div class="value pos">${peso(divTotal)}</div></div>
      <div class="card kpi"><div class="label">Total balance</div><div class="value">${peso(contribTotal + divTotal)}</div></div>
    </div>
    <div class="card" style="margin-bottom:16px;">
      <h3>Year by year</h3>
      <table style="margin-bottom:14px;"><thead><tr><th>Year</th><th class="num">Contribution</th><th class="num">Dividend</th><th class="num">Rate</th><th class="num">Year-end balance</th><th></th></tr></thead>
      <tbody>
        ${
          years
            .map((y) => {
              const yc = data.mp2Contrib
                .filter((c) => c.fund === fundId && c.year === y)
                .reduce((sum, c) => sum + c.amount, 0);
              const yearly = data.mp2Yearly.find((x) => x.fund === fundId && x.year === y);
              const yd = (yearly && yearly.dividend) || 0;
              return `<tr><td>${y}</td><td class="num">${peso(yc)}</td><td class="num">${yd ? peso(yd) : '—'}</td>
            <td class="num">${yearly && yearly.rate != null ? `${yearly.rate.toFixed(2)}%` : '—'}</td><td class="num" style="font-weight:600;">${peso(yc + yd)}</td>
            <td><button class="icon-btn edit-mp2-year" data-year="${y}" data-div="${yd}" data-rate="${yearly && yearly.rate != null ? yearly.rate : ''}" title="Edit">✎</button></td></tr>`;
            })
            .join('') || '<tr><td colspan="6" class="empty">No contributions logged yet.</td></tr>'
        }
      </tbody></table>
      <form class="form-row" id="add-contrib-form">
        <div class="field"><label>Year</label><input type="number" name="year" required placeholder="2026" style="width:90px;"></div>
        <div class="field"><label>Month</label><select name="month">${MONTH_NAMES.map((m, i) => `<option value="${i + 1}">${m}</option>`).join('')}</select></div>
        <div class="field"><label>Amount</label><input type="text" inputmode="decimal" class="amount-input" name="amount" placeholder="0.00" style="width:110px;"></div>
        <div class="field"><label>Account (optional)</label><select name="account" style="width:170px;">${accountOptions(data)}</select></div>
        <button class="btn small" type="submit">+ Add contribution</button>
      </form>
      <p class="muted" style="font-size:12px; margin-top:10px;">Picking an account logs a matching Expense in Transactions
        (category "Investments") and keeps it in sync when you edit this contribution. Only applies when adding a brand-new
        month — adding again to a month that already has an entry just tops up its total without touching a linked transaction
        (use the month's ✎ below to manage that).</p>
    </div>
    <div class="card">
      <h3>Monthly detail</h3>
      <div class="filters" style="margin-bottom:14px;">
        <select id="mp2-detail-year">${years.map((y) => `<option value="${y}">${y}</option>`).join('') || `<option>${new Date().getFullYear()}</option>`}</select>
      </div>
      <div id="mp2-monthly-table"></div>
    </div>
  `;

  container.querySelector('#back-btn').onclick = goBack;

  const yearSel = container.querySelector('#mp2-detail-year');
  const currentYear = years.includes(mp2YearState[fundId]) ? mp2YearState[fundId] : years[years.length - 1];
  if (yearSel && currentYear) yearSel.value = currentYear;

  const drawMonthly = () => {
    const y = parseInt(yearSel.value, 10);
    mp2YearState[fundId] = y;
    const box = container.querySelector('#mp2-monthly-table');
    const entries = data.mp2Contrib.filter((c) => c.fund === fundId && c.year === y);
    box.innerHTML = `<table><thead><tr><th>Month</th><th class="num">Amount</th><th></th></tr></thead><tbody>
      ${MONTH_NAMES.map((m, i) => {
        const e = entries.find((c) => c.month === i + 1);
        return `<tr><td>${m}${e && e.txId ? ' <span class="muted" style="font-size:11px;">🔗</span>' : ''}</td><td class="num">${e ? peso(e.amount) : '—'}</td>
          <td>${e ? `<button class="icon-btn edit-mp2-month" data-id="${e.id}" data-amt="${e.amount}" data-month="${i + 1}" title="Edit">✎</button><button class="icon-btn danger-hover del-mp2-month" data-id="${e.id}" title="Delete">✕</button>` : ''}</td></tr>`;
      }).join('')}
      <tr><td style="font-weight:600;">Total</td><td class="num" style="font-weight:600;">${peso(entries.reduce((s, e) => s + e.amount, 0))}</td><td></td></tr>
    </tbody></table>`;

    box.querySelectorAll('.edit-mp2-month').forEach((btn) => {
      btn.onclick = () => {
        const entry = entries.find((c) => c.id === btn.dataset.id);
        if (!entry) return;
        const overlay = openModal(
          'Edit contribution',
          `<div class="field"><label>Amount</label><input type="text" inputmode="decimal" class="amount-input" name="amount" value="${btn.dataset.amt}"></div>
           <div class="field"><label>Account (optional)</label><select name="account">${accountOptions(data, entry.account)}</select>
             ${entry.txId ? '<p class="muted" style="font-size:11px; margin-top:4px;">Linked to a transaction — changing amount/account here updates it too; clearing the account removes it.</p>' : ''}</div>`,
          'Save'
        );
        onModalSubmit(overlay, async (fd) => {
          const amount = parseAmount(fd.get('amount'));
          const account = fd.get('account') || '';
          // Reuse the linked transaction's own date if it already has one,
          // rather than overwriting it — this modal has no date field of its
          // own, and updateItem() merges patches directly (a patch key set
          // to undefined would blank the date out, not skip it).
          const existingTx = entry.txId ? data.transactions.find((t) => t.id === entry.txId) : null;
          const date = existingTx ? existingTx.date : new Date().toISOString().slice(0, 10);
          const txId = await syncLinkedTransaction(entry, account, {
            type: 'Expense',
            category: 'Investments',
            amount,
            date,
            details: `${f.name} contribution — ${MONTH_NAMES[entry.month - 1]} ${entry.year}`,
            direction: 'out',
          });
          await updateItem('mp2Contrib', entry.id, { amount, account, txId });
        });
      };
    });
    box.querySelectorAll('.del-mp2-month').forEach((btn) => {
      btn.onclick = () => {
        const entry = entries.find((c) => c.id === btn.dataset.id);
        confirmModal(
          `Delete this month's contribution?${entry && entry.txId ? ' This also removes its linked transaction.' : ''}`,
          true,
          async () => {
            if (entry && entry.txId) await deleteItem('transactions', entry.txId);
            await deleteItem('mp2Contrib', btn.dataset.id);
          }
        );
      };
    });
  };
  if (yearSel) {
    yearSel.onchange = drawMonthly;
    drawMonthly();
  }

  container.querySelector('#add-contrib-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const year = parseInt(fd.get('year'), 10);
    const month = parseInt(fd.get('month'), 10);
    const amount = parseAmount(fd.get('amount'));
    const account = fd.get('account') || '';
    if (!year || !amount) return;
    const existing = data.mp2Contrib.find((c) => c.fund === fundId && c.year === year && c.month === month);
    if (existing) {
      // Topping up a month that already has an entry — keeps its existing
      // linked transaction (if any) untouched rather than trying to guess
      // how to merge a second cash movement into one transaction; use the
      // month's own ✎ edit to manage that transaction directly.
      await updateItem('mp2Contrib', existing.id, { amount: existing.amount + amount });
    } else {
      const txId = await syncLinkedTransaction(undefined, account, {
        type: 'Expense',
        category: 'Investments',
        amount,
        date: new Date().toISOString().slice(0, 10),
        details: `${f.name} contribution — ${MONTH_NAMES[month - 1]} ${year}`,
        direction: 'out',
      });
      await addItem('mp2Contrib', { fund: fundId, year, month, amount, account, txId });
    }
    e.target.reset();
  };

  container.querySelectorAll('.edit-mp2-year').forEach((btn) => {
    btn.onclick = () => {
      const year = parseInt(btn.dataset.year, 10);
      const overlay = openModal(
        `Dividend & rate — ${year}`,
        `<div class="field"><label>Dividend for ${year}</label><input type="text" inputmode="decimal" class="amount-input" name="dividend" value="${btn.dataset.div}"></div>
         <div class="field"><label>Rate % for ${year}</label><input type="number" name="rate" step="0.01" value="${btn.dataset.rate}"></div>`,
        'Save'
      );
      onModalSubmit(overlay, async (fd) => {
        const existing = data.mp2Yearly.find((x) => x.fund === fundId && x.year === year);
        const obj = {
          fund: fundId,
          year,
          dividend: parseAmount(fd.get('dividend')),
          rate: fd.get('rate') !== '' ? parseFloat(fd.get('rate')) : null,
        };
        if (existing) await upsertItem('mp2Yearly', existing.id, obj);
        else await addItem('mp2Yearly', obj);
      });
    };
  });
}

// ---------- Market fund holding detail ----------

function renderHoldingDetail(container, data, ticker) {
  const h = data.holdings.find((x) => x.ticker === ticker);
  if (!h) {
    goBack();
    return;
  }
  const s = holdingSummary(data, h);
  const hl = holdingLots(data, ticker)
    .slice()
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const xirrVal = holdingXIRR(data, h);
  const netProfit = s.gl + (s.realizedGL || 0) + (s.dividends || 0) - (s.fees || 0);
  const isForeign = h.currency && h.currency !== 'PHP';

  container.innerHTML = `
    <div class="page-head"><div><button class="btn small secondary" id="back-btn" style="margin-bottom:10px;">← Back to investments</button>
      <h1>${h.name || h.ticker} <button class="icon-btn edit-meta" title="Edit fund details">✎</button></h1>
      <div class="sub">${h.ticker}${h.platform ? ` · ${h.platform}` : ''}${h.security ? ` · ${h.security}` : ''}${isForeign ? ` · ${h.currency} (₱${h.fxRate || 1} per unit)` : ''}</div></div></div>
    <div class="grid kpis" style="display:grid; gap:16px; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); margin-bottom:16px;">
      <div class="card kpi"><div class="label">Total qty</div><div class="value">${s.totalQty.toFixed(4)}</div></div>
      <div class="card kpi"><div class="label">Avg. price</div><div class="value">${s.avgPrice.toFixed(2)}</div></div>
      <div class="card kpi"><div class="label">Total cost</div><div class="value">${isForeign ? `${h.currency} ${s.totalCost.toFixed(2)}` : peso(s.totalCost)}</div></div>
      <div class="card kpi"><div class="label">Last price <button class="icon-btn edit-price" title="Edit">✎</button></div><div class="value">${(h.lastPrice || 0).toFixed(2)}</div></div>
      <div class="card kpi"><div class="label">Value / G-L</div><div class="value">${isForeign ? `${h.currency} ${s.totalValue.toFixed(2)}` : peso(s.totalValue)} <span class="${s.gl >= 0 ? 'pos' : 'neg'}" style="font-size:13px;">(${pct(s.glPct)})</span></div>${isForeign ? `<div class="muted" style="font-size:11px; margin-top:4px;">≈ ${peso(toBaseCurrency(h, s.totalValue))}</div>` : ''}</div>
      <div class="card kpi"><div class="label">XIRR</div><div class="value ${xirrVal != null ? (xirrVal >= 0 ? 'pos' : 'neg') : ''}">${xirrVal != null ? pct(xirrVal) : '—'}</div></div>
      <div class="card kpi"><div class="label">Net profit${isForeign ? ' (₱ equiv.)' : ''}</div><div class="value ${netProfit >= 0 ? 'pos' : 'neg'}">${peso(toBaseCurrency(h, netProfit))}</div></div>
    </div>
    <div class="card"><h3>Lot history</h3>
      <table style="margin-bottom:14px;"><thead><tr><th>Date</th><th>Type</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Total</th><th></th></tr></thead>
      <tbody>${
        hl
          .map((l) => {
            const type = l.type || 'Buy';
            const cashOnly = type === 'Dividend' || type === 'Fee';
            return `<tr><td>${fmtDate(l.date)}</td><td><span class="tag ${type.toLowerCase()}">${type}</span>${l.txId ? ' <span class="muted" style="font-size:11px;">🔗</span>' : ''}</td>
        <td class="num">${cashOnly ? '—' : l.qty.toFixed(4)}</td><td class="num">${cashOnly ? '—' : l.price.toFixed(2)}</td><td class="num">${peso(l.totalCost)}</td>
        <td style="white-space:nowrap;"><button class="icon-btn edit-lot" data-id="${l.id}" title="Edit">✎</button><button class="icon-btn danger-hover del-lot" data-id="${l.id}" title="Delete">✕</button></td></tr>`;
          })
          .join('') || '<tr><td colspan="6" class="empty">No lots logged yet.</td></tr>'
      }</tbody></table>
      <form class="form-row" id="add-lot-form">
        <div class="field"><label>Date</label><input type="date" name="date" required value="${new Date().toISOString().slice(0, 10)}"></div>
        <div class="field"><label>Type</label><select name="type" id="lot-type-input"><option>Buy</option><option>Sell</option><option>Dividend</option><option>Fee</option></select></div>
        <div class="field"><label>Qty</label><input type="number" name="qty" id="lot-qty-input" step="0.0001" required style="width:100px;"></div>
        <div class="field"><label id="lot-price-label">Price</label><input type="text" inputmode="decimal" class="amount-input" name="price" id="lot-price-input" required style="width:100px;"></div>
        <div class="field"><label>Account (optional)</label><select name="account" style="width:170px;">${accountOptions(data)}</select></div>
        <div class="field"><label>Notes (optional)</label><input name="notes" placeholder="Rationale" style="width:160px;"></div>
        <button class="btn small" type="submit">+ Add lot</button>
      </form>
      <p class="muted" style="font-size:12px; margin-top:10px;">Picking an account logs a matching transaction in Transactions
        (Buy/Fee as an Expense, Sell/Dividend as Income, category "Investments") and keeps it in sync — editing or deleting
        this lot updates or removes that transaction too. Leave it on "not tracked" if the cash movement is already
        recorded elsewhere, or isn't represented by a single transaction.</p>
    </div>
  `;

  container.querySelector('#back-btn').onclick = goBack;

  const lotType = container.querySelector('#lot-type-input');
  const lotQty = container.querySelector('#lot-qty-input');
  const lotPriceLabel = container.querySelector('#lot-price-label');
  const syncLotFields = () => {
    const cashOnly = lotType.value === 'Dividend' || lotType.value === 'Fee';
    lotQty.disabled = cashOnly;
    if (cashOnly) {
      lotQty.value = '';
      lotQty.removeAttribute('required');
      lotPriceLabel.textContent = 'Amount';
    } else {
      lotQty.setAttribute('required', 'required');
      lotPriceLabel.textContent = 'Price';
    }
  };
  lotType.onchange = syncLotFields;
  syncLotFields();

  container.querySelector('.edit-price').onclick = () => {
    const overlay = openModal(
      'Update current price',
      `<div class="field"><label>Price per unit</label><input type="text" inputmode="decimal" class="amount-input" name="price" value="${h.lastPrice || ''}" placeholder="Enter current price per unit"></div>`,
      'Save'
    );
    onModalSubmit(overlay, async (fd) => {
      await updateItem('holdings', h.id, { lastPrice: parseAmount(fd.get('price')) });
    });
  };

  container.querySelector('.edit-meta').onclick = () => openEditHoldingModal(h);

  container.querySelectorAll('.del-lot').forEach((btn) => {
    btn.onclick = () => {
      const l = data.lots.find((x) => x.id === btn.dataset.id);
      confirmModal(
        `Delete this lot?${l && l.txId ? ' This also removes its linked transaction.' : ''}`,
        true,
        async () => {
          if (l && l.txId) await deleteItem('transactions', l.txId);
          await deleteItem('lots', btn.dataset.id);
        }
      );
    };
  });

  container.querySelectorAll('.edit-lot').forEach((btn) => {
    btn.onclick = () => {
      const l = data.lots.find((x) => x.id === btn.dataset.id);
      if (!l) return;
      const curType = l.type || 'Buy';
      const overlay = openModal(
        'Edit lot',
        `<div class="field"><label>Date</label><input type="date" name="date" required value="${l.date}"></div>
         <div class="field"><label>Type</label><select name="type" id="edit-lot-type">${['Buy', 'Sell', 'Dividend', 'Fee'].map((t) => `<option value="${t}" ${t === curType ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
         <div class="field"><label>Qty</label><input type="number" name="qty" id="edit-lot-qty" step="0.0001" value="${l.qty}" ${curType === 'Dividend' || curType === 'Fee' ? 'disabled' : ''}></div>
         <div class="field"><label id="edit-lot-price-label">${curType === 'Dividend' || curType === 'Fee' ? 'Amount' : 'Price'}</label><input type="text" inputmode="decimal" class="amount-input" name="price" required value="${l.price}"></div>
         <div class="field"><label>Account (optional)</label><select name="account">${accountOptions(data, l.account)}</select>
           ${l.txId ? '<p class="muted" style="font-size:11px; margin-top:4px;">Linked to a transaction — changing amount/date/account here updates it too; clearing the account removes it.</p>' : ''}</div>
         <div class="field"><label>Notes</label><textarea name="notes" rows="3" style="width:100%;">${l.notes || ''}</textarea></div>`,
        'Save changes'
      );
      const editType = overlay.querySelector('#edit-lot-type');
      const editQty = overlay.querySelector('#edit-lot-qty');
      const editPriceLabel = overlay.querySelector('#edit-lot-price-label');
      editType.onchange = () => {
        const cashOnly = editType.value === 'Dividend' || editType.value === 'Fee';
        editQty.disabled = cashOnly;
        if (cashOnly) editQty.value = '';
        editPriceLabel.textContent = cashOnly ? 'Amount' : 'Price';
      };
      onModalSubmit(overlay, async (fd) => {
        const type = fd.get('type');
        const cashOnly = type === 'Dividend' || type === 'Fee';
        const price = parseAmount(fd.get('price'));
        const qty = cashOnly ? 0 : parseFloat(fd.get('qty')) || 0;
        const totalCost = cashOnly ? price : Math.round(qty * price * 100) / 100;
        const date = fd.get('date');
        const notes = fd.get('notes') || '';
        const account = fd.get('account') || '';
        const { type: txType, direction } = lotTxDirection(type);
        const txId = await syncLinkedTransaction(l, account, {
          type: txType,
          category: 'Investments',
          amount: totalCost,
          date,
          details: `${h.name || ticker} — ${type}${notes ? ` (${notes})` : ''}`,
          direction,
        });
        await upsertItem('lots', l.id, {
          ticker,
          date,
          type,
          qty,
          price,
          totalCost,
          notes,
          account,
          txId,
        });
      });
    };
  });

  container.querySelector('#add-lot-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const type = fd.get('type');
    const cashOnly = type === 'Dividend' || type === 'Fee';
    const price = parseAmount(fd.get('price'));
    if (!price) return;
    const qty = cashOnly ? 0 : parseFloat(fd.get('qty'));
    if (!cashOnly && !qty) return;
    const totalCost = cashOnly ? price : Math.round(qty * price * 100) / 100;
    const date = fd.get('date');
    const notes = fd.get('notes') || '';
    const account = fd.get('account') || '';
    const { type: txType, direction } = lotTxDirection(type);
    const txId = await syncLinkedTransaction(undefined, account, {
      type: txType,
      category: 'Investments',
      amount: totalCost,
      date,
      details: `${h.name || ticker} — ${type}${notes ? ` (${notes})` : ''}`,
      direction,
    });
    await addItem('lots', { ticker, date, type, qty, price, totalCost, notes, account, txId });
    e.target.reset();
  };
}

// ---------- Entry point ----------

/**
 * Renders the Investments view (list or a drill-in detail screen) into
 * `container`. Re-invoked on every store change so it always reflects
 * current data.
 * @param {HTMLElement} container
 */
export function renderInvestmentsView(container) {
  mountedContainer = container;
  const data = getData();
  if (!data) {
    container.innerHTML = '<div class="empty">Loading…</div>';
    return;
  }

  if (detail && detail.kind === 'mp2') {
    renderMp2Detail(container, data, detail.id);
  } else if (detail && detail.kind === 'holding') {
    renderHoldingDetail(container, data, detail.id);
  } else {
    renderList(container, data);
  }
}
