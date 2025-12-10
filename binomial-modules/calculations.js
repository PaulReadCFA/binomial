export function calculateBinomialOption({ s0, su, sd, strike, riskFreeRate }) {
  const r = riskFreeRate / 100;
  
  // Option payoffs at expiration
  const Cu = Math.max(su - strike, 0);  // Call up
  const Cd = Math.max(sd - strike, 0);  // Call down
  const Pu = Math.max(strike - su, 0);  // Put up
  const Pd = Math.max(strike - sd, 0);  // Put down
  
  // Risk-neutral probability
  const p = ((1 + r) * s0 - sd) / (su - sd);
  
  // Option prices at t=0
  const C0 = (p * Cu + (1 - p) * Cd) / (1 + r);
  const P0 = (p * Pu + (1 - p) * Pd) / (1 + r);
  
  return {
    Cu, Cd, Pu, Pd,
    C0, P0,
    p,
    isValid: s0 > 0 && su > 0 && sd > 0 && su > sd && r > -1
  };
}

export function calculateOptionMetrics(params) {
  return calculateBinomialOption(params);
}
