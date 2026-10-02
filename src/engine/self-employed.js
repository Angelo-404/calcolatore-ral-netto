import { T } from '../texts/it.js';
import { computeGrossIrpef, computeMunicipalTax } from './employee.js';
import { socialSecurityContributions } from './parameters.js';
import { MUNICIPALITIES_BY_CODE, REGIONS, computeRegionalTax } from './territory.js';

/* ====================================================================
   SELF-EMPLOYED — VAT NUMBER (PARTITA IVA)
   ----------------------------------------------------------------------
   There is no payslip to rebuild here: no TFR, no extra monthly payments,
   no welfare, no tax wedge cut and no employer paying two thirds of the
   contributions. The order of the factors changes too: contributions are
   computed on income and then deducted, and in the flat-rate regime the
   substitute tax replaces IRPEF and surcharges. That is why it is a separate
   engine and not a branch inside the employee one: mixing them would have
   produced a function full of exceptions, which is where errors are born.
   
   Stated limit: the pension schemes modelled are the INPS separate scheme
   and the artisans' and traders' schemes. Professional funds with their own
   rules (lawyers, engineers, doctors...) are not covered.
   ==================================================================== */

/* Annex 4 of law 190/2014: the coefficient does not depend on the costs
   actually incurred but on the ATECO code, and it is what makes the flat-rate
   regime convenient or punishing depending on the trade. */
export const FLAT_RATE_COEFFICIENTS = [
  { key: 'professionali', coefficient: 0.78,
    name: T.FLAT_RATE_COEFFICIENTS_name_9,
    ateco: '64-65-66 · 69-70-71-72-73-74-75 · 85 · 86-87-88' },
  { key: 'altre', coefficient: 0.67,
    name: T.FLAT_RATE_COEFFICIENTS_name_8, ateco: T.FLAT_RATE_COEFFICIENTS_ateco_1 },
  { key: 'costruzioni', coefficient: 0.86,
    name: T.FLAT_RATE_COEFFICIENTS_name_7, ateco: '41-42-43 · 68' },
  { key: 'intermediari', coefficient: 0.62,
    name: T.FLAT_RATE_COEFFICIENTS_name_6, ateco: '46.1' },
  { key: 'ambulante_altri', coefficient: 0.54,
    name: T.FLAT_RATE_COEFFICIENTS_name_5, ateco: '47.82 · 47.89' },
  { key: 'alimentari', coefficient: 0.40,
    name: T.FLAT_RATE_COEFFICIENTS_name_4, ateco: '10-11' },
  { key: 'commercio', coefficient: 0.40,
    name: T.FLAT_RATE_COEFFICIENTS_name_3, ateco: '45 · 46.2-46.9 · 47.1-47.7 · 47.9' },
  { key: 'ambulante_alimentari', coefficient: 0.40,
    name: T.FLAT_RATE_COEFFICIENTS_name_2, ateco: '47.81' },
  { key: 'ristorazione', coefficient: 0.40,
    name: T.FLAT_RATE_COEFFICIENTS_name_1, ateco: '55-56' }
];

export const FLAT_RATE = {
  threshold: 85000,
  rate: 0.15,
  startUpRate: 0.05,
  startUpYears: 5,
  source: T.FLAT_RATE_source_1,
  verifiedOn: '2026-08-21'
};

export const SELF_EMPLOYED_REGIMES = {
  ordinario: {
    name: T.SELF_EMPLOYED_REGIMES_name_1,
    note: T.SELF_EMPLOYED_REGIMES_note_3
  },
  forfettario15: {
    name: T.SELF_EMPLOYED_REGIMES_name_3,
    note: T.SELF_EMPLOYED_REGIMES_note_2
  },
  forfettario5: {
    name: T.SELF_EMPLOYED_REGIMES_name_2,
    note: T.SELF_EMPLOYED_REGIMES_note_1
  }
};

/* Deduction of art. 13, paragraph 5, TUIR: the one for self-employment
   income, lower than the employee one and not cumulable with it. */
export function computeSelfEmployedDeduction(income) {
  if (income <= 0) return 0;
  // Art. 13, paragraph 5-ter TUIR (L. 234/2021, art. 1, paragraph 2): 50 euro more
  // if total income is above 11,000 euro but not above 17,000.
  const surcharge = income > 11000 && income <= 17000 ? 50 : 0;
  if (income <= 5500) return 1265;
  if (income <= 28000) return 500 + 765 * ((28000 - income) / 22500) + surcharge;
  if (income <= 50000) return 500 * ((50000 - income) / 22000);
  return 0;
}

