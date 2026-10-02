/* ======================================================================
   TAX CALCULATION ENGINE — 2025/2026
   ----------------------------------------------------------------------
   National rules shared by the employee and the self-employed calculation.
   ====================================================================== */

/* The version in the page header stayed at 1.0.0 while the engine grew by
   three tabs and a tax year: nobody remembers to bump it by hand. From here on
   the tests notice: they compare the engine fingerprint with the one recorded
   below and fail when the two differ. It is the same principle applied to the
   law: what cannot be automated can at least be made impossible to forget. */
// Date of the last check of rates and rules against the official sources.
export const RULES_VERIFIED_ON = '2026-10-02';
export const ENGINE_VERSION = '4.1.0';
export const ENGINE_FINGERPRINT = '88f6f9c0';

export const CONSTANTS = {
  MONTHLY_PAYMENTS: 13,
  DAYS_WORKED: 365,

  DEDUCTIONS: {
    MINIMUM: 1955,
    CORRECTION: 65,
    CORRECTION_FROM: 25000,
    CORRECTION_TO: 35000,
    /* Art. 13, paragraph 1, letter a) TUIR: in the first band the deduction
       prorated to the days worked cannot drop below a floor, which is higher for
       fixed-term contracts. Without this rule a contract of a few months paid tax
       on a deduction cut down by the proration. */
    FLOOR_UP_TO: 15000,
    FLOOR: 690,
    FLOOR_FIXED_TERM: 1380
  },

  WEDGE: {
    BONUS_1: 0.071, BONUS_1_UP_TO: 8500,
    BONUS_2: 0.053, BONUS_2_UP_TO: 15000,
    BONUS_3: 0.048, BONUS_3_UP_TO: 20000,
    DEDUCTION_FULL: 1000,
    DEDUCTION_FULL_UP_TO: 32000,
    DEDUCTION_ZERO_AT: 40000
  },

  INTEGRATIVE_TREATMENT: {
    AMOUNT: 1200,
    THRESHOLD_FULL: 15000,
    THRESHOLD_MAX: 28000,
    /* L. 207/2024, art. 1, paragraph 3 (AdE circular 4/E/2025, p. 7): to decide
       whether the treatment is due, the art. 13 deduction REDUCED by 75 euro is
       compared with the gross tax; the 75 euro are prorated to the period worked.
       The cut exists because the minimum deduction rose to 1,955 € and without it
       a band of low incomes would have been left out of the treatment. */
    DEDUCTION_CUT: 75
  }
};

/* ------------------------------------- EMPLOYMENT INCOME DEDUCTION */
/* The banded part only, without the band correction. The two pieces stay
   separate because they follow different rules when the contract does not
   cover the whole year: the banded part is prorated to the days, the
   correction is not. */
export function employmentDeductionBand(taxable) {
  /* The art. 13 deduction is due because the income includes employment
     income: with no taxable income none accrues, and without this line the
     engine declared 1,955 € of "unused" deductions on a payslip that does not
     exist. */
  if (taxable <= 0) return 0;

  if (taxable <= 15000) {
    // No tax area: the minimum deduction is 1,955 €
    return CONSTANTS.DEDUCTIONS.MINIMUM;
  }
  if (taxable <= 28000) {
    return 1910 + 1190 * ((28000 - taxable) / 13000);
  }
  if (taxable <= 50000) {
    return 1910 * ((50000 - taxable) / 22000);
  }
  return 0;
}

/* Band correction: +65 € between 25,000 and 35,000 € of taxable income.
   Art. 13, paragraph 1.1 TUIR adds 65 euro to «la detrazione spettante ai
   sensi del comma 1», that is to the deduction already prorated to the
   period: the 65 euro themselves are not prorated, so someone who works six
   months gets 65, not 32.50. This is a reading of the text; no circular
   found so far says it in so many words. */
export function bandCorrection(taxable) {
  const C = CONSTANTS.DEDUCTIONS;
  if (taxable <= 0) return 0;
  return taxable > C.CORRECTION_FROM && taxable <= C.CORRECTION_TO ? C.CORRECTION : 0;
}

export function computeEmploymentDeduction(taxable) {
  return employmentDeductionBand(taxable) + bandCorrection(taxable);
}

