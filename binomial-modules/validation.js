import { $ } from './utils.js';

const VALIDATION_RULES = {
  s0: { min: 0, positive: true, required: true, label: 'Current price' },
  su: { min: 0, positive: true, required: true, label: 'Up-state price' },
  sd: { min: 0, positive: true, required: true, label: 'Down-state price' },
  strike: { min: 0, required: true, label: 'Strike price' },
  riskFreeRate: { min: -99, max: 100, required: true, label: 'Risk-free rate', unit: '%' }
};

export function validateField(field, value) {
  const rules = VALIDATION_RULES[field];
  if (!rules) return null;
  
  if (rules.required && (value === '' || value == null || !Number.isFinite(Number(value)))) {
    return `${rules.label} is required`;
  }

  if (rules.positive && Number(value) <= 0) {
    return `${rules.label} must be greater than 0`;
  }
  
  if (rules.min !== undefined && value < rules.min) {
    return `${rules.label} must be at least ${rules.min}${rules.unit || ''}`;
  }
  
  if (rules.max !== undefined && value > rules.max) {
    return `${rules.label} cannot exceed ${rules.max}${rules.unit || ''}`;
  }
  
  return null;
}

export function validateAll(inputs) {
  const errors = {};
  
  Object.keys(VALIDATION_RULES).forEach(field => {
    const error = validateField(field, inputs[field]);
    if (error) errors[field] = error;
  });
  
  if (Number.isFinite(inputs.su) && Number.isFinite(inputs.sd) && inputs.su <= inputs.sd) {
    errors.upDown = 'Up-state price must be greater than down-state price';
  }
  
  if (Number.isFinite(inputs.s0) && Number.isFinite(inputs.su) && Number.isFinite(inputs.sd)) {
    if (!(inputs.sd < inputs.s0 && inputs.s0 < inputs.su)) {
      errors.currentPrice = 'Current price must be between down-state and up-state prices';
    }
  }

  if (!errors.upDown && !errors.currentPrice
      && Number.isFinite(inputs.riskFreeRate)) {
    const r = inputs.riskFreeRate / 100;
    const probability = ((1 + r) * inputs.s0 - inputs.sd) / (inputs.su - inputs.sd);
    if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
      errors.riskFreeRate = 'Risk-free rate must imply a risk-neutral probability between 0% and 100%';
    }
  }
  
  return errors;
}

export function updateFieldError(fieldId, errorMessage) {
  const input = $(`#${fieldId}`);
  if (!input) return;
  
  if (errorMessage) {
    input.setAttribute('aria-invalid', 'true');
    input.classList.add('error');
  } else {
    input.removeAttribute('aria-invalid');
    input.classList.remove('error');
  }
}

export function updateValidationSummary(errors) {
  const summary = $('#validation-summary');
  const list = $('#validation-list');

  if (!summary || !list) return;

  if (hasErrors(errors)) {
    list.innerHTML = Object.entries(errors)
      .map(([field, message]) => `<li>${message}</li>`)
      .join('');
    summary.style.display = 'block';
  } else {
    summary.style.display = 'none';
  }
}

export function hasErrors(errors) {
  return Object.keys(errors).length > 0;
}