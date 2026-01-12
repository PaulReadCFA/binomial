export function calculateBinomialOption({ s0, su, sd, strike, riskFreeRate }) {
  const r = riskFreeRate / 100;
  
  // Option payoffs at expiration
  const Cu = Math.max(su - strike, 0);  // Call up
  const Cd = Math.max(sd - strike, 0);  // Call down
  const Pu = Math.max(strike - su, 0);  // Put up
  const Pd = Math.max(strike - sd, 0);  // Put down
  
  // Hedge ratios
  const HRc = (Cu - Cd) / (su - sd);
  const HRp = (Pu - Pd) / (su - sd);
  
  // Option prices at t=0 using hedge ratio method
  const C0 = s0 * HRc - (HRc * su - Cu) / (1 + r);
  const P0 = s0 * HRp - (HRp * su - Pu) / (1 + r);
  
  // Risk-neutral probability (for reference/validation)
  const p = ((1 + r) * s0 - sd) / (su - sd);
  
  return {
    Cu, Cd, Pu, Pd,
    C0, P0,
    HRc, HRp,
    p,
    isValid: s0 > 0 && su > 0 && sd > 0 && su > sd && r > -1
  };
}

export function calculateOptionMetrics(params) {
  return calculateBinomialOption(params);
}