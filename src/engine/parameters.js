import { T } from '../texts/it.js';
/* ======================================================================
   EMPLOYEE CALCULATION — parameters
   ----------------------------------------------------------------------
   Every parameter can change: tax year, contribution profile, territory,
   period worked, family dependants, welfare, variable pay and special tax
   regimes.
   
   Sources of the embedded data:
   - Regional and municipal surcharges: MEF, Dipartimento delle Finanze,
   registry of resolutions (all Italian municipalities, 21 regions and
   autonomous provinces).
   - Contribution minimums, ceilings and the 1% additional rate: INPS circulars.
   - IRPEF rates and rules: TUIR, L. 207/2024, 2026 Budget Law.
   ====================================================================== */




/* ------------------------------------------- Parameters by tax year */
export const YEARS = {
  2025: {
    label: '2025',
    irpef: [ { upTo: 28000, rate: 0.23 }, { upTo: 50000, rate: 0.35 }, { upTo: Infinity, rate: 0.43 } ],
    ceiling: 120607,
    threshold1pc: 55448,
    minimumMonthly: 1490.32,
    electronicVoucher: 8,
    paperVoucher: 4,
    bonusRate: 0.05,
    bonusCap: 3000,
    premiumsRelief: false,
    renewalRelief: false,
    pensionFundDeductible: 5164.57,
    notes: T.YEARS_notes_2
  },
  2026: {
    label: '2026',
    irpef: [ { upTo: 28000, rate: 0.23 }, { upTo: 50000, rate: 0.33 }, { upTo: Infinity, rate: 0.43 } ],
    ceiling: 122295,
    threshold1pc: 56224,
    minimumMonthly: 1511.38,
    electronicVoucher: 10,
    paperVoucher: 4,
    bonusRate: 0.01,
    bonusCap: 5000,
    premiumsRelief: true,
    /* L. 199/2025, art. 1, paragraph 7: 5% substitute tax on the 2026 pay
       increases from collective agreements renewed in 2024-2026. */
    renewalRelief: true,
    /* D.Lgs. 252/2005, art. 8, paragraph 4, as amended by L. 199/2025,
       art. 1, paragraph 201: the cap rises to 5,300 euro from tax year 2026. */
    pensionFundDeductible: 5300,
    notes: T.YEARS_notes_1
  }
};

/* The rules of a tax year. A year without rules stops the calculation with a
   clear error: a silent fallback would show plausible but wrong numbers. */
export function yearRules(year) {
  const rules = YEARS[year];
  if (!rules) throw new Error(`No tax rules for year ${year}: add them to YEARS first.`);
  return rules;
}

/* Values shared by both tax years */
export const EMPLOYEE_PARAMS = {
  FRINGE_THRESHOLD: 1000,
  FRINGE_THRESHOLD_WITH_CHILDREN: 2000,
  VOUCHER_DAYS_YEAR: 220,
  BONUS_INCOME_MAX: 80000,
  /* L. 199/2025, art. 1, paragraphs 10 and 11: surcharges and allowances for
     night work, holidays, rest days and shifts, only in 2026, only in the
     private sector, for those who had up to 40,000 euro of employment income in
     2025. Ordinary overtime is not included. */
  PREMIUMS_INCOME_MAX: 40000,
  PREMIUMS_RATE: 0.15,
  PREMIUMS_CAP: 1500,
  /* L. 199/2025, art. 1, paragraph 7: private sector, employment income
     in 2025 up to 33,000 euro. */
  RENEWAL_INCOME_MAX: 33000,
  RENEWAL_RATE: 0.05,
  INBOUND_CAP: 600000,
  INBOUND_TAXED_SHARE: 0.50,
  INBOUND_TAXED_SHARE_CHILDREN: 0.40,
  RESEARCHERS_TAXED_SHARE: 0.10,
  CROSS_BORDER_ALLOWANCE: 10000,
  ADDITIONAL_RATE: 0.01,
  ADDITIONAL_RATE_THRESHOLD: 0.10,
  TFR_DIVISOR: 13.5,
  TFR_FUND_CONTRIBUTION: 0.005,
  EMPLOYER_INAIL: 0.005,
  DAYS_YEAR: 365
};

