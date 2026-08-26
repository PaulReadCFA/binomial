/**
 * Shared validation UI for CFA equation explorers.
 * Domain rules stay local. This module owns field errors, the summary, and
 * count-only announcements.
 */

const ERROR_ID_SUFFIX = '-error';

let lastAnnouncedCount = 0;
let validationLiveRegion = null;

export function hasErrors(errors = {}) {
  return Object.keys(errors).length > 0;
}

export function allFinite(...values) {
  return values.every((v) => Number.isFinite(v));
}

export function requiredMessage(label) {
  return `${label} is required`;
}

export function wholeNumberMessage(label) {
  return `${label} must be a whole number`;
}

export function minMessage(label, min) {
  return `${label} must be >= ${min}`;
}

export function maxMessage(label, max) {
  return `${label} must be <= ${max}`;
}

/** ISO currency in messages: USD1,234 with no space (not $). */
export function usdAmount(n) {
  const formatted = typeof n === 'number' ? n.toLocaleString('en-US') : String(n);
  return `USD${formatted}`;
}

function fieldExists(fieldId) {
  return !!document.getElementById(fieldId);
}

function helpIdsFor(el) {
  return (el.getAttribute('aria-describedby') || '')
    .split(/\s+/)
    .filter(Boolean)
    .filter((id) => !id.endsWith(ERROR_ID_SUFFIX));
}

export function updateFieldError(fieldId, msg) {
  const el = document.getElementById(fieldId);
  if (!el) return;

  const hasError = !!msg;
  const errorId = `${fieldId}${ERROR_ID_SUFFIX}`;
  const helpIds = helpIdsFor(el);

  el.classList.toggle('error', hasError);
  el.setAttribute('aria-invalid', hasError ? 'true' : 'false');

  if (hasError) {
    el.setAttribute('aria-describedby', [...helpIds, errorId].join(' '));
    let errorEl = document.getElementById(errorId);
    if (!errorEl) {
      errorEl = document.createElement('span');
      errorEl.id = errorId;
      errorEl.className = 'sr-only';
      errorEl.setAttribute('role', 'alert');
      (el.parentElement || el).appendChild(errorEl);
    }
    errorEl.textContent = msg;
  } else {
    if (helpIds.length) el.setAttribute('aria-describedby', helpIds.join(' '));
    else el.removeAttribute('aria-describedby');
    const errorEl = document.getElementById(errorId);
    if (errorEl) errorEl.remove();
  }
}

export function applyFieldErrors(errors, fieldIds) {
  fieldIds.forEach((id) => updateFieldError(id, errors[id] || null));
}

function announceValidationCount(cnt) {
  if (!validationLiveRegion) {
    validationLiveRegion = document.createElement('div');
    validationLiveRegion.id = 'validation-live-region';
    validationLiveRegion.className = 'sr-only';
    validationLiveRegion.setAttribute('aria-live', 'polite');
    validationLiveRegion.setAttribute('aria-atomic', 'true');
    document.body.appendChild(validationLiveRegion);
  }
  validationLiveRegion.textContent = `${cnt} validation ${cnt === 1 ? 'error' : 'errors'}.`;
  setTimeout(() => {
    if (validationLiveRegion) validationLiveRegion.textContent = '';
  }, 1500);
}

/**
 * Render the visible summary. Linked items only when `fieldId` matches an input.
 * Announces the error count when the summary first appears or the count changes;
 * does not re-read the list on every keystroke.
 */
export function updateValidationSummary(errors = {}) {
  const sum = document.getElementById('validation-summary');
  const list = document.getElementById('validation-list');
  if (!sum || !list) return;

  const cnt = Object.keys(errors).length;
  const wasHidden = sum.style.display === 'none' || getComputedStyle(sum).display === 'none';

  if (cnt) {
    list.innerHTML = Object.entries(errors)
      .map(([fieldId, message]) => {
        if (fieldExists(fieldId)) {
          return `<li><a href="#${fieldId}" data-field="${fieldId}" class="validation-error-link">${message}</a></li>`;
        }
        return `<li>${message}</li>`;
      })
      .join('');
    sum.style.display = 'block';

    list.querySelectorAll('.validation-error-link').forEach((link) => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const field = document.getElementById(link.getAttribute('data-field'));
        if (!field) return;
        field.focus();
        if (typeof field.select === 'function') field.select();
        field.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    });

    if (wasHidden || lastAnnouncedCount !== cnt) {
      announceValidationCount(cnt);
      lastAnnouncedCount = cnt;
    }

    if (wasHidden) {
      sum.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  } else {
    list.innerHTML = '';
    sum.style.display = 'none';
    lastAnnouncedCount = 0;
  }
}
