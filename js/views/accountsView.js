import { getData, addItem, updateItem, deleteItem, replaceData } from '../state/store.js';
import {
  ACCOUNT_TYPES,
  accountType,
  accountLiquidity,
  accountBalance,
  accountClearedBalance,
  toBaseCurrency,
  totalBalance,
} from '../services/accountsService.js';
import { peso, parseAmount, downloadFile } from '../utils/format.js';
import { openModal, onModalSubmit, confirmModal, infoModal } from '../components/modal.js';
import {
  isSupported as autoBackupSupported,
  getBackupConfig,
  chooseBackupFolder,
  setAutoBackupEnabled,
  reauthorizeBackupFolder,
} from '../state/autoBackup.js';

/** View-local UI state — not persisted, resets on reload. */
let sortKey = 'name';
let detailAccountId = null;

/**
 * Lets another view (e.g. the Dashboard's "Account balances" list) deep-link
 * straight into one account's detail screen the next time this view renders.
 * @param {string} accountId
 */
export function openAccountDetail(accountId) {
  detailAccountId = accountId;
}

// ---------- Auto-backup card ----------
// A second, optional backup path alongside the manual Export/Import
// buttons above: pick a folder once, and a dated backup JSON gets written
// there automatically on the last day of every month. See
// js/state/autoBackup.js for exactly what this can and can't guarantee.

function autoBackupStatusHtml(supported, config) {
  if (!supported) {
    return '<p class="muted" style="font-size:12.5px;">Not available in this browser — writing straight to a folder needs a Chromium-based browser (Chrome, Edge, Brave, etc.). Manual export/import above works everywhere.</p>';
  }
  if (!config.folderHandle) {
    return `<p class="muted" style="font-size:12.5px; margin-bottom:10px;">Pick a folder once, and a dated backup is written there automatically on the last day of every month — the next time this app is open that day — alongside your manual exports above.</p>
      <button class="btn small secondary" id="choose-backup-folder-btn">Choose backup folder…</button>`;
  }
  if (config.needsReauth) {
    return `<p class="neg" style="font-size:12.5px; margin-bottom:8px;">Lost write access to <b>${config.folderName}</b> — the browser needs one click to re-grant it before the next auto-backup can run.</p>
      <button class="btn small accent" id="reauth-backup-btn">Re-authorize folder access</button>`;
  }
  if (!config.enabled) {
    return `<p class="muted" style="font-size:12.5px; margin-bottom:10px;">Off. Folder still remembered: <b>${config.folderName}</b>.</p>
      <div style="display:flex; gap:8px;">
        <button class="btn small secondary" id="enable-auto-backup-btn">Turn on</button>
        <button class="btn small secondary" id="choose-backup-folder-btn">Change folder…</button>
      </div>`;
  }
  return `<p style="font-size:12.5px; margin-bottom:6px;">Backing up to <b>${config.folderName}</b> on the last day of each month.</p>
    <p class="muted" style="font-size:12px; margin-bottom:10px;">${
      config.lastBackupMonth
        ? `Last auto-backup: ${config.lastBackupMonth}`
        : "No auto-backup has run yet — it runs the next time this app is open on the last day of a month."
    }</p>
    <div style="display:flex; gap:8px;">
      <button class="btn small secondary" id="choose-backup-folder-btn">Change folder…</button>
      <button class="btn small secondary" id="disable-auto-backup-btn">Turn off</button>
    </div>`;
}

