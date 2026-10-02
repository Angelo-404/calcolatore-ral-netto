import { exemptionStatus } from './hiring-exemptions.js';
import { CONSTANTS, computeBracketTax, computeExtraDeduction, computeIntegrativeTreatment, employmentDeductionForPeriod, wedgeBonusRate } from './national-rules.js';
import { CONTRACT_TYPES, CONTRIBUTION_PROFILES, EMPLOYEE_PARAMS, TAX_REGIMES, YEARS, normaliseProfile, yearRules } from './parameters.js';
import { MUNICIPALITIES_BY_CODE, REGIONS, computeRegionalTax } from './territory.js';

/* ====================================================================
   EMPLOYEE CALCULATION — domain functions
   ==================================================================== */

/* Gross IRPEF with the rates of the tax year. */
export function computeGrossIrpef(taxable, year) {
  const brackets = yearRules(year).irpef;
  let tax = 0;
  let previous = 0;
  for (const s of brackets) {
    if (taxable <= previous) break;
    tax += (Math.min(taxable, s.upTo) - previous) * s.rate;
    previous = s.upTo;
  }
  return tax;
}

/* Employee contributions, with ceiling and additional rate. The 1%
   additional rate (art. 3-ter of D.L. 384/1992, converted by L. 438/1992)
   applies to the part above the first pensionable pay band, and only when
   the employee's rate is below 10%. The band is monthly (INPS circular
   6/2026, par. 5: 4,685 euro a month in 2026): over a shorter relationship
   it covers only the months worked. */
export function computeEmployeeContributions(contributionBase, profile, year, ceilingActive, separateScheme, yearShare = 1) {
  const A = yearRules(year);
  const base = ceilingActive ? Math.min(contributionBase, A.ceiling) : contributionBase;

  const ordinary = base * profile.employee;
  // The 1% additional rate above the first band belongs to the FPLD:
  // it does not exist in the separate scheme, and the collaborator's share
  // would exceed the threshold below which it is looked for anyway.
  const additional = !separateScheme
    && profile.employee > 0 && profile.employee < EMPLOYEE_PARAMS.ADDITIONAL_RATE_THRESHOLD
    ? Math.max(0, base - A.threshold1pc * yearShare) * EMPLOYEE_PARAMS.ADDITIONAL_RATE
    : 0;
  // A contractual pension fund has its own pay ceiling, unrelated to the
  // INPS one: its base is the pay, not the capped contribution base.
  const fund = profile.fund
    ? Math.min(contributionBase, profile.fundCap || Infinity) * profile.fund
    : 0;

  return {
    ordinary, additional, fund,
    total: ordinary + additional + fund,
    appliedBase: base,
    ceilingReached: ceilingActive && contributionBase > A.ceiling
  };
}

/* Apply the special tax regime to the IRPEF taxable income.
   No regime reduces the contribution base: they only affect tax. */
export function applyTaxRegime(taxable, regime, options) {
  if (regime === 'impatriati') {
    const eligible = Math.min(taxable, EMPLOYEE_PARAMS.INBOUND_CAP);
    const share = options.inboundMinorChildren
      ? EMPLOYEE_PARAMS.INBOUND_TAXED_SHARE_CHILDREN
      : EMPLOYEE_PARAMS.INBOUND_TAXED_SHARE;
    const excess = taxable - eligible;
    return { taxable: eligible * share + excess, exemptAmount: eligible * (1 - share) };
  }
  if (regime === 'ricercatori') {
    const taxed = taxable * EMPLOYEE_PARAMS.RESEARCHERS_TAXED_SHARE;
    return { taxable: taxed, exemptAmount: taxable - taxed };
  }
  if (regime === 'frontalieri') {
    const taxed = Math.max(0, taxable - EMPLOYEE_PARAMS.CROSS_BORDER_ALLOWANCE);
    return { taxable: taxed, exemptAmount: taxable - taxed };
  }
  return { taxable, exemptAmount: 0 };
}

/* Municipal surcharge: exemption threshold with a step effect, then a single
   rate or cumulative brackets, as the resolution says. */
