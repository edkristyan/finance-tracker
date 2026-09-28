# Ledger — local dev

**Phase 1:** PWA plumbing (manifest, icons, service worker, tooling).
**Phase 2:** the real app shell — sidebar nav, theme toggle, CSS split into
tokens/layout/components/views.
**Phase 3:** the data layer — `js/services/db.js` (IndexedDB wrapper) and
`js/state/store.js` (seeding, migrations, CRUD + sanitization, subscribe/notify).
**Phase 4:** the Accounts view — full add/edit/delete, archive, liquidity
toggle, backup export/import, and reset. Also: `js/components/modal.js`
(shared dialog system) and `js/services/accountsService.js`.
**Phase 5:** the Investments view — PAG-IBIG MP2 funds (monthly
contributions, yearly dividends/rate) and market fund holdings (Buy/Sell/
Dividend/Fee lots, average-cost-basis, XIRR). Full add/edit/delete on every
collection: funds, holdings, contributions, dividend/rate entries, and lots
— including renaming a holding's ticker (which moves its lots along with it).
Also new: `js/services/investmentsService.js`.

**Post-Phase-5 follow-ups:**
- Added the missing **Savings accounts** section back to the Investments view.
- **Multi-currency holdings:** a holding can now have a `currency` + exchange
  rate; Net Profit and the combined portfolio totals convert to ₱ automatically.
  The asset-allocation chart itself is still pending (needs the shared charts
  component from a later phase) but will read from these same already-
  converted totals once it exists.
- **Multi-currency accounts:** an account can now have a `currency` + exchange
  rate too; the Accounts total row and Dashboard-bound totals both convert to ₱.
- **Cleared vs Pending groundwork:** clicking an account now opens a detail
  screen showing "App balance" vs "Cleared balance" (`accountClearedBalance`
  in `accountsService.js`, respecting a transaction's `cleared` field). The
  two will always match right now, and there's no way to mark a transaction
  pending yet — that toggle belongs on each transaction row, which only
  exists once the Transactions view is built. This phase just lays the
  groundwork so that view can plug straight in.

**Phase 6: Transactions** — the last major view. All 6 types
(Expense/Income/Transfer/Savings/Investments/Received), full add/edit/delete,
filters (year/month/account/type/tag/sort), CSV export. Also new:
`js/services/transactionsService.js`.

- **Split transactions:** a "Split" button in both the add-entry form and
  the edit modal swaps the single Category field for addable sub-rows
  (category + amount), with a live total that must match the transaction's
  master Amount before it can be saved.
- **#Hashtag tags:** any `#word` typed into a transaction's Details field
  is parsed as a tag automatically — no separate tag field. A new "All tags"
  dropdown in the filter bar lists every tag currently in use; picking one
  filters the list and shows a summary card with the total cost of every
  Expense-type entry carrying that tag (e.g. `#JapanTrip2026`).

**Intentionally not carried over:** the original app's "Track as" feature (an
Investments-type transaction that simultaneously creates an MP2 contribution
or market-fund lot) — confirmed dropped rather than deferred. Investments
already has its own dedicated add-entry flow for contributions and lots, so
this isn't a gap, just one less path to the same result.

**Phase 7: Dashboard** — the last view, ties everything together.
New: `js/services/routinesService.js`, `js/services/dashboardService.js`,
`js/components/charts.js` (hand-rolled inline SVG, no chart libraries — a
bar chart, a line chart, and a simplified Sankey).

- **KPI row:** liquid balance, net worth, combined Investments+MP2, credit
  owed, dividends earned — all base-currency-converted.
- **This month's routines:** a checklist of recurring expected payments
  (rent, subscriptions, bills), grouped, with add/edit/delete and a
  checkbox per routine. Deliberately **manual check-off, not auto-matched
  against the ledger** — guessing which transaction "is" a routine from
  category/amount/date is fragile and would silently mis-tick things; a
  checkbox is never wrong.
- **Cash flow forecasting:** a small line chart (Today → projected month-end
  balance) plus a text readout, computed as liquid balance minus every
  unpaid routine still outstanding this month. Turns red if the projection
  would go negative.
- **Category budgets / envelope progress:** "Manage budgets" opens a modal
  to set a monthly ₱ limit per category; "Where it went" now shows a
  progress bar per budgeted category (spent / limit), switching from the
  gold accent to red at 80% of the limit.
- **Income vs Expense chart, with a Sankey toggle:** the existing bar chart
  (by year) can be swapped for a **cash flow map** — income categories
  flowing into expense categories for the current month, plus a "Net
  savings" flow when income exceeds spending. Built by hand as ribboned SVG
  paths sized proportional to amount; it visualizes proportional
  allocation, not a literal trace of which peso came from where, since
  nothing in the app tracks that level of attribution (no app meaningfully
  does, without requiring every transaction to be manually source-tagged).