function wireAutoBackupButtons(container) {
  const chooseBtn = container.querySelector('#choose-backup-folder-btn');
  if (chooseBtn) {
    chooseBtn.onclick = async () => {
      const result = await chooseBackupFolder();
      if (!result.ok && result.error !== 'cancelled') {
        infoModal('Couldn\'t set that folder', '<p class="muted">The browser didn\'t grant access to that folder. Try again.</p>');
      }
      refreshAutoBackupCard(container);
    };
  }
  const disableBtn = container.querySelector('#disable-auto-backup-btn');
  if (disableBtn) {
    disableBtn.onclick = async () => {
      await setAutoBackupEnabled(false);
      refreshAutoBackupCard(container);
    };
  }
  const enableBtn = container.querySelector('#enable-auto-backup-btn');
  if (enableBtn) {
    enableBtn.onclick = async () => {
      await setAutoBackupEnabled(true);
      refreshAutoBackupCard(container);
    };
  }
  const reauthBtn = container.querySelector('#reauth-backup-btn');
  if (reauthBtn) {
    reauthBtn.onclick = async () => {
      const granted = await reauthorizeBackupFolder();
      if (!granted) {
        infoModal('Still not authorized', '<p class="muted">Permission wasn\'t granted. Try again, or choose a different folder.</p>');
      }
      refreshAutoBackupCard(container);
    };
  }
}

/**
 * Fetches the current auto-backup config (async — it's stored separately
 * from the main ledger data) and fills in the card's status area. Called
 * once when the view first renders and again after any action inside the
 * card, rather than routing through the full renderAccountsView(), so
 * picking a folder doesn't also reset scroll position/sort/etc.
 * @param {HTMLElement} container
 */
async function refreshAutoBackupCard(container) {
  const statusEl = container.querySelector('#auto-backup-status');
  if (!statusEl) return;
  const supported = autoBackupSupported();
  const config = supported ? await getBackupConfig() : null;
  statusEl.innerHTML = autoBackupStatusHtml(supported, config || {});
  wireAutoBackupButtons(container);
}

const SORT_FNS = {
  name: (a, b) => a.name.localeCompare(b.name),
  type: (a, b) =>
    (ACCOUNT_TYPES[a.type] || '').localeCompare(ACCOUNT_TYPES[b.type] || '') ||
    a.name.localeCompare(b.name),
  liquidity: (a, b) =>
    accountLiquidity(a).localeCompare(accountLiquidity(b)) || a.name.localeCompare(b.name),
};

/**
 * @param {string} sel - currently-selected type key
 * @returns {string} <option> tags for every account type
 */