export function computeMunicipalTax(taxable, municipality, year) {
  if (!municipality) return 0;
  const rule = municipality[year];
  if (!rule) throw new Error(`No municipal rates for year ${year}.`);
  if (!rule.brackets.length) return 0;
  if (rule.exemption > 0 && taxable <= rule.exemption) return 0;

  if (rule.brackets.length === 1 && rule.brackets[0].upTo === Infinity) {
    return taxable * rule.brackets[0].rate;   // single rate
  }
  return computeBracketTax(taxable, rule.brackets);
}

/* Deduction for a dependent spouse — art. 12 TUIR */
export function spouseDeduction(income) {
  if (income <= 15000) {
    if (income === 0) return 800;
    return 800 - 110 * (income / 15000);
  }
  if (income <= 40000) {
    let base = 690;
    if (income > 29000 && income <= 29200) base += 10;
    else if (income > 29200 && income <= 34700) base += 20;
    else if (income > 34700 && income <= 35000) base += 30;
    else if (income > 35000 && income <= 35100) base += 20;
    else if (income > 35100 && income <= 35200) base += 10;
    return base;
  }
  if (income <= 80000) return 690 * ((80000 - income) / 40000);
  return 0;
}

/* Deduction for dependent children — art. 12 TUIR.
   Below 21 the single child allowance (Assegno Unico) takes the place of the
   deduction; from 2025 the deduction stops at 30, except for children with
   a certified disability, a case the calculator does not model. */
export function childrenDeduction(income, childCount) {
  if (childCount <= 0) return 0;
  const cap = 95000 + Math.max(0, childCount - 1) * 15000;
  if (income >= cap) return 0;
  const baseAmount = 950;
  return childCount * baseAmount * ((cap - income) / cap);
}

/* Deduction for other dependants — art. 12 TUIR.
   From 2025 it is limited to cohabiting ascendants. */
export function otherDependantsDeduction(income, num) {
  if (num <= 0 || income >= 80000) return 0;
  return num * 750 * ((80000 - income) / 80000);
}

/* ====================================================================
   EMPLOYEE ENGINE
   ==================================================================== */