**Phase 8: Loans / Liabilities** — a new tab for tracking money you
owe, kept deliberately separate from Accounts (which is money you have).
New: `js/services/loansService.js` (amortization schedule, monthly-payment
formula, interest/principal splitting), `js/views/loansView.js`. New
collections: `loans`, `loanPayments`. New category: **Loan Payment**
(backfilled into existing saved data via a migration, since the categories
list only gets replaced wholesale when it's empty).

- **Add/edit/archive/delete a loan:** name, original principal, annual
  interest rate, term in months, start date, and an optional default "usually
  paid from" account. Deleting is blocked while the loan has payments logged
  against it (archive it instead, same guard pattern as Accounts) — a paid-off
  loan is meant to be archived, not deleted, so its history stays intact.
- **Amortization schedule:** a full month-by-month table (payment / principal
  / interest / running balance) computed from the standard fixed-payment
  loan formula, shown on each loan's detail screen, with rows already covered
  by a logged payment marked "Paid." This is the *theoretical* schedule —
  what a perfectly on-time loan looks like — kept visually separate from the
  *actual* payment history below it, since real payments can run ahead,
  behind, or off-amount from it.
- **Log a payment → auto-split into principal and interest:** logging a
  payment asks only for date, amount, and which account it came from. The
  split is computed the way amortization actually works — interest is one
  month's rate on the *current outstanding balance*, and everything else
  goes to principal (capped at what's still owed, so an overpayment just
  pays the loan off early rather than going negative). If an account is
  selected, an ordinary Expense transaction is created in Transactions too
  (category "Loan Payment"), so the loan payment shows up in that account's
  balance and history exactly like any other expense — the loan tracker
  isn't a second, disconnected ledger. Choosing "already paid elsewhere"
  skips the transaction and just logs the payment against the loan directly.
  Editing or deleting a payment updates or removes its linked transaction
  too, so the two never drift out of sync.
- **Full add/edit/delete** on both loans and individual logged payments, per
  the project's standing requirement.
- **Not done in this phase, on purpose:** loan balances aren't folded into
  the Dashboard's Net worth / KPI cards yet — that's a Dashboard change, and
  Dashboard work is being kept in its own phase per how this project has been
  scoped throughout. Say the word if you want "Total outstanding across
  loans" pulled into Net worth (as a liability, the same way credit-card debt
  already is) or onto a KPI card.

**Phase 9: Goals / Sinking Funds** — a new tab for savings targets. New:
`js/services/goalsService.js`, `js/views/goalsView.js`. New collections:
`goals`, `goalContributions`. No new category — logging a manual
contribution deliberately does **not** create a Transaction (see below).

- **Two progress modes, picked per goal:** **linked** ties a goal to one
  real account and reads its live balance as progress — no separate
  bookkeeping, it can never drift from what the account actually holds. Best
  when a goal has (or will get) its own dedicated account. **Manual** has no
  account link; progress is the running total of contributions logged
  directly against the goal. Best for a sinking fund that shares space
  inside a bigger account, where the peso is spoken-for on paper but not
  physically separated — logging a manual contribution here is a bookkeeping
  entry only and doesn't touch Transactions, since the real money movement
  either already happened elsewhere or can't be represented by one
  transaction without double-counting against the shared account's balance.
- **Progress bar + required monthly contribution:** each goal shows % of
  target reached (turns green once fully reached), and — when a target date
  is set — how much would need to go in per month, from now, to hit it on
  time (`(target − progress) / months remaining`). No target date just shows
  "No deadline" instead of a made-up number.
- **Full add/edit/archive/delete** on goals; manual-mode goals also get full
  add/edit/delete on their individual contributions. Deleting a manual goal
  is blocked while it has contributions logged (archive it instead, same
  guard pattern as Loans/Accounts); a linked goal can always be deleted since
  it holds no data of its own beyond the goal record.
- **Not done in this phase, on purpose:** same as Loans — goal progress
  doesn't feed into any Dashboard card yet, kept out to keep this phase
  scoped to Goals alone.

**Phase 10: Reports / Analytics** — the last of the three tabs discussed, and
the only one that's pure reporting: no new collections, no CRUD, just new
ways of looking at data every other tab already maintains (transactions,
loans, goals). New: `js/services/reportsService.js`, `js/views/reportsView.js`.
Also extended `js/components/charts.js` with a generic grouped-bar-chart
renderer shared by the Dashboard's monthly chart and this tab's yearly one,
rather than a second copy of the same SVG-building logic.

- **Year-over-year comparison:** a table plus a bar chart (green income vs.
  rust expense, one group per year — same visual language as the Dashboard's
  monthly chart) across every year that has data, with each year's percent
  change in income/expense from the year before it.
- **Automated "Year in Review":** pick a year and get a short plain-language
  recap generated entirely from that year's own data — total income/expense/
  savings rate, top expense category, busiest month by transaction count,
  single biggest expense, most expensive #tag, current outstanding loan
  balance, and overall goals-funded percentage. Nothing here is hand-written
  per year; change the data and the recap changes with it.

**Post-Phase-10 follow-ups, round 9 — Dashboard layout + chart:**
- **Income vs expense / Where it went moved into their own row.** The
  Dashboard's first section used to be one 4-across `.quad-grid` (Account
  balances, This month's routines, Income vs expense, Where it went). It's
  now two stacked `.duo-grid` rows instead: Account balances + This
  month's routines on top, Income vs expense + Where it went below —
  `.quad-grid` is gone from the CSS entirely, both rows use the same
  2-up `.duo-grid` treatment as the Liquid vs. illiquid / Cash flow
  forecast row already did.
- **"Income vs. expense" card redesigned** to match the reference look: a
  small color-key legend (Income/Expense swatches) above the chart, and
  slightly rounder bar tops.