function accountTypeOptions(sel) {
  return Object.entries(ACCOUNT_TYPES)
    .map(([k, v]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${v}</option>`)
    .join('');
}

/**
 * Formats an amount in an account's native currency, with a muted PHP-
 * equivalent alongside it when the account isn't already in PHP.
 * @param {Object} a
 * @param {number} amount
 * @returns {string}
 */
function amountWithBase(a, amount) {
  const isForeign = a.currency && a.currency !== 'PHP';
  const native = isForeign
    ? `${a.currency} ${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : peso(amount);
  if (!isForeign) return native;
  return `${native} <span class="muted" style="font-size:11px;">(${peso(toBaseCurrency(a, amount))})</span>`;
}

/**
 * Renders one account's table row.
 * @param {Object} data
 * @param {Object} a - the account
 * @returns {string}
 */
function accountRow(data, a) {
  const bal = accountBalance(data, a.id);
  const isCredit = accountType(a) === 'Liability';
  const liq = accountLiquidity(a);
  return `<tr class="clickable-row" data-open-account="${a.id}">
    <td>${a.name}</td>
    <td><span class="tag">${ACCOUNT_TYPES[a.type] || 'Bank'}</span>${a.currency && a.currency !== 'PHP' ? ` <span class="tag">${a.currency}</span>` : ''}</td>
    <td>${
      isCredit
        ? '<span class="muted" style="font-size:12px;">— liability</span>'
        : `<button class="badge liquidity-toggle" data-id="${a.id}" data-cur="${liq}">${liq === 'liquid' ? 'Liquid' : 'Illiquid'}</button>`
    }</td>
    <td class="num">${amountWithBase(a, a.openingBalance)}</td>
    <td class="num ${isCredit && bal < 0 ? 'neg' : ''}" style="font-weight:600;">${isCredit ? amountWithBase(a, Math.abs(bal)) : amountWithBase(a, bal)}${isCredit && bal < 0 ? ' owed' : ''}</td>
    <td style="white-space:nowrap;">
      <button class="icon-btn edit-account" data-id="${a.id}" title="Edit">✎</button>
      <button class="icon-btn archive-toggle" data-id="${a.id}" data-archived="${!!a.archived}" title="${a.archived ? 'Unarchive' : 'Archive'}">${a.archived ? '↩' : '📦'}</button>
      <button class="icon-btn danger-hover" data-del-account="${a.id}" title="Remove">✕</button>
    </td>
  </tr>`;
}

/**
 * Opens the add/edit account modal. Passing an existing account pre-fills
 * the form and updates in place; omitting it adds a new account.
 * @param {Object} [account]
 */
function openAccountModal(account) {
  const isEdit = !!account;
  const overlay = openModal(
    isEdit ? 'Edit account' : 'Add a bank, e-wallet, or credit card',
    `<div class="field"><label>Name</label><input name="name" required placeholder="e.g. Seabank, RCBC Credit Card" value="${isEdit ? account.name : ''}"></div>
     <div class="field"><label>Type</label><select name="type">${accountTypeOptions(isEdit ? account.type : 'bank')}</select></div>
     <div class="field"><label>Opening balance</label><input type="text" inputmode="decimal" class="amount-input" name="opening" placeholder="0.00" ${isEdit ? `value="${account.openingBalance}"` : ''}></div>
     <div class="field"><label>Currency</label><input name="currency" placeholder="PHP" value="${isEdit ? account.currency || 'PHP' : 'PHP'}" style="text-transform:uppercase;" maxlength="3"></div>
     <div class="field"><label>Exchange rate (₱ per 1 unit, if not PHP)</label><input type="number" name="fxRate" step="0.0001" min="0" placeholder="e.g. 56.50" value="${isEdit && account.fxRate != null ? account.fxRate : ''}"></div>`,
    isEdit ? 'Save changes' : 'Add account'
  );
  onModalSubmit(overlay, async (fd) => {
    const name = fd.get('name').trim();
    if (!name) return;
    const currency = (fd.get('currency') || 'PHP').trim().toUpperCase() || 'PHP';
    const fxRateRaw = fd.get('fxRate');
    const payload = {
      name,
      type: fd.get('type') || 'bank',
      openingBalance: parseAmount(fd.get('opening')),
      currency,
      fxRate: currency === 'PHP' ? 1 : fxRateRaw !== '' ? parseFloat(fxRateRaw) : 1,
    };
    if (isEdit) {
      await updateItem('accounts', account.id, payload);
    } else {
      const data = getData();
      await addItem('accounts', { ...payload, order: data.accounts.length + 1 });
    }
  });
}

// ---------- Account detail: App Balance vs Cleared Balance ----------

function renderAccountDetail(container, data, accountId) {
  const a = data.accounts.find((x) => x.id === accountId);
  if (!a) {
    detailAccountId = null;
    renderAccountsView(container);
    return;
  }
  const appBalance = accountBalance(data, a.id);
  const clearedBalance = accountClearedBalance(data, a.id);
  const isCredit = accountType(a) === 'Liability';

  container.innerHTML = `
    <div class="page-head"><div><button class="btn small secondary" id="back-btn" style="margin-bottom:10px;">← Back to accounts</button>
      <h1>${a.name}</h1><div class="sub">${ACCOUNT_TYPES[a.type] || 'Bank'}${a.currency && a.currency !== 'PHP' ? ` · ${a.currency}` : ''}</div></div></div>
    <div class="grid kpis" style="display:grid; gap:16px; grid-template-columns:repeat(2,1fr); margin-bottom:16px;">
      <div class="card kpi">
        <div class="label">App balance</div>
        <div class="value">${amountWithBase(a, isCredit ? Math.abs(appBalance) : appBalance)}</div>
      </div>
      <div class="card kpi">
        <div class="label">Cleared balance</div>
        <div class="value">${amountWithBase(a, isCredit ? Math.abs(clearedBalance) : clearedBalance)}</div>
      </div>
    </div>
    <div class="card">
      <p class="muted" style="font-size:12.5px;">Cleared balance counts only transactions marked "cleared" — use this to match your actual bank statement. A transaction with no cleared/pending status yet counts as cleared by default, which is why these two figures match for now: the Cleared/Pending toggle lives on each transaction row, in the Transactions view.</p>
    </div>
  `;

  container.querySelector('#back-btn').onclick = () => {
    detailAccountId = null;
    renderAccountsView(container);
  };
}

// ---------- Main list ----------

/**
 * Renders the Accounts view into `container` and wires all its interactions.
 * Re-invoked on every store change (the caller subscribes) and every local
 * UI-state change (sort, detail drill-in), so it always reflects current data.
 * @param {HTMLElement} container
 */
export function renderAccountsView(container) {
  const data = getData();
  if (!data) {
    container.innerHTML = '<div class="empty">Loading…</div>';
    return;
  }

  if (detailAccountId) {
    renderAccountDetail(container, data, detailAccountId);
    return;
  }

  const sortFn = SORT_FNS[sortKey];
  const active = data.accounts.filter((a) => !a.archived).sort(sortFn);
  const archived = data.accounts.filter((a) => a.archived).sort(sortFn);

  container.innerHTML = `
    <div class="page-head">
      <div><h1>Accounts</h1><div class="sub">Opening balances carry forward automatically — every transaction after them keeps the running total current. Click a row for balance detail.</div></div>
      <div class="filters">
        <select id="acct-sort">
          <option value="name" ${sortKey === 'name' ? 'selected' : ''}>Sort: Account name</option>
          <option value="type" ${sortKey === 'type' ? 'selected' : ''}>Sort: Type</option>
          <option value="liquidity" ${sortKey === 'liquidity' ? 'selected' : ''}>Sort: Liquidity</option>
        </select>
        <button class="btn small secondary" id="export-json-btn">Export backup (.json)</button>
        <button class="btn small secondary" id="import-json-btn">Import backup</button>
        <input type="file" id="import-file" accept=".json" style="display:none;">
      </div>
    </div>
    <div class="card" style="margin-bottom:20px;">
      <table>
        <thead><tr><th>Account</th><th>Type</th><th>Liquidity</th><th class="num">Opening balance</th><th class="num">Current balance</th><th></th></tr></thead>
        <tbody>
          ${active.map((a) => accountRow(data, a)).join('') || '<tr><td colspan="6" class="empty">No accounts yet — add one below.</td></tr>'}
          ${
            active.length
              ? `<tr><td style="font-weight:600;">Total (excl. credit cards, ₱ equiv.)</td><td></td><td></td><td></td><td class="num" style="font-weight:600;">${peso(totalBalance(data, true))}</td><td></td></tr>`
              : ''
          }
        </tbody>
      </table>
    </div>
    ${
      archived.length
        ? `<div class="section-title"><h2 style="font-size:15px;">Archived accounts</h2><div class="rule"></div></div>
    <div class="card" style="margin-bottom:20px;">
      <table><thead><tr><th>Account</th><th>Type</th><th>Liquidity</th><th class="num">Opening balance</th><th class="num">Current balance</th><th></th></tr></thead>
      <tbody>${archived.map((a) => accountRow(data, a)).join('')}</tbody></table>
      <p class="muted" style="font-size:12px; margin-top:10px;">Hidden from totals. Still fully traceable in Transactions once that view lands.</p>
    </div>`
        : ''
    }
    <div class="card" style="margin-bottom:20px;">
      <h3 style="margin-bottom:10px;">Auto-backup</h3>
      <div id="auto-backup-status"><p class="muted" style="font-size:12.5px;">Checking…</p></div>
    </div>
    <form id="add-account-form" class="card form-row">
      <div class="field"><label>Account name</label><input type="text" name="name" required placeholder="e.g. Seabank, RCBC credit card"></div>
      <div class="field"><label>Type</label><select name="type">${accountTypeOptions('bank')}</select></div>
      <div class="field"><label>Opening balance</label><input type="text" inputmode="decimal" class="amount-input" name="opening" placeholder="0.00"></div>
      <div class="field"><label>Currency</label><input name="currency" placeholder="PHP" value="PHP" style="text-transform:uppercase; width:70px;" maxlength="3"></div>
      <div class="field"><label>FX rate (if not PHP)</label><input type="number" name="fxRate" step="0.0001" min="0" placeholder="e.g. 56.50" style="width:110px;"></div>
      <button class="btn small" type="submit">+ Add account</button>
    </form>
    <p class="muted" style="font-size:12.5px; margin-top:14px;">For a credit card: add it here as type "Credit card." Record each purchase as an Expense from the card account once Transactions is built. For a foreign-currency account (e.g. a USD brokerage cash balance), set its currency and an exchange rate so it rolls up correctly into the ₱ totals above.</p>
  `;

  container.querySelector('#acct-sort').onchange = (e) => {
    sortKey = e.target.value;
    renderAccountsView(container);
  };

  refreshAutoBackupCard(container);

  container.querySelectorAll('[data-open-account]').forEach((row) => {
    row.onclick = (e) => {
      if (e.target.closest('button')) return;
      detailAccountId = row.dataset.openAccount;
      renderAccountsView(container);
    };
  });

  container.querySelectorAll('.edit-account').forEach((btn) => {
    btn.onclick = () => {
      const account = data.accounts.find((a) => a.id === btn.dataset.id);
      if (account) openAccountModal(account);
    };
  });

  container.querySelectorAll('.archive-toggle').forEach((btn) => {
    btn.onclick = async () => {
      const archived = btn.dataset.archived === 'true';
      await updateItem('accounts', btn.dataset.id, { archived: !archived });
    };
  });

  container.querySelectorAll('.liquidity-toggle').forEach((btn) => {
    btn.onclick = async () => {
      const next = btn.dataset.cur === 'liquid' ? 'illiquid' : 'liquid';
      await updateItem('accounts', btn.dataset.id, { liquidity: next });
    };
  });

  container.querySelectorAll('[data-del-account]').forEach((btn) => {
    btn.onclick = () => {
      const id = btn.dataset.delAccount;
      const used = data.transactions.some((t) => t.account === id || t.toAccount === id);
      if (used) {
        infoModal(
          'Can&rsquo;t remove this account',
          '<p class="muted">This account has transactions on record — remove those first.</p>'
        );
        return;
      }
      confirmModal('Remove this account?', true, async () => {
        await deleteItem('accounts', id);
      });
    };
  });

  container.querySelector('#add-account-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const name = fd.get('name').trim();
    if (!name) return;
    const currency = (fd.get('currency') || 'PHP').trim().toUpperCase() || 'PHP';
    const fxRateRaw = fd.get('fxRate');
    await addItem('accounts', {
      name,
      type: fd.get('type') || 'bank',
      openingBalance: parseAmount(fd.get('opening')),
      currency,
      fxRate: currency === 'PHP' ? 1 : fxRateRaw !== '' ? parseFloat(fxRateRaw) : 1,
      order: data.accounts.length + 1,
    });
    e.target.reset();
  };

  container.querySelector('#export-json-btn').onclick = () => {
    downloadFile(
      `ledger-backup-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(data, null, 2),
      'application/json'
    );
  };

  const fileInput = container.querySelector('#import-file');
  container.querySelector('#import-json-btn').onclick = () => fileInput.click();
  fileInput.onchange = () => {
    const file = fileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      confirmModal(
        'Importing will replace everything currently in this ledger with the backup file. Continue?',
        true,
        async () => {
          try {
            const parsed = JSON.parse(reader.result);
            await replaceData(parsed);
          } catch (err) {
            infoModal('Import failed', '<p class="muted">That file doesn\'t look like a valid backup.</p>');
          }
        }
      );
    };
    reader.readAsText(file);
  };
}
