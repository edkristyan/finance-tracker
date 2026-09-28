import { getData, addItem, upsertItem, deleteItem } from '../state/store.js';
import {
  TX_TYPES,
  txIcon,
  years,
  allCategoryNames,
  allTags,
  categoryLabel,
  filterTransactions,
  expenseTotal,
} from '../services/transactionsService.js';
import { isExpenseLike, isIncomeLike } from '../utils/transactionMath.js';
import { peso, fmtDate, parseAmount, csvEscape, downloadFile } from '../utils/format.js';
import { MONTH_NAMES } from '../utils/constants.js';
import { openModal, onModalSubmit, confirmModal } from '../components/modal.js';

/** View-local UI state — filters, not persisted, resets on reload. */
let filters = { year: 'all', month: 'all', accounts: [], type: 'all', tag: 'all', sort: 'date-desc' };

/** Add-entry form's split-mode state, reset each time the form re-renders. */
let addSplitMode = false;
let addSplitRows = [{ category: '', amount: '' }];

function accountName(data, id) {
  const a = data.accounts.find((x) => x.id === id);
  return a ? a.name : id;
}

/**
 * @param {Object} data
 * @param {string} [sel]
 * @param {boolean} [includeNone] - adds an "external / not tracked" option (for Transfer's "to")
 * @returns {string}
 */
function accountOptionsHtml(data, sel, includeNone) {
  let html = includeNone ? '<option value="">— External / not tracked —</option>' : '';
  const list = data.accounts
    .filter((a) => !a.archived || a.id === sel)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));
  html += list.map((a) => `<option value="${a.id}" ${a.id === sel ? 'selected' : ''}>${a.name}</option>`).join('');
  return html;
}

// ---------- Split-row editor (shared by the add form and the edit modal) ----------

/**
 * Renders the split-rows editor markup.
 * @param {Array<{category:string, amount:string|number}>} rows
 * @param {Array<string>} catNames
 * @returns {string}
 */
function splitRowsHtml(rows, catNames) {
  return rows
    .map(
      (r, i) => `<div class="form-row split-row" data-idx="${i}" style="margin-bottom:6px;">
      <input type="text" class="split-category" list="split-cat-list" placeholder="Category" value="${(r.category || '').replace(/"/g, '&quot;')}" style="flex:1; min-width:0;">
      <input type="text" inputmode="decimal" class="amount-input split-amount" placeholder="0.00" value="${r.amount || ''}" style="width:110px;">
      <button type="button" class="icon-btn danger-hover remove-split" data-idx="${i}" title="Remove">✕</button>
    </div>`
    )
    .join('');
}

/**
 * Wires a split-rows editor: add/remove rows and a live validation summary
 * comparing the split total against the master amount input.
 * @param {HTMLElement} root - the modal/form root containing #split-rows and the amount input
 * @param {Array<Object>} rows - mutable rows array this editor operates on
 * @param {Array<string>} catNames
 * @param {HTMLInputElement} amountInput - the master transaction amount field
 */
function wireSplitEditor(root, rows, catNames, amountInput) {
  const rowsBox = root.querySelector('#split-rows');
  const summary = root.querySelector('#split-summary');

  const readRows = () => {
    rowsBox.querySelectorAll('.split-row').forEach((rowEl, i) => {
      rows[i] = {
        category: rowEl.querySelector('.split-category').value,
        amount: rowEl.querySelector('.split-amount').value,
      };
    });
  };

  const updateSummary = () => {
    readRows();
    const splitTotal = rows.reduce((sum, r) => sum + parseAmount(r.amount), 0);
    const master = parseAmount(amountInput.value);
    const ok = Math.abs(splitTotal - master) < 0.005;
    summary.className = ok ? 'muted' : 'neg';
    summary.style.fontSize = '12.5px';
    summary.textContent = `Split total: ${peso(splitTotal)} / ${peso(master)} (master amount)${ok ? ' ✓' : ' — must match to save'}`;
  };

  const redraw = () => {
    rowsBox.innerHTML = splitRowsHtml(rows, catNames);
    rowsBox.querySelectorAll('.split-amount, .split-category').forEach((el) => el.addEventListener('input', updateSummary));
    rowsBox.querySelectorAll('.remove-split').forEach((btn) => {
      btn.onclick = () => {
        rows.splice(parseInt(btn.dataset.idx, 10), 1);
        if (!rows.length) rows.push({ category: '', amount: '' });
        redraw();
        updateSummary();
      };
    });
  };

  redraw();
  updateSummary();
  amountInput.addEventListener('input', updateSummary);
  root.querySelector('#add-split-row').onclick = () => {
    readRows();
    rows.push({ category: '', amount: '' });
    redraw();
    updateSummary();
  };
}