- **The chart now actually fills its card's height, not just its width.**
  Previously the bar chart's SVG had a fixed aspect ratio (700:220), so a
  taller card just left dead space below the chart. The card is now a
  flex column with the chart area set to `flex:1`, and
  `buildBarChartSvg()` takes a new `fillHeight` option (used only here —
  Reports' year-over-year chart keeps the old fixed-ratio behavior) that
  switches the SVG to `width:100%; height:100%` with
  `preserveAspectRatio="none"`. Net effect: since "Income vs expense" and
  "Where it went" are now `.duo-grid` siblings, whichever one is taller
  (e.g. "Where it went" growing with more budgeted categories) stretches
  the row height via the grid's existing `align-items:stretch`, and the
  chart resizes to actually fill that height instead of leaving a gap or
  getting clipped.

**Post-Phase-10 follow-ups, round 8 — fixed a real PWA install bug on the
deployed site:**
- **Moved `manifest.json` from the project root into `public/`.** `npm run
  dev` served it unprocessed, so it looked fine there, but `vite build`
  only copies files verbatim if they live under `public/` — anything else
  referenced by a `<link>` tag (like `manifest.json` at the root) gets
  content-hashed and moved into `dist/assets/`. That silently broke every
  relative path *inside* the manifest (icon paths, `start_url`, `scope`),
  since Vite doesn't rewrite a JSON file's own contents — it just moved the
  file up a directory level without updating what it pointed at. The
  practical symptom: on the live GitHub Pages deploy, Chrome/Edge/Brave had
  no valid manifest to check, so the "Install app" icon never appeared in
  the address bar at all — confirmed by actually running `npm run build`
  and inspecting `dist/`, not just guessing. With `manifest.json` now
  alongside the icons and service worker in `public/`, it's copied as-is
  to `dist/manifest.json` and every relative path inside it resolves
  correctly again.

**Post-Phase-10 follow-ups, round 7:**
- **"Investments & MP2" broken out by fund/holding** in the Liquid vs.
  illiquid card's Illiquid column, instead of one lumped line — each MP2
  fund and each market-fund holding now gets its own row (`MP2 — <fund
  name>`, `<holding name/ticker>`), using the same per-fund/per-holding
  math the Investments tab itself already uses.
- **New: Auto-backup (Accounts tab, its own card below the accounts
  table).** A second, optional backup path alongside the existing manual
  "Export backup" button: pick a folder once and a dated
  `ledger-backup-YYYY-MM-DD.json` (same format/content as a manual export)
  is written there automatically on the last day of every calendar month.
  Two important limits, both inherent to a client-side browser app with no
  server or background process:
  - **Browser support:** needs a Chromium-based browser (Chrome, Edge,
    Brave, Opera, ...) — it's built on the File System Access API, which
    Firefox and Safari don't implement. On those browsers the card just
    says so and manual export/import remains the only backup path.
  - **"Automatic" means checked at app open, not a true background job:**
    since a web page can't run code while it isn't open, the check runs
    once when the app loads and asks "is today the last day of the month,
    and have I already backed up this month?" — so it only actually
    writes a file if the app happens to be open (or gets opened) on that
    day. There's no way to retroactively back up a last-day-of-month you
    didn't have the app open for.
  - Folder write permission can also be silently revoked by the browser
    after long disuse; if that happens the card shows a one-click
    "Re-authorize folder access" button rather than failing silently
    forever.
  - You weren't ready to point this at a specific folder yet, so it ships
    unconfigured — click "Choose backup folder…" in Accounts whenever your
    folders are tidied up (that dialog is exactly where you'd navigate to
    your E: drive, or wherever you land on).

**Post-Phase-10 follow-ups, round 6:**
- **Fixed a regression from round 5's card-height fix:** stretching every
  card in a row to match the tallest one looked right for the 4-card
  `.quad-grid`, but in the 2-card `.duo-grid` it left "Liquid vs. illiquid"
  with a large empty gap at the bottom next to the taller "Cash flow
  forecast" card. Rather than reverting the fix, "Liquid vs. illiquid" now
  fills that space with something useful: a per-account breakdown split
  into Liquid and Illiquid columns underneath the existing bar (MP2/market
  funds show as their own "Investments & MP2" line, matching how the total
  is already computed).

**Post-Phase-10 follow-ups, round 5 — Dashboard visual polish:**
- **Cash flow forecast card no longer sits mostly empty once every routine
  is checked off.** It now always shows a small "Paid so far / Remaining
  due / Projected month-end" breakdown above the chart, with the projected
  figure sized up as the headline number for that card.
- **"Where it went" now uses the same category icons as everywhere else**
  (Transactions, category pickers) — both the budgeted rows and the
  "No budget set" list, via the shared `CATEGORY_ICONS` map.
- **Equal card heights in the dashboard's grid rows.** `.quad-grid` and
  `.duo-grid` no longer force `align-items:start`; cards in the same row
  now stretch to match the tallest card instead of leaving a ragged bottom
  edge next to a shorter neighbor.
- **KPI row split into 2 "hero" numbers + a lighter chip row.** Net worth
  and Liquid balance are the two figures most worth reading at a glance, so
  they're now larger cards of their own (`.kpi-hero-row`); Investments+MP2,
  Credit owed, Dividends earned, and Loans outstanding moved into small
  pill-shaped chips (`.kpi-chip-row`) below, demoted rather than removed.
- **Routines with no expected amount set show "—" instead of "₱0.00."**
  A blank amount now reads as "not tracked yet" rather than looking like a
  bug; hovering it explains why, and editing the routine (✎) still lets you
  set one.

**Post-Phase-10 follow-ups, round 4:**
- **Removed "Load sample data" and "Reset all data" from the Accounts tab**
  — both buttons, their confirm-modal handlers, and the now-unused
  `resetStore`/`buildSampleData` imports in `accountsView.js`. Neither is
  reachable from the app anymore. `resetStore()` (in `store.js`) and
  `buildSampleData()` (in `js/state/sampleData.js`) still exist as functions
  — the former as a small generic store primitive, the latter because the
  automated Loans/Goals/Reports/Routines test script (`npm run
  test:loans-goals-reports`) still generates its test data from it — but
  neither is wired to any button, so there's no way to trigger either from
  inside the running app.

**Post-Phase-10 follow-ups, round 3:**
- **Quick actions removed entirely**, per your call — deleted
  `js/components/commandPalette.js`, its wiring in `main.js` (the Cmd/Ctrl+K
  listener, the palette action list, the sidebar hint button), and the
  `.cmdk-*`/`.nav-hint-btn` CSS. The sidebar's bottom text no longer mentions
  a shortcut at all. Hide amounts is untouched — that was a separate feature
  built the same round, not part of this removal.
- **Transactions: filters moved below "Add an entry."** The year/month/
  account/type/tag/sort selects, Clear filters, and Export CSV now sit in
  their own row between the add-entry card and the table, instead of up in
  the page header. Purely a template reorder in `transactionsView.js` — same
  elements, same ids, same behavior, just lower on the page.
- **Categories and types standardized against your actual backup.** Cross-
  checked `seed.json`'s category list against the ledger backup you
  attached (1,268 real transactions from the original app) — it turned out
  to already match almost exactly, with one gap: your data uses **"Credit
  Card Payment"** as its own category (distinct from general "Bank Fees"),
  which the rebuilt app's default list was missing. Added it, with the same
  kind of backfill Loan Payment got in Phase 8 (`applyMigrations()` in
  `store.js`) so it appears in your already-existing data too, not just new
  installs. Also reordered the whole category list into readable clusters —
  everyday spending (Food & Groceries, Transportation, Utilities,
  Subscription, Shopping, Health, Insurance), debt & fees (Credit Card
  Payment, Loan Payment, Bank Fees), money movement (Savings, Withdraw,
  Investments), income (Salary, Received, Gift), and Others last — and gave
  every category an icon in `transactionsService.js`'s `CATEGORY_ICONS` (a
  few, like Credit Card Payment and Loan Payment, had none before). Re-
  ordered the six transaction Types the same way: Expense, Income, Received,
  Transfer, Savings, Investments (money-out, then money-in, then the three
  "moving money around" types) — the six types themselves already matched
  your real data exactly, so nothing was added or removed there, just
  reordered for readability.
