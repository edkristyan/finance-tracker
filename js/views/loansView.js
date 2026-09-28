import { getData, addItem, updateItem, deleteItem } from '../state/store.js';
import {
  monthlyPayment,
  loanPaymentsFor,
  principalPaidTotal,
  interestPaidTotal,
  outstandingBalance,
  payoffProgressPct,
  splitPayment,
  amortizationSchedule,
  totalInterestScheduled,
  estimatedPayoffDate,
  totalOutstandingAcrossLoans,
} from '../services/loansService.js';
import { peso, parseAmount, fmtDate } from '../utils/format.js';
import { openModal, onModalSubmit, confirmModal, infoModal } from '../components/modal.js';

/** View-local UI state — not persisted, resets on reload. */
let detailLoanId = null;

/**
 * Lets another view deep-link straight into a loan's detail screen the next
 * time this view renders (same pattern as accountsView.openAccountDetail).
 * @param {string} loanId
 */
export function openLoanDetail(loanId) {
  detailLoanId = loanId;
}

/**
 * @param {Object} data
 * @param {string} [selectedId]
 * @returns {string} <option> tags: a blank "no account" choice plus every
 *   non-archived account, for the "pay from" selects.
 */
function accountOptions(data, selectedId) {
  const blank = `<option value="" ${!selectedId ? 'selected' : ''}>— none (already paid elsewhere) —</option>`;
  const opts = data.accounts
    .filter((a) => !a.archived)
    .map((a) => `<option value="${a.id}" ${a.id === selectedId ? 'selected' : ''}>${a.name}</option>`)
    .join('');
  return blank + opts;
}

// ---------- Add / edit loan ----------

function openLoanModal(loan) {
  const data = getData();
  const isEdit = !!loan;
  const overlay = openModal(
    isEdit ? 'Edit loan' : 'Add a loan',
    `<div class="field"><label>Name</label><input name="name" required placeholder="e.g. Car loan, Home mortgage" value="${isEdit ? loan.name : ''}"></div>
     <div class="field"><label>Original principal</label><input type="text" inputmode="decimal" class="amount-input" name="principal" required placeholder="0.00" ${isEdit ? `value="${loan.principal}"` : ''}></div>
     <div class="field"><label>Annual interest rate (%)</label><input type="number" name="rate" step="0.01" min="0" required placeholder="e.g. 12" value="${isEdit ? loan.annualRatePct : ''}"></div>
     <div class="field"><label>Term (months)</label><input type="number" name="term" min="1" required placeholder="e.g. 36" value="${isEdit ? loan.termMonths : ''}"></div>
     <div class="field"><label>Start date</label><input type="date" name="startDate" required value="${isEdit ? loan.startDate : new Date().toISOString().slice(0, 10)}"></div>
     <div class="field"><label>Usually paid from</label><select name="paymentAccount">${accountOptions(data, isEdit ? loan.paymentAccount : '')}</select></div>
     <div class="field"><label>Notes (optional)</label><input name="notes" placeholder="e.g. Lender, account number" value="${isEdit ? loan.notes || '' : ''}"></div>`,
    isEdit ? 'Save changes' : 'Add loan'
  );
  onModalSubmit(overlay, async (fd) => {
    const name = fd.get('name').trim();
    const principal = parseAmount(fd.get('principal'));
    const termMonths = parseInt(fd.get('term'), 10);
    if (!name || !principal || !termMonths) return;
    const payload = {
      name,
      principal,
      annualRatePct: parseFloat(fd.get('rate')) || 0,
      termMonths,
      startDate: fd.get('startDate'),
      paymentAccount: fd.get('paymentAccount') || '',
      notes: fd.get('notes').trim(),
    };
    if (isEdit) await updateItem('loans', loan.id, payload);
    else await addItem('loans', payload);
  });
}

// ---------- Log / edit a payment ----------

