import { T } from '../texts/it.js';
import {
  CONSTANTS,
  CONTRIBUTION_PROFILES,
  DEFAULT_PROFILE,
  EMPLOYEE_PARAMS,
  ENGINE_FINGERPRINT,
  ENGINE_VERSION,
  HIRING_EXEMPTIONS,
  LEGACY_PROFILES,
  MUNICIPALITIES,
  MUNICIPALITIES_BY_CODE,
  PENSION_ACCRUAL_RATE,
  PENSION_SCHEMES,
  PROVINCE_REGION,
  REGIONAL_TAX_RULES,
  REGIONS,
  SELF_EMPLOYED_REGIMES,
  SEPARATE_SCHEME,
  TAX_REGIMES,
  YEARS,
  applyTaxRegime,
  bandCorrection,
  computeBracketTax,
  computeEmployee,
  computeEmployeeContributions,
  computeEmploymentDeduction,
  computeExtraDeduction,
  computeIntegrativeTreatment,
  computeRegionalTax,
  computeSelfEmployed,
  computeSelfEmployedDeduction,
  computeWedgeBonus,
  employmentDeductionBand,
  employmentDeductionForPeriod,
  exemptCaps,
  exemptionStatus,
  exemptionsInConflict,
  foregoneAnalysis,
  invertNet,
  normaliseProfile,
  optimisedPackages,
  socialSecurityContributions,
  thresholdOpportunity,
  toolEfficiency,
  wedgeBonusRate,
  spouseDeduction, SOUTHERN_REGIONS } from '../engine/index.js';
import { euro, euro2, fmtPct, fmtPct2, ratePct } from '../ui/format.js';
import {
  DATASET_UPDATED,
  REGIONAL_RATES_BY_YEAR,
  MUNICIPALITY_REGISTRY,
  MUNICIPALITY_RATES_2025,
  MUNICIPALITY_DIFF_2026
} from '../data/mef-data.js';

