import { T } from '../texts/it.js';
import { REGIONAL_RATES_BY_YEAR, MUNICIPALITY_REGISTRY, MUNICIPALITY_RATES_2025, MUNICIPALITY_DIFF_2026, MUNICIPALITIES_RESOLVED_2026 } from '../data/mef-data.js';
import { computeBracketTax } from './national-rules.js';

/* ====================================================================
   READING THE OFFICIAL DATASET
   ==================================================================== */

/* Decode "0.4:15000,0.6:28000,0.7:50000,0.8" into cumulative brackets.
   A value without a cap is the last bracket, open upwards. */
export function decodeRates(spec) {
  if (!spec || spec === '0') return [];
  return spec.split(',').map((piece) => {
    const [a, cap] = piece.split(':');
    return { rate: parseFloat(a) / 100, upTo: cap ? parseFloat(cap) : Infinity };
  });
}

export const MUNICIPALITIES = (() => {
  const registry = MUNICIPALITY_REGISTRY.split('\n');
  const rates = MUNICIPALITY_RATES_2025.split('\n');
  const diff = new Map();
  const resolved = new Set(MUNICIPALITIES_RESOLVED_2026.split(',').filter(Boolean).map(Number));

  MUNICIPALITY_DIFF_2026.split('\n').forEach((row) => {
    if (!row) return;
    const [idx, value] = row.split('=');
    diff.set(parseInt(idx, 10), value);
  });

  return registry.map((row, i) => {
    const [code, name, province] = row.split('|');
    const read = (t) => {
      const [exemption, spec] = (t || '0;0').split(';');
      return { exemption: parseFloat(exemption) || 0, brackets: decodeRates(spec), spec: spec };
    };
    return {
      code, name, province,
      2025: read(rates[i]),
      2026: read(diff.has(i) ? diff.get(i) : rates[i]),
      resolved2026: resolved.has(i)
    };
  });
})();

export const MUNICIPALITIES_BY_CODE = new Map(MUNICIPALITIES.map((c) => [c.code, c]));

export const REGIONAL_YEARS = Object.keys(REGIONAL_RATES_BY_YEAR).map(Number).sort();
export const LATEST_REGIONAL_YEAR = REGIONAL_YEARS[REGIONAL_YEARS.length - 1];
export const decodeRegionalBrackets = (brackets) =>
  brackets.map(([a, cap]) => ({ rate: a / 100, upTo: cap === null ? Infinity : cap }));

/* Every region has one table per tax year: Puglia, Piemonte and
   Emilia-Romagna changed rates between 2025 and 2026. `brackets` stays as a
   shortcut to the latest year. */
export const REGIONS = Object.fromEntries(
  Object.keys(REGIONAL_RATES_BY_YEAR[LATEST_REGIONAL_YEAR]).map((name) => {
    const years = Object.fromEntries(REGIONAL_YEARS.map((year) =>
      [year, decodeRegionalBrackets(REGIONAL_RATES_BY_YEAR[year][name])]));
    return [name, { name, years, brackets: years[LATEST_REGIONAL_YEAR] }];
  })
);

/* Rules the rate table does not tell: the MEF publishes them as
   «Disposizioni particolari» on each region's page. Source: MEF, Dipartimento
   delle Finanze, addregirpef.php?reg=NN&anno=YYYY, read on 2 October 2026.
   Only the income-based ones are here. Deductions for dependent children and
   disability stay out: the calculator does not ask how many dependent
   children there are in total nor about disability, and the page says so
   through `notIncluded`.
   exemptUpTo        no surcharge up to that income
   flatRateUpTo      up to that income, a single rate on the whole amount
   rateOnWhole       the rate of the band applies to the whole amount
   deductions        fixed amount for incomes in the band (over, upTo]
   risingDeduction   amount proportional above a threshold, with a cap
   Deductions do not create a credit: they stop at the tax due. */