function openPaymentModal(loan, payment) {
  const data = getData();
  const isEdit = !!payment;
  const outstanding = outstandingBalance(data, loan, isEdit ? payment.id : undefined);
  const suggested = monthlyPayment(loan);
  const overlay = openModal(
    isEdit ? 'Edit payment' : 'Log a payment',
    `<p class="muted" style="font-size:12px; margin:-4px 0 12px;">Outstanding balance right now: <b>${peso(outstanding)}</b>. Scheduled payment: ${peso(suggested)}.</p>
     <div class="field"><label>Date</label><input type="date" name="date" required value="${isEdit ? payment.date : new Date().toISOString().slice(0, 10)}"></div>
     <div class="field"><label>Amount</label><input type="text" inputmode="decimal" class="amount-input" name="amount" required placeholder="${suggested.toFixed(2)}" ${isEdit ? `value="${payment.amount}"` : ''}></div>
     <div class="field"><label>Pay from</label><select name="account">${accountOptions(data, isEdit ? payment.account : loan.paymentAccount)}</select></div>
     <div class="field"><label>Note (optional)</label><input name="note" placeholder="e.g. Payment #14" value="${isEdit ? payment.note || '' : ''}"></div>`,
    isEdit ? 'Save changes' : 'Log payment'
  );
  onModalSubmit(overlay, async (fd) => {
    const amount = parseAmount(fd.get('amount'));
    if (!amount) return;
    const date = fd.get('date');
    const account = fd.get('account') || '';
    const note = fd.get('note').trim();
    const { interestPortion, principalPortion } = splitPayment(loan, outstanding, amount);
    const details = `${loan.name} payment${note ? ` — ${note}` : ''} (${peso(principalPortion)} principal / ${peso(interestPortion)} interest)`;

    let txId = isEdit ? payment.txId : undefined;
    if (account) {
      const txPayload = { type: 'Expense', category: 'Loan Payment', account, amount, date, details, direction: 'out' };
      if (txId) await updateItem('transactions', txId, txPayload);
      else txId = await addItem('transactions', txPayload);
    } else if (txId) {
      // Switched from "pay from an account" to "already paid elsewhere" —
      // the transaction that used to represent this payment no longer belongs.
      await deleteItem('transactions', txId);
      txId = undefined;
    }

    const paymentPayload = { loanId: loan.id, date, amount, principalPortion, interestPortion, account, note, txId };
    if (isEdit) await updateItem('loanPayments', payment.id, paymentPayload);
    else await addItem('loanPayments', paymentPayload);
  });
}

// ---------- Loan detail: schedule + payment history ----------

function scheduleRowsHtml(loan, paymentsMade) {
  const schedule = amortizationSchedule(loan);
  return schedule
    .map(
      (row) => `<tr class="${row.period <= paymentsMade ? '' : 'muted'}">
      <td>${row.period}</td>
      <td>${fmtDate(row.date)}</td>
      <td class="num">${peso(row.payment)}</td>
      <td class="num">${peso(row.principal)}</td>
      <td class="num">${peso(row.interest)}</td>
      <td class="num">${peso(row.balance)}</td>
      <td>${row.period <= paymentsMade ? '<span class="tag" style="background:var(--gold-soft); color:var(--gold);">Paid</span>' : ''}</td>
    </tr>`
    )
    .join('');
}

function paymentRowHtml(p) {
  return `<tr>
    <td>${fmtDate(p.date)}</td>
    <td class="num">${peso(p.amount)}</td>
    <td class="num">${peso(p.principalPortion)}</td>
    <td class="num">${peso(p.interestPortion)}</td>
    <td>${p.note || ''}${p.txId ? ' <span class="muted" style="font-size:11px;">(linked transaction)</span>' : ''}</td>
    <td style="white-space:nowrap;">
      <button class="icon-btn edit-payment" data-id="${p.id}" title="Edit">✎</button>
      <button class="icon-btn danger-hover del-payment" data-id="${p.id}" title="Delete">✕</button>
    </td>
  </tr>`;
}