/* ------------------------------------------------- Contribution rates */
/* The rate is not an attribute of a vague "sector": it comes from three
   things together, as INPS itself states. The company's activity, the
   worker's role and the size of the workforce, because above 15 employees
   the CIGS applies and above 50 the ordinary CIGO increases. Keeping them
   separate avoids a menu of ready-made combinations that would never cover
   the real cases.
   
   Each entry carries the TOTAL and the employee share, as in the INPS tables.
   The employer share is the difference: not an estimate, a subtraction.
   Where the table can be broken down, the single items are listed in `items`
   and their sum must match the total — a test checks it. */

export const ROLES = {
  operaio:     T.ROLES_operaio_1,
  impiegato:   T.ROLES_impiegato_1,
  viaggiatore: T.ROLES_viaggiatore_1,
  dirigente:   T.ROLES_dirigente_1
};

/* Items shared by all industry tables: IVS, NASpI including the 0.30% for
   training, CUAF already net of exemptions, TFR guarantee fund. */
export const V = { ivs: 33.00, naspi: 1.61, cuaf: 0.68, tfr: 0.20,
            sickness: 2.22, maternity: 0.46, maternityTravel: 0.24,
            cigs: 0.90 };

export const industryItems = (cigo, role, withCigs) => {
  // The keys are the labels shown to the user, kept in the texts file.
  const L = T.contributionItems;
  const v = { [L.ivs]: V.ivs, [L.naspi]: V.naspi, [L.cuaf]: V.cuaf, [L.cigo]: cigo };
  if (withCigs) v[L.cigs] = V.cigs;
  v[L.tfr] = V.tfr;
  if (role === 'operaio') v[L.sickness] = V.sickness;
  v[L.maternity] = role === 'viaggiatore' ? V.maternityTravel : V.maternity;
  return v;
};

/* Industry and construction share the structure and differ only in the
   workers' ordinary CIG: 1.70% (2.00% above 50 employees) against 4.70% in
   construction, which never goes down. */
export const industryBracket = (cigoWorkers, cigoOthers, withCigs) => {
  const emp = withCigs ? 0.0949 : 0.0919;   // +0.30% CIGS paid by the employee
  const q = (role, cigo) => {
    const items = industryItems(cigo, role, withCigs);
    const total = Object.values(items).reduce((a, b) => a + b, 0);
    return { total: Math.round(total * 100) / 100, employee: emp, items };
  };
  return {
    operaio:     q('operaio', cigoWorkers),
    impiegato:   q('impiegato', cigoOthers),
    viaggiatore: q('viaggiatore', cigoOthers),
    // Executives cannot be broken down with the same items: the table gives
    // only the total, and the total is what is used.
    /* Previndai from 1/1/2025: 2% paid by the executive, 4% + 2% by the
       company, on pay up to 200,000 euro; the company's 4% is at least 4,800
       euro a year, prorated by twelfths (previndai.it, «Contribuzione», read
       on 2 October 2026). It is a supplementary pension fund: both shares
       fall under the deductibility cap of D.Lgs. 252/2005, art. 8. */
    dirigente:   { total: 36.15, employee: 0.0919,
                   fund: 0.02, employerFund: 0.06, fundCap: 200000,
                   employerFundMinimum: { rate: 0.04, annual: 4800 },
                   fundName: T.industryBracket_fundName_1 }
  };
};

