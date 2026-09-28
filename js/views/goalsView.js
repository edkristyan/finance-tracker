import { getData, addItem, updateItem, deleteItem } from '../state/store.js';
import {
  goalMode,
  goalProgress,
  goalProgressPct,
  isGoalReached,
  monthsRemaining,
  requiredMonthlyContribution,
  goalContributionsFor,
  goalsTotals,
} from '../services/goalsService.js';
import { peso, parseAmount, fmtDate } from '../utils/format.js';
import { openModal, onModalSubmit, confirmModal, infoModal } from '../components/modal.js';

/** View-local UI state — not persisted, resets on reload. */
let detailGoalId = null;

/**
 * Lets another view deep-link straight into a goal's detail screen the next
 * time this view renders (same pattern as accountsView.openAccountDetail).
 * @param {string} goalId
 */
export function openGoalDetail(goalId) {
  detailGoalId = goalId;
}

/**
 * @param {Object} data
 * @param {string} [selectedId]
 * @returns {string} <option> tags: a blank "manual/unlinked" choice plus
 *   every non-archived, non-credit account.
 */
function accountOptions(data, selectedId) {
  const blank = `<option value="" ${!selectedId ? 'selected' : ''}>— none (track manually) —</option>`;
  const opts = data.accounts
    .filter((a) => !a.archived && a.type !== 'credit')
    .map((a) => `<option value="${a.id}" ${a.id === selectedId ? 'selected' : ''}>${a.name}</option>`)
    .join('');
  return blank + opts;
}

// ---------- Add / edit goal ----------

function openGoalModal(goal) {
  const data = getData();
  const isEdit = !!goal;
  const overlay = openModal(
    isEdit ? 'Edit goal' : 'Add a savings goal',
    `<div class="field"><label>Name</label><input name="name" required placeholder="e.g. Emergency fund, Japan trip 2027" value="${isEdit ? goal.name : ''}"></div>
     <div class="field"><label>Target amount</label><input type="text" inputmode="decimal" class="amount-input" name="target" required placeholder="0.00" ${isEdit ? `value="${goal.targetAmount}"` : ''}></div>
     <div class="field"><label>Target date (optional)</label><input type="date" name="targetDate" value="${isEdit ? goal.targetDate || '' : ''}"></div>
     <div class="field"><label>Track progress via</label><select name="linkedAccount">${accountOptions(data, isEdit ? goal.linkedAccount : '')}</select></div>
     <p class="muted" style="font-size:11.5px; margin:-6px 0 12px;">Linking an account uses its live balance as progress — best for a
       goal with its own dedicated account. Leave it unlinked to log contributions manually instead — best for a sinking fund sharing space in a bigger account.</p>
     <div class="field"><label>Notes (optional)</label><input name="notes" placeholder="e.g. 6 months of expenses" value="${isEdit ? goal.notes || '' : ''}"></div>`,
    isEdit ? 'Save changes' : 'Add goal'
  );
  onModalSubmit(overlay, async (fd) => {
    const name = fd.get('name').trim();
    const targetAmount = parseAmount(fd.get('target'));
    if (!name || !targetAmount) return;
    const payload = {
      name,
      targetAmount,
      targetDate: fd.get('targetDate') || '',
      linkedAccount: fd.get('linkedAccount') || '',
      notes: fd.get('notes').trim(),
    };
    if (isEdit) await updateItem('goals', goal.id, payload);
    else await addItem('goals', payload);
  });
}

// ---------- Log / edit a manual contribution ----------

function openContributionModal(goal, contribution) {
  const isEdit = !!contribution;
  const overlay = openModal(
    isEdit ? 'Edit contribution' : 'Log a contribution',
    `<div class="field"><label>Date</label><input type="date" name="date" required value="${isEdit ? contribution.date : new Date().toISOString().slice(0, 10)}"></div>
     <div class="field"><label>Amount</label><input type="text" inputmode="decimal" class="amount-input" name="amount" required placeholder="0.00" ${isEdit ? `value="${contribution.amount}"` : ''}></div>
     <div class="field"><label>Note (optional)</label><input name="note" placeholder="e.g. Year-end bonus set-aside" value="${isEdit ? contribution.note || '' : ''}"></div>`,
    isEdit ? 'Save changes' : 'Log contribution'
  );
  onModalSubmit(overlay, async (fd) => {
    const amount = parseAmount(fd.get('amount'));
    if (!amount) return;
    const payload = { goalId: goal.id, date: fd.get('date'), amount, note: fd.get('note').trim() };
    if (isEdit) await updateItem('goalContributions', contribution.id, payload);
    else await addItem('goalContributions', payload);
  });
}

// ---------- Goal detail ----------

function contributionRowHtml(c) {
  return `<tr>
    <td>${fmtDate(c.date)}</td>
    <td class="num">${peso(c.amount)}</td>
    <td>${c.note || ''}</td>
    <td style="white-space:nowrap;">
      <button class="icon-btn edit-contribution" data-id="${c.id}" title="Edit">✎</button>
      <button class="icon-btn danger-hover del-contribution" data-id="${c.id}" title="Delete">✕</button>
    </td>
  </tr>`;
}

