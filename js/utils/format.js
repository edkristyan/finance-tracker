/**
 * format.js — money, date, and file-download formatting helpers used across
 * every view. Pulled out on their own because they're pure functions with
 * no dependency on the store or the DOM (attachAmountFormatters is the one
 * exception, since live input formatting has to touch the DOM by nature).
 * peso() is the one function here with a state dependency — it reads the
 * global "Hide amounts" privacy toggle so every call site across every view
 * gets masking for free, without having to thread a `masked` flag through
 * dozens of render functions individually.
 */
import { isPrivacyMode } from '../state/privacy.js';

/**
 * Formats a number as Philippine peso currency.
 * @param {number} n
 * @param {boolean} [masked] - if true, returns a fixed-length placeholder
 *   instead of the real figure. Defaults to the global "Hide amounts"
 *   privacy toggle when not explicitly passed, so existing call sites mask
 *   automatically; pass `false` explicitly to force a real figure even in
 *   privacy mode (there's currently no such case, but the escape hatch
 *   costs nothing to keep).
 * @returns {string}
 */
export function peso(n, masked) {
  const shouldMask = masked === undefined ? isPrivacyMode() : masked;
  const sign = n < 0 ? '-' : '';
  if (shouldMask) return `${sign}₱ •••••`;
  const v = Math.abs(n || 0);
  return `${sign}₱${v.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Live thousands-separator formatting for amount inputs (type="text" so
 * commas are allowed while typing). parseAmount() is what every submit
 * handler should read the value back through.
 * @param {string} str
 * @returns {string}
 */
export function formatAmountLive(str) {
  let clean = (str || '').replace(/[^\d.]/g, '');
  const firstDot = clean.indexOf('.');
  if (firstDot !== -1) clean = clean.slice(0, firstDot + 1) + clean.slice(firstDot + 1).replace(/\./g, '');
  let [intPart, decPart] = clean.split('.');
  intPart = (intPart || '').replace(/^0+(?=\d)/, '');
  const withCommas = intPart ? intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : '';
  return decPart != null ? `${withCommas}.${decPart.slice(0, 2)}` : withCommas;
}

/**
 * Parses a possibly comma-formatted amount string back into a number.
 * @param {string} str
 * @returns {number}
 */
export function parseAmount(str) {
  return parseFloat((str == null ? '' : String(str)).replace(/,/g, '')) || 0;
}

/**
 * Wires live thousands-separator formatting onto every `.amount-input`
 * under `root` that isn't already wired. Idempotent — safe to call again
 * after re-rendering a container.
 * @param {HTMLElement} [root]
 */
export function attachAmountFormatters(root) {
  (root || document).querySelectorAll('.amount-input').forEach((input) => {
    if (input.dataset.amountWired) return;
    input.dataset.amountWired = '1';
    if (input.value) input.value = formatAmountLive(String(input.value));
    input.addEventListener('input', () => {
      const cursorFromEnd = input.value.length - input.selectionStart;
      input.value = formatAmountLive(input.value);
      const pos = Math.max(0, input.value.length - cursorFromEnd);
      input.setSelectionRange(pos, pos);
    });
  });
}

/**
 * Formats a fraction as a signed percentage, e.g. 0.0532 -> "+5.32%".
 * @param {number} n
 * @returns {string}
 */
export function pct(n) {
  return `${n >= 0 ? '+' : ''}${(n * 100).toFixed(2)}%`;
}

/**
 * Formats an ISO date string (YYYY-MM-DD) for display.
 * @param {string} iso
 * @returns {string}
 */
export function fmtDate(iso) {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * Escapes a value for safe inclusion in a CSV cell.
 * @param {*} v
 * @returns {string}
 */
export function csvEscape(v) {
  const str = v == null ? '' : String(v);
  if (/["\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

/**
 * Triggers a browser download of in-memory content (no server involved).
 * @param {string} filename
 * @param {string} content
 * @param {string} mime
 */
export function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 200);
}