/* Employment deduction on a contract that does not cover the year: the
   banded part is prorated to the days but does not drop below the floor of
   art. 13, paragraph 1, letter a); the band correction is added in full. The
   floor lives inside letter a), so it applies only in the first income band. */
export function employmentDeductionForPeriod(taxable, yearShare, fixedTerm) {
  const C = CONSTANTS.DEDUCTIONS;
  let bracket = employmentDeductionBand(taxable) * yearShare;

  if (taxable > 0 && taxable <= C.FLOOR_UP_TO) {
    bracket = Math.max(bracket, fixedTerm ? C.FLOOR_FIXED_TERM : C.FLOOR);
  }

  return bracket + bandCorrection(taxable);
}

/* --------------------------------------------- TAX WEDGE CUT 2025/26 */
// CASE A — tax-free bonus as a percentage of taxable income (up to 20,000 €)
/* The percentage depends on employment income scaled to the whole year
   (L. 207/2024, paragraph 5): someone who works six months picks it on the
   income they would have had working twelve. */
export function wedgeBonusRate(annualIncome) {
  const K = CONSTANTS.WEDGE;
  if (annualIncome <= K.BONUS_1_UP_TO) return K.BONUS_1;
  if (annualIncome <= K.BONUS_2_UP_TO) return K.BONUS_2;
  return K.BONUS_3;
}

export function computeWedgeBonus(taxable) {
  return taxable <= CONSTANTS.WEDGE.BONUS_3_UP_TO ? taxable * wedgeBonusRate(taxable) : 0;
}

// CASE B — extra tax deduction (from 20,000 to 40,000 €)
export function computeExtraDeduction(taxable) {
  const K = CONSTANTS.WEDGE;
  if (taxable <= K.BONUS_3_UP_TO) return 0;
  if (taxable <= K.DEDUCTION_FULL_UP_TO) return K.DEDUCTION_FULL;
  if (taxable <= K.DEDUCTION_ZERO_AT) {
    return K.DEDUCTION_FULL * ((K.DEDUCTION_ZERO_AT - taxable) / 8000);
  }
  return 0;
}

/* --------------------------------------- INTEGRATIVE TREATMENT */
/* Former "bonus Renzi": 1,200 € a year. Not due when the tax cannot absorb it.
   
   `relevantDeductions` is the sum of only the deductions the law lists —
   those of articles 12 and 13 TUIR. The extra wedge deduction comes from
   outside the TUIR (L. 207/2024, art. 1, paragraph 6) and the list of
   D.L. 3/2020 is closed: so it stays out of the comparison, even though it
   counts normally in the net IRPEF. */
export function computeIntegrativeTreatment(taxable, grossIrpef, employmentDeduction,
                                       relevantDeductions, yearShare = 1, capacityCheck = null) {
  const T = CONSTANTS.INTEGRATIVE_TREATMENT;

  if (taxable <= 0) return 0;

  if (taxable <= T.THRESHOLD_FULL) {
    /* Full right only if the gross tax exceeds the employment deduction reduced
       by 75 € prorated to the period: below that point the taxpayer cannot absorb
       it. The cut moves the break-even from 8,500 € to 8,173.91 € of taxable income. */
    // `capacityCheck` carries gross tax and deduction recomputed on the
    // employment income that includes incomes under substitute tax.
    const check = capacityCheck || { grossIrpef, employmentDeduction };
    const threshold = Math.max(0, check.employmentDeduction - T.DEDUCTION_CUT * yearShare);
    return check.grossIrpef > threshold ? T.AMOUNT : 0;
  }

  if (taxable <= T.THRESHOLD_MAX) {
    // Due only for the part of the deductions exceeding the gross tax
    const excess = relevantDeductions - grossIrpef;
    return excess > 0 ? Math.min(T.AMOUNT, excess) : 0;
  }

  return 0;
}

/* ------------------------------------ REGIONAL SURCHARGE (brackets) */
export function computeBracketTax(taxable, brackets) {
  let tax = 0;
  let previous = 0;

  for (const s of brackets) {
    if (taxable <= previous) break;
    const share = Math.min(taxable, s.upTo) - previous;
    tax += share * s.rate;
    previous = s.upTo;
  }

  return tax;
}