export const CONTRIBUTION_SECTORS = {
  industria: {
    name: T.CONTRIBUTION_SECTORS_name_17,
    source: T.CONTRIBUTION_SECTORS_source_9,
    companySizes: {
      fino15:  { name: T.CONTRIBUTION_SECTORS_name_16,  roles: industryBracket(1.70, 1.70, false) },
      fino50:  { name: T.CONTRIBUTION_SECTORS_name_15, roles: industryBracket(1.70, 1.70, true) },
      oltre50: { name: T.CONTRIBUTION_SECTORS_name_14,   roles: industryBracket(2.00, 2.00, true) }
    }
  },
  edilizia: {
    name: T.CONTRIBUTION_SECTORS_name_23,
    source: T.CONTRIBUTION_SECTORS_source_8,
    note: T.CONTRIBUTION_SECTORS_note_4,
    companySizes: {
      fino15:  { name: T.CONTRIBUTION_SECTORS_name_13,  roles: industryBracket(4.70, 1.70, false) },
      fino50:  { name: T.CONTRIBUTION_SECTORS_name_12, roles: industryBracket(4.70, 1.70, true) },
      oltre50: { name: T.CONTRIBUTION_SECTORS_name_11,   roles: industryBracket(4.70, 2.00, true) }
    }
  },
  artigianato: {
    name: T.CONTRIBUTION_SECTORS_name_22,
    source: T.CONTRIBUTION_SECTORS_source_7,
    note: T.CONTRIBUTION_SECTORS_note_3,
    companySizes: {
      unica: { name: T.CONTRIBUTION_SECTORS_name_21, roles: {
        operaio:     { total: 36.12, employee: 0.0919 },
        impiegato:   { total: 33.90, employee: 0.0919 },
        viaggiatore: { total: 33.68, employee: 0.0919 }
      } }
    }
  },
  commercio: {
    name: T.CONTRIBUTION_SECTORS_name_10,
    source: T.CONTRIBUTION_SECTORS_source_6,
    note: T.CONTRIBUTION_SECTORS_note_2,
    companySizes: {
      fino50:  { name: T.CONTRIBUTION_SECTORS_name_9, roles: {
        operaio:     { total: 38.17, employee: 0.0919 },
        impiegato:   { total: 38.17, employee: 0.0919 },
        viaggiatore: { total: 35.73, employee: 0.0919 },
        dirigente:   { total: 35.73, employee: 0.0919 }
      } },
      oltre50: { name: T.CONTRIBUTION_SECTORS_name_8, roles: {
        operaio:     { total: 39.07, employee: 0.0949 },
        impiegato:   { total: 39.07, employee: 0.0949 },
        viaggiatore: { total: 36.63, employee: 0.0949 },
        dirigente:   { total: 35.73, employee: 0.0919 }
      } }
    }
  },
  commercio_cuaf_ridotta: {
    name: T.CONTRIBUTION_SECTORS_name_7,
    source: T.CONTRIBUTION_SECTORS_source_5,
    note: T.CONTRIBUTION_SECTORS_note_1,
    companySizes: {
      fino50: { name: T.CONTRIBUTION_SECTORS_name_6, roles: {
        operaio:     { total: 36.12, employee: 0.0919 },
        impiegato:   { total: 36.12, employee: 0.0919 },
        viaggiatore: { total: 33.68, employee: 0.0919 },
        dirigente:   { total: 33.74, employee: 0.0919 }
      } }
    }
  },
  pubblici_esercizi: {
    name: T.CONTRIBUTION_SECTORS_name_5,
    source: T.CONTRIBUTION_SECTORS_source_4,
    companySizes: {
      fino50: { name: T.CONTRIBUTION_SECTORS_name_4, roles: {
        operaio:     { total: 36.89, employee: 0.0919 },
        impiegato:   { total: 36.89, employee: 0.0919 },
        viaggiatore: { total: 33.68, employee: 0.0919 },
        dirigente:   { total: 33.68, employee: 0.0919 }
      } }
    }
  },
  logistica: {
    name: T.CONTRIBUTION_SECTORS_name_3,
    source: T.CONTRIBUTION_SECTORS_source_3,
    companySizes: {
      oltre50: { name: T.CONTRIBUTION_SECTORS_name_2, roles: {
        operaio:     { total: 39.37, employee: 0.0949 },
        impiegato:   { total: 39.37, employee: 0.0949 },
        viaggiatore: { total: 36.93, employee: 0.0949 },
        dirigente:   { total: 36.03, employee: 0.0919 }
      } }
    }
  },
  agricoltura: {
    name: T.CONTRIBUTION_SECTORS_name_20,
    estimate: true,
    source: T.CONTRIBUTION_SECTORS_source_2,
    companySizes: {
      unica: { name: T.CONTRIBUTION_SECTORS_name_19, roles: {
        operaio:   { total: 33.84, employee: 0.0884 },
        impiegato: { total: 33.84, employee: 0.0884 }
      } }
    }
  },
  domestico: {
    name: T.CONTRIBUTION_SECTORS_name_1,
    estimate: true,
    source: T.CONTRIBUTION_SECTORS_source_1,
    companySizes: {
      unica: { name: T.CONTRIBUTION_SECTORS_name_18, roles: {
        operaio: { total: 14.40, employee: 0.0240 }
      } }
    }
  }
};

