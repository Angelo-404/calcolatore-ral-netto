import { T } from '../texts/it.js';
import { computeEmployee } from './employee.js';
import { invertNet } from './inverse.js';
import { CONSTANTS } from './national-rules.js';
import { EMPLOYEE_PARAMS, YEARS } from './parameters.js';
import { MUNICIPALITIES_BY_CODE } from './territory.js';

/* ====================================================================
   OPTIMISING THE EMPLOYER COST
   ----------------------------------------------------------------------
   A euro of gross salary and a euro of welfare do not cost the company the
   same, because they do not bear the same levy. Giving value to the worker
   through exempt tools costs about half.
   
   Two directions, same machine:
   - from the desired net  -> which package delivers it at the lowest
   employer cost;
   - from the company budget -> which is the highest value that budget
   can deliver.
   
   The efficiency of each tool is not written by hand: it is measured by
   perturbing the engine and observing how much value reaches the worker for
   each euro the company spends.
   ==================================================================== */

/* Legal caps of the exempt tools, for the current scenario */
export function exemptCaps(params) {
  const A = YEARS[params.year] || YEARS[2026];
  const voucherLimit = params.electronicVouchers === false ? A.paperVoucher : A.electronicVoucher;
  return {
    fringe: params.children > 0 || params.youngChildren > 0 ? EMPLOYEE_PARAMS.FRINGE_THRESHOLD_WITH_CHILDREN : EMPLOYEE_PARAMS.FRINGE_THRESHOLD,
    vouchers: voucherLimit * (params.voucherDays || EMPLOYEE_PARAMS.VOUCHER_DAYS_YEAR),
    perfBonus: A.bonusCap,
    voucherLimit
  };
}

/* How much value the worker receives for each euro the company spends.
   Measured, not declared: a share is added to each tool and the real change
   in value and cost is observed. */
export function toolEfficiency(params) {
  const neutro = { ...params, fringeBenefit: 0, mealVoucherPerDay: 0, performanceBonus: 0,
                   bonusAsWelfare: false, shiftPremiums: 0 };
  const base = computeEmployee(neutro);
  const value = (r) => r.netAnnual + r.welfareExempt;
  const caps = exemptCaps(params);
  const step = 100;

  const measure = (change) => {
    const r = computeEmployee({ ...neutro, ...change });
    const deltaCost = r.employerCost - base.employerCost;
    const deltaValue = value(r) - value(base);
    return deltaCost > 0.01 ? deltaValue / deltaCost : 0;
  };

  return {
    salary: measure({ salary: neutro.salary + step }),
    fringe: caps.fringe >= step ? measure({ fringeBenefit: step }) : 0,
    vouchers: caps.voucherLimit > 0 ? measure({ mealVoucherPerDay: Math.min(caps.voucherLimit, 4) }) : 0,
    bonusWelfare: measure({ performanceBonus: step, bonusAsWelfare: true }),
    bonusCash: measure({ performanceBonus: step, bonusAsWelfare: false })
  };
}

/* Inversion on cost: which gross salary brings the employer cost to the
   given value. Cost grows with the salary without jumps, so bisection is
   enough. */
export function invertCost(targetCost, params) {
  const cost = (salary) => computeEmployee({ ...params, salary }).employerCost;
  if (targetCost <= cost(0)) return 0;

  let low = 0, high = 1000000;
  if (cost(high) < targetCost) return high;
  for (let i = 0; i < 60 && high - low > 0.5; i++) {
    const half = (low + high) / 2;
    if (cost(half) < targetCost) low = half;
    else high = half;
  }
  return low;
}

/* Build a package: welfare up to the given caps, then the gross salary
   needed to cover the rest. */
