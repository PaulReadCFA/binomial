export const state = {
  s0: 40,
  su: 56,
  sd: 32,
  strike: 50,
  riskFreeRate: 5,
  errors: {},
  optionCalculations: null,
  listeners: []
};

export function setState(updates) {
  Object.assign(state, updates);
  state.listeners.forEach(fn => fn(state));
}

export function subscribe(fn) {
  state.listeners.push(fn);
}