/* The engine keeps working on a single key. The key is the triple, so shared
   links stay stable and the calculation does not need to know how the
   interface builds it. */
export const CONTRIBUTION_PROFILES = {};
for (const [sectorKey, sector] of Object.entries(CONTRIBUTION_SECTORS))
  for (const [sizeKey, size] of Object.entries(sector.companySizes))
    for (const [roleKey, q] of Object.entries(size.roles)) {
      const employer = Math.round((q.total / 100 - q.employee) * 10000) / 10000;
      CONTRIBUTION_PROFILES[`${sectorKey}|${roleKey}|${sizeKey}`] = {
        ...q,
        name: `${sector.name} — ${ROLES[roleKey].split(',')[0].toLowerCase()}`,
        sector: sectorKey, role: roleKey, companySize: sizeKey,
        employee: q.employee, employer, estimate: !!sector.estimate, source: sector.source
      };
    }

/* Links shared before the split still carry the old names: they must be
   translated, not ignored. */
export const LEGACY_PROFILES = {
  terziario_impiegato: 'commercio|impiegato|fino50',
  terziario_quadro:    'commercio|impiegato|fino50',
  industria_impiegato: 'industria|impiegato|fino50',
  industria_operaio:   'industria|operaio|fino50',
  industria_cigs:      'industria|operaio|oltre50',
  edilizia_operaio:    'edilizia|operaio|fino50',
  dirigente:           'industria|dirigente|fino50',
  agricolo_operaio:    'agricoltura|operaio|unica',
  domestico:           'domestico|operaio|unica'
};

export const DEFAULT_PROFILE = 'commercio|impiegato|fino50';

export const normaliseProfile = (key) =>
  CONTRIBUTION_PROFILES[key] ? key
    : (LEGACY_PROFILES[key] || DEFAULT_PROFILE);

/* INPS separate scheme: 2026 rates from circular no. 8/2026. The annual
   ceiling is the same as for employees (122,295 €); the 18,808 € minimum is
   about crediting contributions, not about the calculation. */
export const SEPARATE_SCHEME = {
  collaborators: 0.3503,   // 33.00 IVS + 0.50 + 0.22 + 1.31 DIS-COLL
  professionisti: 0.2607,  // 25.00 IVS + 0.72 + 0.35 ISCRO
  ceiling: 122295,
  source: T.SEPARATE_SCHEME_source_1,
  verifiedOn: '2026-08-21'
};

/* --------------------------------------------- Pension schemes */
/* A VAT number does not pay a single rate. The separate scheme is the fund
   of those who have no fund of their own, and it computes contributions on
   actual income: below a threshold little is paid, at zero income nothing.
   The artisans' and traders' schemes work the other way round: there is a
   MINIMUM income below which contributions are due anyway, and at zero income
   they stay due in full. It is the difference that weighs most on beginners. */
export const PENSION_SCHEMES = {
  separata_professionisti: {
    name: T.PENSION_SCHEMES_name_3,
    rate: 0.2607,
    ceiling: 122295,
    years: { 2025: { ceiling: 120607, source: T.PENSION_SCHEMES_source_6 } },
    source: T.PENSION_SCHEMES_source_5,
    note: T.PENSION_SCHEMES_note_3
  },
  artigiani: {
    name: T.PENSION_SCHEMES_name_2,
    rate: 0.24,
    rateAbove: 0.25,
    bandThreshold: 56224,
    minimum: 18808,
    maternity: 7.44,
    ceiling: 122295,
    flatRateReductionRate: 0.35,
    years: { 2025: { minimum: 18555, bandThreshold: 55448, ceiling: 120607,
                    source: T.PENSION_SCHEMES_source_4 } },
    source: T.PENSION_SCHEMES_source_3,
    note: T.PENSION_SCHEMES_note_2
  },
  commercianti: {
    name: T.PENSION_SCHEMES_name_1,
    rate: 0.2448,
    rateAbove: 0.2548,
    bandThreshold: 56224,
    minimum: 18808,
    maternity: 7.44,
    ceiling: 122295,
    flatRateReductionRate: 0.35,
    years: { 2025: { minimum: 18555, bandThreshold: 55448, ceiling: 120607,
                    source: T.PENSION_SCHEMES_source_2 } },
    source: T.PENSION_SCHEMES_source_1,
    note: T.PENSION_SCHEMES_note_1
  }
};