export function buildPackage(name, description, params, shares, goal) {
  const caps = exemptCaps(params);

  const fringe = Math.min(shares.fringe || 0, caps.fringe);
  const voucherPerDay = shares.vouchers ? Math.min(shares.vouchers / (params.voucherDays || EMPLOYEE_PARAMS.VOUCHER_DAYS_YEAR), caps.voucherLimit) : 0;
  const vouchers = voucherPerDay * (params.voucherDays || EMPLOYEE_PARAMS.VOUCHER_DAYS_YEAR);
  const perfBonus = Math.min(shares.perfBonus || 0, caps.perfBonus);
  const welfare = fringe + vouchers + perfBonus;

  const packageParams = { ...params, fringeBenefit: fringe, mealVoucherPerDay: voucherPerDay,
                   performanceBonus: perfBonus, bonusAsWelfare: perfBonus > 0 };

  let salary;
  if (goal.type === 'net') {
    const cashNeeded = Math.max(0, goal.value - welfare);
    const inversion = invertNet(cashNeeded, packageParams);
    salary = inversion.outcome === 'exact' ? inversion.salary
        : inversion.outcome === 'unreachable' ? inversion.above.salary
        : 0;
  } else {
    // From the budget: the cost returned by the engine already includes welfare,
    // so the target is the whole budget, not the budget net of it.
    salary = invertCost(goal.value, packageParams);
  }

  let r = computeEmployee({ ...packageParams, salary });

  /* The relieved bonus is not due above the income threshold: if the needed
     salary exceeds it, the package would promise welfare that will not be
     paid. It is rebuilt without the bonus, so the numbers shown match what the
     worker really receives. */
  if (perfBonus > 0 && salary > EMPLOYEE_PARAMS.BONUS_INCOME_MAX) {
    const withoutBonus = buildPackage(name, description, params,
                                         { fringe: shares.fringe, vouchers: shares.vouchers, perfBonus: 0 }, goal);
    return { ...withoutBonus, bonusOverThreshold: true };
  }

  return {
    name, description, salary,
    fringe, vouchers, perfBonus, welfare: r.welfareExempt,
    netCash: r.netAnnual,
    totalValue: r.netAnnual + r.welfareExempt,
    employerCost: r.employerCost,
    cashShare: (r.netAnnual + r.welfareExempt) > 0 ? r.netAnnual / (r.netAnnual + r.welfareExempt) : 1,
    bonusOverThreshold: perfBonus > 0 && salary > EMPLOYEE_PARAMS.BONUS_INCOME_MAX,
    result: r
  };
}

/* The three packages, from the simplest to the most efficient */
export function optimisedPackages(goal, params) {
  const caps = exemptCaps(params);
  const neutro = { ...params, fringeBenefit: 0, mealVoucherPerDay: 0,
                   performanceBonus: 0, bonusAsWelfare: false };

  // Welfare cannot exceed the value to be delivered
  const space = goal.type === 'net' ? goal.value : Infinity;
  const fringe = Math.min(caps.fringe, space);
  const vouchers = Math.min(caps.vouchers, Math.max(0, space - fringe));
  const perfBonus = Math.min(caps.perfBonus, Math.max(0, space - fringe - vouchers));

  return [
    buildPackage(T.optimisedPackages_6,
      T.optimisedPackages_5,
      neutro, {}, goal),
    buildPackage(T.optimisedPackages_4,
      T.optimisedPackages_3,
      neutro, { fringe, vouchers }, goal),
    buildPackage(T.optimisedPackages_2,
      T.optimisedPackages_1,
      neutro, { fringe, vouchers, perfBonus }, goal)
  ];
}

/* ====================================================================
   WHAT THE WORKER GAINS AND WHAT THEY GIVE UP
   ----------------------------------------------------------------------
   Welfare does not go through the payslip: it is not taxable, but for that
   very reason it is not pay either. What is not pay does not build a
   pension, does not accrue TFR and does not enter the bases used to compute
   benefits. A comparison showing only the saving would be half the truth.
   ==================================================================== */

/* Pension accrual rate for employment: the share of pay that feeds the
   contribution pot, higher than the payslip deduction alone because it
   includes the employer's share. */
export const PENSION_ACCRUAL_RATE = 0.33;

