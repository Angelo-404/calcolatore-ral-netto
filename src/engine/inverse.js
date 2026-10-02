import { computeEmployee } from './employee.js';

/* ====================================================================
   INVERSION — from the requested net to the gross salary (RAL)
   ----------------------------------------------------------------------
   Net pay is not a monotonic function of the gross salary: the three legal
   thresholds produce downward jumps. A downward jump leaves no holes in the
   set of reachable nets — it crosses them a second time. As a result some
   net amounts match SEVERAL gross salaries, and the lowest is the better
   one: same net pay, lower cost for the company. The inversion finds them
   all and says so. The "unreachable" branch stays as a defence: an upward
   jump, which a future law could introduce, would create a real hole.
   ==================================================================== */

// maxJump: the largest jump in net pay the law creates today (1,200 € of
// integrative treatment, plus margin); fineStep: the scan step near the target.
export const INVERSION = { min: 0, max: 500000, step: 100, tolerance: 0.5, maxJump: 1500, fineStep: 5 };

/* Bisection on an interval where the function crosses the target */
export function bisectSalary(f, low, high, target) {
  for (let i = 0; i < 60 && high - low > INVERSION.tolerance; i++) {
    const half = (low + high) / 2;
    if (f(half) < target) low = half;
    else high = half;
  }
  return high;
}

export function invertNet(netRequested, params) {
  if (!(netRequested > 0)) return { outcome: 'zero' };

  const f = (salary) => computeEmployee({ ...params, salary }).netAnnual;
  const { min, max, step } = INVERSION;

  const netMax = f(max);
  if (netRequested > netMax) {
    return { outcome: 'outOfRange', netMaxFound: netMax, maxSalaryFound: max };
  }

  // Coarse scan: finds the crossings and, at the same time,
  // the best value reachable below and above the target.
  const crossings = [];
  let salaryPrevious = min;
  let netPrevious = f(min);
  let below = { salary: min, net: netPrevious };
  let above = null;

  for (let salary = min + step; salary <= max; salary += step) {
    const net = f(salary);

    if (net <= netRequested && net >= below.net) below = { salary, net };
    if (net >= netRequested && (!above || net < above.net)) above = { salary, net };

    // Near the target a downward jump can cross it twice inside a single
    // coarse step, and the two ends of the step would not show it: there the
    // interval is scanned again with a fine step.
    const nearTarget = Math.min(netPrevious, net) - INVERSION.maxJump <= netRequested
      && netRequested <= Math.max(netPrevious, net) + INVERSION.maxJump;
    if (nearTarget) {
      let subPrevious = salaryPrevious;
      let subNet = netPrevious;
      for (let s = salaryPrevious + INVERSION.fineStep; s <= salary + 1e-9; s += INVERSION.fineStep) {
        const n = s >= salary ? net : f(s);
        if ((subNet < netRequested) !== (n < netRequested)) crossings.push([subPrevious, s]);
        subPrevious = s;
        subNet = n;
      }
    } else if ((netPrevious < netRequested) !== (net < netRequested)) {
      crossings.push([salaryPrevious, salary]);
    }
    salaryPrevious = salary;
    netPrevious = net;
  }

  // Refine every crossing and keep only those that really hit
  // the target: a downward jump produces an apparent crossing
  // that actually steps over the requested value.
  const solutions = [];
  for (const [low, high] of crossings) {
    const salary = bisectSalary(f, low, high, netRequested);
    if (Math.abs(f(salary) - netRequested) <= 1) solutions.push(salary);
  }

  if (solutions.length) {
    const salary = Math.min(...solutions);
    return {
      outcome: 'exact',
      salary,
      net: f(salary),
      otherSolutions: solutions.filter((r) => r !== salary)
    };
  }

  // No gross salary hits the target: we are inside one of the jumps.
  // The interval is narrowed with a fine step to give the two real ends.
  let nearBelow = below;
  let nearAbove = above;
  if (above) {
    for (let salary = Math.max(min, below.salary); salary <= above.salary; salary += 1) {
      const net = f(salary);
      if (net <= netRequested && net >= nearBelow.net) nearBelow = { salary, net };
      if (net >= netRequested && net <= nearAbove.net) nearAbove = { salary, net };
    }
  }

  return {
    outcome: 'unreachable',
    below: nearBelow,
    above: nearAbove,
    jump: nearAbove ? nearAbove.net - nearBelow.net : 0
  };
}