export function engineFingerprint() {
  const material = [
    computeEmploymentDeduction, employmentDeductionBand,
    bandCorrection, employmentDeductionForPeriod, computeWedgeBonus, wedgeBonusRate,
    computeSelfEmployedDeduction,
    computeExtraDeduction, computeIntegrativeTreatment, computeBracketTax,
    computeEmployee, computeEmployeeContributions, socialSecurityContributions, computeRegionalTax,
    applyTaxRegime, exemptionStatus, computeSelfEmployed, invertNet
  ].map((fn) => fn.toString()).join('')
    + JSON.stringify(CONSTANTS) + JSON.stringify(YEARS) + JSON.stringify(EMPLOYEE_PARAMS)
    + JSON.stringify(REGIONAL_TAX_RULES);

  /* Whitespace and comments are not part of the engine: without removing
     them the fingerprint would change with indentation, with CRLF/LF, or
     with a reworded comment. */
  const bare = material
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')
    .replace(/\s+/g, '');

  // 32-bit FNV-1a: no cryptographic strength needed, only noticing changes.
  let h = 0x811c9dc5;
  for (let i = 0; i < bare.length; i++) {
    h ^= bare.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function runTests() {
  const results = [];
  const check = (name, condition, detail = '') => results.push({ name, outcome: !!condition, detail });
  const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;

  /* Standard scenario: white-collar worker in services, permanent contract,
     Milan/Lombardy, 13 monthly payments, no parameter active. The year stays
     2025 because many tests below measure precisely the jump between the two
     years; `standard` moves it to 2026. */
  const baseScenario = { year: 2025, monthlyPayments: 13, profile: 'terziario_impiegato',
                         region: 'Lombardia', municipality: 'F205' };
  const standard = (salary) => computeEmployee({ ...baseScenario, year: 2026, salary });
  // Employee rate below the first pensionable band.
  const EMPLOYEE_RATE = standard(30000).inps / 30000;

  // Reference value computed by hand
  const r30 = standard(30000);
  check('RAL 30.000 — INPS = 2.757,00 €', near(r30.inps, 2757), euro2(r30.inps));
  check(T.runTests_143, near(r30.taxable, 27243), euro2(r30.taxable));
  check(T.runTests_122, near(r30.netAnnual, 23425.52, 0.02), euro2(r30.netAnnual));

  // Step effect of the Milan municipal surcharge
  const above = standard(23001 / (1 - EMPLOYEE_RATE));
  const below = standard(22999 / (1 - EMPLOYEE_RATE));
  check(T.runTests_121, below.municipalTax === 0, euro2(below.municipalTax));
  check(T.runTests_120,
        near(above.municipalTax, above.taxable * 0.008), euro2(above.municipalTax));

  // Capacity: net IRPEF is never negative
  let capacityOk = true;
  for (let salary = 1000; salary <= 200000; salary += 1000) {
    if (standard(salary).netIrpef < 0) { capacityOk = false; break; }
  }
  check(T.runTests_142, capacityOk);

  /* Discontinuities: the law creates four known "tax traps", where a higher
     gross salary gives a lower net. No other break of monotonicity is
     allowed: it would be an engine bug.
     8,500 €  → the wedge bonus drops from 7.1% to 5.3%
     15,000 €  → the integrative treatment ends
     23,000 €  → step effect of the Milan municipal surcharge
     35,000 €  → the 65 € band correction ends
     The first appeared together with the fix of the integrative treatment: as
     long as the treatment started at 8,500 € instead of 8,173.91 €, its
     1,200 € fell exactly on the wedge step and covered it. The step was
     already there — the wrong threshold was hiding it.
     The threshold is checked to the cent: rounding to the thousand confused
     8,500 € with 9,000 € and would have accepted a break in the wrong place. */
  const expectedThresholds = [8500, 15000, 23000, 35000];
  const breaks = [];
  let previous = null;
  for (let salary = 500; salary <= 250000; salary += 1) {
    const r = standard(salary);
    if (previous !== null && r.netAnnual < previous - 1e-9) {
      breaks.push(r.taxable);
    }
    previous = r.netAnnual;
  }
  /* The step falls between two consecutive whole salaries, so the taxable
     income of the first point past the threshold exceeds it by less than one
     euro of salary. */
  const taxableStep = 1 - EMPLOYEE_RATE;
  check(T.runTests_119,
        breaks.length === expectedThresholds.length &&
        expectedThresholds.every((s, i) => breaks[i] > s && breaks[i] <= s + taxableStep),
        breaks.map((s) => euro2(s) + T.runTests_118).join(' · '));

  // Accounting reconciliation of the cascade
  let balance = true;
  for (const salary of [12000, 18000, 25000, 30000, 45000, 60000, 90000, 150000]) {
    const r = standard(salary);
    const expected = r.salary - r.totalDeductions + r.totalBonuses;
    if (!near(r.netAnnual, expected, 0.001)) { balance = false; break; }
  }
  check(T.runTests_117, balance);

  // Continuity of the wedge bonus at the 20,000 € taxable threshold
  const threshold20 = standard(20000 / (1 - EMPLOYEE_RATE));
  check(T.runTests_116,
        threshold20.wedgeBonus > 0 && threshold20.extraDeduction === 0);

  // The integrative treatment is not due when the tax cannot absorb it
  const r10 = standard(10000);
  check(T.runTests_115,
        r10.grossIrpef <= r10.employmentDeduction ? r10.integrativeTreatment === 0 : true);

  /* The break-even of the integrative treatment is not on the full deduction
     but on the one reduced by 75 €: 1,880 / 0.23 = 8,173.91 € of taxable
     income. One euro above it is due, one euro below it is not, and it is a
     band of salaries that without the cut was left without 1,200 €. */
  const K = CONSTANTS.INTEGRATIVE_TREATMENT;
  const breakEvenTi = (CONSTANTS.DEDUCTIONS.MINIMUM - K.DEDUCTION_CUT) / YEARS[2026].irpef[0].rate;
  const tiAbove = standard((breakEvenTi + 5) / (1 - EMPLOYEE_RATE));
  const tiBelow = standard((breakEvenTi - 5) / (1 - EMPLOYEE_RATE));
  check(T.runTests_114,
        tiAbove.integrativeTreatment === K.AMOUNT && tiBelow.integrativeTreatment === 0,
        T.runTests_113(euro2(breakEvenTi)));


  /* Between 15,000 and 28,000 € the comparison looks at articles 12 and 13,
     not at the extra wedge deduction: counting it would have made an
     integrative treatment appear where the law does not provide one. */
  const withFamily = { ...baseScenario, year: 2026, salary: 25000,
                        dependentSpouse: true, children: 2 };
  const rFamily = computeEmployee(withFamily);
  check(T.runTests_112,
        rFamily.extraDeduction > 0 &&
        rFamily.employmentDeduction + rFamily.deductionFamily < rFamily.grossIrpef &&
        rFamily.integrativeTreatment === 0,
        T.runTests_111(euro2(rFamily.employmentDeduction + rFamily.deductionFamily), euro2(rFamily.grossIrpef)));

  /* Art. 13, paragraph 1, letter a): in the first band the prorated deduction
     does not drop below 690 €, which become 1,380 € on fixed-term contracts.
     The band correction, on the contrary, is not prorated. */
  const short = { ...baseScenario, year: 2026, salary: 30000, daysWorked: 90 };
  const shortPermanent = computeEmployee(short);
  const shortFixed = computeEmployee({ ...short, contractType: 'determinato' });
  check(T.runTests_110,
        near(shortPermanent.employmentDeduction, CONSTANTS.DEDUCTIONS.FLOOR) &&
        near(shortFixed.employmentDeduction, CONSTANTS.DEDUCTIONS.FLOOR_FIXED_TERM),
        T.runTests_109(euro2(shortPermanent.employmentDeduction), euro2(shortFixed.employmentDeduction)));

  const halfYear = computeEmployee({ ...baseScenario, year: 2026, salary: 60000, daysWorked: 183 });
  check(T.runTests_108,
        near(halfYear.employmentDeduction,
               employmentDeductionBand(halfYear.totalIncome) * halfYear.yearShare
               + CONSTANTS.DEDUCTIONS.CORRECTION),
        euro2(halfYear.employmentDeduction));

  // Above the first pensionable band 1% is added on the excess only
  const high = computeEmployee({ ...baseScenario, year: 2026, salary: 70000 });
  check(T.runTests_107,
        near(high.additionalContribution, (70000 - YEARS[2026].threshold1pc) * 0.01, 0.01),
        euro2(high.additionalContribution));

  // The second 2026 rate is lower: all else equal, the net goes up
  const y25 = computeEmployee({ ...baseScenario, salary: 45000 });
  const y26 = computeEmployee({ ...baseScenario, year: 2026, salary: 45000 });
  check(T.runTests_106,
        y26.netAnnual > y25.netAnnual,
        `+${euro2(y26.netAnnual - y25.netAnnual)}`);

  // 1% additional rate above the first pensionable pay band
  const aboveBand = computeEmployee({ ...baseScenario, year: 2026, salary: 80000 });
  check(T.runTests_105,
        near(aboveBand.additionalContribution, (80000 - YEARS[2026].threshold1pc) * 0.01, 0.01),
        euro2(aboveBand.additionalContribution));

  // Contribution ceiling: above the cap contributions stop growing
  const withCeiling = computeEmployee({ ...baseScenario, year: 2026, salary: 200000, ceilingActive: true });
  const withoutCeiling = computeEmployee({ ...baseScenario, year: 2026, salary: 200000 });
  check(T.runTests_104,
        withCeiling.inps < withoutCeiling.inps &&
        withCeiling.appliedContributionBase === YEARS[2026].ceiling,
        `${euro(withCeiling.inps)} vs ${euro(withoutCeiling.inps)}`);

  // The inbound workers regime cuts taxable income, not the contribution base
  const imp = computeEmployee({ ...baseScenario, year: 2026, salary: 60000, regime: 'impatriati' });
  const ord = computeEmployee({ ...baseScenario, year: 2026, salary: 60000 });
  check(T.runTests_103,
        near(imp.inps, ord.inps, 0.001) && imp.taxable < ord.taxable);

  // Proration to the days: half a year halves pay and deductions
  const half = computeEmployee({ ...baseScenario, year: 2026, salary: 30000, daysWorked: 182 });
  const full = computeEmployee({ ...baseScenario, year: 2026, salary: 30000 });
  check(T.runTests_102,
        near(half.salary, full.salary * 182 / 365, 0.01) &&
        half.employmentDeduction < full.employmentDeduction);

  // Fringe benefits: the threshold is not an allowance
  const fringeBelow = computeEmployee({ ...baseScenario, year: 2026, salary: 30000, fringeBenefit: 1000 });
  const fringeAbove = computeEmployee({ ...baseScenario, year: 2026, salary: 30000, fringeBenefit: 1001 });
  check(T.runTests_101,
        fringeBelow.fringeTaxable === 0 && fringeAbove.fringeTaxable === 1001 &&
        fringeAbove.netAnnual < fringeBelow.netAnnual);

  // Supplementary pension is a deductible charge: it lowers the tax but
  // not total income, so it must not inflate deductions and wedge.
  const withoutFund = computeEmployee({ ...baseScenario, year: 2026, salary: 30000 });
  const withFund = computeEmployee({ ...baseScenario, year: 2026, salary: 30000, pensionFund: 5000 });
  check(T.runTests_100,
        near(withoutFund.employmentDeduction, withFund.employmentDeduction, 0.001) &&
        near(withoutFund.extraDeduction, withFund.extraDeduction, 0.001) &&
        withFund.taxable < withoutFund.taxable,
        T.runTests_99(euro2(withFund.employmentDeduction)));

  // The tax relief on night, holiday and shift premiums starts in 2026
  const acc25 = computeEmployee({ ...baseScenario, year: 2025, salary: 28000, shiftPremiums: 2000 });
  const acc26 = computeEmployee({ ...baseScenario, year: 2026, salary: 28000, shiftPremiums: 2000 });
  check(T.runTests_98,
        acc25.premiumsRelieved === 0 && acc25.premiumsTax === 0 &&
        acc26.premiumsRelieved === 1500 && acc26.premiumsOrdinary === 500 &&
        near(acc26.premiumsTax, 225),
        T.runTests_97(euro2(acc26.premiumsRelieved), euro2(acc26.premiumsTax)));
  const accHigh = computeEmployee({ ...baseScenario, year: 2026, salary: 45000, shiftPremiums: 1000 });
  check(T.runTests_96,
        accHigh.premiumsRelieved === 0 && accHigh.premiumsOrdinary === 1000,
        euro2(accHigh.premiumsOrdinary) + T.runTests_95);

  // In contractual funds the employer's contribution is due only to those who pay in
  const withoutEnrolment = computeEmployee({ ...baseScenario, year: 2026, salary: 35000, employerFundContribution: 2 });
  const withEnrolment = computeEmployee({ ...baseScenario, year: 2026, salary: 35000, employerFundContribution: 2, pensionFund: 500 });
  check(T.runTests_94,
        withoutEnrolment.employerFundContribution === 0 &&
        near(withEnrolment.employerFundContribution, 700, 0.01),
        T.runTests_93(euro(withEnrolment.employerFundContribution)));

  // The deductibility cap is shared by worker and employer
  const sharedCap = computeEmployee({ ...baseScenario, year: 2026, salary: 100000,
                                          employerFundContribution: 4, pensionFund: 4000 });
  check(T.runTests_92,
        near(sharedCap.pensionFundDeductible + sharedCap.employerFundContribution,
               YEARS[2026].pensionFundDeductible, 0.01) &&
        sharedCap.employeeFundNotDeducted > 0,
        T.runTests_91(euro2(sharedCap.pensionFundDeductible), euro2(sharedCap.employeePayment)));

  // The employer contribution above the cap becomes taxable again
  const overCap = computeEmployee({ ...baseScenario, year: 2026, salary: 200000,
                                      employerFundContribution: 4, pensionFund: 100 });
  check(T.runTests_90,
        overCap.employerFundExcess > 0 &&
        overCap.totalIncome > overCap.taxableGross,
        euro2(overCap.employerFundExcess));

  // Paying TFR into the fund avoids the Guarantee Fund contribution
  const tfrInCompany = computeEmployee({ ...baseScenario, year: 2026, salary: 30000 });
  const tfrToFund = computeEmployee({ ...baseScenario, year: 2026, salary: 30000, tfrToFund: true });
  check(T.runTests_89,
        tfrToFund.tfr > tfrInCompany.tfr &&
        near(tfrToFund.tfr - tfrInCompany.tfr, 30000 * 0.005, 0.01),
        `+${euro2(tfrToFund.tfr - tfrInCompany.tfr)}`);

  // The payment to the fund cannot exceed what the payslip contains. The
  // limit is not the pay: deducting wipes out the tax and loses the
  // integrative treatment, so the available net drops faster than what is
  // paid in and the value must be found by approximation.
  const minimumPay = computeEmployee({ ...baseScenario, year: 2026, salary: 12000,
                                       daysWorked: 1, pensionFund: 9000 });
  check(T.runTests_88,
        minimumPay.employeePayment < minimumPay.paymentRequested &&
        minimumPay.netAnnual >= -0.005 &&
        minimumPay.paymentUncovered > 0,
        T.runTests_141(euro(minimumPay.paymentRequested), euro2(minimumPay.employeePayment)));

  // Sweep over funds: no combination may produce a negative net
  let fundCombinations = 0, fundAnomalies = 0;
  for (const salary of [0, 12000, 32000, 120000])
  for (const payment of [0, 384, 5164.57, 9000])
  for (const employer of [0, 2, 20])
  for (const tfrToFund of [false, true]) {
    fundCombinations++;
    const x = computeEmployee({ ...baseScenario, year: 2026, salary, pensionFund: payment,
                               employerFundContribution: employer, tfrToFund });
    const healthy = x.netAnnual >= -0.005 && x.efficiency >= 0 && x.tfr >= 0 &&
                 x.pensionFundDeductible <= x.employeePayment + 0.01 &&
                 (x.employeePayment > 0 || x.employerFundContribution === 0);
    if (!healthy) fundAnomalies++;
  }
  check(T.runTests_87,
        fundAnomalies === 0, T.runTests_140(fundCombinations, fundAnomalies));

  // Net deductions have no tax effect: union dues,
  // salary-backed loans and garnishments are neither deductible nor creditable.
  const withoutDeductions = computeEmployee({ ...baseScenario, year: 2026, salary: 30000 });
  const withDeductions = computeEmployee({ ...baseScenario, year: 2026, salary: 30000, otherDeductions: 320 });
  check(T.runTests_86,
        near(withDeductions.taxable, withoutDeductions.taxable, 0.001) &&
        near(withDeductions.netIrpef, withoutDeductions.netIrpef, 0.001) &&
        near(withDeductions.netAnnual, withoutDeductions.netAnnual - 320, 0.01) &&
        near(withDeductions.taxPressure, withoutDeductions.taxPressure, 0.001),
        T.runTests_85(euro2(withDeductions.netAnnual)));

  // One cannot withhold more than the payslip contains
  const excessDeduction = computeEmployee({ ...baseScenario, year: 2026, salary: 12000,
                                               daysWorked: 5, otherDeductions: 50000 });
  check(T.runTests_84,
        excessDeduction.netAnnual >= -0.005 &&
        excessDeduction.otherDeductions < excessDeduction.otherDeductionsRequested &&
        excessDeduction.otherDeductionsUncovered > 0,
        T.runTests_139(euro(excessDeduction.otherDeductionsRequested), euro2(excessDeduction.otherDeductions)));

  // Optimisation from the net: every package delivers the same value,
  // and the cost for the company drops as exempt welfare is used.
  const fromNet = optimisedPackages({ type: 'net', value: 26000 }, { ...baseScenario, year: 2026 });
  check(T.runTests_83,
        fromNet.every((p) => near(p.totalValue, 26000, 2)) &&
        fromNet[1].employerCost < fromNet[0].employerCost &&
        fromNet[2].employerCost < fromNet[1].employerCost,
        `risparmio ${euro(fromNet[0].employerCost - fromNet[2].employerCost)}`);

  // Optimisation from the budget: same spending, increasing value delivered
  const fromBudget = optimisedPackages({ type: 'budget', value: 50000 }, { ...baseScenario, year: 2026 });
  check(T.runTests_138,
        fromBudget.every((p) => near(p.employerCost, 50000, 2)) &&
        fromBudget[1].totalValue > fromBudget[0].totalValue &&
        fromBudget[2].totalValue > fromBudget[1].totalValue,
        T.runTests_82(euro(fromBudget[2].totalValue - fromBudget[0].totalValue)));

  // The optimiser never exceeds the exemption thresholds: above the threshold
  // the fringe benefit becomes fully taxable and the advantage disappears
  const caps = exemptCaps({ ...baseScenario, year: 2026 });
  check(T.runTests_81,
        fromNet[2].fringe <= caps.fringe + 0.01 &&
        fromNet[2].vouchers <= caps.vouchers + 0.01 &&
        fromNet[2].perfBonus <= YEARS[2026].bonusCap + 0.01);

  // Tool efficiency is measured on the engine, not declared:
  // exempt welfare must come out as 1 € received for 1 € spent.
  const eff = toolEfficiency({ ...baseScenario, year: 2026, salary: 35000 });
  check(T.runTests_80,
        near(eff.fringe, 1, 0.001) && near(eff.vouchers, 1, 0.001) &&
        near(eff.bonusWelfare, 1, 0.001) && eff.salary < 0.6,
        T.runTests_79(fmtPct2.format(eff.salary)));

  // A fixed-term contract costs more only to the company: the additional
  // NASpI contribution is paid by the employer and does not touch the payslip.
  const perm = computeEmployee({ ...baseScenario, year: 2026, salary: 24000, contractType: 'indeterminato' });
  const det = computeEmployee({ ...baseScenario, year: 2026, salary: 24000, contractType: 'determinato' });
  check(T.runTests_78,
        near(det.netAnnual, perm.netAnnual, 0.01) &&
        near(det.employerCost - perm.employerCost, 24000 * 0.014, 0.01),
        T.runTests_77(euro2(det.employerCost - perm.employerCost)));

  // Apprenticeship has a rate fixed by law, the same in every sector
  const apprServices = computeEmployee({ ...baseScenario, year: 2026, salary: 24000,
                                        profile: 'terziario_impiegato', contractType: 'apprendistato' });
  const apprIndustry = computeEmployee({ ...baseScenario, year: 2026, salary: 24000,
                                        profile: 'industria_operaio', contractType: 'apprendistato' });
  check(T.runTests_76,
        near(apprServices.inps, 24000 * 0.0584, 0.01) &&
        near(apprServices.netAnnual, apprIndustry.netAnnual, 0.01),
        euro2(apprServices.inps));

  // An internship is assimilated income: the nature changes, not just the rate
  const intern = computeEmployee({ ...baseScenario, year: 2026, salary: 9000,
                                 monthlyPayments: 12, contractType: 'tirocinio' });
  check(T.runTests_75,
        intern.inps === 0 && intern.tfr === 0 &&
        near(intern.taxable, 9000, 0.01) &&
        near(intern.employerCost, 9000 * (1 + EMPLOYEE_PARAMS.EMPLOYER_INAIL), 0.01),
        T.runTests_74(euro2(intern.taxable), euro2(intern.employerCost)));

  // The wedge cut and the integrative treatment are aimed at employment
  const internLow = computeEmployee({ ...baseScenario, year: 2026, salary: 6000, monthlyPayments: 12, contractType: 'tirocinio' });
  const employeeLow = computeEmployee({ ...baseScenario, year: 2026, salary: 6000, monthlyPayments: 12 });
  check(T.runTests_73,
        internLow.wedgeBonus === 0 && employeeLow.wedgeBonus > 0,
        T.runTests_72(euro2(employeeLow.wedgeBonus)));
  // The integrative treatment instead is due: art. 50, paragraph 1, letter c).
  const internMid = computeEmployee({ ...baseScenario, year: 2026, salary: 12000, monthlyPayments: 12, contractType: 'tirocinio' });
  check(T.runTests_71,
        near(internMid.integrativeTreatment, CONSTANTS.INTEGRATIVE_TREATMENT.AMOUNT),
        euro2(internMid.integrativeTreatment));

  // Welfare is not pay: what does not go through the payslip does not
  // feed TFR or the pension pot. What is given up must be quantified.
  const packages = optimisedPackages({ type: 'net', value: 26000 }, { ...baseScenario, year: 2026 });
  const foregone = foregoneAnalysis(packages[0], packages[2]);
  check(T.runTests_70,
        foregone.deltaSalary > 0 && foregone.deltaTfr > 0 &&
        near(foregone.deltaPensionPot, foregone.deltaSalary * PENSION_ACCRUAL_RATE, 0.01) &&
        near(foregone.annualForegone, foregone.deltaTfr + foregone.deltaPensionPot, 0.01),
        T.runTests_69(euro(foregone.annualForegone)));

  // Below a step threshold the recovery is real and measurable
  const aboveThreshold = { ...baseScenario, year: 2026, salary: 26500 };
  const opportunity = thresholdOpportunity(aboveThreshold, 6200);
  check(T.runTests_68,
        opportunity !== null && opportunity.taxableAfter < opportunity.value &&
        opportunity.gain > 0 && opportunity.shift <= 6200,
        opportunity ? T.runTests_137(opportunity.name, euro(opportunity.gain)) : T.runTests_67);

  /* Whoever is already below every threshold must not get useless hints.
     The lowest is now the wedge step at 8,500 € of taxable income, so the
     "already low" case must be looked for below it: at 12,000 € of salary
     there is a hint, and it is real. */
  check(T.runTests_66,
        thresholdOpportunity({ ...baseScenario, year: 2026, salary: 8000 }, 6200) === null);

  const wedgeNotch = thresholdOpportunity({ ...baseScenario, year: 2026, salary: 12000 }, 6200);
  check(T.runTests_65,
        wedgeNotch !== null &&
        wedgeNotch.value === CONSTANTS.WEDGE.BONUS_1_UP_TO &&
        wedgeNotch.taxableAfter < CONSTANTS.WEDGE.BONUS_1_UP_TO &&
        wedgeNotch.gain > 0,
        wedgeNotch ? `${euro(wedgeNotch.gain)} recuperati` : T.runTests_64);

  // A package must not promise welfare that will not be paid: above
  // the income threshold the relieved bonus is not due.
  const goalHigh = optimisedPackages({ type: 'net', value: 90000 }, { ...baseScenario, year: 2026 });
  check(T.runTests_63,
        goalHigh.every((p) => !(p.perfBonus > 0 && p.salary > EMPLOYEE_PARAMS.BONUS_INCOME_MAX)) &&
        goalHigh.every((p) => near(p.totalValue, p.netCash + p.welfare, 0.02)),
        goalHigh[2].bonusOverThreshold ? T.runTests_62 : T.runTests_61);

  // The shift towards a threshold must be measured: between gross salary
  // and taxable income there are also the additional rate and the sector
  // funds, which vary by profile. For executives the estimate missed the target.
  let thresholdsCentred = true, thresholdsGap = '';
  for (const profile of Object.keys(CONTRIBUTION_PROFILES)) {
    const occ = thresholdOpportunity({ ...baseScenario, year: 2026, profile, salary: 26500 }, 6200);
    if (occ && occ.taxableAfter >= occ.value) {
      thresholdsCentred = false;
      thresholdsGap = T.runTests_60(profile, euro2(occ.taxableAfter), euro(occ.value));
      break;
    }
  }
  check(T.runTests_59,
        thresholdsCentred, thresholdsGap);

  /* Sector rates come from tables, not from memory: where the table can be
     broken down the items must add up to the total, and the employer share
     must always be the difference between the total and the employee share.
     If a figure is touched by hand without touching the others, the test fails. */
  let itemsBalance = true, itemsGap = '';
  let sharesBalance = true, sharesGap = '';
  for (const [key, profile] of Object.entries(CONTRIBUTION_PROFILES)) {
    if (profile.items) {
      const sum = Object.values(profile.items).reduce((a, b) => a + b, 0);
      if (Math.abs(sum - profile.total) > 0.005) {
        itemsBalance = false;
        itemsGap = T.runTests_58(key, sum.toFixed(2), profile.total.toFixed(2));
      }
    }
    const expected = profile.total / 100 - profile.employee;
    if (Math.abs(expected - profile.employer) > 0.00005) {
      sharesBalance = false;
      sharesGap = T.runTests_136(key, ratePct(profile.employer), ratePct(expected));
    }
  }
  check(T.runTests_57,
        itemsBalance, itemsGap);
  check(T.runTests_56,
        sharesBalance, sharesGap);

  /* The breakdown bar is not an approximate drawing: its items are those of
     the calculation, and together they must give exactly the gross that goes
     through the payslip. If one day an item were added to the engine and not
     to the bar, the difference would show here and not by eye. */
  const comp = computeEmployee({ ...baseScenario, year: 2026, salary: 42000,
                                performanceBonus: 2000, shiftPremiums: 1500,
                                pensionFund: 1200, otherDeductions: 800,
                                fringeBenefit: 500, mealVoucherPerDay: 8 });
  const itemsSum = comp.netAnnual + comp.inps + comp.netIrpef + comp.regionalTax + comp.municipalTax
                  + comp.bonusTax + comp.premiumsTax
                  + comp.employeePayment + comp.otherDeductions;
  const grossPay = comp.salary + comp.bonusSubstitute + comp.bonusOrdinary
                   + comp.premiumsRelieved + comp.premiumsOrdinary
                   + comp.wedgeBonus + comp.integrativeTreatment;
  check(T.runTests_55,
        near(itemsSum, grossPay, 0.01),
        `${euro2(itemsSum)} contro ${euro2(grossPay)}`);

  /* Meal vouchers are counted on days present, and days present cannot exceed
     the days the contract exists. Without this limit a one-day contract
     collected 220 vouchers, whose taxable excess exceeded the pay accrued and
     pushed the net below zero. */
  const vouchersLong = computeEmployee({ ...baseScenario, year: 2026, salary: 45000,
                                       daysWorked: 30, mealVoucherPerDay: 12, voucherDays: 220 });
  check(T.runTests_54,
        vouchersLong.voucherDaysEffective === 30 && vouchersLong.vouchersProrated === true &&
        near(vouchersLong.vouchersTotal, 12 * 30, 0.01),
        T.runTests_53(vouchersLong.voucherDaysEffective, euro2(vouchersLong.vouchersTotal)));

  /* A payslip does not go negative: if the taxable welfare exceeds the pay
     accrued, the net stops at zero and the uncovered part is stated instead of
     showing a negative number. */
  const payShortfall = computeEmployee({ ...baseScenario, year: 2026, salary: 45000,
                                         daysWorked: 1, fringeBenefit: 8000 });
  check(T.runTests_52,
        payShortfall.netAnnual === 0 && payShortfall.netShortfall > 0,
        `scoperto ${euro2(payShortfall.netShortfall)}`);

  // Links shared before the split must keep opening
  // on the same calculation, not on a random profile.
  check(T.runTests_51,
        Object.entries(LEGACY_PROFILES).every(([old, fresh]) =>
          normaliseProfile(old) === fresh && CONTRIBUTION_PROFILES[fresh]) &&
        normaliseProfile('nonexistent') === DEFAULT_PROFILE);

  // An exemption outside its validity window must not be applied,
  // and the engine must notice by itself by comparing the dates.
  // The date is pinned: exemptions follow their validity window, and with
  // today's date these tests would change outcome by themselves in 2027.
  const exemptionsScenario = { ...baseScenario, year: 2026, salary: 30000, contractType: 'indeterminato',
                               today: '2026-10-02T12:00:00' };
  const withExpired = computeEmployee({ ...exemptionsScenario, exemptions: ['giovani'] });
  const withNothing = computeEmployee(exemptionsScenario);
  check(T.runTests_50,
        withExpired.employerExemption === 0 && near(withExpired.employerCost, withNothing.employerCost, 0.01),
        T.runTests_49(HIRING_EXEMPTIONS.giovani.windowTo));

  // The employer exemption does not touch the payslip; the female worker's one does
  const withWomen = computeEmployee({ ...exemptionsScenario, exemptions: ['donne'] });
  check(T.runTests_48,
        near(withWomen.netAnnual, withNothing.netAnnual, 0.01) &&
        withWomen.employerCost < withNothing.employerCost &&
        near(withWomen.employerExemption, 650 * 12, 0.01),
        T.runTests_47(euro(withNothing.employerCost), euro(withWomen.employerCost)));

  // The female worker's exemption raises the net but also taxable income:
  // what is not paid to INPS stays taxable income.
  const withMothers = computeEmployee({ ...exemptionsScenario, exemptions: ['madri_tre_figli'] });
  check(T.runTests_46,
        withMothers.netAnnual > withNothing.netAnnual &&
        withMothers.taxable > withNothing.taxable &&
        withMothers.employeeExemption <= 3000.01 &&
        withMothers.netAnnual - withNothing.netAnnual < withMothers.employeeExemption,
        T.runTests_45(euro(withMothers.netAnnual - withNothing.netAnnual), euro(withMothers.employeeExemption)));

  // Territory matters: the Southern relief applies only in the South
  const southOutside = exemptionStatus('sud_pmi', { ...exemptionsScenario, region: 'Lombardia' });
  const southInside = exemptionStatus('sud_pmi', { ...exemptionsScenario, region: T.southInside_region_1 });
  check(T.runTests_44,
        !southOutside.applicable && southInside.applicable &&
        southInside.share.monthlyCap === 125);

  // A coordinated and continuous collaboration is not employment but not
  // self-employment either: the separate scheme splits 35.03% one third on
  // the collaborator and two thirds on the client.
  const collab = computeEmployee({ ...baseScenario, year: 2026, salary: 30000,
                                  monthlyPayments: 12, contractType: 'collaboratore' });
  check(T.runTests_43,
        near(collab.ordinaryContributions, 30000 * 0.3503 / 3, 0.01) &&
        near(collab.employerContributionsGross, 30000 * 0.3503 * 2 / 3, 0.01) &&
        collab.additionalContribution === 0,
        `${euro2(collab.ordinaryContributions)} + ${euro2(collab.employerContributionsGross)}`);

  // No TFR and no wedge, but the integrative treatment is due: D.L. 3/2020
  // refers to letter c-bis), the 2025 Budget Law only to art. 49.
  const collabLow = computeEmployee({ ...baseScenario, year: 2026, salary: 14000,
                                       monthlyPayments: 12, contractType: 'collaboratore' });
  const empLow = computeEmployee({ ...baseScenario, year: 2026, salary: 14000, monthlyPayments: 12 });
  check(T.runTests_42,
        collab.tfr === 0 && collab.wedgeBonus === 0 && collab.extraDeduction === 0 &&
        collabLow.integrativeTreatment > 0 && empLow.wedgeBonus > 0,
        `TI ${euro2(collabLow.integrativeTreatment)}`);

  // The separate scheme ceiling is not an option: it applies
  // even without ticking the box, which is optional for employees.
  const collabHigh = computeEmployee({ ...baseScenario, year: 2026, salary: 200000,
                                      monthlyPayments: 12, contractType: 'collaboratore',
                                      ceilingActive: false });
  check(T.runTests_41,
        near(collabHigh.appliedContributionBase, SEPARATE_SCHEME.ceiling, 0.01) &&
        near(collabHigh.ordinaryContributions, SEPARATE_SCHEME.ceiling * 0.3503 / 3, 0.01),
        euro2(collabHigh.appliedContributionBase));

  // The stabilisation incentive has a narrow window and a monthly cap:
  // the date must be pinned, otherwise the test changes outcome by itself
  // on 1 January 2027.
  const insideWindow = new Date('2026-09-15');
  const withStabilisation = computeEmployee({ ...exemptionsScenario, exemptions: ['stabilizzazione'],
                                        today: insideWindow });
  const outsideWindow = exemptionStatus('stabilizzazione', exemptionsScenario, new Date('2027-01-15'));
  check(T.runTests_40,
        near(withStabilisation.employerExemption, 500 * 12, 0.01) &&
        near(withStabilisation.netAnnual, withNothing.netAnnual, 0.01) &&
        !outsideWindow.applicable && outsideWindow.expired,
        T.runTests_39(euro(withStabilisation.employerExemption)));

  /* Who is covered: executives out, agricultural workers in — the opposite of
     the Southern relief, which excludes agriculture. The keys used here are
     the composite ones the interface really produces: with the old flat names
     the comparison always passed, and the exclusion of executives never fired
     outside the test. */
  const stabExec = exemptionStatus('stabilizzazione',
        { ...exemptionsScenario, profile: 'industria|dirigente|fino50' }, insideWindow);
  const stabAgri = exemptionStatus('stabilizzazione',
        { ...exemptionsScenario, profile: 'agricoltura|operaio|unica' }, insideWindow);
  const stabFixed = exemptionStatus('stabilizzazione',
        { ...exemptionsScenario, contractType: 'determinato' }, insideWindow);
  check(T.runTests_38,
        !stabExec.applicable && stabAgri.applicable && !stabFixed.applicable);

  /* The same exclusion must hold on the composite key also when it reaches
     the engine: it is the path the interface takes. */
  const executiveExempt = computeEmployee({ ...exemptionsScenario, region: T.executiveExempt_region_1,
        profile: 'industria|dirigente|fino50', exemptions: ['stabilizzazione'], today: insideWindow });
  const domesticExempt = computeEmployee({ ...exemptionsScenario, region: T.domesticExempt_region_1,
        profile: 'domestico|operaio|unica', exemptions: ['sud_pmi'], today: insideWindow });
  check(T.runTests_37,
        executiveExempt.exemptionsApplied.length === 0 && executiveExempt.employerExemption === 0 &&
        domesticExempt.exemptionsApplied.length === 0 && domesticExempt.employerExemption === 0,
        T.runTests_135(euro2(executiveExempt.employerExemption), euro2(domesticExempt.employerExemption)));

  // A combination forbidden by law must not be possible
  check(T.runTests_36,
        exemptionsInConflict(['sud_pmi', 'donne']) !== null &&
        exemptionsInConflict(['stabilizzazione', 'zes']) !== null &&
        exemptionsInConflict(['donne', 'madri_tre_figli']) === null);

  // Without pay, welfare and allowances alone would generate contributions
  // on a payslip that does not exist, that is a negative net.
  const withoutSalary = computeEmployee({ ...baseScenario, year: 2026, salary: 0,
    fringeBenefit: 2500, mealVoucherPerDay: 12, performanceBonus: 5000, pensionFund: 9000 });
  check(T.runTests_35,
        withoutSalary.netAnnual === 0 && withoutSalary.inps === 0,
        euro2(withoutSalary.netAnnual));

  // Systematic sweep over every contract combination: none may
  // produce non-finite values, negative nets or broken balances.
  let combinations = 0, anomalies = 0;
  for (const profile of Object.keys(CONTRIBUTION_PROFILES))
  for (const year of [2025, 2026])
  for (const regime of Object.keys(TAX_REGIMES))
  for (const salary of [0, 15000, 35000, 80000, 250000]) {
    combinations++;
    const x = computeEmployee({ ...baseScenario, year, salary, profile, regime, ceilingActive: salary > 120000 });
    const identity = x.salary + x.bonusSubstitute + x.bonusOrdinary + x.premiumsRelieved
                   + x.premiumsOrdinary - x.totalDeductions - x.employeePayment
                   - x.otherDeductions + x.totalBonuses;
    const healthy = Object.values(x).every((v) => typeof v !== 'number' || Number.isFinite(v))
              && x.netAnnual >= -0.01 && Math.abs(identity - x.netAnnual) <= 0.02;
    if (!healthy) anomalies++;
  }
  check(T.runTests_34,
        anomalies === 0, T.runTests_134(combinations, anomalies));

  // Every province in the dataset must fall in an existing region,
  // otherwise a municipality could be computed with the wrong surcharge
  const datasetProvinces = new Set(MUNICIPALITIES.map((c) => c.province));
  const orphans = [...datasetProvinces].filter((p) => !PROVINCE_REGION[p]);
  const ghostRegions = [...new Set(Object.values(PROVINCE_REGION))].filter((r) => !REGIONS[r]);
  check(T.runTests_33,
        orphans.length === 0 && ghostRegions.length === 0,
        T.runTests_133(datasetProvinces.size));

  // Inversion: the gross salary found must reproduce the requested net
  const inversionScenario = { ...baseScenario, year: 2026 };
  let inversionConsistent = true, inversionGap = '';
  for (const target of [18000, 24000, 31000, 42000, 60000]) {
    const found = invertNet(target, inversionScenario);
    if (found.outcome !== 'exact') { inversionConsistent = false; inversionGap = `${target}: ${found.outcome}`; break; }
    const verify = computeEmployee({ ...inversionScenario, salary: found.salary }).netAnnual;
    if (!near(verify, target, 1.5)) {
      inversionConsistent = false;
      inversionGap = `${euro2(target)} → RAL ${euro2(found.salary)} → ${euro2(verify)}`;
      break;
    }
  }
  check(T.runTests_32, inversionConsistent, inversionGap);

  // A downward jump leaves no holes: it crosses the same net level twice.
  // Near the Milan step the same net amount must come from several
  // gross salaries, and the lowest must be chosen.
  let peak = { salary: 0, net: -1 };
  for (let salary = 25000; salary <= 25500; salary++) {
    const net = standard(salary).netAnnual;
    if (net > peak.net) peak = { salary, net };
  }
  const multiple = invertNet(peak.net - 30, { ...baseScenario, year: 2026 });
  check(T.runTests_31,
        multiple.outcome === 'exact' &&
        multiple.otherSolutions.length >= 1 &&
        multiple.salary < Math.min(...multiple.otherSolutions),
        multiple.outcome === 'exact'
          ? T.runTests_132(1 + multiple.otherSolutions.length, euro(multiple.salary))
          : multiple.outcome);

  // Beyond the largest representable value it must say so, not return a number
  const outside = invertNet(900000, inversionScenario);
  check(T.runTests_30, outside.outcome === 'outOfRange');

  // --- VAT number -----------------------------------------------------
  // In the flat-rate regime income is revenue times the ATECO coefficient,
  // contributions are computed on it and then deducted.
  const flat = computeSelfEmployed({ year: 2026, revenue: 50000,
                                 selfEmployedRegime: 'forfettario15', coefficient: 0.78 });
  const expectedIncome = 50000 * 0.78;
  const expectedContributions = expectedIncome * SEPARATE_SCHEME.professionisti;
  check(T.runTests_29,
        near(flat.grossIncome, expectedIncome, 0.01) &&
        near(flat.contributions, expectedContributions, 0.01) &&
        near(flat.substituteTax, (expectedIncome - expectedContributions) * 0.15, 0.01) &&
        near(flat.netAnnual, 50000 - expectedContributions - flat.substituteTax, 0.01),
        euro2(flat.netAnnual));

  // The start-up rate is a third of the ordinary one: the rest of the
  // chain must stay identical, contributions included.
  const flat5 = computeSelfEmployed({ year: 2026, revenue: 50000,
                                  selfEmployedRegime: 'forfettario5', coefficient: 0.78 });
  check(T.runTests_28,
        near(flat5.contributions, flat.contributions, 0.01) &&
        near(flat5.substituteTax, flat.substituteTax / 3, 0.01) &&
        flat5.netAnnual > flat.netAnnual,
        T.runTests_27(euro2(flat5.netAnnual - flat.netAnnual)));

  // The substitute tax also replaces local surcharges: in the flat-rate
  // regime the municipality does not move the net, in the ordinary one it does.
  const flatMilan = computeSelfEmployed({ year: 2026, revenue: 50000, municipality: 'F205',
                                       selfEmployedRegime: 'forfettario15', coefficient: 0.78 });
  const flatRome = computeSelfEmployed({ year: 2026, revenue: 50000, municipality: 'H501',
                                     region: T.flatRome_region_1, selfEmployedRegime: 'forfettario15', coefficient: 0.78 });
  const ordMilan = computeSelfEmployed({ year: 2026, revenue: 50000, municipality: 'F205' });
  const ordRome = computeSelfEmployed({ year: 2026, revenue: 50000, municipality: 'H501', region: T.ordRome_region_1 });
  check(T.runTests_26,
        near(flatMilan.netAnnual, flatRome.netAnnual, 0.01) &&
        flatMilan.regionalTax === 0 && flatMilan.municipalTax === 0 &&
        ordMilan.municipalTax > 0 && Math.abs(ordMilan.netAnnual - ordRome.netAnnual) > 1,
        T.runTests_25(euro2(ordMilan.netAnnual), euro2(ordRome.netAnnual)));

  // Separate scheme contributions stop at the ceiling, as for
  // collaborators: above that threshold only tax is paid.
  const flatHigh = computeSelfEmployed({ year: 2026, revenue: 200000,
                                     selfEmployedRegime: 'forfettario15', coefficient: 0.78 });
  check(T.runTests_24,
        flatHigh.ceilingReached && flatHigh.overThreshold &&
        near(flatHigh.contributions, SEPARATE_SCHEME.ceiling * SEPARATE_SCHEME.professionisti, 0.01),
        euro2(flatHigh.contributions));

  // Deduction of art. 13 paragraph 5: it ends at 50,000 € and is not the
  // employee one, which is worth more at the same income.
  check(T.runTests_23,
        near(computeSelfEmployedDeduction(5500), 1265, 0.01) &&
        computeSelfEmployedDeduction(50001) === 0 &&
        near(computeSelfEmployedDeduction(15000), 500 + 765 * 13000 / 22500 + 50, 0.01) &&
        near(computeSelfEmployedDeduction(17001), 500 + 765 * 10999 / 22500, 0.01) &&
        computeSelfEmployedDeduction(20000) < computeEmploymentDeduction(20000),
        `${euro2(computeSelfEmployedDeduction(20000))} contro ${euro2(computeEmploymentDeduction(20000))}`);

  // In the ordinary regime costs are really deductible, in the flat-rate one
  // they are not: it is the difference that decides between the regimes.
  const ordWithCosts = computeSelfEmployed({ year: 2026, revenue: 50000, costs: 20000 });
  const ordNoCosts = computeSelfEmployed({ year: 2026, revenue: 50000, costs: 0 });
  check(T.runTests_22,
        ordWithCosts.contributions < ordNoCosts.contributions &&
        ordWithCosts.taxes < ordNoCosts.taxes &&
        near(ordWithCosts.grossIncome, 30000, 0.01),
        T.runTests_21(euro2(ordNoCosts.taxes), euro2(ordWithCosts.taxes)));

  /* The artisans' and traders' schemes have a minimum: it is the difference
     that changes everything for beginners, and it must be checked against
     the values published by INPS, not the rate multiplied by hand. */
  const artZero = computeSelfEmployed({ year: 2026, revenue: 0, scheme: 'artigiani' });
  const munZero = computeSelfEmployed({ year: 2026, revenue: 0, scheme: 'commercianti' });
  const sepZero = computeSelfEmployed({ year: 2026, revenue: 0, scheme: 'separata_professionisti' });
  check(T.runTests_20,
        near(artZero.contributions, 4521.36, 0.01) &&
        near(munZero.contributions, 4611.64, 0.01) &&
        sepZero.contributions === 0,
        T.runTests_131(euro2(artZero.contributions), euro2(munZero.contributions)));

  // Above the first band the rate goes up one point: 24% → 25%.
  const artHigh = computeSelfEmployed({ year: 2026, revenue: 80000, scheme: 'artigiani' });
  const expectedHigh = 56224 * 0.24 + (80000 - 56224) * 0.25 + 7.44;
  check(T.runTests_19,
        near(artHigh.contributions, expectedHigh, 0.01),
        `${euro2(artHigh.contributions)} contro ${euro2(expectedHigh)}`);

  // The 35% reduction is an option of the flat-rate regime: outside it does not apply.
  const artReduced = computeSelfEmployed({ year: 2026, revenue: 30000, coefficient: 0.67,
                                       selfEmployedRegime: 'forfettario15',
                                       scheme: 'artigiani', flatRateReduction: true });
  const artFull = computeSelfEmployed({ year: 2026, revenue: 30000, coefficient: 0.67,
                                     selfEmployedRegime: 'forfettario15', scheme: 'artigiani' });
  const ordReduced = computeSelfEmployed({ year: 2026, revenue: 30000,
                                       scheme: 'artigiani', flatRateReduction: true });
  const ordFull = computeSelfEmployed({ year: 2026, revenue: 30000, scheme: 'artigiani' });
  /* The reduction cuts only the pension share: the maternity contribution is
     a fixed amount covering a benefit and stays due in full, so the reduced
     total is not a plain 65%. */
  const maternityArt = PENSION_SCHEMES.artigiani.maternity;
  check(T.runTests_18,
        near(artReduced.contributions, (artFull.contributions - maternityArt) * 0.65 + maternityArt, 0.01) &&
        near(ordReduced.contributions, ordFull.contributions, 0.01),
        T.runTests_130(euro2(artFull.contributions), euro2(artReduced.contributions)));

  check(T.runTests_17,
        near(artFull.contributions - artReduced.contributions,
               (artFull.contributions - maternityArt) * 0.35, 0.01),
        `risparmio ${euro2(artFull.contributions - artReduced.contributions)}`);

  /* At almost zero revenue the minimum stays due: the net stops at zero, but
     the shortfall must be stated, otherwise the big number lies. */
  const atLoss = computeSelfEmployed({ year: 2026, revenue: 0, scheme: 'artigiani' });
  const minimumShare = PENSION_SCHEMES.artigiani.minimum
                      * PENSION_SCHEMES.artigiani.rate + maternityArt;
  check(T.runTests_16,
        atLoss.netAnnual === 0 && near(atLoss.netShortfall, minimumShare, 0.01),
        `scoperto ${euro2(atLoss.netShortfall)}`);
  check(T.runTests_15,
        computeSelfEmployed({ year: 2026, revenue: 40000, scheme: 'artigiani' }).netShortfall === 0);

  /* Accounting identity of the cascade: it is the one the net explanation
     draws step by step, and the steps must add up to the total shown. Without
     this check the explanation had already stopped adding up when deductible
     costs were present, with nothing to flag it. */
  let vatBalance = true, vatGap = '';
  for (const testCase of [{ revenue: 50000, costs: 10000 }, { revenue: 3000, costs: 0 },
                      { revenue: 80000, costs: 0 }, { revenue: 25000, costs: 24000 }]) {
    for (const scheme of Object.keys(PENSION_SCHEMES)) {
      for (const selfEmployedRegime of Object.keys(SELF_EMPLOYED_REGIMES)) {
        const a = computeSelfEmployed({ year: 2026, scheme, selfEmployedRegime, coefficient: 0.67, ...testCase });
        const sum = a.revenue - a.costs - a.contributions - a.taxes + a.netShortfall;
        if (!near(sum, a.netAnnual, 0.01)) {
          vatBalance = false;
          vatGap = T.runTests_14(scheme, selfEmployedRegime, euro(testCase.revenue), euro2(sum), euro2(a.netAnnual));
        }
      }
    }
  }
  check(T.runTests_13,
        vatBalance, vatGap);

  // The net must move with the chosen scheme, otherwise the field is fake.
  const netSep = computeSelfEmployed({ year: 2026, revenue: 30000, scheme: 'separata_professionisti' }).netAnnual;
  const netArt = computeSelfEmployed({ year: 2026, revenue: 30000, scheme: 'artigiani' }).netAnnual;
  check(T.runTests_12,
        Math.abs(netSep - netArt) > 1,
        `${euro2(netSep)} contro ${euro2(netArt)}`);

  // The engine and the version that declares it must move together
  check(T.runTests_11(ENGINE_VERSION),
        engineFingerprint() === ENGINE_FINGERPRINT,
        engineFingerprint() === ENGINE_FINGERPRINT
          ? engineFingerprint()
          : T.runTests_10(engineFingerprint(), ENGINE_FINGERPRINT));

  // Integrity of the official dataset
  const milan = MUNICIPALITIES_BY_CODE.get('F205');
  /* No fixed number is checked: municipalities merge and the count changes
     legitimately. The check is that the three parts of the dataset describe
     the same registry, and that no row is lost. */
  const registryRows = MUNICIPALITY_REGISTRY.split('\n').length;
  check(T.runTests_9,
        MUNICIPALITIES.length === registryRows &&
        MUNICIPALITY_RATES_2025.split('\n').length === registryRows &&
        MUNICIPALITIES.every((c) => c.code && c.name && c.province) &&
        Object.keys(REGIONS).length === 21,
        T.runTests_129(MUNICIPALITIES.length, Object.keys(REGIONS).length));
  check(T.runTests_8,
        [2025, 2026].every((a) => milan[a].exemption === 23000 &&
          near(milan[a].brackets[0].rate, 0.008, 1e-9)));
  check(T.runTests_128,
        REGIONS.Lombardia.brackets.map((s) => s.rate).join() === '0.0123,0.0158,0.0172,0.0173',
        REGIONS.Lombardia.brackets.map((s) => s.rate).join(' · '));

  // The ordinary cap is 0.80%, but municipalities that joined the agreements
  // to cover their deficit can go up to 1.20%.
  let ratesValid = true;
  let overOrdinaryCap = 0;
  for (const c of MUNICIPALITIES) {
    for (const year of [2025, 2026]) {
      for (const s of c[year].brackets) {
        if (!(s.rate >= 0 && s.rate <= 0.012)) ratesValid = false;
        if (s.rate > 0.008) overOrdinaryCap++;
      }
    }
  }
  check(T.runTests_7,
        ratesValid, T.runTests_6(overOrdinaryCap));

  /* Regional surcharge: table of the year and particular provisions of the MEF
     (regional pages read on 2 October 2026). Values computed by hand on the
     taxable income shown. */
  const regionalTaxFor = (name, taxable, year) =>
    computeRegionalTax(taxable, REGIONS[name], year).amount;
  const regionalCases = [
    [T.regionalCases_34, 25000, 2026, 432.50, T.regionalCases_15],
    [T.regionalCases_33, 29000, 2026, 665.70, T.regionalCases_14],
    [T.regionalCases_32, 33000, 2026, 858.90, T.regionalCases_13],
    [T.regionalCases_31, 33000, 2025, 798.90, T.regionalCases_12],
    [T.regionalCases_30, 20000, 2026, 246.00, T.regionalCases_11],
    [T.regionalCases_29, 40000, 2026, 876.50, T.regionalCases_10],
    [T.regionalCases_28, 14000, 2026, 98.00, T.regionalCases_9],
    [T.regionalCases_27, 20000, 2026, 246.00, T.regionalCases_8],
    [T.regionalCases_26, 30000, 2026, 0, T.regionalCases_7],
    [T.regionalCases_25, 30001, 2026, 369.01, T.regionalCases_6],
    [T.regionalCases_24, 15000, 2026, 0, T.regionalCases_5],
    [T.regionalCases_23, 16000, 2026, 196.80, T.regionalCases_4],
    [T.regionalCases_22, 40000, 2026, 61.50, T.regionalCases_3],
    [T.regionalCases_21, 60000, 2026, 307.50, T.regionalCases_2],
    [T.regionalCases_20, 100000, 2026, 1355.00, T.regionalCases_1],
    [T.regionalCases_19, 40000, 2025, 581.00, T.regionalCases_18],
    [T.regionalCases_17, 40000, 2026, 864.00, T.regionalCases_16]
  ];
  for (const [name, taxable, year, expected, rule] of regionalCases) {
    const computed = regionalTaxFor(name, taxable, year);
    check(T.runTests_127(name, year, euro(taxable), rule),
          near(computed, expected), T.runTests_126(euro2(computed), euro2(expected)));
  }

  /* Wedge on a contract that does not cover the year: circular 4/E/2025,
     example 1 (2,000 euro in 62 days: 5.3% chosen on 11,744.19 euro a year,
     applied to the 2,000 euro received = 106 euro). Here the same principle
     on a 182-day contract with an annual salary of 20,000 euro. */
  const wedgeHalf = computeEmployee({ ...baseScenario, year: 2026, salary: 20000, daysWorked: 182 });
  check(T.runTests_5,
        near(wedgeHalf.wedgeRate, 0.048) &&
        near(wedgeHalf.wedgeBonus, wedgeHalf.totalIncome * 0.048),
        `${euro2(wedgeHalf.totalIncome)} × ${fmtPct.format(wedgeHalf.wedgeRate * 100)}% = ${euro2(wedgeHalf.wedgeBonus)}`);

  /* Inbound workers: circular 4/E/2025, example 3. The exempt share counts for
     the thresholds: with a salary of 40,000 and 50% exempt the reference income
     exceeds 20,000 euro, so no bonus but the extra deduction. */
  const inbound = computeEmployee({ ...baseScenario, year: 2026, salary: 40000, regime: 'impatriati' });
  check(T.runTests_4,
        inbound.wedgeBonus === 0 && inbound.extraDeduction > 0 &&
        inbound.wedgeIncome > inbound.totalIncome,
        T.runTests_3(euro2(inbound.wedgeIncome), euro2(inbound.extraDeduction)));

  /* Artisan below the minimum: 18,555 € × 24% + 7.44 € in 2025 (INPS circ.
     38/2025), 18,808 € × 24% + 7.44 € in 2026 (circ. 14/2026). */
  check(T.runTests_2,
        near(socialSecurityContributions(10000, 'artigiani', false, 2025).contributions, 4460.64) &&
        near(socialSecurityContributions(10000, 'artigiani', false, 2026).contributions, 4521.36),
        `${euro2(socialSecurityContributions(10000, 'artigiani', false, 2025).contributions)} · `
        + euro2(socialSecurityContributions(10000, 'artigiani', false, 2026).contributions));

  /* Surcharges are due only when net IRPEF is due (D.Lgs. 446/1997 art. 50,
     D.Lgs. 360/1998 art. 1): a single worker in Milan at 8,000 euro pays none. */
  const lowIncome = standard(8000);
  check(T.testSurchargesNeedIrpef,
        lowIncome.netIrpef === 0 && lowIncome.regionalTax === 0 && lowIncome.municipalTax === 0,
        T.runTests_125(euro2(lowIncome.netIrpef), euro2(lowIncome.regionalTax), euro2(lowIncome.municipalTax)));

  /* Self-employed, ordinary regime, separate scheme, 20,000 euro and no costs:
     the art. 13 paragraph 5 deduction is computed on 20,000 euro of income,
     before the 26.07% contributions: 500 + 765 × 8,000 / 22,500 = 772.00. */
  const ordinary20 = computeSelfEmployed({ year: 2026, revenue: 20000, costs: 0, selfEmployedRegime: 'ordinario',
                                           scheme: 'separata_professionisti' });
  check(T.testSelfEmployedDeductionBase, near(ordinary20.deduction, 772, 0.01), euro2(ordinary20.deduction));

  /* Fringe benefits: the 2,000 euro threshold applies with a minor child too
     (L. 207/2024, art. 1, paragraph 390). */
  const fringeMinor = computeEmployee({ ...baseScenario, year: 2026, salary: 30000, fringeBenefit: 1500, youngChildren: 1 });
  check(T.testFringeMinorChildren, fringeMinor.fringeTaxable === 0 && fringeMinor.fringeThreshold === 2000,
        `soglia ${euro2(fringeMinor.fringeThreshold)}`);

  /* Children deduction: 50% to each parent unless the spouse is a dependant
     or the parents agree on 100% (art. 12, paragraph 1, letter c TUIR). */
  const childHalf = computeEmployee({ ...baseScenario, year: 2026, salary: 30000, children: 1 });
  const childFull = computeEmployee({ ...baseScenario, year: 2026, salary: 30000, children: 1, childDeductionFull: true });
  check(T.testChildrenDeductionSplit,
        childHalf.deductionChildren > 0 && near(childHalf.deductionChildren * 2, childFull.deductionChildren, 0.01),
        `${euro2(childHalf.deductionChildren)} · al 100% ${euro2(childFull.deductionChildren)}`);

  /* Family deductions follow the months the dependant is dependent, not the
     days worked (art. 12, paragraph 3 TUIR): half a year of work keeps the
     whole spouse deduction. */
  const spouseHalfYear = computeEmployee({ ...baseScenario, year: 2026, salary: 30000, daysWorked: 182, dependentSpouse: true });
  check(T.testFamilyDeductionsByMonth,
        near(spouseHalfYear.deductionSpouse, spouseDeduction(spouseHalfYear.totalIncome), 0.01),
        euro2(spouseHalfYear.deductionSpouse));

  /* The supplementary pension cap is 5,164.57 euro until 2025 and 5,300
     euro from 2026 (D.Lgs. 252/2005, art. 8, paragraph 4; L. 199/2025,
     art. 1, paragraph 201). */
  const cap2025 = computeEmployee({ ...baseScenario, year: 2025, salary: 100000, employerFundContribution: 4, pensionFund: 4000 });
  const cap2026 = computeEmployee({ ...baseScenario, year: 2026, salary: 100000, employerFundContribution: 4, pensionFund: 4000 });
  check(T.testPensionCapByYear,
        near(cap2025.pensionFundDeductible + cap2025.employerFundContribution, 5164.57, 0.01) &&
        near(cap2026.pensionFundDeductible + cap2026.employerFundContribution, 5300, 0.01),
        `${euro2(cap2025.pensionCap)} · ${euro2(cap2026.pensionCap)}`);

  /* Previndai on 100,000 euro: 2% by the executive (2,000), 4% + 2% by the
     company with the 4% at least 4,800 euro (4,800 + 2,000 = 6,800). The
     company share alone exceeds the 5,300 cap: 1,500 euro become taxable and
     the executive's 2,000 are not deductible. */
  const executive = computeEmployee({ year: 2026, monthlyPayments: 13, profile: 'dirigente',
                                     region: 'Lombardia', municipality: 'F205', salary: 100000 });
  check(T.testPrevindaiCap,
        near(executive.fundContribution, 2000, 0.01) &&
        near(executive.employerFundTotal, 6800, 0.01) &&
        near(executive.employerFundExcess, 1500, 0.01) &&
        near(executive.pensionFundDeductible, 0, 0.01),
        `${euro2(executive.employerFundTotal)} · ${euro2(executive.employerFundExcess)}`);

  /* 2026 contract renewal increases: 5% instead of IRPEF and surcharges up to
     33,000 euro of employment income, nothing in 2025 or above the limit. */
  const renewal = computeEmployee({ ...baseScenario, year: 2026, salary: 30000, renewalIncrease: 1200 });
  const renewal2025 = computeEmployee({ ...baseScenario, year: 2025, salary: 30000, renewalIncrease: 1200 });
  const renewalHigh = computeEmployee({ ...baseScenario, year: 2026, salary: 45000, renewalIncrease: 1200 });
  check(T.testRenewalTax,
        near(renewal.renewalTax, 60, 0.01) && renewal.netAnnual > standard(30000).netAnnual &&
        renewal2025.renewalRelieved === 0 && renewalHigh.renewalRelieved === 0,
        euro2(renewal.renewalTax));

  /* The income under substitute tax still counts for the integrative
     treatment's capacity check (circular 2/E/2026): 9,200 euro with 500 of
     renewal increase keep the 1,200 euro, although the taxable income alone
     is below the break-even point. */
  const renewalTreatment = computeEmployee({ ...baseScenario, year: 2026, salary: 9200, renewalIncrease: 500 });
  check(T.testRenewalTreatment,
        renewalTreatment.taxable < 8173.91 && near(renewalTreatment.integrativeTreatment, 1200, 0.01),
        euro2(renewalTreatment.integrativeTreatment));

  /* The first pensionable band is monthly: three months at 100,000 euro a
     year pay the 1% on (25,000 - 56,224 x 3/12) = 10,944 euro. */
  const shortHigh = computeEmployee({ ...baseScenario, year: 2026, salary: 100000, daysWorked: 91.25 });
  check(T.testAdditionalRateMonthly,
        near(shortHigh.additionalContribution, (25000 - 56224 * 0.25) * 0.01, 0.01),
        euro2(shortHigh.additionalContribution));

  // A year without rules stops with an error instead of a plausible zero
  let missingYear = '';
  try { computeEmployee({ ...baseScenario, year: 2027, salary: 30000 }); } catch (e) { missingYear = e.message; }
  check(T.testMissingYear, /2027/.test(missingYear), missingYear);

  // The regions of the southern exemptions are keys of the regional table
  check(T.testSouthernRegions, SOUTHERN_REGIONS.length === 8 && SOUTHERN_REGIONS.every((name) => REGIONS[name]),
        SOUTHERN_REGIONS.filter((name) => !REGIONS[name]).join(', '));

  /* Part-time counts for the income thresholds: 50,000 euro at 70% is about
     35,000 euro of pay, below the 40,000 limit of the shift premiums. */
  const partTimePremiums = computeEmployee({ ...baseScenario, year: 2026, salary: 50000, partTime: 70, shiftPremiums: 1500 });
  check(T.testPartTimeThresholds, near(partTimePremiums.premiumsRelieved, 1500, 0.01),
        euro2(partTimePremiums.premiumsRelieved));

  // Food service and tourism are excluded from the 15% on shift premiums
  const catering = computeEmployee({ ...baseScenario, year: 2026, salary: 28000, shiftPremiums: 1500,
                                     profile: 'pubblici_esercizi|operaio|fino50' });
  check(T.testCateringPremiums, catering.premiumsRelieved === 0 && near(catering.premiumsOrdinary, 1500, 0.01),
        euro2(catering.premiumsOrdinary));

  /* Valle d'Aosta exempts total incomes up to 15,000 euro: a pension fund
     that brings the taxable income below the threshold does not exempt. */
  const aosta = computeEmployee({ year: 2026, monthlyPayments: 13, profile: 'terziario_impiegato',
                                  region: "Valle d'Aosta", municipality: 'A326', salary: 17500, pensionFund: 2000 });
  check(T.testRegionalExemptionTotalIncome,
        aosta.taxable < 15000 && aosta.totalIncome > 15000 && aosta.regionalTax > 0,
        euro2(aosta.regionalTax));

  // A zero or negative salary does not produce NaN
  check(T.runTests_124, Number.isFinite(standard(0).netAnnual));
  check(T.runTests_123, Number.isFinite(standard(-5000).netAnnual));
  check(T.runTests_1,
        Number.isFinite(computeEmployee({ ...baseScenario, salary: 0 }).netAnnual));

  return results;
}
