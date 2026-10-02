import { T } from '../texts/it.js';
import { CONTRIBUTION_PROFILES, normaliseProfile } from './parameters.js';

/* ====================================================================
   HIRING CONTRIBUTION EXEMPTIONS
   ----------------------------------------------------------------------
   Unlike the territorial rates, these are not a dataset: they come from
   laws that change their structure, not only their amounts. Every entry
   therefore carries its own validity window, its source and the date it
   was verified. The engine compares the window with today's date and turns
   off by itself whatever has expired: it is the only automation really
   possible here, and it avoids the worst way of being wrong, that is
   applying an exemption that no longer exists.
   ==================================================================== */

// Region names as keys of REGIONS: they are data, not interface texts.
export const SOUTHERN_REGIONS = ['Abruzzo', 'Molise', 'Campania', 'Basilicata',
                                 'Sicilia', 'Puglia', 'Calabria', 'Sardegna'];

export const HIRING_EXEMPTIONS = {
  sud_pmi: {
    name: T.HIRING_EXEMPTIONS_name_7,
    affects: 'employer',
    description: T.HIRING_EXEMPTIONS_description_7,
    shares: { 2025: { percentage: 0.25, monthlyCap: 145 },
             2026: { percentage: 0.20, monthlyCap: 125 } },
    windowFrom: '2025-01-01',
    windowTo: '2029-12-31',
    regions: SOUTHERN_REGIONS,
    excludedContracts: ['apprendistato', 'tirocinio', 'collaboratore'],
    excludedSectors: ['domestico', 'agricoltura'],
    conditions: T.HIRING_EXEMPTIONS_conditions_7,
    source: T.HIRING_EXEMPTIONS_source_7,
    verifiedOn: '2026-08-21'
  },

  donne: {
    name: T.HIRING_EXEMPTIONS_name_6,
    affects: 'employer',
    description: T.HIRING_EXEMPTIONS_description_6,
    shares: { 2025: { percentage: 1, monthlyCap: 650 },
             2026: { percentage: 1, monthlyCap: 650 } },
    windowFrom: '2024-09-01',
    windowTo: '2026-12-31',
    months: 24,
    excludedContracts: ['apprendistato', 'tirocinio', 'determinato', 'collaboratore'],
    excludedSectors: ['domestico'],
    conditions: T.HIRING_EXEMPTIONS_conditions_6,
    source: T.HIRING_EXEMPTIONS_source_1,
    verifiedOn: '2026-08-21'
  },

  giovani: {
    name: T.HIRING_EXEMPTIONS_name_5,
    affects: 'employer',
    description: T.HIRING_EXEMPTIONS_description_5,
    shares: { 2025: { percentage: 1, monthlyCap: 500 },
             2026: { percentage: 1, monthlyCap: 500 } },
    windowFrom: '2024-09-01',
    windowTo: '2026-04-30',
    months: 24,
    excludedContracts: ['apprendistato', 'tirocinio', 'determinato', 'collaboratore'],
    excludedSectors: ['domestico'],
    conditions: T.HIRING_EXEMPTIONS_conditions_5,
    source: T.HIRING_EXEMPTIONS_source_6,
    verifiedOn: '2026-08-21'
  },

  stabilizzazione: {
    name: T.HIRING_EXEMPTIONS_name_3,
    affects: 'employer',
    description: T.HIRING_EXEMPTIONS_description_4,
    shares: { 2026: { percentage: 1, monthlyCap: 500 } },
    windowFrom: '2026-08-01',
    windowTo: '2026-12-31',
    months: 24,
    excludedContracts: ['apprendistato', 'tirocinio', 'determinato', 'collaboratore'],
    excludedSectors: ['domestico'],
    excludedRoles: ['dirigente'],
    conditions: T.HIRING_EXEMPTIONS_conditions_4,
    source: T.HIRING_EXEMPTIONS_source_5,
    verifiedOn: '2026-08-21'
  },

  zes: {
    name: T.HIRING_EXEMPTIONS_name_4,
    affects: 'employer',
    description: T.HIRING_EXEMPTIONS_description_3,
    shares: { 2025: { percentage: 1, monthlyCap: 650 },
             2026: { percentage: 1, monthlyCap: 650 } },
    windowFrom: '2024-09-01',
    windowTo: '2026-04-30',
    months: 24,
    regions: SOUTHERN_REGIONS,
    excludedContracts: ['apprendistato', 'tirocinio', 'determinato', 'collaboratore'],
    excludedSectors: ['domestico'],
    excludedRoles: ['dirigente'],
    conditions: T.HIRING_EXEMPTIONS_conditions_3,
    source: T.HIRING_EXEMPTIONS_source_4,
    verifiedOn: '2026-08-21'
  },

  assunzione_madri: {
    name: T.HIRING_EXEMPTIONS_name_2,
    affects: 'employer',
    description: T.HIRING_EXEMPTIONS_description_2,
    shares: { 2026: { percentage: 1, annualCap: 8000 } },
    windowFrom: '2026-01-01',
    windowTo: '2026-12-31',
    excludedContracts: ['apprendistato', 'tirocinio', 'determinato', 'collaboratore'],
    excludedSectors: ['domestico'],
    excludedRoles: ['dirigente'],
    conditions: T.HIRING_EXEMPTIONS_conditions_2,
    source: T.HIRING_EXEMPTIONS_source_3,
    verifiedOn: '2026-08-21'
  },

  madri_tre_figli: {
    name: T.HIRING_EXEMPTIONS_name_1,
    affects: 'employee',
    description: T.HIRING_EXEMPTIONS_description_1,
    shares: { 2025: { percentage: 1, annualCap: 3000 },
             2026: { percentage: 1, annualCap: 3000 } },
    windowFrom: '2024-01-01',
    windowTo: '2026-12-31',
    excludedContracts: ['tirocinio', 'determinato', 'collaboratore'],
    excludedSectors: ['domestico'],
    conditions: T.HIRING_EXEMPTIONS_conditions_1,
    source: T.HIRING_EXEMPTIONS_source_2,
    verifiedOn: '2026-08-21'
  }
};