- **"This month's routines" now suggests a match — still never auto-checks.**
  New `suggestedMatch()` in `routinesService.js`: if an unpaid routine's own
  name shows up in an expense transaction's Details text this month (e.g.
  routine "Netflix" vs. a transaction detailed "Netflix subscription"), a
  small **💡 Looks paid — mark it?** button appears next to it — hover for
  the matched transaction's details/amount/date, click to check it off.
  Nothing ticks on its own; a routine with no plausible match, or already
  paid, shows nothing extra. Deliberately matches on name-in-details only,
  not category or amount — a routine's `group` label ("Bills") is too broad
  to match safely on its own, and this was the exact "fragile guessing" the
  original manual-only design was written to avoid. Wired into
  `dashboardView.js`'s routines card; 5 new automated checks in
  `scripts/verify-loans-goals-reports.mjs` cover it (already-paid routines
  never suggest, no-match routines return null, a real name-in-details match
  is found, and a Transfer is never suggested even on a name hit, since
  moving money between your own accounts isn't "paying" a bill).

**Post-Phase-10 follow-ups, round 2:**
- **Investments now auto-link to Transactions, the same way Loans do.**
  Previously the "Track as" feature that did this in the original app had
  been removed outright, with no replacement — Investments and Transactions
  were completely disconnected in both directions. Rebuilt as an *optional*
  one-directional link, matching Loans exactly: an MP2 contribution or a
  holding lot (Buy/Sell/Dividend/Fee) can now pick an account, which
  auto-creates a matching Transaction (Buy/Fee → Expense, Sell/Dividend →
  Income, category "Investments") and remembers it via a `txId` field.
  Editing the contribution/lot's amount, date, or account afterward updates
  that transaction to match; clearing the account (or deleting the
  contribution/lot) removes it. A 🔗 icon marks any month/lot with a linked
  transaction. **Same limitation as Loans, on purpose:** this is one-way —
  a transaction you add or edit directly in the Transactions tab, even one
  categorized "Investments," never creates or updates an MP2 contribution or
  a lot. There's also one MP2-specific wrinkle: adding a contribution to a
  month that *already has one* just tops up the total (existing behavior,
  unchanged) rather than trying to guess how to merge a second cash movement
  into one transaction — link/unlink/re-sync that month's transaction via
  its own ✎ instead. Changed: `js/views/investmentsView.js` (new
  `accountOptions()`, `syncLinkedTransaction()`, `lotTxDirection()` helpers,
  mirroring the equivalent functions already in `loansView.js`); `lots` and
  `mp2Contrib` records both gained optional `account`/`txId` fields.
- **"Hide amounts" is wired up.** It had sat disabled since Phase 3
  ("Activates once Transactions (Phase 4) is in place") — Transactions has
  existed since Phase 4, the toggle was just never finished. New
  `js/state/privacy.js` (a persisted boolean + pub/sub, same shape as
  `theme.js`); `peso()` in `format.js` now reads it by default, so every
  existing call site across every view masks automatically with no
  per-call-site changes needed. Click it again (or hit it from the quick-
  actions palette) to flip back. Persists across reloads, same as theme.
- **Cmd/Ctrl+K quick-actions palette.** Also sat as static, non-functional
  text since Phase 3. New `js/components/commandPalette.js`: type to filter,
  ↑/↓ to move, Enter to run, Esc to close. Currently offers jumping straight
  to any tab, the two toggles (theme, hide amounts), and Export backup — the
  sidebar's own "⌘/Ctrl + K" line is now a real button that opens it too.
  Said "Not done in this phase, on purpose": it doesn't yet jump straight
  into an "+ Add transaction"/"+ Add loan"/etc. form — those live inside
  each view's own render function with no shared way to invoke them from
  outside yet, so wiring that in was left out of this round rather than
  refactoring every view's modal-opening code to be externally callable. Say
  the word if you want that added.
- **Nav groups made unmistakably non-clickable.** Added a top divider rule
  and more breathing room above each group label (`Money`/`Planning`/
  `Insights`, plus a new `Overview` label above Dashboard for the same
  visual treatment at the top), and made the labels `pointer-events: none`
  so there's no chance of them reading as a 4th clickable row. Purely
  `index.html` + `css/layout.css` — no functional/router change.

**Post-Phase-10 follow-ups:**
- **Loans now count against Net worth.** `totalOutstandingAcrossLoans()` was
  already written in Phase 8 for exactly this, but never wired in — Net worth
  on the Dashboard was quietly overstated for anyone with an active loan,
  since a loan's principal never touches an account balance the way a
  credit card's does. Fixed in `dashboardView.js`: `netWorth` now subtracts
  it, and a new **Loans outstanding** KPI card (6th tile in `.kpi-grid`, grid
  updated 5→6 columns on tablet/desktop) shows the figure on its own so it's
  visible even before you check the Loans tab. **Goals were deliberately left
  out** of both Net worth and the KPI row: a manual-mode goal's contributions
  are a bookkeeping note, not money that moved, so folding them in would
  double-count against whatever account that money is still actually sitting
  in. If you'd like a "Goals progress" KPI added anyway (e.g. total saved
  across all goals, purely informational, no effect on Net worth), say so —
  it's a small addition.