function renderGoalDetail(container, data, goalId) {
  const goal = data.goals.find((g) => g.id === goalId);
  if (!goal) {
    detailGoalId = null;
    renderGoalsView(container);
    return;
  }
  const mode = goalMode(goal);
  const progress = goalProgress(data, goal);
  const pct = goalProgressPct(data, goal);
  const reached = isGoalReached(data, goal);
  const months = monthsRemaining(goal.targetDate);
  const required = requiredMonthlyContribution(data, goal);
  const linkedAccount = mode === 'linked' ? data.accounts.find((a) => a.id === goal.linkedAccount) : null;
  const contributions = mode === 'manual' ? goalContributionsFor(data, goal.id) : [];

  container.innerHTML = `
    <div class="page-head"><div><button class="btn small secondary" id="back-btn" style="margin-bottom:10px;">← Back to goals</button>
      <h1>${goal.name}</h1>
      <div class="sub">${goal.targetDate ? `Target date ${fmtDate(goal.targetDate)}` : 'No target date set'} · ${mode === 'linked' ? `Linked to ${linkedAccount ? linkedAccount.name : 'a removed account'}` : 'Manual tracking'}${reached ? ' · <b style="color:var(--green);">Goal reached!</b>' : ''}</div></div>
      ${mode === 'manual' ? '<div class="filters"><button class="btn small" id="add-contribution-btn">+ Add contribution</button></div>' : ''}
    </div>

    <div class="grid kpis" style="display:grid; gap:16px; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); margin-bottom:16px;">
      <div class="card kpi"><div class="label">Progress</div><div class="value pos">${peso(progress)}</div></div>
      <div class="card kpi"><div class="label">Target</div><div class="value">${peso(goal.targetAmount)}</div></div>
      <div class="card kpi"><div class="label">Remaining</div><div class="value">${peso(Math.max(0, goal.targetAmount - progress))}</div></div>
      <div class="card kpi"><div class="label">Required / month</div><div class="value" style="font-size:16px;">${required == null ? 'No deadline' : peso(required)}</div></div>
    </div>

    <div class="card" style="margin-bottom:20px;">
      <div style="display:flex; justify-content:space-between; font-size:12.5px; margin-bottom:6px;">
        <span>Payoff progress</span><span class="mono">${(pct * 100).toFixed(1)}%${months != null ? ` · ${months} month${months === 1 ? '' : 's'} left` : ''}</span>
      </div>
      <div style="background:var(--surface-2); border-radius:6px; height:10px; overflow:hidden;">
        <div style="width:${(pct * 100).toFixed(1)}%; height:100%; background:${reached ? 'var(--green)' : 'var(--gold)'}; border-radius:6px;"></div>
      </div>
      ${
        mode === 'linked'
          ? `<p class="muted" style="font-size:12px; margin-top:12px;">Progress tracks ${linkedAccount ? linkedAccount.name : 'the linked account'}&rsquo;s live balance automatically — deposit into that account and this updates on its own.</p>`
          : ''
      }
      ${goal.notes ? `<p class="muted" style="font-size:12px; margin-top:12px;">${goal.notes}</p>` : ''}
    </div>

    ${
      mode === 'manual'
        ? `<div class="section-title"><h2 style="font-size:15px;">Contributions logged</h2><div class="rule"></div></div>
    <div class="card">
      <table>
        <thead><tr><th>Date</th><th class="num">Amount</th><th>Note</th><th></th></tr></thead>
        <tbody>${contributions.map(contributionRowHtml).join('') || '<tr><td colspan="4" class="empty">No contributions logged yet.</td></tr>'}</tbody>
      </table>
    </div>`
        : ''
    }
  `;

  container.querySelector('#back-btn').onclick = () => {
    detailGoalId = null;
    renderGoalsView(container);
  };
  const addBtn = container.querySelector('#add-contribution-btn');
  if (addBtn) addBtn.onclick = () => openContributionModal(goal);

  container.querySelectorAll('.edit-contribution').forEach((btn) => {
    btn.onclick = () => {
      const c = contributions.find((x) => x.id === btn.dataset.id);
      if (c) openContributionModal(goal, c);
    };
  });
  container.querySelectorAll('.del-contribution').forEach((btn) => {
    btn.onclick = () => {
      confirmModal('Delete this contribution?', true, async () => {
        await deleteItem('goalContributions', btn.dataset.id);
      });
    };
  });
}

// ---------- Main list ----------