export function foregoneAnalysis(reference, alternative) {
  const deltaSalary = reference.salary - alternative.salary;
  const deltaTfr = reference.result.tfr - alternative.result.tfr;
  const deltaPensionPot = deltaSalary * PENSION_ACCRUAL_RATE;
  const deltaNetCash = alternative.netCash - reference.netCash;
  const deltaCost = reference.employerCost - alternative.employerCost;
  const deltaValue = alternative.totalValue - reference.totalValue;

  return {
    deltaSalary, deltaTfr, deltaPensionPot, deltaNetCash, deltaCost, deltaValue,
    welfare: alternative.welfare,
    // TFR is deferred but stays the worker's money: the real loss,
    // for a single year, is the sum of TFR and pension accrual.
    annualForegone: deltaTfr + deltaPensionPot,
    annualGain: deltaValue > 0.5 ? deltaValue : deltaCost
  };
}

/* ====================================================================
   THRESHOLDS: WHERE IT PAYS TO STOP THE TAXABLE INCOME
   ----------------------------------------------------------------------
   Legal thresholds are not all alike. Some only change the marginal rate,
   and crossing them costs nothing in net terms. Others are real steps:
   going one euro over loses a whole amount. Moving pay into welfare lowers
   taxable income, so it can bring it back below a step. It is worth it only
   if what is recovered exceeds what is given up.
   ==================================================================== */

export function relevantThresholds(params) {
  const packageParams = MUNICIPALITIES_BY_CODE.get(params.packageParams);
  const municipalExemption = packageParams ? packageParams[params.year].exemption : 0;

  const thresholds = [
    { value: EMPLOYEE_PARAMS.BONUS_INCOME_MAX, name: T.thresholds_name_6, notch: true },
    { value: 15000, name: T.thresholds_name_7, notch: true },
    { value: CONSTANTS.WEDGE.BONUS_1_UP_TO, name: T.thresholds_name_5, notch: true },
    { value: 20000, name: T.thresholds_name_4, notch: true },
    { value: 35000, name: T.thresholds_name_3, notch: true },
    { value: 28000, name: T.thresholds_name_2, notch: false },
    { value: 50000, name: T.thresholds_name_1, notch: false }
  ];
  if (municipalExemption > 0) {
    thresholds.push({ value: municipalExemption, notch: true,
                  name: T.relevantThresholds_name_1(packageParams.name) });
  }
  return thresholds.sort((a, b) => a.value - b.value);
}

/* Find the nearest threshold below the current taxable income and measure,
   without estimating, how much would be recovered by bringing it just below. */
export function thresholdOpportunity(params, welfareAvailable) {
  const current = computeEmployee(params);
  const taxable = current.taxable;
  if (!(taxable > 0) || welfareAvailable <= 0) return null;

  let best = null;

  for (const threshold of relevantThresholds(params)) {
    if (taxable <= threshold.value) continue;                 // already below

    /* How much gross to move so that taxable income drops below the threshold
       cannot be derived from a single rate: between gross salary and taxable
       income there are also the 1% additional contribution and the sector funds,
       which vary by profile. For an executive the analytical estimate was off by
       128 euro and left taxable income above the threshold. It is measured by
       bisection. */
    const taxableWith = (cut) => computeEmployee({ ...params, salary: params.salary - cut }).taxable;
    if (taxableWith(welfareAvailable) >= threshold.value) continue;   // out of reach

    let low = 0, high = welfareAvailable;
    for (let i = 0; i < 40 && high - low > 0.5; i++) {
      const half = (low + high) / 2;
      if (taxableWith(half) >= threshold.value) low = half;
      else high = half;
    }
    const shift = Math.min(high + 5, welfareAvailable);
    if (taxableWith(shift) >= threshold.value) continue;

    const trial = computeEmployee({ ...params, salary: params.salary - shift });
    const valueBefore = current.netAnnual + current.welfareExempt;
    const valueAfter = trial.netAnnual + trial.welfareExempt + shift;
    const gain = valueAfter - valueBefore;

    if (gain > 1 && (!best || gain > best.gain)) {
      best = { ...threshold, shift, gain, taxableAfter: trial.taxable };
    }
  }
  return best;
}