- **Nav bar grouped and reordered by usage:** the sidebar's tabs are now split
  into three labeled clusters — **Money** (Transactions, Accounts,
  Investments), **Planning** (Loans, Goals), and **Insights** (Reports) —
  with Dashboard on its own above them, in the order each tab tends to get
  opened (Dashboard every visit → day-to-day money tabs → occasional planning
  checks → Reports as a once-in-a-while look-back). Purely a nav
  reorder/relabel (`index.html` + a new `.nav-group-label` rule in
  `layout.css`) — no view or router logic changed, and the underlying
  `data-view` values are untouched. On the mobile horizontal nav strip, each
  group label collapses to a thin divider line instead of text, so it doesn't
  crowd the scroll strip; the full text label shows once the sidebar goes
  vertical on desktop (≥821px).
- **New: "Load sample data" (Accounts tab, next to Import backup).** Fills
  every collection with two years (Jan 2025 → this month) of realistic,
  internally-consistent demo data — 5 accounts, ~150 transactions (including
  a split transaction, hashtags, a pending/uncleared entry, transfers), two
  MP2 funds, one market-fund holding with Buy/Sell/Dividend lots, routines,
  budgets, two loans (one active with real logged payments, one paid-off and
  archived to exercise the 0%-interest path), and three goals (one linked,
  one in-progress manual, one fully-funded manual) — so every tab can be
  clicked through against believable numbers instead of an empty ledger.
  Lives in `js/state/sampleData.js`, exporting a pure `buildSampleData()`
  function used by the automated test script below, so the demo data and the
  test data are guaranteed to be the same dataset. **Update:** the "Load
  sample data" button (and "Reset all data") were later removed from the
  Accounts tab at your request — see the most recent changelog entry below.
  `buildSampleData()` itself stays, since the automated test script still
  needs it; it's just no longer reachable from the app's UI.