/**
 * Validates a set of split rows against a master amount.
 * @param {Array<{category:string, amount:string|number}>} rows
 * @param {number} masterAmount
 * @returns {{ok: boolean, splits: Array<{category:string, amount:number}>}}
 */
function validateSplits(rows, masterAmount) {
  const splits = rows
    .map((r) => ({ category: (r.category || '').trim() || 'Others', amount: parseAmount(r.amount) }))
    .filter((r) => r.amount > 0);
  const total = splits.reduce((sum, r) => sum + r.amount, 0);
  return { ok: splits.length > 0 && Math.abs(total - masterAmount) < 0.005, splits };
}

// ---------- Main view ----------

/**
 * Renders the Transactions view into `container` and wires all its
 * interactions. Re-invoked on every store change and every local
 * filter/UI-state change, so it always reflects current data.
 * @param {HTMLElement} container
 */
export function renderTransactionsView(container) {
  const data = getData();
  if (!data) {
    container.innerHTML = '<div class="empty">Loading…</div>';
    return;
  }

  const rows = filterTransactions(data, filters);
  const catNames = allCategoryNames(data);
  const tags = allTags(data);
  const accountsLabel =
    filters.accounts.length === 0
      ? 'All accounts'
      : filters.accounts.length === 1
        ? accountName(data, filters.accounts[0])
        : `${filters.accounts.length} accounts`;
  const anyFilterActive =
    filters.year !== 'all' || filters.month !== 'all' || filters.accounts.length > 0 || filters.type !== 'all' || filters.tag !== 'all';

  container.innerHTML = `
    <div class="page-head">
      <div><h1>Transactions</h1><div class="sub">Every entry, in one ledger. Add #tags in Details to group spending across categories — e.g. "Sushi dinner #JapanTrip2026".</div></div>
    </div>

    <div class="card" style="margin-bottom:20px;">
      <h3>Add an entry</h3>
      <form id="tx-form" class="form-row">
        <div class="field"><label>Date</label><input type="date" name="date" required value="${new Date().toISOString().slice(0, 10)}"></div>
        <div class="field"><label>Type</label><select name="type" id="tx-type-input">${TX_TYPES.map((t) => `<option value="${t}">${t}</option>`).join('')}</select></div>
        <div class="field"><label>Account</label><select name="account" id="tx-account-select">${accountOptionsHtml(data)}</select></div>
        <div class="field" id="to-account-field" style="display:none;"><label>To account</label><select name="toAccount" id="tx-to-account-select">${accountOptionsHtml(data, '', true)}</select></div>
        <div class="field" id="category-field"><label>Category</label><div style="display:flex; gap:6px;">
          <input type="text" name="category" list="cat-list" placeholder="e.g. Utilities" id="tx-category-input">
          <button type="button" class="btn small secondary" id="new-category-btn">+ New</button>
        </div></div>
        <div class="field"><label>Details</label><input type="text" name="details" placeholder="e.g. Meralco bill #householdbills"></div>
        <div class="field"><label>Amount</label><input type="text" inputmode="decimal" class="amount-input" name="amount" id="tx-amount-input" required placeholder="0.00"></div>
        <button type="button" class="btn small secondary" id="add-split-toggle">${addSplitMode ? 'Remove split' : 'Split'}</button>
        <button class="btn" type="submit">Add entry</button>
        <datalist id="cat-list">${catNames.map((c) => `<option value="${c}">`).join('')}</datalist>
        ${
          addSplitMode
            ? `<div style="width:100%; margin-top:10px;"><div id="split-rows"></div>
          <button type="button" class="btn small secondary" id="add-split-row">+ Add split</button>
          <div id="split-summary" class="muted" style="margin-top:6px;"></div>
          <datalist id="split-cat-list">${catNames.map((c) => `<option value="${c}">`).join('')}</datalist>
        </div>`
            : ''
        }
      </form>
    </div>

    <div class="filters" style="margin-bottom:16px;">
      <select id="t-year"><option value="all" ${filters.year === 'all' ? 'selected' : ''}>All years</option>${years(data).map((y) => `<option value="${y}" ${filters.year === y ? 'selected' : ''}>${y}</option>`).join('')}</select>
      <select id="t-month"><option value="all" ${filters.month === 'all' ? 'selected' : ''}>All months</option>${MONTH_NAMES.map((m, i) => `<option value="${i + 1}" ${filters.month === i + 1 ? 'selected' : ''}>${m}</option>`).join('')}</select>
      <button class="btn small secondary" id="t-account-btn">${accountsLabel} ▾</button>
      <select id="t-type"><option value="all">All types</option>${TX_TYPES.map((t) => `<option value="${t}" ${filters.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <select id="t-tag"><option value="all">All tags</option>${tags.map((tg) => `<option value="${tg}" ${filters.tag === tg ? 'selected' : ''}>#${tg}</option>`).join('')}</select>
      <select id="t-sort">
        <option value="date-desc" ${filters.sort === 'date-desc' ? 'selected' : ''}>Date: newest first</option>
        <option value="date-asc" ${filters.sort === 'date-asc' ? 'selected' : ''}>Date: oldest first</option>
        <option value="recent" ${filters.sort === 'recent' ? 'selected' : ''}>Recently added</option>
        <option value="type" ${filters.sort === 'type' ? 'selected' : ''}>Type</option>
        <option value="category" ${filters.sort === 'category' ? 'selected' : ''}>Category</option>
      </select>
      ${anyFilterActive ? '<button class="btn small accent" id="clear-filters-btn">Clear filters</button>' : ''}
      <button class="btn small info" id="export-csv-btn">Export CSV</button>
    </div>

    ${
      filters.tag !== 'all'
        ? `<div class="card" style="margin-bottom:16px; display:flex; justify-content:space-between; align-items:center;">
      <div>Showing <b>${rows.length}</b> ${rows.length === 1 ? 'entry' : 'entries'} tagged <span class="tag">#${filters.tag}</span></div>
      <div class="mono" style="font-weight:600;">Total cost: ${peso(expenseTotal(rows))}</div>
    </div>`
        : ''
    }

    <table>
      <thead><tr><th>Date</th><th>Type</th><th>Details</th><th>Category</th><th>Account</th><th class="num">Amount</th><th></th></tr></thead>
      <tbody>
        ${
          rows
            .map(
              (t) => `<tr>
            <td>${fmtDate(t.date)}</td>
            <td><span class="tag ${t.type.toLowerCase()}">${t.type}</span></td>
            <td><span style="margin-right:6px;">${txIcon(t)}</span>${t.details || ''}</td>
            <td>${categoryLabel(t)}${t.splits && t.splits.length ? ' <span class="tag">split</span>' : ''}</td>
            <td>${accountName(data, t.account)}${t.toAccount ? ` → ${accountName(data, t.toAccount)}` : ''}</td>
            <td class="num ${isExpenseLike(t) ? 'neg' : isIncomeLike(t) ? 'pos' : ''}">${isExpenseLike(t) ? '-' : ''}${peso(t.amount)}</td>
            <td style="white-space:nowrap;"><button class="icon-btn" data-edit="${t.id}" title="Edit">✎</button><button class="icon-btn danger-hover" data-del="${t.id}" title="Delete">✕</button></td>
          </tr>`
            )
            .join('') || '<tr><td colspan="7" class="empty">No transactions match these filters.</td></tr>'
        }
      </tbody>
    </table>
  `;

  // ---- filters ----
  container.querySelector('#t-year').onchange = (e) => {
    filters.year = e.target.value === 'all' ? 'all' : parseInt(e.target.value, 10);
    renderTransactionsView(container);
  };
  container.querySelector('#t-month').onchange = (e) => {
    filters.month = e.target.value === 'all' ? 'all' : parseInt(e.target.value, 10);
    renderTransactionsView(container);
  };
  container.querySelector('#t-type').onchange = (e) => {
    filters.type = e.target.value;
    renderTransactionsView(container);
  };
  container.querySelector('#t-tag').onchange = (e) => {
    filters.tag = e.target.value;
    renderTransactionsView(container);
  };
  container.querySelector('#t-sort').onchange = (e) => {
    filters.sort = e.target.value;
    renderTransactionsView(container);
  };
  container.querySelector('#t-account-btn').onclick = () => {
    const usage = {};
    data.transactions.forEach((t) => {
      usage[t.account] = (usage[t.account] || 0) + 1;
      if (t.toAccount) usage[t.toAccount] = (usage[t.toAccount] || 0) + 1;
    });
    const sortedAccounts = data.accounts.slice().sort((a, b) => {
      if (!!a.archived !== !!b.archived) return a.archived ? 1 : -1;
      return (usage[b.id] || 0) - (usage[a.id] || 0);
    });
    const fieldsHtml = sortedAccounts
      .map(
        (a) =>
          `<label style="display:flex; align-items:center; gap:8px; padding:4px 0;"><input type="checkbox" name="acc" value="${a.id}" ${filters.accounts.includes(a.id) ? 'checked' : ''}> <span>${a.name}${a.archived ? ' <span class="muted">(archived)</span>' : ''}</span></label>`
      )
      .join('');
    const overlay = openModal('Filter by account', `<div>${fieldsHtml}</div>`, 'Apply');
    onModalSubmit(overlay, async (fd) => {
      filters.accounts = fd.getAll('acc');
      renderTransactionsView(container);
    });
  };
  const clearBtn = container.querySelector('#clear-filters-btn');
  if (clearBtn) {
    clearBtn.onclick = () => {
      filters = { year: 'all', month: 'all', accounts: [], type: 'all', tag: 'all', sort: 'date-desc' };
      renderTransactionsView(container);
    };
  }

  container.querySelector('#export-csv-btn').onclick = () => {
    const header = ['Date', 'Type', 'Category', 'Account', 'To Account', 'Details', 'Amount'];
    const lines = [header.join(',')];
    rows.forEach((t) =>
      lines.push(
        [t.date, t.type, categoryLabel(t), accountName(data, t.account), t.toAccount ? accountName(data, t.toAccount) : '', t.details || '', t.amount]
          .map(csvEscape)
          .join(',')
      )
    );
    downloadFile('transactions.csv', lines.join('\n'), 'text/csv');
  };

  // ---- add-entry form ----
  const typeInput = container.querySelector('#tx-type-input');
  const toField = container.querySelector('#to-account-field');
  const catField = container.querySelector('#category-field');
  const amountInput = container.querySelector('#tx-amount-input');
  const syncFields = () => {
    const isMove = typeInput.value === 'Transfer' || typeInput.value === 'Savings';
    toField.style.display = isMove ? '' : 'none';
    catField.style.display = isMove || addSplitMode ? 'none' : '';
  };
  typeInput.onchange = syncFields;
  syncFields();

  container.querySelector('#new-category-btn').onclick = () => {
    const overlay = openModal('Add a category', '<div class="field"><label>Category name</label><input name="name" required placeholder="e.g. School Supplies"></div>', 'Add category');
    onModalSubmit(overlay, async (fd) => {
      const name = fd.get('name').trim();
      if (!name) return;
      await addItem('categories', { name });
      container.querySelector('#tx-category-input').value = name;
    });
  };

  container.querySelector('#add-split-toggle').onclick = () => {
    addSplitMode = !addSplitMode;
    addSplitRows = [{ category: '', amount: '' }];
    renderTransactionsView(container);
  };
  if (addSplitMode) {
    wireSplitEditor(container.querySelector('#tx-form'), addSplitRows, catNames, amountInput);
  }

  container.querySelectorAll('[data-del]').forEach((btn) => {
    btn.onclick = () =>
      confirmModal("Delete this entry? This can't be undone.", true, async () => {
        await deleteItem('transactions', btn.dataset.del);
      });
  });
  container.querySelectorAll('[data-edit]').forEach((btn) => {
    btn.onclick = () => openEditTxModal(data, btn.dataset.edit, container);
  });

  container.querySelector('#tx-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const type = fd.get('type');
    const amount = parseAmount(fd.get('amount'));
    if (!amount) return;
    const doc = { date: fd.get('date'), type, account: fd.get('account'), details: fd.get('details') || '', amount, createdAt: new Date().toISOString() };

    if (addSplitMode) {
      const { ok, splits } = validateSplits(addSplitRows, amount);
      if (!ok) return; // live summary already flags the mismatch in red
      doc.splits = splits;
      doc.category = undefined;
    }

    if (type === 'Transfer' || type === 'Savings') {
      const to = fd.get('toAccount');
      if (to) {
        doc.toAccount = to;
        doc.category = 'Transfer';
      } else {
        doc.direction = 'out';
        doc.category = type;
      }
    } else {
      doc.direction = type === 'Income' || type === 'Received' ? 'in' : 'out';
      if (!addSplitMode) doc.category = fd.get('category') || 'Others';
    }

    await addItem('transactions', doc);
    addSplitMode = false;
    addSplitRows = [{ category: '', amount: '' }];
    e.target.reset();
    renderTransactionsView(container);
  };
}

// ---------- Edit modal ----------

function openEditTxModal(data, id, container) {
  const t = data.transactions.find((x) => x.id === id);
  if (!t) return;
  const catNames = allCategoryNames(data);
  let splitMode = !!(t.splits && t.splits.length);
  let splitRows = splitMode ? t.splits.map((s) => ({ category: s.category, amount: s.amount })) : [{ category: '', amount: '' }];

  const overlay = openModal(
    'Edit entry',
    `<div class="field"><label>Date</label><input type="date" name="date" required value="${t.date}"></div>
     <div class="field"><label>Type</label><select name="type" id="edit-type-input">${TX_TYPES.map((x) => `<option value="${x}" ${x === t.type ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
     <div class="field"><label>Account</label><select name="account">${accountOptionsHtml(data, t.account)}</select></div>
     <div class="field" id="edit-to-field" style="display:${t.toAccount ? '' : 'none'};"><label>To account</label><select name="toAccount">${accountOptionsHtml(data, t.toAccount || '', true)}</select></div>
     <div class="field" id="edit-cat-field" style="display:${t.toAccount || splitMode ? 'none' : ''};"><label>Category</label><input type="text" name="category" list="cat-list-edit" value="${(t.category || '').replace(/"/g, '&quot;')}"></div>
     <datalist id="cat-list-edit">${catNames.map((c) => `<option value="${c}">`).join('')}</datalist>
     <div class="field"><label>Details</label><input type="text" name="details" value="${(t.details || '').replace(/"/g, '&quot;')}"></div>
     <div class="field"><label>Amount</label><input type="text" inputmode="decimal" class="amount-input" name="amount" id="edit-amount-input" required value="${t.amount}"></div>
     <button type="button" class="btn small secondary" id="edit-split-toggle">${splitMode ? 'Remove split' : 'Split'}</button>
     <div id="edit-split-container" style="${splitMode ? '' : 'display:none;'} margin-top:10px;">
       <div id="split-rows"></div>
       <button type="button" class="btn small secondary" id="add-split-row">+ Add split</button>
       <div id="split-summary" class="muted" style="margin-top:6px;"></div>
       <datalist id="split-cat-list">${catNames.map((c) => `<option value="${c}">`).join('')}</datalist>
     </div>`,
    'Save changes'
  );

  const typeInput = overlay.querySelector('#edit-type-input');
  const toF = overlay.querySelector('#edit-to-field');
  const catF = overlay.querySelector('#edit-cat-field');
  const amountInput = overlay.querySelector('#edit-amount-input');
  const splitContainer = overlay.querySelector('#edit-split-container');

  typeInput.onchange = () => {
    const isMove = typeInput.value === 'Transfer' || typeInput.value === 'Savings';
    toF.style.display = isMove ? '' : 'none';
    catF.style.display = isMove || splitMode ? 'none' : '';
  };

  const enableSplitEditor = () => wireSplitEditor(overlay, splitRows, catNames, amountInput);
  if (splitMode) enableSplitEditor();

  overlay.querySelector('#edit-split-toggle').onclick = () => {
    splitMode = !splitMode;
    splitRows = [{ category: '', amount: '' }];
    splitContainer.style.display = splitMode ? '' : 'none';
    catF.style.display = splitMode || t.toAccount ? 'none' : '';
    if (splitMode) enableSplitEditor();
  };

  onModalSubmit(overlay, async (fd) => {
    const type = fd.get('type');
    const amount = parseAmount(fd.get('amount'));
    const doc = { date: fd.get('date'), type, account: fd.get('account'), details: fd.get('details') || '', amount, createdAt: t.createdAt };

    if (splitMode) {
      const { ok, splits } = validateSplits(splitRows, amount);
      if (!ok) return;
      doc.splits = splits;
      doc.category = undefined;
    }

    if (type === 'Transfer' || type === 'Savings') {
      const to = fd.get('toAccount');
      if (to) {
        doc.toAccount = to;
        doc.category = 'Transfer';
      } else {
        doc.direction = 'out';
        doc.category = type;
      }
    } else {
      doc.direction = type === 'Income' || type === 'Received' ? 'in' : 'out';
      if (!splitMode) doc.category = fd.get('category') || 'Others';
    }

    await upsertItem('transactions', id, doc);
    renderTransactionsView(container);
  });
}