function renderLoanDetail(container, data, loanId) {
  const loan = data.loans.find((l) => l.id === loanId);
  if (!loan) {
    detailLoanId = null;
    renderLoansView(container);
    return;
  }
  const payments = loanPaymentsFor(data, loan.id);
  const outstanding = outstandingBalance(data, loan);
  const principalPaid = principalPaidTotal(data, loan.id);
  const interestPaid = interestPaidTotal(data, loan.id);
  const progress = payoffProgressPct(data, loan);
  const payoffDate = estimatedPayoffDate(loan);
  const paidOff = outstanding <= 0.005;

  container.innerHTML = `
    <div class="page-head"><div><button class="btn small secondary" id="back-btn" style="margin-bottom:10px;">← Back to loans</button>
      <h1>${loan.name}</h1>
      <div class="sub">${loan.annualRatePct}% APR · ${loan.termMonths}-month term · started ${fmtDate(loan.startDate)}${paidOff ? ' · <b style="color:var(--green);">Paid off</b>' : ''}</div></div>
      <div class="filters"><button class="btn small" id="log-payment-btn" ${paidOff ? 'disabled' : ''}>+ Log payment</button></div>
    </div>

    <div class="grid kpis" style="display:grid; gap:16px; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); margin-bottom:16px;">
      <div class="card kpi"><div class="label">Outstanding balance</div><div class="value">${peso(outstanding)}</div></div>
      <div class="card kpi"><div class="label">Principal paid</div><div class="value pos">${peso(principalPaid)}</div></div>
      <div class="card kpi"><div class="label">Interest paid</div><div class="value">${peso(interestPaid)}</div></div>
      <div class="card kpi"><div class="label">Scheduled payment</div><div class="value">${peso(monthlyPayment(loan))}</div></div>
      <div class="card kpi"><div class="label">Est. payoff date</div><div class="value" style="font-size:16px;">${payoffDate ? fmtDate(payoffDate) : '—'}</div></div>
    </div>

    <div class="card" style="margin-bottom:20px;">
      <div style="display:flex; justify-content:space-between; font-size:12.5px; margin-bottom:6px;">
        <span>Payoff progress</span><span class="mono">${(progress * 100).toFixed(1)}%</span>
      </div>
      <div style="background:var(--surface-2); border-radius:6px; height:10px; overflow:hidden;">
        <div style="width:${(progress * 100).toFixed(1)}%; height:100%; background:var(--gold); border-radius:6px;"></div>
      </div>
      ${loan.notes ? `<p class="muted" style="font-size:12px; margin-top:12px;">${loan.notes}</p>` : ''}
    </div>

    <div class="section-title"><h2 style="font-size:15px;">Payment history</h2><div class="rule"></div></div>
    <div class="card" style="margin-bottom:20px;">
      <table>
        <thead><tr><th>Date</th><th class="num">Amount</th><th class="num">Principal</th><th class="num">Interest</th><th>Note</th><th></th></tr></thead>
        <tbody>${payments.map(paymentRowHtml).join('') || '<tr><td colspan="6" class="empty">No payments logged yet.</td></tr>'}</tbody>
      </table>
    </div>

    <div class="section-title"><h2 style="font-size:15px;">Amortization schedule</h2><div class="rule"></div></div>
    <div class="card">
      <p class="muted" style="font-size:12px; margin-bottom:12px;">The theoretical schedule if every payment were exactly on time and on
        amount — actual progress above is tracked from what you've really logged, which may run ahead or behind this.</p>
      <div style="max-height:360px; overflow-y:auto;">
        <table>
          <thead><tr><th>#</th><th>Date</th><th class="num">Payment</th><th class="num">Principal</th><th class="num">Interest</th><th class="num">Balance</th><th></th></tr></thead>
          <tbody>${scheduleRowsHtml(loan, payments.length)}</tbody>
        </table>
      </div>
      <p class="muted" style="font-size:12px; margin-top:12px;">Total interest over the full schedule: <b>${peso(totalInterestScheduled(loan))}</b></p>
    </div>
  `;

  container.querySelector('#back-btn').onclick = () => {
    detailLoanId = null;
    renderLoansView(container);
  };
  const logBtn = container.querySelector('#log-payment-btn');
  if (logBtn) logBtn.onclick = () => openPaymentModal(loan);

  container.querySelectorAll('.edit-payment').forEach((btn) => {
    btn.onclick = () => {
      const payment = payments.find((p) => p.id === btn.dataset.id);
      if (payment) openPaymentModal(loan, payment);
    };
  });
  container.querySelectorAll('.del-payment').forEach((btn) => {
    btn.onclick = () => {
      const payment = payments.find((p) => p.id === btn.dataset.id);
      if (!payment) return;
      confirmModal(
        'Delete this payment? This also removes its linked transaction, if it has one.',
        true,
        async () => {
          if (payment.txId) await deleteItem('transactions', payment.txId);
          await deleteItem('loanPayments', payment.id);
        }
      );
    };
  });
}

// ---------- Main list ----------

