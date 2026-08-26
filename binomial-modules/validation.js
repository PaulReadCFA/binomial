import {
  updateFieldError,
  updateValidationSummary,
  hasErrors,
  requiredMessage,
  minMessage,
  maxMessage,
} from '../validation-ui.js';

export { updateFieldError, updateValidationSummary, hasErrors };

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
    return requiredMessage(rules.label);
  }

  if (rules.positive && Number(value) <= 0) {
    return `${rules.label} must be > 0`;
  }
  
  if (rules.min !== undefined && value < rules.min) {
    return minMessage(rules.label, `${rules.min}${rules.unit || ''}`);
  }
  
  if (rules.max !== undefined && value > rules.max) {
    return maxMessage(rules.label, `${rules.max}${rules.unit || ''}`);
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
    errors.su = 'Up-state price must be greater than down-state price';
  }
  
  if (Number.isFinite(inputs.s0) && Number.isFinite(inputs.su) && Number.isFinite(inputs.sd)) {
    if (!(inputs.sd < inputs.s0 && inputs.s0 < inputs.su)) {
      errors.s0 = 'Current price must be between down-state and up-state prices';
    }
  }

  if (!errors.su && !errors.s0
      && Number.isFinite(inputs.riskFreeRate)) {
    const r = inputs.riskFreeRate / 100;
    const probability = ((1 + r) * inputs.s0 - inputs.sd) / (inputs.su - inputs.sd);
    if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
      errors.riskFreeRate = 'Risk-free rate must imply a risk-neutral probability between 0% and 100%';
    }
  }
  
  return errors;
}