export function computeSelfEmployed(params) {
  const p = {
    year: 2026,
    revenue: 0,
    selfEmployedRegime: 'ordinario',
    coefficient: 0.78,
    costs: 0,
    scheme: 'separata_professionisti',
    flatRateReduction: false,
    region: 'Lombardia',
    municipality: 'F205',
    ...params
  };

  const revenue = Math.max(0, p.revenue);
  const flatRateRegime = p.selfEmployedRegime !== 'ordinario';
  const costs = flatRateRegime ? 0 : Math.min(Math.max(0, p.costs), revenue);

  /* Contribution and tax base: in the flat-rate regime it is revenue times the
     coefficient, in the ordinary regime the actual income. In both cases the
     contributions are computed before deducting themselves. */
  const grossIncome = flatRateRegime ? revenue * p.coefficient : revenue - costs;
  const prev = socialSecurityContributions(grossIncome, p.scheme,
                                       flatRateRegime && p.flatRateReduction, p.year);
  const contributionBase = prev.base;
  const contributions = prev.contributions;

  // Compulsory contributions are deducted from income in both regimes.
  const taxable = Math.max(0, grossIncome - contributions);

  let grossIrpef = 0, deduction = 0, netIrpef = 0, regionalTax = 0, municipalTax = 0, substituteTax = 0;
  let regionalTaxDetail = null;
  const region = REGIONS[p.region] || REGIONS.Lombardia;
  const municipality = MUNICIPALITIES_BY_CODE.get(p.municipality);

  if (flatRateRegime) {
    // The substitute tax really substitutes: no IRPEF, no
    // local surcharges, no deductions. The municipality of residence does
    // not change a thing here, and that is a result, not an oversight.
    const rate = p.selfEmployedRegime === 'forfettario5'
      ? FLAT_RATE.startUpRate : FLAT_RATE.rate;
    substituteTax = taxable * rate;
  } else {
    grossIrpef = computeGrossIrpef(taxable, p.year);
    /* The art. 13, paragraph 5 deduction depends on total income: compulsory
       contributions are deducted FROM total income (art. 10, paragraph 1,
       letter e TUIR), so the deduction is computed before them. */
    deduction = Math.min(computeSelfEmployedDeduction(Math.max(0, grossIncome)), grossIrpef);
    netIrpef = Math.max(0, grossIrpef - deduction);
    // Surcharges only when net IRPEF is due (D.Lgs. 446/1997 art. 50; D.Lgs. 360/1998 art. 1).
    regionalTaxDetail = computeRegionalTax(netIrpef > 0 ? taxable : 0, region, p.year);
    regionalTax = regionalTaxDetail.amount;
    municipalTax = netIrpef > 0 ? computeMunicipalTax(taxable, municipality, p.year) : 0;
  }

  const taxes = netIrpef + regionalTax + municipalTax + substituteTax;

  /* The minimum of the artisans' and traders' schemes is due even at zero
     income: below a certain revenue the year does not break even, it closes at
     a loss. Stopping the net at zero would have hidden exactly the number that
     matters, so the uncovered part is computed and stated, as the employee tab
     already does. */
  const netRaw = revenue - costs - contributions - taxes;
  const netShortfall = Math.max(0, -netRaw);
  const netAnnual = Math.max(0, netRaw);

  // The fair comparison is between the levy and revenue net of costs:
  // it is what really remains of what was earned.
  const baseLoad = revenue - costs;
  const pressure = baseLoad > 0 ? ((contributions + taxes) / baseLoad) * 100 : 0;

  return {
    year: p.year, revenue, costs, selfEmployedRegime: p.selfEmployedRegime,
    regimeName: (SELF_EMPLOYED_REGIMES[p.selfEmployedRegime] || SELF_EMPLOYED_REGIMES.ordinario).name,
    flatRateRegime, coefficient: flatRateRegime ? p.coefficient : null,
    grossIncome, contributionBase, contributions, taxable,
    grossIrpef, deduction, netIrpef, regionalTax, regionalTaxDetail, municipalTax, substituteTax,
    taxes, netAnnual, netShortfall, netMonthly: netAnnual / 12, pressure,
    overThreshold: flatRateRegime && revenue > FLAT_RATE.threshold,
    ceilingReached: grossIncome > prev.scheme.ceiling,
    scheme: p.scheme, schemeName: prev.scheme.name,
    contributionsOnMinimum: prev.onMinimum, schemeMinimum: prev.scheme.minimum || 0,
    schemeForYear: prev.scheme,
    contributionReduction: prev.reduction, schemeFixedShare: prev.fixedShare,
    regionName: region.name,
    municipalityName: municipality ? municipality.name + ' (' + municipality.province + ')' : '—'
  };
}