function goalCardHtml(data, goal) {
  const mode = goalMode(goal);
  const progress = goalProgress(data, goal);
  const pct = goalProgressPct(data, goal);
  const reached = isGoalReached(data, goal);
  return `<div class="card fund-card" data-open-goal="${goal.id}">
    <div style="display:flex; justify-content:space-between; align-items:start; margin-bottom:6px;">
      <h3 style="font-size:15px;">${goal.name}</h3>
      <div>
        <button class="icon-btn edit-goal" data-id="${goal.id}" title="Edit">✎</button>
        <button class="icon-btn archive-goal-toggle" data-id="${goal.id}" data-archived="${!!goal.archived}" title="${goal.archived ? 'Unarchive' : 'Archive'}">${goal.archived ? '↩' : '📦'}</button>
        <button class="icon-btn danger-hover del-goal" data-id="${goal.id}" title="Remove">✕</button>
      </div>
    </div>
    <div class="tag" style="margin-bottom:10px;">${mode === 'linked' ? 'Linked account' : 'Manual'}${goal.targetDate ? ` · by ${fmtDate(goal.targetDate)}` : ''}</div>
    <div style="background:var(--surface-2); border-radius:6px; height:8px; overflow:hidden; margin-bottom:8px;">
      <div style="width:${(pct * 100).toFixed(1)}%; height:100%; background:${reached ? 'var(--green)' : 'var(--gold)'}; border-radius:6px;"></div>
    </div>
    <div style="display:flex; justify-content:space-between; font-size:13px;">
      <span class="muted">${reached ? 'Reached!' : `${(pct * 100).toFixed(0)}% of target`}</span>
      <span class="mono" style="font-weight:600;">${peso(progress)} / ${peso(goal.targetAmount)}</span>
    </div>
  </div>`;
}

/**
 * Renders the Goals view into `container` and wires all its interactions.
 * Re-invoked on every store change and every local UI-state change
 * (detail drill-in), so it always reflects current data.
 * @param {HTMLElement} container
 */
export function renderGoalsView(container) {
  const data = getData();
  if (!data) {
    container.innerHTML = '<div class="empty">Loading…</div>';
    return;
  }

  if (detailGoalId) {
    renderGoalDetail(container, data, detailGoalId);
    return;
  }

  const active = data.goals.filter((g) => !g.archived);
  const archived = data.goals.filter((g) => g.archived);
  const totals = goalsTotals(data);

  container.innerHTML = `
    <div class="page-head">
      <div><h1>Goals &amp; Sinking Funds</h1><div class="sub">Set a target, link it to a savings account or track it manually, and see what it takes per month to get there.</div></div>
      <div class="filters"><button class="btn small" id="add-goal-btn">+ Add goal</button></div>
    </div>

    <div class="grid kpis" style="display:grid; gap:16px; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); margin-bottom:20px;">
      <div class="card kpi"><div class="label">Total progress</div><div class="value pos">${peso(totals.progress)}</div></div>
      <div class="card kpi"><div class="label">Total target</div><div class="value">${peso(totals.target)}</div></div>
      <div class="card kpi"><div class="label">Active goals</div><div class="value">${active.length}</div></div>
    </div>

    <div class="grid" style="display:grid; gap:16px; grid-template-columns:repeat(auto-fit,minmax(260px,1fr));">
      ${active.map((g) => goalCardHtml(data, g)).join('') || '<div class="empty">No goals yet — add one to start tracking its progress.</div>'}
    </div>

    ${
      archived.length
        ? `<div class="section-title"><h2 style="font-size:15px;">Archived goals</h2><div class="rule"></div></div>
    <div class="grid" style="display:grid; gap:16px; grid-template-columns:repeat(auto-fit,minmax(260px,1fr));">
      ${archived.map((g) => goalCardHtml(data, g)).join('')}
    </div>`
        : ''
    }
  `;

  container.querySelector('#add-goal-btn').onclick = () => openGoalModal();

  container.querySelectorAll('[data-open-goal]').forEach((card) => {
    card.onclick = (e) => {
      if (e.target.closest('button')) return;
      detailGoalId = card.dataset.openGoal;
      renderGoalsView(container);
    };
  });

  container.querySelectorAll('.edit-goal').forEach((btn) => {
    btn.onclick = () => {
      const goal = data.goals.find((g) => g.id === btn.dataset.id);
      if (goal) openGoalModal(goal);
    };
  });

  container.querySelectorAll('.archive-goal-toggle').forEach((btn) => {
    btn.onclick = async () => {
      const archived = btn.dataset.archived === 'true';
      await updateItem('goals', btn.dataset.id, { archived: !archived });
    };
  });

  container.querySelectorAll('.del-goal').forEach((btn) => {
    btn.onclick = () => {
      const id = btn.dataset.id;
      const goal = data.goals.find((g) => g.id === id);
      const hasContributions = goal && goalMode(goal) === 'manual' && goalContributionsFor(data, id).length > 0;
      if (hasContributions) {
        infoModal(
          'Can&rsquo;t remove this goal',
          '<p class="muted">This goal has contributions logged against it — archive it instead if it\'s done, or delete its contributions first if you really want to remove it entirely.</p>'
        );
        return;
      }
      confirmModal('Remove this goal?', true, async () => {
        await deleteItem('goals', id);
      });
    };
  });
}
