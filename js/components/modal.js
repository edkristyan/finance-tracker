import { attachAmountFormatters } from '../utils/format.js';

/**
 * Opens a form modal and returns the overlay element. The caller wires
 * submission via onModalSubmit — kept separate so the caller can build the
 * fields HTML however it needs to without this module knowing about any
 * particular feature's form shape.
 * @param {string} title
 * @param {string} fieldsHtml - inner HTML for the form's fields
 * @param {string} [submitLabel]
 * @returns {HTMLElement} the overlay element
 */
export function openModal(title, fieldsHtml, submitLabel) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal-box"><h3>${title}</h3><form id="modal-form">${fieldsHtml}
    <div class="modal-actions"><button type="button" class="btn secondary" id="modal-cancel">Cancel</button>
    <button type="submit" class="btn">${submitLabel || 'Save'}</button></div></form></div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#modal-cancel').onclick = () => overlay.remove();
  attachAmountFormatters(overlay);
  setTimeout(() => {
    const field = overlay.querySelector('input,select');
    if (field) field.focus();
  }, 30);
  return overlay;
}

/**
 * Wires a modal's form submission to an async handler, then closes the
 * modal once the handler resolves.
 * @param {HTMLElement} overlay - as returned by openModal
 * @param {(formData: FormData) => Promise<void>} handler
 */
export function onModalSubmit(overlay, handler) {
  overlay.querySelector('#modal-form').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await handler(new FormData(e.target));
      overlay.remove();
    } catch (err) {
      console.error('Modal submit failed:', err);
    }
  };
}

/**
 * Confirmation dialog with intentional friction: the confirm button stays
 * disabled for a beat (450ms for destructive actions, 200ms otherwise) so a
 * click is always a considered one, not a reflex. Not dismissible by
 * backdrop click — only the explicit Cancel/Confirm buttons close it.
 * @param {string} message
 * @param {boolean} danger - true for destructive actions (longer hold, red button)
 * @param {() => Promise<void>} onConfirm
 */
export function confirmModal(message, danger, onConfirm) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal-box"><p style="margin:0 0 16px;">${message}</p>
    <div class="modal-actions"><button class="btn secondary" id="modal-no">Cancel</button>
    <button class="btn ${danger ? 'danger' : ''}" id="modal-yes" disabled>Confirm</button></div></div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#modal-no').onclick = () => overlay.remove();
  const yesBtn = overlay.querySelector('#modal-yes');
  const holdMs = danger ? 450 : 200;
  setTimeout(() => {
    yesBtn.disabled = false;
  }, holdMs);
  yesBtn.onclick = async () => {
    if (yesBtn.disabled) return;
    overlay.remove();
    try {
      await onConfirm();
    } catch (err) {
      console.error('Confirm action failed:', err);
    }
  };
}

/**
 * Simple informational dialog with a single Close button.
 * @param {string} title
 * @param {string} bodyHtml
 * @returns {HTMLElement} the overlay element
 */
export function infoModal(title, bodyHtml) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal-box"><h3>${title}</h3><div>${bodyHtml}</div>
    <div class="modal-actions"><button type="button" class="btn" id="info-close">Close</button></div></div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#info-close').onclick = () => overlay.remove();
  return overlay;
}