export function computeEmployee(params) {
  // Not a constant because the scenario without pay sets the additional
  // components to zero before going on: see the check further down.
  let p = {
    year: 2026,
    salary: 0,
    monthlyPayments: 13,
    profile: 'terziario_impiegato',
    contractType: 'indeterminato',
    ceilingActive: false,
    region: 'Lombardia',
    municipality: 'F205',
    daysWorked: 365,
    partTime: 100,
    dependentSpouse: false,
    children: 0,
    youngChildren: 0,
    childDeductionFull: false,
    otherDependants: 0,
    fringeBenefit: 0,
    mealVoucherPerDay: 0,
    electronicVouchers: true,
    voucherDays: EMPLOYEE_PARAMS.VOUCHER_DAYS_YEAR,
    performanceBonus: 0,
    bonusAsWelfare: false,
    shiftPremiums: 0,
    renewalIncrease: 0,
    pensionFund: 0,
    employerFundContribution: 0,
    tfrToFund: false,
    otherDeductions: 0,
    exemptions: [],
    regime: 'nessuno',
    inboundMinorChildren: false,
    ...params
  };

  const A = yearRules(p.year);
  const contract = CONTRACT_TYPES[p.contractType] || CONTRACT_TYPES.indeterminato;
  const sectorProfile = CONTRIBUTION_PROFILES[normaliseProfile(p.profile)];

  /* The contract type wins over the sector rates: apprenticeship has a rate
     fixed by law, an internship generates no pension contributions because
     the allowance is income assimilated to employment. */
  const profile = contract.assimilated
    ? { ...sectorProfile, name: sectorProfile.name, employee: 0, employer: 0,
        fund: 0, employerFund: 0, assimilated: true }
    : { ...sectorProfile,
        employee: contract.employee !== undefined ? contract.employee : sectorProfile.employee,
        employer: (contract.employer !== undefined ? contract.employer : sectorProfile.employer)
                + (contract.employerSurcharge || 0) };
  const days = Math.min(Math.max(p.daysWorked, 0), EMPLOYEE_PARAMS.DAYS_YEAR);
  const yearShare = days / EMPLOYEE_PARAMS.DAYS_YEAR;
  const partTimeShare = Math.min(Math.max(p.partTime, 0), 100) / 100;

  /* --- Pay actually accrued in the period ------------------------------ */
  const contractSalary = Math.max(0, p.salary);
  const salary = contractSalary * partTimeShare * yearShare;

  // Without pay there is no employment to simulate: welfare and
  // allowances alone would generate contributions on a payslip that does not
  // exist, that is a negative net. All additional components are set to zero.
  if (salary <= 0) {
    p = { ...p, fringeBenefit: 0, mealVoucherPerDay: 0, performanceBonus: 0,
          shiftPremiums: 0, renewalIncrease: 0, pensionFund: 0 };
  }

  /* --- Welfare: exempt share and taxable share ------------------------- */
  /* L. 207/2024, art. 1, paragraph 390: the 2,000 euro threshold applies to
     every dependent child under art. 12, paragraph 2 TUIR, of any age: the
     children aged 21-30 that give the IRPEF deduction and the younger ones
     covered by the single child allowance. */
  const hasDependentChildren = p.children > 0 || p.youngChildren > 0;
  const fringeThreshold = hasDependentChildren ? EMPLOYEE_PARAMS.FRINGE_THRESHOLD_WITH_CHILDREN : EMPLOYEE_PARAMS.FRINGE_THRESHOLD;
  // If the threshold is exceeded, the WHOLE value becomes taxable: it is a
  // threshold, not an allowance.
  const fringeTaxable = p.fringeBenefit > fringeThreshold ? p.fringeBenefit : 0;
  const fringeExempt = p.fringeBenefit > fringeThreshold ? 0 : p.fringeBenefit;

  const voucherLimit = p.electronicVouchers ? A.electronicVoucher : A.paperVoucher;
  /* Vouchers are counted on days present, and days present cannot exceed the
     days the contract exists: 220 vouchers on a one-month contract is not an
     edge case, it is impossible data. Without this limit the taxable excess
     could exceed the pay accrued. */
  const voucherDaysEffective = Math.min(Math.max(0, p.voucherDays), days);
  const vouchersProrated = voucherDaysEffective < p.voucherDays;
  const vouchersTotal = p.mealVoucherPerDay * voucherDaysEffective;
  const vouchersExcess = Math.max(0, p.mealVoucherPerDay - voucherLimit) * voucherDaysEffective;
  const vouchersExempt = vouchersTotal - vouchersExcess;

  /* --- Performance bonus and shift premiums ---------------------------- */
  // A bonus converted into welfare is fully exempt from tax and
  // contributions; otherwise it bears contributions and the substitute tax.
  const bonusGross = Math.max(0, p.performanceBonus);
  /* The income limits of the bonus (80,000 euro) and of the shift premiums
     (40,000 euro) refer to employment income, which does not include the
     compulsory contributions (art. 51, paragraph 2, letter a TUIR). The law
     looks at the previous year: here the income of the simulated year is
     used, net of the employee rate, and the page says so. Part-time counts:
     whoever works part-time almost always did the year before too. The
     length of the relationship does not: a short contract says nothing about
     the income of the previous year. */
  const employmentIncome = contractSalary * partTimeShare * (1 - (profile.employee || 0));
  const bonusAllowed = employmentIncome <= EMPLOYEE_PARAMS.BONUS_INCOME_MAX
    ? Math.min(bonusGross, A.bonusCap)
    : 0;
  const bonusOrdinary = bonusGross - bonusAllowed;   // excess taxed with IRPEF
  const bonusWelfare = p.bonusAsWelfare ? bonusAllowed : 0;
  const bonusSubstitute = p.bonusAsWelfare ? 0 : bonusAllowed;

  // The substitute tax on night, holiday and shift premiums
  // applies only in 2026 and only up to 1,500 euro: the part above the cap,
  // and everything in 2025, follows ordinary IRPEF. The income limit of the
  // law looks at 2025; here the gross salary of the simulated year is used.
  /* L. 199/2025, art. 1, paragraph 11, excludes the activities of paragraph
     18 (food and drink service, tourism, spas): for them the premiums are
     taxed as ordinary pay, and the special 15% integrative treatment of
     paragraph 18 is not modelled (the page says so). */
  const premiumsExcludedSector = profile.sector === 'pubblici_esercizi';
  const premiumsRelieved = (A.premiumsRelief && !premiumsExcludedSector
      && employmentIncome <= EMPLOYEE_PARAMS.PREMIUMS_INCOME_MAX)
    ? Math.min(Math.max(0, p.shiftPremiums), EMPLOYEE_PARAMS.PREMIUMS_CAP)
    : 0;
  const premiumsOrdinary = Math.max(0, p.shiftPremiums) - premiumsRelieved;

  /* L. 199/2025, art. 1, paragraph 7, and Agenzia delle Entrate circular 2/E
     of 24/02/2026: the pay increases received in 2026 from national
     collective agreements renewed in 2024-2026 bear a 5% substitute tax
     instead of IRPEF and surcharges, for private-sector employees with up to
     33,000 euro of employment income in 2025, unless they waive it in
     writing. The increases are already part of the salary: they are not
     added, they are taxed differently. Assimilated incomes (internships,
     collaborations) have no collective agreement and stay out. The income
     limit looks at 2025; here the income of the simulated year is used. */
  const renewalRelieved = (A.renewalRelief && !contract.assimilated
      && employmentIncome <= EMPLOYEE_PARAMS.RENEWAL_INCOME_MAX)
    ? Math.min(Math.max(0, p.renewalIncrease), salary)
    : 0;

  /* --- Contribution base ----------------------------------------------- */
  const contributionBase = salary + fringeTaxable + vouchersExcess
                         + bonusSubstitute + bonusOrdinary
                         + premiumsRelieved + premiumsOrdinary;

  const contributions = computeEmployeeContributions(contributionBase, profile, p.year,
        p.ceilingActive || !!contract.ceilingMandatory, !!contract.separateScheme, yearShare);

  /* Exemptions on the employee's share raise the net, but also the taxable
     income: what is not paid to INPS stays taxable income. The cap is annual
     and spread over 12 months. */
  const chosenExemptions = Array.isArray(p.exemptions) ? p.exemptions : [];
  let employeeExemption = 0;
  const exemptionsApplied = [];

  for (const key of chosenExemptions) {
    const status = exemptionStatus(key, p, p.today);
    if (!status.applicable) continue;
    if (status.hiringExemption.affects === 'employee') {
      const cap = (status.share.annualCap || Infinity) * yearShare;
      employeeExemption += Math.min(contributions.ordinary * status.share.percentage, cap);
    }
    exemptionsApplied.push(key);
  }
  employeeExemption = Math.min(employeeExemption, contributions.ordinary);

  const inps = contributions.total - employeeExemption;

  /* --- Taxable income -------------------------------------------------- */
  // Outside the IRPEF taxable income: bonus under substitute tax, relieved
  // shift premiums, bonus converted into welfare, exempt welfare.
  /* The employee's share of a contractual pension fund (Previndai) is not a
     compulsory contribution: it is deducted below, inside the cap of
     supplementary pension, together with the employer's share. */
  const compulsoryContributions = inps - contributions.fund;
  const contributionsOnOrdinary = contributionBase > 0
    ? compulsoryContributions * ((contributionBase - bonusSubstitute - premiumsRelieved - renewalRelieved) / contributionBase)
    : 0;
  // Contributions on the incomes under substitute tax, needed below for the
  // integrative treatment.
  const contributionsOnRelieved = contributionBase > 0
    ? compulsoryContributions * ((premiumsRelieved + renewalRelieved) / contributionBase)
    : 0;

  const taxableGross = Math.max(
    0,
    salary - renewalRelieved + fringeTaxable + vouchersExcess + bonusOrdinary + premiumsOrdinary - contributionsOnOrdinary
  );

  const regime = applyTaxRegime(taxableGross, p.regime, p);

  /* --- Supplementary pension -------------------------------------------
     The employer's contribution to contractual funds is due only if the
     worker pays their own share: whoever does not join leaves it on the
     table. The deductibility cap (5,164.57 euro, 5,300 from 2026) is shared
     by the worker's and the employer's payments, including a contractual fund
     such as Previndai, and the part of the employer contribution above it
     becomes taxable income for the worker again. */
  /* The payment is withheld from the payslip and cannot exceed what the
     payslip contains. The cap is not trivial to find: deducting lowers the
     taxable income and, at very low incomes, wipes out the tax and with it the
     integrative treatment. The available net therefore drops by more than what
     is paid in, and the value is found by successive approximations. The
     internal parameter `withoutCapacity` stops the recursion. */
  const paymentRequested = Math.max(0, p.pensionFund);
  let employeePayment = paymentRequested;

  if (paymentRequested > 0 && !p.withoutCapacity) {
    const available = computeEmployee({ ...p, pensionFund: 0, employerFundContribution: 0, withoutCapacity: true });
    let attempt = Math.min(paymentRequested, Math.max(0, available.netAnnual));

    for (let i = 0; i < 4 && attempt > 0; i++) {
      const trial = computeEmployee({ ...p, pensionFund: attempt, withoutCapacity: true });
      if (trial.netAnnual >= -0.005) break;
      attempt = Math.max(0, attempt + trial.netAnnual);
    }
    employeePayment = attempt;
  }
  const paymentUncovered = paymentRequested - employeePayment;
  const employerFundContribution = employeePayment > 0
    ? salary * Math.min(Math.max(0, p.employerFundContribution), 100) / 100
    : 0;
  // Contractual fund paid by the employer (Previndai: 4% + 2%, with a yearly
  // minimum on the 4% prorated to the period).
  const fundBase = Math.min(contributionBase, profile.fundCap || Infinity);
  const fundMinimum = profile.employerFundMinimum;
  const employerFund = profile.employerFund
    ? (fundMinimum
        ? Math.max(fundBase * fundMinimum.rate, fundMinimum.annual * yearShare)
          + fundBase * (profile.employerFund - fundMinimum.rate)
        : fundBase * profile.employerFund)
    : 0;
  const pensionCap = A.pensionFundDeductible;
  const employerFundTotal = employerFundContribution + employerFund;
  const employeeFundTotal = employeePayment + contributions.fund;
  const employerFundExcess = Math.max(0, employerFundTotal - pensionCap);
  const deductionCapacity = Math.max(0, pensionCap - employerFundTotal);
  const pensionFundDeductible = Math.min(employeeFundTotal, deductionCapacity);
  const employeeFundNotDeducted = employeeFundTotal - pensionFundDeductible;

  // Total income is before deductible charges: deductions, the wedge cut
  // and the integrative treatment are scaled on this value. Supplementary
  // pension lowers the tax; it must not raise the deductions nor bring the
  // income back into a more favourable band.
  const totalIncome = regime.taxable + employerFundExcess;
  const taxable = Math.max(0, totalIncome - pensionFundDeductible);

  /* --- IRPEF and deductions -------------------------------------------- */
  const grossIrpef = computeGrossIrpef(taxable, p.year);

  // Deductions and wedge benefits are prorated to the period worked
  // The art. 13 paragraph 1 TUIR deduction expressly refers to art. 50
  // paragraph 1 letter c): interns get it, prorated to the days.
  // The proration is not just a multiplication, though: inside the first
  // band there is a legal floor, and the band correction is not prorated
  // at all.
  const employmentDeduction = employmentDeductionForPeriod(totalIncome, yearShare,
                                                     !!contract.fixedTerm);

  // The wedge cut is only for holders of employment income under art. 49
  // TUIR: internships and collaborations, which are assimilated income under
  // art. 50, stay out. The integrative treatment instead is due to them as
  // well: D.L. 3/2020 refers to the income of art. 50, paragraph 1, letters
  // a), b), c), c-bis), d), h-bis) and l), and an internship is letter c)
  // (Agenzia delle Entrate, circular 4/E/2025, p. 7).
  const withoutWedge = contract.assimilated || contract.withoutWedge;
  /* L. 207/2024, paragraphs 4, 5 and 9, read with Agenzia delle Entrate
     circular 4/E of 16/05/2025 (examples 1 and 3):
     - the 20,000 and 40,000 euro thresholds look at total income including
     the exempt share of inbound workers and researchers;
     - the bonus percentage is chosen on income scaled to the whole year and
     applied to the taxed income actually received, without a second
     proration to the days (it already is the income of the period);
     - the extra deduction instead is prorated to the period worked. */
  const wedgeExemptShare = p.regime === 'impatriati' || p.regime === 'ricercatori' ? regime.exemptAmount : 0;
  const wedgeIncome = totalIncome + wedgeExemptShare;
  const wedgeRate = wedgeBonusRate(yearShare > 0 ? wedgeIncome / yearShare : 0);
  const wedgeBonus = withoutWedge || wedgeIncome > CONSTANTS.WEDGE.BONUS_3_UP_TO
    ? 0 : totalIncome * wedgeRate;
  const extraDeduction = withoutWedge ? 0 : computeExtraDeduction(wedgeIncome) * yearShare;

  /* Family deductions are prorated to the MONTHS the dependants are
     dependent (art. 12, paragraph 3 TUIR), not to the days worked: here the
     dependants are assumed dependent for the whole year. The children
     deduction is split 50% between parents, unless the spouse is a
     dependant or the parents agree to give it all to the higher income
     (art. 12, paragraph 1, letter c TUIR). */
  const childrenShare = p.dependentSpouse || p.childDeductionFull ? 1 : 0.5;
  const deductionSpouse = p.dependentSpouse ? spouseDeduction(totalIncome) : 0;
  const deductionChildren = childrenDeduction(totalIncome, p.children) * childrenShare;
  const deductionOthers = otherDependantsDeduction(totalIncome, p.otherDependants);
  const deductionFamily = deductionSpouse + deductionChildren + deductionOthers;

  const totalDeductionsIrpef = employmentDeduction + extraDeduction + deductionFamily;
  const deductionUsed = Math.min(totalDeductionsIrpef, grossIrpef);
  const deductionUnused = totalDeductionsIrpef - deductionUsed;
  const netIrpef = Math.max(0, grossIrpef - deductionUsed);

  /* The integrative treatment comparison counts the deductions of articles 12
     and 13 TUIR — the employment one and the family ones — and not the extra
     wedge deduction, which D.L. 3/2020 does not list. */
  const deductionsForTreatment = employmentDeduction + deductionFamily;
  /* Incomes under the 2026 substitute taxes (shift premiums, contract
     renewals) are out of total income, but the integrative treatment's
     capacity check counts them: gross tax and employment deduction are
     computed on employment income including them (Agenzia delle Entrate,
     circular 2/E/2026, on paragraphs 7 and 10, recalling circular 29/E/2020). */
  const relievedIncome = Math.max(0, premiumsRelieved + renewalRelieved - contributionsOnRelieved);
  const capacityCheck = relievedIncome > 0
    ? { grossIrpef: computeGrossIrpef(taxable + relievedIncome, p.year),
        employmentDeduction: employmentDeductionForPeriod(totalIncome + relievedIncome, yearShare, !!contract.fixedTerm) }
    : null;
  const integrativeTreatment = computeIntegrativeTreatment(totalIncome, grossIrpef, employmentDeduction,
                                                               deductionsForTreatment, yearShare, capacityCheck) * yearShare;

  /* --- Substitute tax on bonuses and shift premiums -------------------- */
  const bonusTax = bonusSubstitute * A.bonusRate;
  const premiumsTax = premiumsRelieved * EMPLOYEE_PARAMS.PREMIUMS_RATE;
  const renewalTax = renewalRelieved * EMPLOYEE_PARAMS.RENEWAL_RATE;

  /* --- Local taxes ----------------------------------------------------- */
  const region = REGIONS[p.region] || REGIONS.Lombardia;
  const municipality = MUNICIPALITIES_BY_CODE.get(p.municipality);
  /* The regional and municipal surcharges are due only if net IRPEF is due
     for the same year (D.Lgs. 446/1997, art. 50, paragraph 2; D.Lgs. 360/1998,
     art. 1, paragraph 4). */
  const surchargesDue = netIrpef > 0;
  const regionalTaxDetail = computeRegionalTax(surchargesDue ? taxable : 0, region, p.year,
                                               surchargesDue ? totalIncome : 0);
  const regionalTax = regionalTaxDetail.amount;
  const municipalTax = surchargesDue ? computeMunicipalTax(taxable, municipality, p.year) : 0;

  /* --- Net ------------------------------------------------------------- */
  let netAnnual = salary
    + bonusSubstitute + bonusOrdinary + premiumsRelieved + premiumsOrdinary
    - inps - netIrpef - regionalTax - municipalTax
    - bonusTax - premiumsTax - renewalTax
    - employeePayment
    + wedgeBonus + integrativeTreatment;

  /* Deductions with no tax effect: union dues, salary-backed loans,
     garnishments, company loans. They are neither deductible nor creditable
     charges, so they do not touch taxable income, taxes or contributions: they
     come out of the already taxed net. They cannot exceed the available net,
     because that is all the payslip contains. */
  /* A payslip does not go negative. When the taxable value of welfare exceeds
     the pay accrued — it happens on very short contracts — the withholdings
     have nothing to be withheld from: the net stops at zero and the uncovered
     part is stated, as already happens for the pension fund and the other
     deductions. */
  const netShortfall = Math.max(0, -netAnnual);
  if (netAnnual < 0) netAnnual = 0;

  const otherDeductionsRequested = Math.max(0, p.otherDeductions);
  const otherDeductions = Math.min(otherDeductionsRequested, Math.max(0, netAnnual));
  const otherDeductionsUncovered = otherDeductionsRequested - otherDeductions;
  const netBeforeDeductions = netAnnual;
  netAnnual -= otherDeductions;

  // Extra monthly payments are an employment institution: where the
  // contract does not provide them the pay is divided by twelve, whatever
  // the interface control says.
  const monthlyPayments = contract.fixedMonthlyPayments || p.monthlyPayments;
  const netMonthly = netAnnual / monthlyPayments;
  const welfareExempt = fringeExempt + vouchersExempt + bonusWelfare;
  // Goods and vouchers are received even when taxed: the tax is already in the net.
  const welfareInKind = welfareExempt + fringeTaxable + vouchersExcess;
  const totalValue = netAnnual + welfareInKind;
  const referenceGross = salary + bonusGross + Math.max(0, p.shiftPremiums);
  const taxPressure = referenceGross > 0
    ? ((referenceGross - netBeforeDeductions) / referenceGross) * 100
    : 0;

  /* --- TFR and employer cost ------------------------------------------- */
  // A bonus converted into welfare is not pay: it accrues no TFR.
  const tfrBase = salary + bonusSubstitute + bonusOrdinary;
  const tfrGross = tfrBase / EMPLOYEE_PARAMS.TFR_DIVISOR;
  // TFR paid into a fund does not bear the 0.50% contribution to the
  // Guarantee Fund, which concerns TFR kept in the company.
  const withoutTfr = contract.assimilated || contract.withoutTfr;
  const tfr = withoutTfr ? 0
    : (p.tfrToFund ? tfrGross : tfrGross - tfrBase * EMPLOYEE_PARAMS.TFR_FUND_CONTRIBUTION);

  const employerContributionsGross = contributions.appliedBase * profile.employer;

  let employerExemption = 0;
  for (const key of exemptionsApplied) {
    const status = exemptionStatus(key, p, p.today);
    if (!status.applicable || status.hiringExemption.affects !== 'employer') continue;
    const cap = status.share.annualCap !== undefined
      ? status.share.annualCap * yearShare
      : status.share.monthlyCap * 12 * yearShare;
    employerExemption += Math.min(employerContributionsGross * status.share.percentage, cap);
  }
  employerExemption = Math.min(employerExemption, employerContributionsGross);
  const employerContributions = employerContributionsGross - employerExemption;
  const inail = salary * EMPLOYEE_PARAMS.EMPLOYER_INAIL;
  const employerCost = salary + bonusGross + Math.max(0, p.shiftPremiums)
    + employerContributions + employerFund + employerFundContribution + inail
    + (withoutTfr ? 0 : tfrGross)
    + p.fringeBenefit + vouchersTotal;
  // Without a positive net the ratio is meaningless
  const efficiency = employerCost > 0 && netBeforeDeductions > 0
    ? (netBeforeDeductions / employerCost) * 100 : 0;

  /* --- Contribution minimum check -------------------------------------- */
  const monthlyPay = monthlyPayments > 0 ? salary / monthlyPayments : 0;
  const belowMinimum = salary > 0 && monthlyPay < A.minimumMonthly;

  return {
    year: p.year, salary, contractSalary, days, yearShare, partTimeShare,
    profileName: profile.name, profile,
    contractType: p.contractType, contractName: contract.name, assimilated: !!contract.assimilated,
    inps, ordinaryContributions: contributions.ordinary,
    additionalContribution: contributions.additional, fundContribution: contributions.fund,
    exemptionsApplied, employeeExemption, employerExemption, employerContributionsGross,
    ceilingReached: contributions.ceilingReached, contributionBase,
    appliedContributionBase: contributions.appliedBase,
    taxableGross, taxable, totalIncome,
    regimeExempt: regime.exemptAmount, regimeName: (TAX_REGIMES[p.regime] || TAX_REGIMES.nessuno).name,
    pensionFundDeductible, employeePayment, paymentRequested,
    paymentUncovered, employeeFundNotDeducted,
    employerFundContribution, employerFundExcess, employerFundTotal, employeeFundTotal, pensionCap, tfrToFund: !!p.tfrToFund,
    grossIrpef, employmentDeduction, extraDeduction,
    deductionSpouse, deductionChildren, deductionOthers, deductionFamily,
    totalDeductionsIrpef, deductionUsed, deductionUnused, netIrpef,
    wedgeBonus, wedgeRate, wedgeIncome, integrativeTreatment,
    bonusSubstitute, bonusOrdinary, bonusWelfare, bonusTax,
    premiumsRelieved, premiumsOrdinary, premiumsTax, renewalRelieved, renewalTax,
    regionalTax, regionalTaxDetail, municipalTax, regionName: region.name,
    municipalityName: municipality ? municipality.name + ' (' + municipality.province + ')' : '—',
    municipalityExemption: municipality ? municipality[p.year].exemption : 0,
    municipalityResolved2026: municipality ? municipality.resolved2026 : false,
    fringeExempt, fringeTaxable, fringeThreshold, welfareInKind, employmentIncome, surchargesDue, childrenShare,
    vouchersExempt, vouchersExcess, vouchersTotal,
    voucherDaysEffective, vouchersProrated, netShortfall,
    electronicVouchers: p.electronicVouchers,
    welfareExempt, totalValue,
    netAnnual, netMonthly, taxPressure, referenceGross, monthlyPayments,
    otherDeductions, otherDeductionsRequested, otherDeductionsUncovered, netBeforeDeductions,
    tfr, employerContributions, employerFund, inail, employerCost, efficiency,
    belowMinimum, minimumMonthly: A.minimumMonthly,
    totalDeductions: inps + netIrpef + regionalTax + municipalTax + bonusTax + premiumsTax + renewalTax,
    totalBonuses: wedgeBonus + integrativeTreatment
  };
}