function loanCardHtml(data, loan) {
  const outstanding = outstandingBalance(data, loan);
  const progress = payoffProgressPct(data, loan);
  const paidOff = outstanding <= 0.005;
  return `<div class="card fund-card" data-open-loan="${loan.id}">
    <div style="display:flex; justify-content:space-between; align-items:start; margin-bottom:6px;">
      <h3 style="font-size:15px;">${loan.name}</h3>
      <div>
        <button class="icon-btn edit-loan" data-id="${loan.id}" title="Edit">✎</button>
        <button class="icon-btn archive-loan-toggle" data-id="${loan.id}" data-archived="${!!loan.archived}" title="${loan.archived ? 'Unarchive' : 'Archive'}">${loan.archived ? '↩' : '📦'}</button>
        <button class="icon-btn danger-hover del-loan" data-id="${loan.id}" title="Remove">✕</button>
      </div>
    </div>
    <div class="tag" style="margin-bottom:10px;">${loan.annualRatePct}% APR · ${loan.termMonths} mo</div>
    <div style="background:var(--surface-2); border-radius:6px; height:8px; overflow:hidden; margin-bottom:8px;">
      <div style="width:${(progress * 100).toFixed(1)}%; height:100%; background:${paidOff ? 'var(--green)' : 'var(--gold)'}; border-radius:6px;"></div>
    </div>
    <div style="display:flex; justify-content:space-between; font-size:13px;">
      <span class="muted">${paidOff ? 'Paid off' : 'Outstanding'}</span>
      <span class="mono" style="font-weight:600;">${paidOff ? peso(0) : peso(outstanding)}</span>
    </div>
  </div>`;
}

/**
 * Renders the Loans view into `container` and wires all its interactions.
 * Re-invoked on every store change and every local UI-state change
 * (detail drill-in), so it always reflects current data.
 * @param {HTMLElement} container
 */
export function renderLoansView(container) {
  const data = getData();
  if (!data) {
    container.innerHTML = '<div class="empty">Loading…</div>';
    return;
  }

  if (detailLoanId) {
    renderLoanDetail(container, data, detailLoanId);
    return;
  }

  const active = data.loans.filter((l) => !l.archived);
  const archived = data.loans.filter((l) => l.archived);

  container.innerHTML = `
    <div class="page-head">
      <div><h1>Loans &amp; Liabilities</h1><div class="sub">Track what you owe separately from what you have. Click a loan for its full amortization schedule and payment history.</div></div>
      <div class="filters"><button class="btn small" id="add-loan-btn">+ Add loan</button></div>
    </div>

    <div class="grid kpis" style="display:grid; gap:16px; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); margin-bottom:20px;">
      <div class="card kpi"><div class="label">Total outstanding</div><div class="value neg">${peso(totalOutstandingAcrossLoans(data))}</div></div>
      <div class="card kpi"><div class="label">Active loans</div><div class="value">${active.length}</div></div>
    </div>

    <div class="grid" style="display:grid; gap:16px; grid-template-columns:repeat(auto-fit,minmax(260px,1fr));">
      ${active.map((l) => loanCardHtml(data, l)).join('') || '<div class="empty">No loans yet — add one to start tracking its payoff.</div>'}
    </div>

    ${
      archived.length
        ? `<div class="section-title"><h2 style="font-size:15px;">Archived loans</h2><div class="rule"></div></div>
    <div class="grid" style="display:grid; gap:16px; grid-template-columns:repeat(auto-fit,minmax(260px,1fr));">
      ${archived.map((l) => loanCardHtml(data, l)).join('')}
    </div>`
        : ''
    }
  `;

  container.querySelector('#add-loan-btn').onclick = () => openLoanModal();

  container.querySelectorAll('[data-open-loan]').forEach((card) => {
    card.onclick = (e) => {
      if (e.target.closest('button')) return;
      detailLoanId = card.dataset.openLoan;
      renderLoansView(container);
    };
  });

  container.querySelectorAll('.edit-loan').forEach((btn) => {
    btn.onclick = () => {
      const loan = data.loans.find((l) => l.id === btn.dataset.id);
      if (loan) openLoanModal(loan);
    };
  });

  container.querySelectorAll('.archive-loan-toggle').forEach((btn) => {
    btn.onclick = async () => {
      const archived = btn.dataset.archived === 'true';
      await updateItem('loans', btn.dataset.id, { archived: !archived });
    };
  });

  container.querySelectorAll('.del-loan').forEach((btn) => {
    btn.onclick = () => {
      const id = btn.dataset.id;
      const hasPayments = data.loanPayments.some((p) => p.loanId === id);
      if (hasPayments) {
        infoModal(
          'Can&rsquo;t remove this loan',
          '<p class="muted">This loan has payments logged against it — archive it instead if it\'s paid off, or delete its payments first if you really want to remove it entirely.</p>'
        );
        return;
      }
      confirmModal('Remove this loan?', true, async () => {
        await deleteItem('loans', id);
      });
    };
  });
}