export const REGIONAL_TAX_RULES = {
  2025: {
    Bolzano: {
      deductions: [{ over: 0, upTo: 90000, amount: 430.5 }],
      risingDeduction: { over: 50000, width: 25000, amount: 125 },
      notIncluded: T.REGIONAL_TAX_RULES_notIncluded_17
    },
    Campania: { notIncluded: T.REGIONAL_TAX_RULES_notIncluded_16 },
    'Friuli-Venezia Giulia': {
      rateOnWhole: [{ upTo: 15000, rate: 0.007 }, { upTo: Infinity, rate: 0.0123 }]
    },
    Lazio: {
      flatRateUpTo: { upTo: 28000, rate: 0.0173 },
      deductions: [{ over: 28000, upTo: 35000, amount: 60 }]
    },
    Liguria: { notIncluded: T.REGIONAL_TAX_RULES_notIncluded_15 },
    Marche: { notIncluded: T.REGIONAL_TAX_RULES_notIncluded_14 },
    Piemonte: { notIncluded: T.REGIONAL_TAX_RULES_notIncluded_13 },
    Puglia: { notIncluded: T.REGIONAL_TAX_RULES_notIncluded_12 },
    Sardegna: { notIncluded: T.REGIONAL_TAX_RULES_notIncluded_11 },
    Trento: { exemptUpTo: 30000, notIncluded: T.REGIONAL_TAX_RULES_notIncluded_10 },
    Umbria: {
      flatRateUpTo: { upTo: 28000, rate: 0.0123 },
      deductions: [{ over: 28000, upTo: 50000, amount: 150 }]
    },
    "Valle d'Aosta": { exemptUpTo: 15000 },
    Veneto: { notIncluded: T.REGIONAL_TAX_RULES_notIncluded_9 }
  },
  2026: {
    Bolzano: {
      deductions: [{ over: 0, upTo: 90000, amount: 430.5 }],
      risingDeduction: { over: 50000, width: 25000, amount: 125 },
      notIncluded: T.REGIONAL_TAX_RULES_notIncluded_8
    },
    Campania: { notIncluded: T.REGIONAL_TAX_RULES_notIncluded_7 },
    'Friuli-Venezia Giulia': {
      rateOnWhole: [{ upTo: 15000, rate: 0.007 }, { upTo: Infinity, rate: 0.0123 }]
    },
    Lazio: {
      flatRateUpTo: { upTo: 28000, rate: 0.0173 },
      deductions: [{ over: 28000, upTo: 30000, amount: 60 }]
    },
    Marche: { notIncluded: T.REGIONAL_TAX_RULES_notIncluded_6 },
    Piemonte: { notIncluded: T.REGIONAL_TAX_RULES_notIncluded_5 },
    Puglia: { notIncluded: T.REGIONAL_TAX_RULES_notIncluded_4 },
    Sardegna: { notIncluded: T.REGIONAL_TAX_RULES_notIncluded_3 },
    Trento: { exemptUpTo: 30000, notIncluded: T.REGIONAL_TAX_RULES_notIncluded_2 },
    Umbria: {
      flatRateUpTo: { upTo: 28000, rate: 0.0123 },
      deductions: [{ over: 28000, upTo: 50000, amount: 150 }]
    },
    "Valle d'Aosta": { exemptUpTo: 15000 },
    Veneto: { notIncluded: T.REGIONAL_TAX_RULES_notIncluded_1 }
  }
};

/* Regional surcharge for the year, with the particular provisions. It also
   returns the pieces of the calculation, which the explanation shows. */
export function computeRegionalTax(taxable, region, year, totalIncome = taxable) {
  const base = Math.max(0, taxable);
  const brackets = region.years[year];
  if (!brackets) throw new Error(`No regional rates for year ${year}.`);
  const rule = (REGIONAL_TAX_RULES[year] || {})[region.name] || {};
  const empty = { amount: 0, grossTax: 0, deduction: 0, flatRate: null, brackets, rule };

  // The exemption thresholds of the particular provisions look at total
  // income, which is higher than the taxable one when a pension fund is deducted.
  if (rule.exemptUpTo !== undefined && Math.max(0, totalIncome) <= rule.exemptUpTo) return { ...empty, exempt: true };

  let flatRate = null;
  if (rule.flatRateUpTo && base <= rule.flatRateUpTo.upTo) flatRate = rule.flatRateUpTo.rate;
  if (rule.rateOnWhole) flatRate = rule.rateOnWhole.find((f) => base <= f.upTo).rate;

  const grossTax = flatRate !== null ? base * flatRate : computeBracketTax(base, brackets);

  let deduction = 0;
  for (const d of rule.deductions || []) {
    if (base > d.over && base <= d.upTo) deduction += d.amount;
  }
  const c = rule.risingDeduction;
  if (c && base > c.over) deduction += Math.min(c.amount, c.amount * (base - c.over) / c.width);
  deduction = Math.min(deduction, grossTax);

  return { ...empty, amount: grossTax - deduction, grossTax, deduction, flatRate, exempt: false };
}