- **Expanded automated verification for Loans/Goals/Reports:** a new Node
  script (kept outside the app bundle; see below) runs 46 assertions against
  `buildSampleData()` plus hand-built edge cases the sample data doesn't
  otherwise hit — a 0%-interest loan, a loan with no payments logged yet, a
  0-term loan (blank form), an overpayment that should cap at the outstanding
  balance instead of going negative, a goal with no target date, a fully-
  reached goal (required-monthly should read exactly 0), a past-due target
  date (months-remaining floors at 0, doesn't go negative), a single-year
  dataset fed into the year-over-year comparison (should return one row with
  null deltas, not crash), and a year with zero transactions at all fed into
  `yearSummary` (should come back zeroed, not throw). All 46 currently pass.

**Post-Phase-7 follow-ups, round 4:**
- **Dashboard cards regrouped per your latest layout request**, replacing the
  round-2 bento grouping entirely: **Account balances**, **This month's
  routines**, **Income vs. Expense / cash flow map**, and **Where it went**
  now share one `.quad-grid` — 1 column on phone, 2 on tablet (≥600px), all
  4 inline on desktop (≥1200px). **Liquid vs. illiquid** and **Cash flow
  forecast** now share their own `.duo-grid` — 1 column on phone, 2 columns
  from tablet width up through desktop (never more than 2, so there's no
  separate desktop breakpoint to define). Both new classes live in
  `components.css` right after `.kpi-grid`/`.bento-grid`, which are now only
  used by the KPI row; `dashboardView.js`'s main template was restructured
  to place each card in its new container.

**Post-Phase-7 follow-ups, round 3:**
- **KPI layout redone per your screenshot:** the 5 stat cards (Liquid
  balance, Net worth, Investments+MP2, Credit owed, Dividends earned) are
  now one `.kpi-grid` instead of two separate grids: 1 column on phone, 3 on
  tablet (wraps 3-then-2, matching your screenshot exactly), and all 5 in
  one row on desktop (≥1200px). Account balances and Liquidity keep their
  own `.bento-grid` below (2–4 columns) since they're richer content, not
  plain number tiles.
- **Fixed a real regression while reviewing:** the Transactions add-entry
  form had no way to create a brand-new category — only pick from existing
  ones via the datalist. Your original app had a "+ New" button for exactly
  this; added it back (opens a small modal, adds to `data.categories`, fills
  the field). Edit-existing-entry still uses the datalist only, no button —
  editing rarely calls for inventing a category on the spot, but say if you
  want it there too.

**Post-Phase-7 follow-ups, round 2:**
- **Bento-box Dashboard layout:** the top 3 KPI cards (Liquid balance, Net
  worth, Investments + MP2) are now pinned in their own row (`.bento-fixed-row`
  in `components.css`) — always these three, in this order, never mixed into
  the reflowing grid below. Everything else in that top section (Credit
  owed, Dividends earned, Account balances, Liquidity) sits in a `.bento-grid`
  that's 4 columns wide on large screens, 3 on medium, 2 on small desktop,
  and 1 on phone (breakpoints at 600/900/1200px) — explicit column counts
  per breakpoint, not `auto-fit`/`minmax`, so "at least 2, at most 4" is exact.
- **Cash-flow forecast's dots aren't draggable — by design, not a bug.**
  They're read-only data markers on a small chart (hover one for its exact
  value), not a range-slider control; there was never anything there to drag.
- **Added the "previous years' balance" you asked for:** the forecast card
  now has a year dropdown. The current year still shows the live 2-point
  Today → projected forecast; picking a past year swaps in that year's
  actual month-end liquid-balance trend instead (`monthEndBalanceSeries()`
  in `dashboardService.js`), rendered as a proper multi-point line chart
  (`buildLineChartSvg` now takes a `compact` option — `true` for the small
  2-point forecast, `false` for this wider historical trend, which only
  labels its first/last points with a peso value so 12 points don't turn
  into a wall of overlapping numbers).

**Post-Phase-7 follow-ups:**
- Fixed the cash-flow forecast chart, which was badly broken — its SVG had
  too little padding, so the peso-value labels overflowed past the card
  edges, and its aspect ratio made it balloon to ~500px tall in a wide card
  instead of reading as the "small line chart" it's meant to be. Rewrote
  `buildLineChartSvg` in `charts.js` with its own tighter, better-padded
  dimensions, inward-anchored endpoint labels, and a `max-width` cap so it
  stays compact regardless of card width.
- Cash flow forecast and This month's routines now sit side by side in a
  responsive CSS grid (`repeat(auto-fit, minmax(340px, 1fr))`) — no JS
  needed for the responsiveness, they reflow to stacked automatically once
  the window is too narrow for both.
- Brought back two widgets from the original app that Phase 7 had dropped:
  **Account balances** (a clickable list — clicking a row jumps to Accounts
  and opens that account's detail screen directly, via a new
  `openAccountDetail()` export from `accountsView.js`) and **Liquid vs.
  illiquid** (a stacked bar; MP2 and market-fund holdings always count as
  illiquid, since neither has a per-fund liquidity tag the way accounts do).
  Skipped **Savings rate** per your call.

## Run it

```bash
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`). You should see
the real sidebar (Dashboard/Transactions/Investments/Accounts tabs) and a
placeholder in the main area for whichever tab is active. Try:

- Clicking each nav tab — the active state and placeholder content should
  switch.
- The 🌙 **Toggle theme** button — flips light/dark and persists across
  reloads (check devtools → Application → Local Storage).
- Shrinking the window below ~820px — the sidebar should collapse to a
  horizontal bar (mobile-first layout).