/* Compute the contributions of the chosen scheme and state why they are what
   they are: the minimum is the reason why at low incomes the contribution
   does not go down, and it must be said, not suffered. */
export function socialSecurityContributions(grossIncome, schemeKey, flatRateReduced, year) {
  const choice = PENSION_SCHEMES[schemeKey] || PENSION_SCHEMES.separata_professionisti;
  // Minimum, band threshold and ceiling change every year: the base values
  // are those of 2026, `years` carries those of earlier years.
  const g = { ...choice, ...((choice.years && choice.years[year]) || {}) };
  const income = Math.max(0, grossIncome);

  if (!g.minimum) {
    const base = Math.min(income, g.ceiling);
    return { scheme: g, base, contributions: base * g.rate,
             onMinimum: false, reduction: 0, fixedShare: 0 };
  }

  const base = Math.min(Math.max(income, g.minimum), g.ceiling);
  const ivs = base <= g.bandThreshold
    ? base * g.rate
    : g.bandThreshold * g.rate + (base - g.bandThreshold) * g.rateAbove;
  const grossAmount = ivs + g.maternity;
  /* The flat-rate reduction hits only the pension contribution. The maternity
     contribution stays due in full: it is a fixed amount covering a benefit,
     not a share of the pension pot. */
  const reduction = flatRateReduced ? ivs * g.flatRateReductionRate : 0;

  return { scheme: g, base, contributions: grossAmount - reduction,
           onMinimum: income < g.minimum, reduction,
           fixedShare: g.minimum * g.rate + g.maternity };
}

/* ------------------------------------------------- Contract types */
/* An axis separate from sector and role: an apprentice can work in services
   as in industry, and a fixed-term contract concerns any role. Keeping them
   separate avoids impossible combinations and above all makes explicit what
   really changes: not only the rates, but in one case the very nature of the
   income. */
export const CONTRACT_TYPES = {
  indeterminato: {
    name: T.CONTRACT_TYPES_name_5,
    note: T.CONTRACT_TYPES_note_5
  },
  determinato: {
    name: T.CONTRACT_TYPES_name_4,
    employerSurcharge: 0.014,
    /* Raises the floor of the art. 13 deduction from 690 to 1,380 €: it only
       matters for contracts that do not cover the whole year, where prorating to
       the days would take the deduction below that value. */
    fixedTerm: true,
    note: T.CONTRACT_TYPES_note_4
  },
  apprendistato: {
    name: T.CONTRACT_TYPES_name_3,
    employee: 0.0584,
    employer: 0.1161,
    note: T.CONTRACT_TYPES_note_3
  },
  collaboratore: {
    name: T.CONTRACT_TYPES_name_1,
    /* Not a sector rate but the separate scheme: 35.03% in total (33% IVS + 0.50
       + 0.22 + 1.31 DIS-COLL), one third paid by the collaborator and two thirds by
       the client. The ceiling is not an option as for employees: it is the rule. */
    separateScheme: true,
    employee: SEPARATE_SCHEME.collaborators / 3,
    employer: SEPARATE_SCHEME.collaborators * 2 / 3,
    ceilingMandatory: true,
    withoutTfr: true,
    withoutWedge: true,
    fixedMonthlyPayments: 12,
    note: T.CONTRACT_TYPES_note_2
  },
  tirocinio: {
    name: T.CONTRACT_TYPES_name_2,
    assimilated: true,
    note: T.CONTRACT_TYPES_note_1
  }
};

/* --------------------------------------------------- Special tax regimes */
export const TAX_REGIMES = {
  nessuno:     { name: T.TAX_REGIMES_name_2 },
  impatriati:  { name: T.TAX_REGIMES_name_4 },
  ricercatori: { name: T.TAX_REGIMES_name_1 },
  frontalieri: { name: T.TAX_REGIMES_name_3 }
};
