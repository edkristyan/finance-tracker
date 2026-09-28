import { applyStoredTheme, toggleTheme } from './components/theme.js';
import { isPrivacyMode, togglePrivacyMode, subscribePrivacy } from './state/privacy.js';
import { initStore, getData, subscribe } from './state/store.js';
import { runAutoBackupCheck } from './state/autoBackup.js';
import { renderAccountsView } from './views/accountsView.js';
import { renderInvestmentsView } from './views/investmentsView.js';
import { renderTransactionsView } from './views/transactionsView.js';
import { renderDashboardView } from './views/dashboardView.js';
import { renderLoansView } from './views/loansView.js';
import { renderGoalsView } from './views/goalsView.js';
import { renderReportsView } from './views/reportsView.js';

// Apply any saved theme before anything else renders, to avoid a flash of
// the wrong theme on load.
applyStoredTheme();

/**
 * Registers the service worker. Wrapped in try/catch per the project's
 * error-handling requirement — a failed registration should never break the
 * rest of the app from loading.
 * @returns {Promise<void>}
 */
async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register('./service-worker.js');
  } catch (err) {
    console.error('Service worker registration failed:', err);
  }
}

/**
 * Temporary placeholder content for a view whose real module doesn't exist
 * yet (Dashboard/Transactions/Investments land in later phases).
 * @param {string} viewName - e.g. "dashboard"
 * @returns {string} HTML for the placeholder
 */
function stubViewHtml(viewName) {
  const label = viewName.charAt(0).toUpperCase() + viewName.slice(1);
  return `<div class="view-stub">${label} view — coming in a later phase.</div>`;
}

/**
 * Maps a nav tab's data-view value to its render function. A view not yet
 * built falls back to stubViewHtml. Extending this object is the only thing
 * a future view needs to do to become reachable from the nav.
 * @type {Object<string, (container: HTMLElement) => void>}
 */
const VIEWS = {
  dashboard: renderDashboardView,
  accounts: renderAccountsView,
  investments: renderInvestmentsView,
  transactions: renderTransactionsView,
  loans: renderLoansView,
  goals: renderGoalsView,
  reports: renderReportsView,
};

/**
 * Minimal nav router: switches the active tab and mounts that view's render
 * function (or a placeholder) into #main.
 */
function initNavRouter() {
  const nav = document.getElementById('nav');
  const main = document.getElementById('main');
  if (!nav || !main) return () => {};

  const renderActive = () => {
    const active = nav.querySelector('button.active');
    if (!active) return;
    const viewName = active.dataset.view;
    const renderView = VIEWS[viewName];
    if (renderView) {
      if (!getData()) {
        main.innerHTML = '<div class="empty">Loading your ledger…</div>';
        return;
      }
      renderView(main);
    } else {
      main.innerHTML = stubViewHtml(viewName);
    }
  };

  nav.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-view]');
    if (!button) return;

    nav.querySelectorAll('button').forEach((btn) => btn.classList.remove('active'));
    button.classList.add('active');
    renderActive();
  });

  // Re-render the active view whenever the store changes (e.g. after an
  // add/edit/delete), so the UI always reflects the latest persisted data.
  subscribe(renderActive);
  renderActive();

  return renderActive;
}

function initThemeToggle() {
  const btn = document.getElementById('theme-toggle-btn');
  if (btn) btn.addEventListener('click', toggleTheme);
}

/**
 * Wires the "Hide amounts" toggle. Unlike the theme toggle (pure CSS, no
 * re-render needed), flipping privacy mode has to force every peso() call
 * on screen to re-evaluate, so this re-renders the active view exactly the
 * way a store change does — see renderActive() in initNavRouter().
 * @param {() => void} renderActive - re-renders whichever view is current
 */
function initPrivacyToggle(renderActive) {
  const btn = document.getElementById('privacy-toggle-btn');
  if (!btn) return;

  const applyLabel = () => {
    const masked = isPrivacyMode();
    btn.textContent = masked ? '🙈 Show amounts' : '🙉 Hide amounts';
    btn.setAttribute('aria-pressed', String(masked));
  };

  applyLabel();
  btn.disabled = false;
  btn.removeAttribute('title');
  btn.addEventListener('click', () => {
    togglePrivacyMode();
  });
  subscribePrivacy(() => {
    applyLabel();
    renderActive();
  });
}

/**
 * Boots the app: theme, nav, service worker, and — critically — the data
 * store. A failed store init (e.g. IndexedDB blocked by browser settings or
 * private mode) is shown directly in the main area rather than left silent.
 */
async function boot() {
  initThemeToggle();
  const renderActive = initNavRouter();
  initPrivacyToggle(renderActive);
  registerServiceWorker();

  try {
    await initStore();
    // Fire-and-forget: only actually writes a file on the last day of the
    // month, and only if auto-backup has been set up in Accounts. Never
    // allowed to block or break the rest of the app loading — see the
    // try/catch inside runAutoBackupCheck itself.
    runAutoBackupCheck(getData());
  } catch (err) {
    console.error('Failed to initialize local storage:', err);
    const main = document.getElementById('main');
    if (main) {
      main.innerHTML =
        '<div class="empty">This browser blocked local storage, so the ledger can\'t run here. ' +
        'Try a different browser (Chrome, Edge, or Firefox all work).</div>';
    }
  }
}

boot();