- Click the **Accounts** tab and try each action:
  - **+ Add account** at the bottom of the page
  - **✎ Edit** on a row — change name/type/opening balance
  - The **Liquid/Illiquid** badge — click to toggle
  - **📦 Archive** — moves the row to the Archived section; **↩** to bring it back
  - **✕ Remove** — blocked with an explanation if the account has transactions
    (none exist yet), otherwise asks for confirmation (button is inert for a
    beat before it's clickable — that's intentional)
  - **Export backup (.json)** — downloads the full current dataset
- Reload the page after adding a couple of accounts — they should still be there.
- Click the **Investments** tab:
  - **+ Add fund** under PAG-IBIG MP2, then click the fund card — try
    **+ Add contribution**, editing a year's dividend/rate (✎ next to a
    year row), and editing/deleting a monthly entry.
  - **+ Add holding** under Market funds (try ticker `TEST1`), click into
    it, add a **Buy** lot then a **Sell** lot smaller than the Buy qty —
    the avg price/cost/G-L figures should update correctly.
  - Edit the holding's **ticker** via the ✎ next to its name — its lots
    should move with it and the URL-less "back" navigation should still work.
  - Try deleting a fund/holding that still has contributions/lots — it
    should refuse and tell you to clear those first.
  - Add a holding with a non-PHP currency (e.g. currency `USD`, FX rate
    `56.50`) and a Buy lot — the card should show the native amount with a
    "≈ ₱…" line underneath, and Net Profit should show the ₱ equivalent.
- On the **Dashboard**, click a row in **Account balances** — it should
  jump to Accounts and open that exact account's detail screen (App vs
  Cleared balance). Check **Liquid vs. illiquid** adds up to your combined
  net worth (liquid/illiquid accounts + all MP2 + all market-fund value).
- Resize the browser window (or open devtools' device toolbar) — the top 3
  KPI cards should always stay together as their own row (1 column on
  phone widths), and the 4-card bento grid below should step down from 4 →
  3 → 2 → 1 columns as it narrows.
- On the **Cash flow forecast** card, switch the year dropdown to a past
  year with transaction history — it should replace the 2-point forecast
  with a month-by-month balance line for that year.
  - Scroll down to **Savings accounts** — mark an account as type "Savings"
    in the Accounts tab first if you don't have one yet; it should appear here.
- Back in **Accounts**: add an account with currency `USD` and an FX rate —
  its row should show the USD amount with a ₱ equivalent underneath, and the
  "Total (excl. credit cards, ₱ equiv.)" row should reflect the converted amount.
- Click any account row (not a button) to open its detail screen — you
  should see "App balance" and "Cleared balance" side by side (identical for
  now, as explained on that screen).
- Click the **Transactions** tab:
  - Confirm the layout: title, then **Add an entry**, then the filter row
    (year/month/account/type/tag/sort/Export CSV) below it, then the table —
    filters are no longer above the add-entry card.
  - Open the Type dropdown in the add-entry form — order should read Expense,
    Income, Received, Transfer, Savings, Investments. Open the Category
    field's suggestions — "Credit Card Payment" should be in the list (new),
    alongside the rest in their new grouped order.
  - Add a plain Expense entry with Details like `Sushi dinner #JapanTrip2026`
    — it should appear in the table with a category icon and the tag embedded
    in its details text.
  - Click **Split**, add 2–3 category/amount rows that sum to a different
    total than the master Amount — the summary line should turn red and the
    form should refuse to submit until they match.
  - Add another entry tagged `#JapanTrip2026`, then use the **All tags**
    dropdown (now in the filter row below the form) to filter by it — you
    should see a summary card with the combined expense total for that tag.
  - Edit an existing entry and toggle Split on/off to confirm both directions work.
  - Try the account filter button, the sort dropdown, and **Export CSV**.
  - Go back to **Accounts** and try deleting an account that now has
    transactions — it should refuse, same as before.
- Click the **Dashboard** tab (now the real thing, not a placeholder):
  - Add 2–3 routines (e.g. "Rent", "Netflix"), check one off — it should
    strike through and its amount should drop out of the cash-flow forecast.
  - Add a routine named "Netflix", then add an Expense transaction this month
    with Details like `Netflix subscription` — a **💡 Looks paid — mark it?**
    button should appear next to the Netflix routine; hover it to see the
    matched transaction, click it to check the routine off. Add a second
    routine with a name that appears nowhere in your transactions — it
    should show no suggestion button at all.
  - Add an Expense transaction or two this month in a category, then click
    **Manage budgets** and set a limit for that category lower than what
    you've spent — the progress bar under "Where it went" should turn red.
  - Add an Income transaction this month, then click **Show as cash flow
    map** on the flow chart — you should see ribbons from income category
    to expense category (plus "Net savings" if income exceeds expense),
    and **Show as bar chart** to switch back.
  - Change the bar chart's year dropdown — it should only show that year's data.
- Click the **Loans** tab:
  - Add a loan (e.g. ₱100,000, 12% APR, 12-month term) — the card should show
    a 0% payoff progress bar and the full outstanding principal.
  - Click into it and check the amortization schedule table — 12 rows,
    balance reaching ₱0.00 on the last row.
  - Click **Log payment**, accept the suggested scheduled amount, and pick an
    account to pay from — the payment should appear in the history table
    with a principal/interest split, the payoff progress bar should move,
    and a new Expense entry (category "Loan Payment") should appear on that
    account in **Transactions**.
  - Edit that payment's amount to something larger — its principal portion
    should grow and the outstanding balance should drop further.
  - Delete the payment — both the payment row and its linked transaction
    should disappear, and the outstanding balance should go back up.
  - Try deleting the loan itself while a payment is logged — it should
    refuse and suggest archiving instead; archive it and confirm it moves to
    the "Archived loans" section.
- Click the **Goals** tab:
  - Add a goal linked to an existing account — its progress should
    immediately match that account's current balance, with no separate entry
    needed.
  - Add a second goal with no linked account and a target date a few months
    out, then click into it and log a manual contribution — the progress bar
    and "Required / month" figure should update, and no new Transaction
    should appear in the Transactions tab for it.
  - Edit that contribution's amount, then delete it, confirming progress
    updates both times.
  - Try deleting the manual goal while a contribution is logged — it should
    refuse and suggest archiving instead, same as Loans.
  - Set a target date in the past on a goal that isn't fully funded — its
    detail screen should show "0 months left" rather than a negative number.
- Click the **Reports** tab (needs transactions across more than one year to
  see everything):
  - Confirm the year-over-year table and chart show one row/group per year
    with data, and that the oldest year's change columns read "—" (nothing
    before it to compare against).
  - Switch the "Year in review" dropdown between years and confirm the
    recap's numbers (income, expense, top category, busiest month) actually
    change to match that year's data.
  - With only one year of data, the year-over-year chart should say so
    instead of trying to draw a one-bar comparison.