/* An exemption applies only if today's date falls inside its validity
   window and the contract, the profile and the territory meet the
   conditions. */
export function exemptionStatus(key, params, today) {
  const e = HIRING_EXEMPTIONS[key];
  if (!e) return { applicable: false, reason: T.exemptionStatus_reason_8 };

  // Accept a Date or an ISO string: comparing a string with a Date is always false.
  const now = today ? new Date(today) : new Date();
  const start = new Date(e.windowFrom);
  const end = new Date(e.windowTo + 'T23:59:59');

  if (now < start) return { hiringExemption: e, applicable: false, expired: false,
                                reason: T.exemptionStatus_reason_7(formatDate(e.windowFrom)) };
  if (now > end) return { hiringExemption: e, applicable: false, expired: true,
                              reason: T.exemptionStatus_reason_6(formatDate(e.windowTo)) };

  if (e.excludedContracts && e.excludedContracts.includes(params.contractType))
    return { hiringExemption: e, applicable: false, reason: T.exemptionStatus_reason_5 };

  /* The exclusion looks at the sector and the role, not at the profile key.
     The key is composite (`sector|role|size`) and comparing it with a flat
     name such as 'dirigente' never matched: exemptions that the law denies to
     executives and domestic work were applied anyway. The key is normalised
     and the two axes are read separately. */
  const profile = CONTRIBUTION_PROFILES[normaliseProfile(params.profile)];
  if (profile && e.excludedSectors && e.excludedSectors.includes(profile.sector))
    return { hiringExemption: e, applicable: false, reason: T.exemptionStatus_reason_4 };
  if (profile && e.excludedRoles && e.excludedRoles.includes(profile.role))
    return { hiringExemption: e, applicable: false, reason: T.exemptionStatus_reason_3 };

  if (e.regions && !e.regions.includes(params.region))
    return { hiringExemption: e, applicable: false, reason: T.exemptionStatus_reason_2 };

  const share = e.shares[params.year];
  if (!share) return { hiringExemption: e, applicable: false, reason: T.exemptionStatus_reason_1(params.year) };

  return { hiringExemption: e, applicable: true, share };
}

export function formatDate(iso) {
  return new Date(iso).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });
}

/* The Southern relief cannot be combined with the bonuses of the Cohesion
   decree: it is a rule of law, not an interface choice. */
export const INCOMPATIBLE_EXEMPTIONS = [['sud_pmi', 'donne'], ['sud_pmi', 'giovani'], ['sud_pmi', 'zes'],
                               ['donne', 'giovani'], ['donne', 'zes'], ['giovani', 'zes'],
                               /* Circular 72/2026 rules out combining it with any other exemption or
                                  reduction of the employer's rates. Only the mothers' exemption stays off
                                  the list, because it acts on the employee's share and not on the
                                  employer's rates. */
                               ['stabilizzazione', 'sud_pmi'], ['stabilizzazione', 'donne'],
                               ['stabilizzazione', 'giovani'], ['stabilizzazione', 'zes'],
                               ['stabilizzazione', 'assunzione_madri']];

export function exemptionsInConflict(chosenList) {
  for (const [a, b] of INCOMPATIBLE_EXEMPTIONS) {
    if (chosenList.includes(a) && chosenList.includes(b)) return [a, b];
  }
  return null;
}