- There's no in-app button for this anymore (removed per your request), but
  the same realistic dataset is still one command away for testing: run
  `node -e "import('./js/state/sampleData.js').then(m=>console.log(JSON.stringify(m.buildSampleData())))" > sample.json`
  and import `sample.json` via **Accounts → Import backup**. Once loaded:
  - On the **Dashboard**, confirm **Net worth** now reads noticeably lower
    than **Liquid balance + Investments + MP2** combined — the difference
    should equal the new **Loans outstanding** KPI card's value (check it
    against the Car Loan's outstanding balance on the **Loans** tab).
  - Check the **sidebar nav**: Dashboard on its own at the top, then a
    **Money** group (Transactions/Accounts/Investments), a **Planning**
    group (Loans/Goals), and an **Insights** group (Reports) — with thin
    divider lines between groups on a narrow/mobile window, and visible
    "Money"/"Planning"/"Insights" text labels once the window is wide enough
    for the sidebar to go vertical.
  - On **Loans**, the Car Loan should show ~20 payments logged and a
    partway-paid-down progress bar; the archived Phone Loan should sit under
    "Archived loans" fully paid off.
  - On **Goals**, "Emergency Fund" (linked) should track the Emergency Fund
    account's balance directly; "Japan Trip 2026" (manual) should show
    partial progress with several logged contributions; "New Laptop"
    (manual) should show 100%+ progress and "$0/month" required.
  - On **Reports**, the year dropdown should offer at least 2025 and 2026
    with a real year-over-year comparison between them.
  - To re-run the same checks from the command line instead of clicking
    through: `node js/state/sampleData.js`-style scripts can `import {
    buildSampleData } from './js/state/sampleData.js'` directly — see the
    Phase 9/10 verification script referenced in the changelog above for a
    full example.
- Check the **nav bar**: hover/inspect "Money", "Planning", "Insights", and
  "Overview" — they should show a normal cursor (not a pointer), never
  highlight, and never respond to a click. Each should have a thin rule line
  above it visually separating it from the group before it.
- Click **🙉 Hide amounts** in the bottom-left of the sidebar — every peso
  figure on the currently-open tab should immediately turn into `₱ •••••`.
  Switch tabs while it's on — the new tab should load already masked. Click
  it again (now labeled **🙈 Show amounts**) to restore real figures.
  Reload the page — the masked/unmasked state should persist.
- On **Investments**, open a market-fund holding, add a **Buy** lot and pick
  an account — an Expense transaction (category "Investments") should
  appear on that account in **Transactions**, and the lot row should show a
  🔗. Edit the lot's amount — the linked transaction's amount should update
  to match. Delete the lot — the transaction should disappear too. Repeat
  for a **Dividend** lot and confirm it creates an *Income* transaction
  instead (money coming in, not going out).
- On an **MP2 fund**, add a contribution for a month with no existing entry
  and pick an account — same auto-linked Expense behavior. Add again to a
  month that already has an entry — it should just top up the total with no
  new transaction created (by design — see the changelog above for why).

`localhost` counts as a secure context, so the service worker still
registers fine here even without HTTPS.

## Test the offline/production build

`npm run dev` doesn't precache anything the same way a production build does.
To test it closer to how it'll behave on GitHub Pages:

```bash
npm run build
npm run preview
```

Then open the preview URL, let the page load once (so the service worker
installs and caches the shell), and try reloading with your browser's dev
tools set to "Offline" — the placeholder page should still load.

## Other scripts

```bash
npm run lint      # ESLint + security plugin
npm run format    # Prettier, writes changes
npm run audit     # npm audit (dependency vulnerabilities)
npm run security  # audit + lint together
npm run test:loans-goals-reports  # 46 assertions against sampleData.js + edge cases (loansService/goalsService/reportsService)
```
