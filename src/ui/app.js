import { T } from '../texts/it.js';
import {
  CONSTANTS,
  CONTRACT_TYPES,
  CONTRIBUTION_PROFILES,
  CONTRIBUTION_SECTORS,
  DEFAULT_PROFILE,
  EMPLOYEE_PARAMS,
  ENGINE_VERSION,
  FLAT_RATE,
  FLAT_RATE_COEFFICIENTS,
  HIRING_EXEMPTIONS,
  MUNICIPALITIES,
  MUNICIPALITIES_BY_CODE,
  PENSION_SCHEMES,
  PROVINCE_REGION,
  REGIONAL_TAX_RULES,
  REGIONS,
  ROLES,
  SELF_EMPLOYED_REGIMES,
  TAX_REGIMES,
  YEARS,
  computeEmployee,
  computeGrossIrpef,
  computeSelfEmployed,
  exemptCaps,
  exemptionStatus,
  exemptionsInConflict,
  foregoneAnalysis,
  formatDate,
  invertNet,
  normaliseProfile,
  optimisedPackages,
  thresholdOpportunity,
  toolEfficiency,
  bandCorrection,
  employmentDeductionBand,
  RULES_VERIFIED_ON
} from '../engine/index.js';
import { escapeHtml, euro, euro2, fmtPct, fmtPct2, pct, ratePct } from './format.js';
import {
  DATASET_UPDATED,
  REGIONAL_RATES_BY_YEAR,
  MUNICIPALITY_REGISTRY,
  MUNICIPALITY_RATES_2025,
  MUNICIPALITY_DIFF_2026
} from '../data/mef-data.js';

const el = (id) => document.getElementById(id);

/* Announcement for those who do not look at the screen: a whole sentence once
   the calculation stops, not the sequence of intermediate values. */
let announceTimer = null;
function announce(text) {
  clearTimeout(announceTimer);
  announceTimer = setTimeout(() => { el('announcer').textContent = text; }, 700);
}

/* ====================================================================
   CONTEXTUAL EXPLANATIONS
   ----------------------------------------------------------------------
   Every item that hides a rule carries an explanation with the derivation
   on the numbers of the current calculation, not a generic help text. The
   registry is rebuilt at every render.
   ==================================================================== */

const EXPLANATIONS = new Map();
let explanationSpace = 'b';
let explanationCounter = 0;

/* The two panels redraw independently: each one clears only its own
   entries, otherwise a render would invalidate the other panel's buttons. */
function openExplanationRegistry(space) {
  for (const key of EXPLANATIONS.keys()) {
    if (key.startsWith(space + '-')) EXPLANATIONS.delete(key);
  }
  explanationSpace = space;
  explanationCounter = 0;
}

function registerExplanation(explanation) {
  const key = explanationSpace + '-' + (++explanationCounter);
  EXPLANATIONS.set(key, explanation);
  return key;
}

/* Info button: works with click, keyboard and touch, not only on hover,
   otherwise it would be unreachable on mobile. */
function explanationButton(explanation) {
  if (!explanation) return '';
  const key = registerExplanation(explanation);
  return ` <button type="button" class="explain no-print" data-explain="${key}"
      aria-label="${T.explanationButtonLabel(explanation.title.replace(/"/g, ''))}"
      aria-expanded="false">i</button>`;
}

/* Formula row: operation on the left, result on the right */
function formula(steps, result) {
  return `<div class="exp-formula">
      ${steps.map((p) => `<div class="exp-step"><span>${p[0]}</span><span class="num">${p[1]}</span></div>`).join('')}
      ${result ? `<div class="exp-step exp-total"><span>${result[0]}</span><span class="num">${result[1]}</span></div>` : ''}
    </div>`;
}

function cascadeRow(item, note, annual, monthlyPayments, opts = {}) {
  const type = opts.type || 'neutral';
  const color = type === 'negative' ? 'text-rose-700'
               : type === 'positive' ? 'text-emerald-700'
               : 'text-slate-900';
  // A zero value carries no sign: "− 0,00 €" would be visual noise
  const nullo = Math.abs(annual) < 0.005;
  const sign = nullo ? '' : type === 'negative' ? '− ' : type === 'positive' ? '+ ' : '';
  const weight = opts.strong ? 'font-bold' : 'font-semibold';
  const background = opts.highlight ? 'bg-slate-50' : '';
  const indent = opts.indent ? 'pl-10' : 'px-6';

  return `
    <tr class="${background}">
      <td class="${indent} py-3 ${opts.indent ? 'pr-6' : ''}">
        <span class="${opts.strong ? 'font-bold text-slate-900' : 'font-medium text-slate-700'}">${item}</span>${explanationButton(opts.explain)}
        ${note ? `<span class="block text-xs text-slate-600 mt-0.5">${note}</span>` : ''}
      </td>
      <td class="num px-4 py-3 text-right ${weight} ${color}">${sign}${euro2(Math.abs(annual))}</td>
      <td class="num px-6 py-3 text-right text-slate-600">${sign}${euro2(Math.abs(annual) / monthlyPayments)}</td>
    </tr>`;
}

/* ====================================================================
   RENDER — EMPLOYEE TAB
   ==================================================================== */

let currentYear = 2026;
let currentMunicipality = 'F205';
// True once the user picks a municipality: until then Milan is just the default.
let municipalityChosen = false;

function renderEmployee(r) {
  const M = r.monthlyPayments;
  openExplanationRegistry('p');
  const S = employeeExplanations(r);

  el('emp-out-net-month').textContent = euro(r.netMonthly);
  updateNetBar('employee', r.netMonthly, r.netAnnual);
  announce(T.renderEmployee_67(euro(r.netMonthly), euro(r.netAnnual)));
  el('emp-out-net-year').textContent = euro(r.netAnnual);
  el('emp-out-pressure').textContent = pct(r.taxPressure);
  el('emp-out-payments-label').textContent = T.renderEmployee_66(M);
  el('emp-out-value').textContent = euro(r.totalValue);
  /* Adding euro in the payslip and euro of welfare gives a single number, but
     the two halves are not spent the same way. The card shows the proportion
     instead of leaving it to be guessed. */
  const payShare = r.totalValue > 0 ? r.netAnnual / r.totalValue : 1;
  el('emp-out-value-bar').classList.toggle('hidden', r.welfareExempt <= 0);
  el('emp-out-value-bar').innerHTML = r.welfareExempt > 0
    ? `<div class="bg-slate-800" style="width:${(payShare * 100).toFixed(1)}%"></div>
       <div class="bg-amber-400" style="width:${((1 - payShare) * 100).toFixed(1)}%"></div>`
    : '';
  el('emp-out-value-note').className = r.welfareExempt > 0
    ? 'text-[11px] text-amber-700 mt-1' : 'text-[11px] text-slate-600 mt-1';
  el('emp-out-value-note').textContent = r.welfareExempt > 0
    ? T.renderEmployee_65(euro(r.welfareExempt))
    : T.renderEmployee_64;
  el('emp-out-tfr').textContent = euro(r.tfr);
  el('emp-out-tfr-where').textContent = r.assimilated
    ? T.renderEmployee_63
    : (r.tfrToFund ? T.renderEmployee_62 : T.renderEmployee_61);
  el('emp-out-cost').textContent = euro(r.employerCost);
  el('emp-out-efficiency').textContent = r.efficiency > 0 ? pct(r.efficiency) : '—';

  el('tip-emp-out-pressure').innerHTML = explanationButton({
    title: T.renderEmployee_title_3,
    body: T.renderEmployee_body_3,
    html: formula([
      [T.renderEmployee_html_11, euro2(r.referenceGross)],
      [T.renderEmployee_html_10, euro2(r.netBeforeDeductions)]
    ], [T.renderEmployee_html_9, pct(r.taxPressure)])
  });
  el('tip-value').innerHTML = explanationButton({
    title: T.renderEmployee_title_2,
    body: T.renderEmployee_body_2,
    html: formula([
      [T.renderEmployee_html_8, euro2(r.netAnnual)],
      [T.renderEmployee_html_7, euro2(r.welfareExempt)]
    ], [T.renderEmployee_html_14, euro2(r.totalValue)])
  });

  el('tip-cost').innerHTML = explanationButton({
    title: T.renderEmployee_title_1,
    body: T.renderEmployee_body_1,
    source: T.renderEmployee_source_1,
    html: formula([
      [T.renderEmployee_html_6, euro2(r.salary + r.bonusSubstitute + r.bonusOrdinary + r.premiumsRelieved + r.premiumsOrdinary)],
      [r.contractType === 'determinato'
        ? T.renderEmployee_html_5(ratePct(r.profile.employer))
        : T.renderEmployee_html_4(ratePct(r.profile.employer)), euro2(r.employerContributionsGross)],
      ...(r.employerExemption > 0 ? [[T.renderEmployee_html_3, '− ' + euro2(r.employerExemption)]] : []),
      [T.renderEmployee_html_13, euro2(r.inail)],
      [T.renderEmployee_html_12, euro2(r.tfr)],
      [T.renderEmployee_html_2, euro2(r.fringeExempt + r.fringeTaxable + r.vouchersTotal)]
    ], [T.renderEmployee_html_1, euro2(r.employerCost)])
  });
  el('emp-out-subtitle').textContent =
    T.renderEmployee_60(r.contractName, r.profileName, r.municipalityName, r.regionName, r.year) +
    (r.days < 365 ? T.renderEmployee_59(r.days) : '') +
    (r.partTimeShare < 1 ? T.renderEmployee_93(Math.round(r.partTimeShare * 100)) : '');

  renderWarnings(r);

  let html = '';
  html += cascadeRow(T.renderEmployee_92, T.renderEmployee_58, r.contractSalary, M, { strong: true, highlight: true });

  if (Math.abs(r.salary - r.contractSalary) > 0.005) {
    const cause = [];
    if (r.partTimeShare < 1) cause.push(T.renderEmployee_91(Math.round(r.partTimeShare * 100)));
    if (r.days < 365) cause.push(T.renderEmployee_57(r.days));
    html += cascadeRow(T.renderEmployee_90, cause.join(' · '), r.salary, M, { strong: true, highlight: true, explain: S.accrued });
  }

  if (r.bonusSubstitute > 0) html += cascadeRow(T.renderEmployee_56, T.renderEmployee_55(fmtPct.format(YEARS[r.year].bonusRate * 100)), r.bonusSubstitute, M, { type: 'neutral', indent: true, explain: S.perfBonus });
  if (r.bonusOrdinary > 0) html += cascadeRow(T.renderEmployee_54, T.renderEmployee_89, r.bonusOrdinary, M, { type: 'neutral', indent: true });
  if (r.premiumsRelieved > 0) html += cascadeRow(T.renderEmployee_88, T.renderEmployee_53(fmtPct.format(EMPLOYEE_PARAMS.PREMIUMS_RATE * 100), euro(EMPLOYEE_PARAMS.PREMIUMS_CAP)), r.premiumsRelieved, M, { type: 'neutral', indent: true, explain: S.premiums });
  if (r.premiumsOrdinary > 0) html += cascadeRow(T.renderEmployee_52, T.renderEmployee_51, r.premiumsOrdinary, M, { type: 'neutral', indent: true });
  if (r.renewalRelieved > 0) html += cascadeRow(T.renewalRowLabel, T.renewalRowNote(fmtPct.format(EMPLOYEE_PARAMS.RENEWAL_RATE * 100)), r.renewalRelieved, M, { type: 'neutral', indent: true, explain: S.renewal });
  if (r.fringeTaxable > 0) html += cascadeRow(T.renderEmployee_87, T.renderEmployee_50, r.fringeTaxable, M, { type: 'neutral', indent: true, explain: S.fringe });
  if (r.vouchersExcess > 0) html += cascadeRow(T.renderEmployee_86, T.renderEmployee_49, r.vouchersExcess, M, { type: 'neutral', indent: true });

  if (r.assimilated) {
    html += cascadeRow(T.renderEmployee_48, T.renderEmployee_47, 0, M, { type: 'negative' });
  } else {
    html += cascadeRow(T.renderEmployee_46, T.renderEmployee_45(ratePct(r.profile.employee)), r.ordinaryContributions, M, { type: 'negative', explain: S.contributions });
  }
  if (r.additionalContribution > 0) html += cascadeRow(T.renderEmployee_44, T.renderEmployee_43(euro(YEARS[r.year].threshold1pc * r.yearShare)), r.additionalContribution, M, { type: 'negative', indent: true, explain: S.additional });
  if (r.fundContribution > 0) html += cascadeRow(T.renderEmployee_68(r.profile.fundName || T.renderEmployee_42), T.renderEmployee_41, r.fundContribution, M, { type: 'negative', indent: true });

  html += cascadeRow(T.renderEmployee_40, T.renderEmployee_39, r.taxableGross, M, { strong: true, highlight: true });

  if (r.regimeExempt > 0) html += cascadeRow(T.renderEmployee_85(r.regimeName), T.renderEmployee_38, r.regimeExempt, M, { type: 'positive', indent: true, explain: S.regime });
  if (r.pensionFundDeductible > 0) html += cascadeRow(T.renderEmployee_84, T.renderEmployee_37(euro2(r.pensionCap)), r.pensionFundDeductible, M, { type: 'positive', indent: true, explain: S.fund });
  if (r.employerFundExcess > 0) html += cascadeRow(T.renderEmployee_36, T.renderEmployee_35, r.employerFundExcess, M, { type: 'neutral', indent: true });
  if (r.regimeExempt > 0 || r.pensionFundDeductible > 0) html += cascadeRow(T.renderEmployee_83, T.renderEmployee_82, r.taxable, M, { strong: true, highlight: true });

  html += cascadeRow(T.renderEmployee_81, bracketsDescription(r.year), r.grossIrpef, M, { type: 'negative', explain: S.grossIrpef });
  html += cascadeRow(T.renderEmployee_34, T.renderEmployee_80 + (r.yearShare < 1 ? T.renderEmployee_33 : ''), r.employmentDeduction, M, { type: 'positive', indent: true, explain: S.deductions });

  if (r.extraDeduction > 0) html += cascadeRow(T.renderEmployee_32, T.renderEmployee_31, r.extraDeduction, M, { type: 'positive', indent: true, explain: S.extra });
  if (r.deductionSpouse > 0) html += cascadeRow(T.renderEmployee_30, T.renderEmployee_79, r.deductionSpouse, M, { type: 'positive', indent: true });
  if (r.deductionChildren > 0) html += cascadeRow(T.renderEmployee_29, T.renderEmployee_78, r.deductionChildren, M, { type: 'positive', indent: true });
  if (r.deductionOthers > 0) html += cascadeRow(T.renderEmployee_28, T.renderEmployee_77, r.deductionOthers, M, { type: 'positive', indent: true });
  if (r.deductionUnused > 0.005) html += cascadeRow(T.renderEmployee_27, T.renderEmployee_26, r.deductionUnused, M, { type: 'neutral', indent: true, explain: S.capacity });

  html += cascadeRow(T.renderEmployee_76, T.renderEmployee_25, r.netIrpef, M, { type: 'negative', strong: true, highlight: true });
  html += cascadeRow(T.renderEmployee_75(r.regionName), T.renderEmployee_24, r.regionalTax, M, { type: 'negative', explain: S.regionalTax });
  html += cascadeRow(
    T.renderEmployee_74(r.municipalityName),
    r.municipalTax > 0
      ? T.renderEmployee_73
      : (r.municipalityExemption > 0 ? T.renderEmployee_23(euro(r.municipalityExemption)) : T.renderEmployee_22),
    r.municipalTax, M, { type: 'negative', explain: S.municipalTax }
  );

  if (r.bonusTax > 0) html += cascadeRow(T.renderEmployee_21, T.renderEmployee_20(fmtPct.format(YEARS[r.year].bonusRate * 100)), r.bonusTax, M, { type: 'negative' });
  if (r.premiumsTax > 0) html += cascadeRow(T.renderEmployee_19, T.renderEmployee_18(fmtPct.format(EMPLOYEE_PARAMS.PREMIUMS_RATE * 100)), r.premiumsTax, M, { type: 'negative' });
  if (r.renewalTax > 0) html += cascadeRow(T.renewalTaxLabel, T.renderEmployee_18(fmtPct.format(EMPLOYEE_PARAMS.RENEWAL_RATE * 100)), r.renewalTax, M, { type: 'negative', explain: S.renewal });
  if (r.employeePayment > 0) html += cascadeRow(T.renderEmployee_17, r.employeeFundNotDeducted > 0
      ? T.renderEmployee_16(euro(r.employeeFundNotDeducted))
      : T.renderEmployee_15, r.employeePayment, M, { type: 'negative', explain: S.fund });
  if (r.employeeExemption > 0) html += cascadeRow(T.renderEmployee_14,
      T.renderEmployee_13, r.employeeExemption, M,
      { type: 'positive', explain: S.hiringExemption });
  if (r.employerFundContribution > 0) html += cascadeRow(T.renderEmployee_12, T.renderEmployee_11, r.employerFundContribution, M, { type: 'neutral' });
  if (r.wedgeBonus > 0) html += cascadeRow(T.renderEmployee_72, T.renderEmployee_10, r.wedgeBonus, M, { type: 'positive', explain: S.wedge });
  if (r.integrativeTreatment > 0) html += cascadeRow(T.renderEmployee_71, T.renderEmployee_9, r.integrativeTreatment, M, { type: 'positive', explain: S.treatment });

  if (r.otherDeductions > 0) {
    html += cascadeRow(T.renderEmployee_8, T.renderEmployee_7,
                        r.otherDeductions, M, { type: 'negative', explain: S.deductionsOther });
  }

  html += T.renderEmployee_6(M, euro2(r.netAnnual), euro2(r.netMonthly));

  if (r.welfareExempt > 0) {
    if (r.fringeExempt > 0) html += cascadeRow(T.renderEmployee_70, T.renderEmployee_5, r.fringeExempt, M, { type: 'positive' });
    if (r.vouchersExempt > 0) html += cascadeRow(T.renderEmployee_69, T.renderEmployee_4(euro((r.electronicVouchers === false ? YEARS[r.year].paperVoucher : YEARS[r.year].electronicVoucher))), r.vouchersExempt, M, { type: 'positive' });
    if (r.bonusWelfare > 0) html += cascadeRow(T.renderEmployee_3, T.renderEmployee_2, r.bonusWelfare, M, { type: 'positive' });
    html += T.renderEmployee_1(euro(r.welfareExempt), euro2(r.totalValue), euro2(r.totalValue / M));
  }

  el('tbody-employee').innerHTML = html;
  renderEmployeeComposition(r);
  if (chartView === 'curve') renderChart(r);
}

/* Breakdown of the gross for any scenario. The base is not the gross salary
   but everything that goes through the payslip: pay, bonuses, shift premiums
   and the two bonuses, which are extra money and not a piece of the salary.
   The identity is exact — the items add up to the gross with no rounding of
   convenience — because they are the items of the calculation, not a
   graphical approximation. */
function renderEmployeeComposition(r) {
  const items = [
    { label: T.items_label_6, value: Math.max(0, r.netAnnual), color: 'bg-brand-600', text: 'text-brand-700' },
    { label: T.items_label_5, value: r.inps, color: 'bg-slate-400', text: 'text-slate-600' },
    { label: T.items_label_7, value: r.netIrpef, color: 'bg-rose-500', text: 'text-rose-700' },
    { label: T.items_label_4, value: r.regionalTax + r.municipalTax, color: 'bg-amber-500', text: 'text-amber-700' },
    { label: T.items_label_3, value: r.bonusTax + r.premiumsTax + r.renewalTax, color: 'bg-rose-300', text: 'text-rose-500' },
    { label: T.items_label_2, value: r.employeePayment, color: 'bg-indigo-400', text: 'text-indigo-600' },
    { label: T.items_label_1, value: r.otherDeductions, color: 'bg-slate-700', text: 'text-slate-700' }
  ];

  const total = items.reduce((acc, v) => acc + v.value, 0) || 1;
  const present = items.filter((v) => v.value > 0.005);

  el('emp-out-bar-composition').innerHTML = present
    .map((v) => `<div class="${v.color}" style="width:${(v.value / total) * 100}%" title="${v.label}"></div>`)
    .join('');

  el('emp-out-legend-composition').innerHTML = present.map((v) => `
    <li class="flex items-center justify-between gap-3">
      <span class="flex items-center gap-2">
        <span class="h-2.5 w-2.5 rounded-sm ${v.color} shrink-0"></span>
        <span class="text-slate-600">${v.label}</span>
      </span>
      <span class="num font-semibold ${v.text} whitespace-nowrap">${euro(v.value)}
        <span class="text-slate-600 font-normal ml-1">${fmtPct.format((v.value / total) * 100)}%</span>
      </span>
    </li>`).join('');

  /* Two things are not in the bar and must be said, not hidden: the bonuses
     are money coming in and swell the total, welfare does not even go through
     the payslip. */
  const bonus = r.wedgeBonus + r.integrativeTreatment;
  const notes = [T.notes_1(euro(total))];
  if (bonus > 0.005) notes.push(T.renderEmployeeComposition_2(euro(bonus)));
  if (r.welfareExempt > 0.005) notes.push(T.renderEmployeeComposition_1(euro(r.welfareExempt)));
  el('emp-out-composition-note').textContent = notes.join('. ') + '.';
}

function bracketsDescription(year) {
  return YEARS[year].irpef.map((s) => fmtPct.format(s.rate * 100) + '%').join(' / ');
}

/* Derivations of the employee tab, computed on the current values */
/* Steps of the employment deduction on a contract shorter than the year:
   the banded part is prorated to the days, the legal floor can lift it, the
   band correction is added in full. The steps add up to the amount shown. */
function employmentDeductionSteps(r) {
  const correction = bandCorrection(r.totalIncome);
  const prorated = employmentDeductionBand(r.totalIncome) * r.yearShare;
  const banded = r.employmentDeduction - correction;
  const steps = [[T.deductionAnnualBand, euro2(employmentDeductionBand(r.totalIncome))],
                 [T.employeeExplanations_html_23, `${r.days} / 365`]];
  if (banded > prorated + 0.005) steps.push([T.deductionFloorApplied, euro2(banded)]);
  if (correction > 0) steps.push([T.deductionBandCorrection, euro2(correction)]);
  return steps;
}

function employeeExplanations(r) {
  const A = YEARS[r.year];
  const otherYear = r.year === 2026 ? 2025 : 2026;

  const irpefSteps = [];
  let previous = 0;
  for (const s of A.irpef) {
    if (r.taxable <= previous) break;
    const share = Math.min(r.taxable, s.upTo) - previous;
    irpefSteps.push([`${euro2(share)} × ${fmtPct.format(s.rate * 100)}%`, euro2(share * s.rate)]);
    previous = s.upTo;
  }

  const regionalDetail = r.regionalTaxDetail;
  const regionalSteps = [];
  if (regionalDetail && regionalDetail.exempt) {
    regionalSteps.push([T.employeeExplanations_3(euro(regionalDetail.rule.exemptUpTo)), euro2(0)]);
  } else if (regionalDetail && regionalDetail.flatRate !== null) {
    regionalSteps.push([T.employeeExplanations_2(euro2(r.taxable), fmtPct2.format(regionalDetail.flatRate * 100)),
                   euro2(regionalDetail.grossTax)]);
  } else if (regionalDetail) {
    let prevReg = 0;
    for (const s of regionalDetail.brackets) {
      if (r.taxable <= prevReg) break;
      const share = Math.min(r.taxable, s.upTo) - prevReg;
      regionalSteps.push([`${euro2(share)} × ${fmtPct2.format(s.rate * 100)}%`, euro2(share * s.rate)]);
      prevReg = s.upTo;
    }
  }
  if (regionalDetail && regionalDetail.deduction > 0) {
    regionalSteps.push([T.employeeExplanations_1, euro2(regionalDetail.deduction)]);
  }

  const municipality = MUNICIPALITIES_BY_CODE.get(currentMunicipality);
  const rule = municipality ? municipality[r.year] : null;
  const municipalSteps = [];
  if (rule && rule.brackets.length) {
    if (rule.brackets.length === 1 && rule.brackets[0].upTo === Infinity) {
      municipalSteps.push([`${euro2(r.taxable)} × ${fmtPct2.format(rule.brackets[0].rate * 100)}%`, euro2(r.municipalTax)]);
    } else {
      let prevCap = 0;
      for (const s of rule.brackets) {
        if (r.taxable <= prevCap) break;
        const share = Math.min(r.taxable, s.upTo) - prevCap;
        municipalSteps.push([`${euro2(share)} × ${fmtPct2.format(s.rate * 100)}%`, euro2(share * s.rate)]);
        prevCap = s.upTo;
      }
    }
  }

  return {
    accrued: {
      title: T.employeeExplanations_title_17,
      body: T.employeeExplanations_body_24,
      html: formula([
        [T.employeeExplanations_html_45, euro2(r.contractSalary)],
        [T.employeeExplanations_html_44, Math.round(r.partTimeShare * 100) + '%'],
        [T.employeeExplanations_html_26, `${r.days} / 365`]
      ], [T.employeeExplanations_html_43, euro2(r.salary)])
    },
    contributions: {
      title: T.employeeExplanations_title_11(r.profileName),
      body: T.employeeExplanations_body_23
        + (r.ceilingReached ? T.employeeExplanations_body_22(euro(A.ceiling)) : ''),
      source: T.employeeExplanations_source_16(r.year),
      html: formula([[`${euro2(r.appliedContributionBase)} × ${ratePct(r.profile.employee)}`, euro2(r.ordinaryContributions)]])
    },
    additional: {
      title: T.employeeExplanations_title_10,
      body: T.employeeExplanations_body_21(r.year, euro(A.threshold1pc)),
      source: T.employeeExplanations_source_15,
      html: formula([
        [T.employeeExplanations_html_42, euro2(r.appliedContributionBase)],
        [T.employeeExplanations_html_41, euro2(A.threshold1pc)],
        ['× 1%', euro2(r.additionalContribution)]
      ])
    },
    grossIrpef: {
      title: T.employeeExplanations_title_16(r.year),
      body: r.year === 2026
        ? T.employeeExplanations_body_20
        : T.employeeExplanations_body_19,
      source: r.year === 2026 ? T.employeeExplanations_source_8 : T.employeeExplanations_source_14,
      html: formula(irpefSteps, [T.employeeExplanations_html_40, euro2(r.grossIrpef)])
        + T.employeeExplanations_html_25(otherYear, euro2(computeGrossIrpef(r.taxable, otherYear)))
    },
    deductions: {
      title: T.employeeExplanations_title_9,
      body: r.yearShare < 1
        ? T.employeeExplanations_body_18(r.days)
        : T.employeeExplanations_body_17,
      source: T.employeeExplanations_source_13,
      html: r.yearShare < 1
        ? formula(employmentDeductionSteps(r), [T.employeeExplanations_html_39, euro2(r.employmentDeduction)])
        : formula([], [T.employeeExplanations_html_22, euro2(r.employmentDeduction)])
    },
    regime: {
      title: r.regimeName,
      body: T.employeeExplanations_body_16,
      source: T.employeeExplanations_source_7,
      html: formula([
        [T.employeeExplanations_html_21, euro2(r.taxableGross)],
        [T.employeeExplanations_html_38, euro2(r.regimeExempt)]
      ], [T.employeeExplanations_html_37, euro2(r.taxable)])
    },
    capacity: {
      title: T.employeeExplanations_title_8,
      body: T.employeeExplanations_body_15,
      html: formula([
        [T.employeeExplanations_html_20, euro2(r.totalDeductionsIrpef)],
        [T.employeeExplanations_html_36, euro2(r.grossIrpef)]
      ], [T.employeeExplanations_html_35, euro2(r.deductionUnused)])
    },
    municipalTax: {
      title: T.employeeExplanations_title_15(r.municipalityName),
      body: (rule && rule.exemption > 0
        ? T.employeeExplanations_body_14(euro(rule.exemption))
        : T.employeeExplanations_body_13)
        + T.employeeExplanations_body_12
        + (r.year === 2026 && !r.municipalityResolved2026 ? T.employeeExplanations_body_11 : ''),
      source: T.employeeExplanations_source_6,
      html: municipalSteps.length
        ? formula(municipalSteps, [T.employeeExplanations_html_34, euro2(r.municipalTax)])
        : formula([], [T.employeeExplanations_html_19, euro2(0)])
    },
    extra: {
      title: T.employeeExplanations_title_7,
      body: T.employeeExplanations_body_28(r.yearShare < 1 ? T.employeeExplanations_body_10(r.days) : ''),
      source: 'L. 207/2024',
      html: formula([], [T.employeeExplanations_html_18, euro2(r.extraDeduction)])
    },
    wedge: {
      title: T.employeeExplanations_title_6,
      body: T.employeeExplanations_body_27(r.yearShare < 1
            ? T.employeeExplanations_body_9(r.days, euro(r.wedgeIncome / r.yearShare))
            : ''),
      source: T.employeeExplanations_source_5,
      html: formula(
        r.wedgeBonus > 0
          ? [[`${euro2(r.totalIncome)} × ${fmtPct.format(r.wedgeRate * 100)}%`, euro2(r.wedgeBonus)]]
          : [],
        [T.employeeExplanations_html_33, euro2(r.wedgeBonus)])
    },
    treatment: {
      title: T.employeeExplanations_title_14,
      body: T.employeeExplanations_body_26(r.yearShare < 1 ? T.employeeExplanations_body_8(r.days) : ''),
      source: T.employeeExplanations_source_4,
      html: formula([
        [T.employeeExplanations_html_32, euro2(r.grossIrpef)],
        [T.employeeExplanations_html_17, euro2(r.employmentDeduction)],
        [T.employeeExplanations_html_16, euro2(CONSTANTS.INTEGRATIVE_TREATMENT.DEDUCTION_CUT)]
      ], [T.employeeExplanations_html_31, euro2(r.integrativeTreatment)])
    },
    regionalTax: {
      title: T.employeeExplanations_title_13(r.regionName),
      body: T.employeeExplanations_body_7,
      source: T.employeeExplanations_source_3
        + (r.regionalTaxDetail && r.regionalTaxDetail.rule.notIncluded
            ? T.employeeExplanations_source_2(r.regionalTaxDetail.rule.notIncluded) : ''),
      html: regionalSteps.length
        ? formula(regionalSteps, [T.employeeExplanations_html_30, euro2(r.regionalTax)])
        : formula([], [T.employeeExplanations_html_15, euro2(0)])
    },
    premiums: {
      title: T.employeeExplanations_title_5,
      body: T.employeeExplanations_body_6(fmtPct.format(EMPLOYEE_PARAMS.PREMIUMS_RATE * 100), euro(EMPLOYEE_PARAMS.PREMIUMS_CAP), euro(EMPLOYEE_PARAMS.PREMIUMS_INCOME_MAX)),
      source: T.employeeExplanations_source_1,
      html: formula([
        [T.employeeExplanations_html_29, euro2(r.premiumsRelieved)],
        [`× ${fmtPct.format(EMPLOYEE_PARAMS.PREMIUMS_RATE * 100)}%`, euro2(r.premiumsTax)]
      ], [T.employeeExplanations_html_14, euro2(r.premiumsTax)])
    },
    fringe: {
      title: T.employeeExplanations_title_4,
      body: T.employeeExplanations_body_5(euro(EMPLOYEE_PARAMS.FRINGE_THRESHOLD), euro(EMPLOYEE_PARAMS.FRINGE_THRESHOLD_WITH_CHILDREN)),
      source: T.employeeExplanations_source_12,
      html: formula([
        [T.employeeExplanations_html_13, euro2(r.fringeTaxable)],
        [T.employeeExplanations_html_12, euro2(r.fringeThreshold)]
      ], [T.employeeExplanations_html_28, euro2(r.fringeTaxable)])
    },
    hiringExemption: {
      title: T.employeeExplanations_title_3,
      body: T.employeeExplanations_body_4,
      source: T.employeeExplanations_source_11,
      html: formula([
        [T.employeeExplanations_html_11, euro2(r.ordinaryContributions)],
        [T.employeeExplanations_html_27, euro2(r.employeeExemption)]
      ], [T.employeeExplanations_html_10, euro2(r.ordinaryContributions - r.employeeExemption)])
    },
    deductionsOther: {
      title: T.employeeExplanations_title_2,
      body: T.employeeExplanations_body_25(r.otherDeductions > r.netBeforeDeductions / 5
            ? T.employeeExplanations_body_3
            : ''),
      html: formula([
        [T.employeeExplanations_html_9, euro2(r.netBeforeDeductions)],
        [T.employeeExplanations_html_8, euro2(r.otherDeductions)]
      ], [T.employeeExplanations_html_7, euro2(r.netAnnual)])
    },
    fund: {
      title: T.employeeExplanations_title_12,
      body: T.employeeExplanations_body_2,
      source: T.employeeExplanations_source_10,
      html: formula([
        [T.employeeExplanations_html_6, euro2(r.employeeFundTotal)],
        [T.employeeExplanations_html_5, euro2(r.employerFundTotal)],
        [T.employeeExplanations_html_4, euro2(r.pensionFundDeductible)]
      ], [T.employeeExplanations_html_3, euro2(r.employeeFundTotal + r.employerFundTotal + (r.tfrToFund ? r.tfr : 0))])
    },
    renewal: {
      title: T.renewalExplanationTitle,
      body: T.renewalExplanationBody(fmtPct.format(EMPLOYEE_PARAMS.RENEWAL_RATE * 100), euro(EMPLOYEE_PARAMS.RENEWAL_INCOME_MAX)),
      source: T.renewalExplanationSource,
      html: formula([
        [T.renewalExplanationAmount, euro2(r.renewalRelieved)],
        [`× ${fmtPct.format(EMPLOYEE_PARAMS.RENEWAL_RATE * 100)}%`, euro2(r.renewalTax)]
      ], [T.employeeExplanations_html_14, euro2(r.renewalTax)])
    },
    perfBonus: {
      title: T.employeeExplanations_title_1,
      body: T.employeeExplanations_body_1(euro(A.bonusCap), euro(EMPLOYEE_PARAMS.BONUS_INCOME_MAX), fmtPct.format(A.bonusRate * 100), r.year),
      source: T.employeeExplanations_source_9,
      html: formula([
        [T.employeeExplanations_html_2, euro2(r.bonusSubstitute)],
        [`× ${fmtPct.format(A.bonusRate * 100)}%`, euro2(r.bonusTax)]
      ], [T.employeeExplanations_html_1, euro2(r.bonusTax)])
    }
  };
}

/* Contextual warnings: situations HR must see explicitly */
function renderWarnings(r) {
  const warnings = [];
  const box = el('emp-out-alert');

  // Without pay every other warning is noise: unused deductions
  // and contribution thresholds mean nothing on a payslip that does not exist.
  if (r.contractSalary <= 0) {
    box.className = 'rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm';
    box.innerHTML = T.renderWarnings_13;
    return;
  }

  if (r.assimilated) {
    warnings.push(T.renderWarnings_12);
  }
  if (!r.ceilingReached && !r.assimilated && r.contributionBase > YEARS[r.year].ceiling) {
    warnings.push(T.renderWarnings_11(r.year, euro(YEARS[r.year].ceiling)));
  }
  if (r.ceilingReached) {
    warnings.push(T.renderWarnings_10(r.year, euro(YEARS[r.year].ceiling)));
  }
  if (r.additionalContribution > 0) {
    warnings.push(T.renderWarnings_9(euro(YEARS[r.year].threshold1pc)));
  }
  if (r.belowMinimum) {
    warnings.push(T.renderWarnings_8(euro2(r.minimumMonthly)));
  }
  if (r.netShortfall > 0.01) {
    warnings.push(T.renderWarnings_7(euro2(r.netShortfall)));
  }
  if (r.vouchersProrated) {
    warnings.push(T.renderWarnings_6(r.voucherDaysEffective));
  }
  if (r.otherDeductionsUncovered > 0.01) {
    warnings.push(T.renderWarnings_5(euro(r.otherDeductions), euro(r.otherDeductionsRequested)));
  }
  if (r.paymentUncovered > 0.01) {
    warnings.push(T.renderWarnings_4(euro(r.employeePayment), euro(r.paymentRequested)));
  }
  if (r.netAnnual < 0) {
    warnings.push(T.renderWarnings_3);
  }
  if (r.deductionUnused > 1) {
    warnings.push(T.renderWarnings_2(euro(r.deductionUnused)));
  }
  // Milan is only the starting point: the warning appears once the user has chosen a municipality.
  if (r.year === 2026 && !r.municipalityResolved2026 && municipalityChosen) {
    warnings.push(T.renderWarnings_1);
  }

  if (!warnings.length) {
    box.classList.add('hidden');
    return;
  }
  box.className = 'rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm';
  box.innerHTML = `<ul class="space-y-1.5 text-amber-900">${warnings.map((a) => `<li class="flex gap-2"><span class="font-bold">·</span><span>${a}</span></li>`).join('')}</ul>`;
}

/* SVG chart of the net/gross curve — no external library */
function renderChart(rCurrent) {
  const W = 640, H = 240, padL = 56, padR = 16, padT = 16, padB = 32;
  const minSalary = 10000, maxSalary = 150000, step = 2500;

  const params = readEmployeeParams();
  const points = [];
  for (let salary = minSalary; salary <= maxSalary; salary += step) {
    points.push({ salary, net: computeEmployee({ ...params, salary }).netAnnual });
  }

  const maxNet = Math.max(...points.map((p) => p.net), 1);
  const x = (salary) => padL + ((salary - minSalary) / (maxSalary - minSalary)) * (W - padL - padR);
  const y = (net) => H - padB - (net / maxNet) * (H - padT - padB);

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.salary).toFixed(1)},${y(p.net).toFixed(1)}`).join(' ');
  const area = `${line} L${x(maxSalary).toFixed(1)},${H - padB} L${padL},${H - padB} Z`;

  const gridY = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const value = maxNet * f;
    const yy = y(value);
    return `<line x1="${padL}" y1="${yy.toFixed(1)}" x2="${W - padR}" y2="${yy.toFixed(1)}" stroke="#e2e8f0" stroke-width="1" />
      <text x="${padL - 8}" y="${(yy + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="#64748b">${Math.round(value / 1000)}k</text>`;
  }).join('');

  const gridX = [10000, 45000, 80000, 115000, 150000].map((r) =>
    `<text x="${x(r).toFixed(1)}" y="${H - padB + 18}" text-anchor="middle" font-size="10" fill="#64748b">${Math.round(r / 1000)}k</text>`
  ).join('');

  const salaryCurrent = Math.min(Math.max(rCurrent.contractSalary, minSalary), maxSalary);
  const netCurrent = computeEmployee({ ...params, salary: salaryCurrent }).netAnnual;

  el('chart-wrap').innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" class="w-full h-auto" role="img" aria-label="${T.chartAriaLabel}">
      <defs>
        <linearGradient id="grad-net" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#2148e3" stop-opacity="0.28" />
          <stop offset="100%" stop-color="#2148e3" stop-opacity="0.02" />
        </linearGradient>
      </defs>
      ${gridY}${gridX}
      <path d="${area}" fill="url(#grad-net)" />
      <path d="${line}" fill="none" stroke="#2148e3" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />
      <line x1="${x(salaryCurrent).toFixed(1)}" y1="${padT}" x2="${x(salaryCurrent).toFixed(1)}" y2="${H - padB}"
            stroke="#0f172a" stroke-width="1" stroke-dasharray="4 3" opacity="0.4" />
      <circle cx="${x(salaryCurrent).toFixed(1)}" cy="${y(netCurrent).toFixed(1)}" r="5" fill="#2148e3" stroke="#fff" stroke-width="2.5" />
      <text x="${x(salaryCurrent).toFixed(1)}" y="${Math.max(padT + 10, y(netCurrent) - 12).toFixed(1)}"
            text-anchor="middle" font-size="11" font-weight="700" fill="#1b39c0">${euro(netCurrent)}</text>
    </svg>`;
}

/* ====================================================================
   ENGINE REGRESSION TESTS: see src/tests/suite.js
   ==================================================================== */





/* ====================================================================
   UI BINDING
   ==================================================================== */

/* The bar at the bottom of the screen shows the net of the open tab. It is
   not a link with #: the address fragment holds the state of the simulation
   and an anchor would wipe it out. */
const latestNet = {};
const openTab = () => (el('panel-selfemployed').classList.contains('hidden') ? 'employee' : 'selfEmployed');
function paintNetBar() {
  const n = latestNet[openTab()];
  if (!n) return;
  el('bar-net-month').textContent = euro(n.monthly);
  el('bar-net-year').textContent = euro(n.annual);
}
function updateNetBar(section, monthly, annual) {
  latestNet[section] = { monthly, annual };
  paintNetBar();
}
el('bar-net').addEventListener('click', () => {
  el(openTab() === 'selfEmployed' ? 'result-selfemployed' : 'result-employee')
    .scrollIntoView({ behavior: 'smooth', block: 'start' });
});

/* ------------------------------------------------ Employee parameters */
/* Numeric fields have a valid range, and until now whoever went past it was
   silently brought back inside: 400 days became 365 without the page saying
   so. The value is still corrected, but the correction is announced. */
let parameterCorrections = [];

function withinLimits(id, min, max, defaultValue, sentence) {
  const raw = parseFloat(el(id).value);
  if (el(id).value.trim() === '' || Number.isNaN(raw)) return defaultValue;
  const inside = Math.min(max, Math.max(min, raw));
  if (inside !== raw) {
    parameterCorrections.push(T.withinLimits_1(sentence, inside));
  }
  return inside;
}

function readEmployeeParams() {
  parameterCorrections = [];
  return {
    year: currentYear,
    salary: withinLimits('emp-salary', 0, 2000000, 0, T.readEmployeeParams_salary_1),
    monthlyPayments: parseInt(el('emp-payments').value, 10) || CONSTANTS.MONTHLY_PAYMENTS,
    profile: el('emp-profile').value,
    contractType: el('emp-contract').value,
    ceilingActive: el('emp-ceiling').checked,
    region: el('emp-region').value,
    municipality: currentMunicipality,
    daysWorked: withinLimits('emp-days', 1, 365, 365, T.readEmployeeParams_daysWorked_1),
    partTime: withinLimits('emp-parttime', 1, 100, 100, T.readEmployeeParams_partTime_1),
    dependentSpouse: el('emp-spouse').checked,
    children: Math.max(0, parseInt(el('emp-children').value, 10) || 0),
    youngChildren: Math.max(0, parseInt(el('emp-young-children').value, 10) || 0),
    childDeductionFull: el('emp-children-full').checked,
    otherDependants: Math.max(0, parseInt(el('emp-others').value, 10) || 0),
    fringeBenefit: Math.max(0, parseFloat(el('emp-fringe').value) || 0),
    mealVoucherPerDay: Math.max(0, parseFloat(el('emp-vouchers').value) || 0),
    electronicVouchers: el('emp-vouchers-electronic').checked,
    voucherDays: Math.max(0, parseInt(el('emp-vouchers-days').value, 10) || 0),
    performanceBonus: Math.max(0, parseFloat(el('emp-bonus').value) || 0),
    bonusAsWelfare: el('emp-bonus-welfare').checked,
    shiftPremiums: Math.max(0, parseFloat(el('emp-premiums').value) || 0),
    renewalIncrease: Math.max(0, parseFloat(el('emp-renewal').value) || 0),
    pensionFund: Math.max(0, parseFloat(el('emp-fund').value) || 0),
    employerFundContribution: Math.max(0, parseFloat(el('emp-fund-employer').value) || 0),
    tfrToFund: el('emp-tfr-fund').checked,
    otherDeductions: Math.max(0, parseFloat(el('emp-deductions').value) || 0),
    exemptions: chosenExemptions,
    regime: el('emp-regime').value,
    inboundMinorChildren: el('emp-inbound-children').checked
  };
}

function updateEmployee() {
  const params = readEmployeeParams();
  el('emp-corrections').textContent = parameterCorrections.join(' ');
  el('emp-corrections').classList.toggle('hidden', parameterCorrections.length === 0);
  const result = computeEmployee(params);
  updateContextNotes(params, result);
  renderExemptions(params);
  renderEmployee(result);
  renderComparison();
  writeUrl();
}

/* Dynamic notes explaining the effect of the selected parameter */
function updateContextNotes(p, r) {
  const A = YEARS[p.year];
  const profile = CONTRIBUTION_PROFILES[normaliseProfile(p.profile)];

  el('year-note').textContent = A.notes;
  const contract = CONTRACT_TYPES[p.contractType] || CONTRACT_TYPES.indeterminato;
  el('emp-contract-note').innerHTML = contract.note;

  // A control with no effect is disabled instead of staying active and
  // useless, which would be more confusing. An internship has no extra
  // monthly payments and no TFR; neither has a collaboration, and on top of
  // that the ceiling is not a choice but the rule of the separate scheme.
  const assimilated = !!contract.assimilated;
  const withoutExtraMonths = assimilated || !!contract.fixedMonthlyPayments;
  const disabledFields = {
    'emp-payments': withoutExtraMonths,
    'emp-tfr-fund': assimilated || !!contract.withoutTfr,
    'emp-ceiling': assimilated || !!contract.ceilingMandatory
  };
  for (const [id, off] of Object.entries(disabledFields)) {
    const node = el(id);
    node.disabled = off;
    node.parentElement.classList.toggle('opacity-40', off);
  }
  if (withoutExtraMonths && el('emp-payments').value !== '12') {
    el('emp-payments').value = '12';
    p.monthlyPayments = 12;
  }
  // In the separate scheme the ceiling is mandatory: the box shows it
  // ticked because the calculation applies it anyway.
  if (contract.ceilingMandatory) el('emp-ceiling').checked = true;

  // A collaborator has no gross salary: they have an agreed fee. Changing the
  // word costs one line and removes a misunderstanding.
  el('emp-salary-label').textContent = contract.separateScheme
    ? T.updateContextNotes_15 : T.updateContextNotes_18;

  /* The rate is no longer a number to take on trust: the box shows the total,
     how it splits between the two parties and — where the table allows it —
     which items it is made of. */
  const items = profile.items
    ? Object.entries(profile.items).map(([name, value]) =>
        `<li class="flex justify-between gap-3"><span>${name}</span>
           <span class="num tabular-nums">${fmtPct2.format(value)}%</span></li>`).join('')
    : '';

  el('emp-profile-note').innerHTML = T.updateContextNotes_17(fmtPct2.format(profile.total), ratePct(profile.employee), ratePct(profile.employer), profile.fund ? `<span>${profile.fundName} <strong class="num text-slate-700">${ratePct(profile.fund)}</strong></span>` : '', items ? `<ul class="mt-2 pt-2 border-t border-slate-200 space-y-0.5 text-[11px] text-slate-600">${items}</ul>` : '', profile.estimate ? 'text-amber-700' : 'text-slate-600', profile.estimate ? T.updateContextNotes_14 : '', profile.source, CONTRIBUTION_SECTORS[profile.sector].note ? ' · ' + CONTRIBUTION_SECTORS[profile.sector].note : '');

  const fringeThreshold = p.children > 0 || p.youngChildren > 0 ? EMPLOYEE_PARAMS.FRINGE_THRESHOLD_WITH_CHILDREN : EMPLOYEE_PARAMS.FRINGE_THRESHOLD;
  el('emp-fringe-note').textContent = p.fringeBenefit > fringeThreshold
    ? T.updateContextNotes_13(euro(fringeThreshold))
    : T.updateContextNotes_16(euro(fringeThreshold), p.children > 0 || p.youngChildren > 0 ? T.updateContextNotes_12 : '');

  el('emp-vouchers-note').textContent = T.updateContextNotes_11(euro(p.electronicVouchers ? A.electronicVoucher : A.paperVoucher), p.year);
  // The engine decides on employment income, not on the gross salary typed in.
  el('emp-bonus-note').textContent = r.employmentIncome > EMPLOYEE_PARAMS.BONUS_INCOME_MAX
    ? T.updateContextNotes_10(euro(EMPLOYEE_PARAMS.BONUS_INCOME_MAX))
    : T.updateContextNotes_9(fmtPct.format(A.bonusRate * 100), p.year, euro(A.bonusCap));

  const reg = REGIONS[p.region] || REGIONS.Lombardia;
  const regionalBrackets = reg.years[p.year] || reg.brackets;
  const regionalRule = (REGIONAL_TAX_RULES[p.year] || {})[reg.name] || {};
  el('emp-region-note').textContent = (regionalBrackets.length === 1
    ? T.updateContextNotes_8(fmtPct.format(regionalBrackets[0].rate * 100))
    : 'Scaglioni: ' + regionalBrackets.map((s) => fmtPct.format(s.rate * 100) + '%').join(' · '))
    + (regionalRule.exemptUpTo || regionalRule.flatRateUpTo || regionalRule.rateOnWhole || regionalRule.deductions
        ? T.updateContextNotes_7 : '')
    + (regionalRule.notIncluded ? T.updateContextNotes_6(regionalRule.notIncluded) : '');

  const mun = MUNICIPALITIES_BY_CODE.get(p.municipality);
  if (mun) {
    const rule = mun[p.year];
    const description = !rule.brackets.length
      ? T.description_2
      : (rule.brackets.length === 1 && rule.brackets[0].upTo === Infinity
          ? T.description_1(fmtPct.format(rule.brackets[0].rate * 100))
          : 'Scaglioni: ' + rule.brackets.map((s) => fmtPct.format(s.rate * 100) + '%').join(' · '));
    el('emp-municipality-note').textContent = description +
      (rule.exemption > 0 ? T.updateContextNotes_5(euro(rule.exemption)) : '') +
      (p.year === 2026 && !mun.resolved2026 ? T.updateContextNotes_4 : '');
  }

  const deductionsNote = el('emp-deductions-note');
  const rDeductions = computeEmployee(p);
  if (rDeductions.otherDeductions > rDeductions.netBeforeDeductions / 5 && rDeductions.otherDeductions > 0) {
    deductionsNote.classList.remove('hidden');
    deductionsNote.textContent = T.updateContextNotes_3(euro(rDeductions.netBeforeDeductions / 5));
  } else {
    deductionsNote.classList.add('hidden');
  }

  el('emp-fund-employer-note').textContent = p.pensionFund > 0
    ? T.updateContextNotes_2(euro(p.salary * p.employerFundContribution / 100))
    : T.updateContextNotes_1;

  /* The dropdown follows the value, not the memory of a click: it stays open
     as long as there is something to see and closes when everything is back
     to zero. What is inside counts too, otherwise it would close under the
     fingers of someone filling in the voucher days before entering the daily
     value. */
  el('emp-detail-vouchers').open = p.mealVoucherPerDay > 0
    || p.voucherDays !== EMPLOYEE_PARAMS.VOUCHER_DAYS_YEAR || p.electronicVouchers === false;
  el('emp-detail-bonus').open = p.performanceBonus > 0 || p.bonusAsWelfare;
  el('emp-detail-fund').open = p.pensionFund > 0
    || p.employerFundContribution > 0 || p.tfrToFund;

  /* The welfare card, instead, only ever opens by itself: closing it while
     someone deletes a value to type a new one would hide the field. */
  const welfareCount = [p.fringeBenefit > 0, p.mealVoucherPerDay > 0, p.performanceBonus > 0 || p.bonusAsWelfare,
    p.shiftPremiums > 0, p.renewalIncrease > 0, p.pensionFund > 0 || p.employerFundContribution > 0 || p.tfrToFund,
    p.otherDeductions > 0].filter(Boolean).length;
  el('emp-welfare-summary').textContent = welfareCount ? T.welfareSummary(welfareCount) : T.welfareSummaryNone;
  if (welfareCount) el('emp-card-welfare').open = true;

  el('emp-inbound-box').className = p.regime === 'impatriati'
    ? 'flex items-center gap-3 cursor-pointer'
    : 'hidden items-center gap-3 cursor-pointer';
  el('emp-regime-note').textContent = {
    nessuno: T.updateContextNotes_nessuno_1,
    impatriati: T.updateContextNotes_impatriati_1(p.inboundMinorChildren ? '40' : '50', euro(EMPLOYEE_PARAMS.INBOUND_CAP)),
    ricercatori: T.updateContextNotes_ricercatori_1,
    frontalieri: T.updateContextNotes_frontalieri_1(euro(EMPLOYEE_PARAMS.CROSS_BORDER_ALLOWANCE))
  }[p.regime];
}

/* ------------------------------------------- Filling the selects */
function fillSelects() {
  fillContributionProfile(DEFAULT_PROFILE);

  el('emp-contract').innerHTML = Object.entries(CONTRACT_TYPES)
    .map(([k, v]) => `<option value="${k}"${k === 'indeterminato' ? ' selected' : ''}>${v.name}</option>`)
    .join('');

  el('emp-region').innerHTML = Object.keys(REGIONS).sort()
    .map((k) => `<option value="${k}"${k === 'Lombardia' ? ' selected' : ''}>${k}</option>`)
    .join('');

  el('emp-regime').innerHTML = Object.entries(TAX_REGIMES)
    .map(([k, v]) => `<option value="${k}">${v.name}</option>`)
    .join('');

  el('se-regime').innerHTML = Object.entries(SELF_EMPLOYED_REGIMES)
    .map(([k, v]) => `<option value="${k}">${v.name}</option>`)
    .join('');

  el('se-scheme').innerHTML = Object.entries(PENSION_SCHEMES)
    .map(([k, v]) => `<option value="${k}"${k === 'separata_professionisti' ? ' selected' : ''}>${v.name}</option>`)
    .join('');

  el('se-coefficient').innerHTML = FLAT_RATE_COEFFICIENTS
    .map((c) => `<option value="${c.key}">${fmtPct.format(c.coefficient * 100)}% — ${c.name}</option>`)
    .join('');

  el('se-region').innerHTML = Object.keys(REGIONS).sort()
    .map((k) => `<option value="${k}"${k === 'Lombardia' ? ' selected' : ''}>${k}</option>`)
    .join('');

  /* The number of municipalities is never written by hand: Italian
     municipalities merge, the dataset records it and the page must show the
     right number without anyone having to remember. */
  const count = String(MUNICIPALITIES.length).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  el('stat-municipalities').textContent = count;
  document.querySelectorAll('.stat-municipalities').forEach((n) => { n.textContent = count; });
  el('emp-municipality-search').placeholder = T.fillSelects_1(count);

  const milan = MUNICIPALITIES_BY_CODE.get('F205');
  el('emp-municipality-search').value = `${milan.name} (${milan.province})`;
}

/* Province → region: choosing a municipality must align the regional
   surcharge, otherwise impossible combinations appear, such as Turin with
   the rates of Lombardy. */


/* Align the region select with the chosen municipality. If the province were
   not mapped, the region stays the one chosen by hand. */
function alignRegionToMunicipality(municipalityCode) {
  const municipality = MUNICIPALITIES_BY_CODE.get(municipalityCode);
  if (!municipality) return;
  const region = PROVINCE_REGION[municipality.province];
  if (region && REGIONS[region]) el('emp-region').value = region;
}

/* ------------------------------------- Search among Italian municipalities */
const municipalitySearch = el('emp-municipality-search');
const municipalityResults = el('emp-municipality-results');

function normalise(s) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function searchMunicipalities(query) {
  const q = normalise(query.trim());
  if (q.length < 2) return [];
  const starting = [];
  const contain = [];
  for (const c of MUNICIPALITIES) {
    const name = normalise(c.name);
    if (name.startsWith(q)) starting.push(c);
    else if (name.includes(q) || normalise(c.province) === q) contain.push(c);
    if (starting.length >= 12) break;
  }
  return starting.concat(contain).slice(0, 12);
}

function showMunicipalityResults(list) {
  if (!list.length) {
    closeMunicipalityList();
    return;
  }
  municipalityResults.innerHTML = list.map((c, i) => {
    const rule = c[currentYear];
    const summary = !rule.brackets.length
      ? T.summary_2
      : (rule.brackets.length === 1 && rule.brackets[0].upTo === Infinity
          ? fmtPct.format(rule.brackets[0].rate * 100) + '%'
          : T.summary_1);
    return `<li role="option" id="municipality-opt-${i}" aria-selected="false" data-code="${c.code}"
        class="municipality-opt cursor-pointer px-4 py-2.5 hover:bg-brand-50 transition flex items-center justify-between gap-3">
        <span class="font-medium text-slate-700">${escapeHtml(c.name)} <span class="text-slate-600 text-xs">(${escapeHtml(c.province)})</span></span>
        <span class="text-xs text-slate-600 num">${summary}${rule.exemption > 0 ? ' · es. ' + euro(rule.exemption) : ''}</span>
      </li>`;
  }).join('');
  municipalityResults.classList.remove('hidden');
  municipalitySearch.setAttribute('aria-expanded', 'true');
  highlightIndex = -1;
}

/* Index of the option reached with the arrow keys: -1 when none is. */
let highlightIndex = -1;

function closeMunicipalityList() {
  municipalityResults.classList.add('hidden');
  municipalitySearch.setAttribute('aria-expanded', 'false');
  municipalitySearch.removeAttribute('aria-activedescendant');
  highlightIndex = -1;
}

function highlightOption(index) {
  const options = [...municipalityResults.children];
  if (!options.length) return;
  highlightIndex = (index + options.length) % options.length;
  options.forEach((o, i) => o.setAttribute('aria-selected', String(i === highlightIndex)));
  const activeOption = options[highlightIndex];
  municipalitySearch.setAttribute('aria-activedescendant', activeOption.id);
  if (activeOption.scrollIntoView) activeOption.scrollIntoView({ block: 'nearest' });
}

function municipalityLabel(code) {
  const c = MUNICIPALITIES_BY_CODE.get(code);
  return c ? `${c.name} (${c.province})` : '';
}

function chooseMunicipality(code) {
  if (!MUNICIPALITIES_BY_CODE.has(code)) return;
  currentMunicipality = code;
  municipalityChosen = true;
  municipalitySearch.value = municipalityLabel(code);
  closeMunicipalityList();
  alignRegionToMunicipality(code);
  updateEmployee();
}

/* The field is a text box, but the calculation uses the municipality chosen
   from the list. Whoever typed «Roma» and clicked elsewhere kept «Roma» in
   sight and Milan in the numbers. When the field loses focus it realigns: if
   the text identifies a single municipality it is adopted, otherwise the
   field goes back to saying which municipality is really being used. */
function realignMunicipalityField() {
  if (municipalitySearch.value.trim() === municipalityLabel(currentMunicipality)) {
    closeMunicipalityList();
    return;
  }
  const candidates = searchMunicipalities(municipalitySearch.value);
  const exact = candidates.filter((c) =>
    normalise(c.name) === normalise(municipalitySearch.value.trim()));
  const chosen = exact.length === 1 ? exact[0]
               : (candidates.length === 1 ? candidates[0] : null);
  if (chosen) chooseMunicipality(chosen.code);
  else municipalitySearch.value = municipalityLabel(currentMunicipality);
}

municipalitySearch.addEventListener('input', () => showMunicipalityResults(searchMunicipalities(municipalitySearch.value)));
municipalitySearch.addEventListener('focus', () => municipalitySearch.select());
municipalitySearch.addEventListener('blur', () => {
  // A click on a result goes through the field's blur first: wait until
  // the list has had its chance to answer.
  setTimeout(realignMunicipalityField, 150);
});

/* Declaring role="combobox" is a promise: the arrows move through the list,
   Enter chooses, Esc gives up. Before, the list only worked with the mouse. */
municipalitySearch.addEventListener('keydown', (e) => {
  const open = !municipalityResults.classList.contains('hidden');
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (!open) { showMunicipalityResults(searchMunicipalities(municipalitySearch.value)); return; }
    highlightOption(highlightIndex + (e.key === 'ArrowDown' ? 1 : -1));
    return;
  }
  if (!open) return;
  if (e.key === 'Enter') {
    const options = [...municipalityResults.children];
    const choice = options[highlightIndex >= 0 ? highlightIndex : 0];
    if (choice) { e.preventDefault(); chooseMunicipality(choice.dataset.code); }
    return;
  }
  if (e.key === 'Escape') {
    e.preventDefault();
    municipalitySearch.value = municipalityLabel(currentMunicipality);
    closeMunicipalityList();
  } else if (e.key === 'Home' || e.key === 'End') {
    e.preventDefault();
    highlightOption(e.key === 'Home' ? 0 : municipalityResults.children.length - 1);
  }
});

municipalityResults.addEventListener('click', (e) => {
  const opt = e.target.closest('.municipality-opt');
  if (!opt) return;
  chooseMunicipality(opt.dataset.code);
});
municipalityResults.addEventListener('mousemove', (e) => {
  const opt = e.target.closest('.municipality-opt');
  if (opt) highlightOption([...municipalityResults.children].indexOf(opt));
});
document.addEventListener('click', (e) => {
  if (!municipalityResults.contains(e.target) && e.target !== municipalitySearch) {
    closeMunicipalityList();
  }
});

/* --------------------------------------------- Tax year selector */
/* The active year button is highlighted both on click and when restoring
   from the address: the pair of classes lives here, not in two places. */
function highlightActiveYear() {
  const base = 'year-btn px-3 py-2.5 rounded-xl text-sm font-bold border transition';
  document.querySelectorAll('.year-btn').forEach((x) => {
    const active = parseInt(x.dataset.year, 10) === currentYear;
    x.setAttribute('aria-pressed', String(active));
    x.className = `${base} ${active
      ? 'border-brand-600 bg-brand-600 text-white'
      : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`;
  });
}

document.querySelectorAll('.year-btn').forEach((b) => {
  b.addEventListener('click', () => {
    currentYear = parseInt(b.dataset.year, 10);
    highlightActiveYear();
    updateEmployee();
  });
});

/* Each sector has its own sizes and roles: when the sector changes the
   other two lists are rebuilt, keeping the previous choice if it still
   exists in that sector. */
function fillContributionProfile(key) {
  const chosen = CONTRIBUTION_PROFILES[normaliseProfile(key)];
  const sector = CONTRIBUTION_SECTORS[chosen.sector];
  const option = (k, label, activeOption) =>
    `<option value="${k}"${k === activeOption ? ' selected' : ''}>${label}</option>`;

  el('emp-sector').innerHTML = Object.entries(CONTRIBUTION_SECTORS)
    .map(([k, v]) => option(k, v.name, chosen.sector)).join('');

  const companySizes = Object.entries(sector.companySizes);
  el('emp-size').innerHTML = companySizes
    .map(([k, v]) => option(k, v.name, chosen.companySize)).join('');
  // A field with a single choice is not a choice: it disappears.
  el('emp-row-size').classList.toggle('hidden', companySizes.length < 2);

  el('emp-role').innerHTML = Object.keys(sector.companySizes[chosen.companySize].roles)
    .map((k) => option(k, ROLES[k], chosen.role)).join('');

  el('emp-profile').value = `${chosen.sector}|${chosen.role}|${chosen.companySize}`;
}

/* Not every triple exists: commerce does not distinguish blue- and
   white-collar workers, crafts have no size thresholds. When the chosen
   combination does not exist the first one of the sector is used, instead
   of leaving the calculation without a rate. */
function rebuildProfile() {
  const sectorKey = CONTRIBUTION_SECTORS[el('emp-sector').value] ? el('emp-sector').value : 'commercio';
  const sector = CONTRIBUTION_SECTORS[sectorKey];
  const companySize = sector.companySizes[el('emp-size').value]
    ? el('emp-size').value : Object.keys(sector.companySizes)[0];
  const roles = sector.companySizes[companySize].roles;
  const role = roles[el('emp-role').value]
    ? el('emp-role').value : Object.keys(roles)[0];
  fillContributionProfile(`${sectorKey}|${role}|${companySize}`);
  updateEmployee();
}

/* The breakdown answers the first question people ask — where does my money
   go — so it opens first. The curve is one click away. */
let chartView = 'composition';

function chooseView(which) {
  chartView = which;
  const active = 'px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors bg-white text-brand-700 shadow-sm';
  const off = 'px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors text-slate-600 hover:text-slate-700';
  const onComposition = which === 'composition';

  el('btn-view-composition').className = onComposition ? active : off;
  el('btn-view-curve').className = onComposition ? off : active;
  el('btn-view-composition').setAttribute('aria-selected', String(onComposition));
  el('btn-view-curve').setAttribute('aria-selected', String(!onComposition));
  el('view-composition').classList.toggle('hidden', !onComposition);
  el('view-curve').classList.toggle('hidden', onComposition);

  el('emp-out-view-title').textContent = onComposition ? T.chooseView_4 : T.chooseView_3;
  el('emp-out-view-note').textContent = onComposition
    ? T.chooseView_2
    : T.chooseView_1;

  updateEmployee();
}

el('btn-view-composition').addEventListener('click', () => chooseView('composition'));
el('btn-view-curve').addEventListener('click', () => chooseView('curve'));

['emp-sector', 'emp-role', 'emp-size']
  .forEach((id) => el(id).addEventListener('change', rebuildProfile));


['emp-salary', 'emp-payments', 'emp-profile', 'emp-contract', 'emp-ceiling', 'emp-region', 'emp-days', 'emp-parttime',
 'emp-spouse', 'emp-children', 'emp-young-children', 'emp-children-full', 'emp-others', 'emp-fringe', 'emp-vouchers', 'emp-vouchers-days', 'emp-vouchers-electronic',
 'emp-bonus', 'emp-bonus-welfare', 'emp-premiums', 'emp-renewal', 'emp-fund', 'emp-fund-employer', 'emp-tfr-fund',
 'emp-deductions', 'emp-regime', 'emp-inbound-children']
  .forEach((id) => listenForChanges(el(id), updateEmployee));

/* Text and number fields already recalculate at every keystroke. Their
   'change' event fires again when the field loses focus, that is when the
   user taps an «i» button of the detail: the detail was redrawn under the
   finger and the first tap went lost. Only selects and checkboxes listen to
   'change'. Defined as a function declaration, so it is hoisted. */
function listenForChanges(node, update) {
  node.addEventListener('input', update);
  if (node.tagName === 'SELECT' || node.type === 'checkbox') node.addEventListener('change', update);
}

/* Export the detail as CSV to the clipboard */
el('btn-csv').addEventListener('click', async () => {
  const rows = [...document.querySelectorAll('#tbody-employee tr')].map((tr) =>
    [...tr.cells].map((td) => `"${td.innerText.replace(/\s+/g, ' ').trim().replace(/"/g, '""')}"`).join(';')
  );
  const csv = [T.csv_1].concat(rows).join('\n');
  try {
    await navigator.clipboard.writeText(csv);
    el('btn-csv').textContent = T.top_11;
    setTimeout(() => { el('btn-csv').textContent = T.top_10; }, 1500);
  } catch (err) {
    el('btn-csv').textContent = T.top_6;
    setTimeout(() => { el('btn-csv').textContent = T.top_9; }, 1500);
  }
});

// In-page links scroll without touching the address: the fragment after #
// holds the state of the simulation, and an anchor would wipe it out.
document.addEventListener('click', (e) => {
  const link = e.target.closest('[data-scroll-to]');
  if (!link) return;
  e.preventDefault();
  const target = el(link.dataset.scrollTo);
  const fold = target.closest('details');
  if (fold) fold.open = true;
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (link.dataset.focus) whenScrollStops(() => el(link.dataset.focus).focus({ preventScroll: true }));
});

/* A field taking the focus stops a smooth scroll halfway, so the focus waits
   until the page has stood still for 150 ms. 'scrollend' would be the natural
   event, but it does not fire everywhere yet. Two seconds at most. */
function whenScrollStops(callback) {
  let last = window.scrollY, still = 0, ticks = 0;
  const timer = setInterval(() => {
    ticks += 1;
    still = window.scrollY === last ? still + 1 : 0;
    last = window.scrollY;
    if ((ticks >= 4 && still >= 3) || ticks >= 40) {
      clearInterval(timer);
      callback();
    }
  }, 50);
}

/* Paper has no clicks: every folded card prints open, then goes back to how
   the visitor left it. */
let foldedForPrint = [];
window.addEventListener('beforeprint', () => {
  foldedForPrint = [...document.querySelectorAll('details:not([open])')];
  foldedForPrint.forEach((d) => { d.open = true; });
});
window.addEventListener('afterprint', () => {
  foldedForPrint.forEach((d) => { d.open = false; });
  foldedForPrint = [];
});

// The suite is loaded only when someone asks for it: most visitors never do.
el('btn-test').addEventListener('click', async () => {
  const { runTests } = await import('../tests/suite.js');
  showTestOutcome(runTests());
});


/* ------------------------------------------- Hiring exemptions */
/* The list is redrawn at every parameter change, because eligibility depends
   on contract, role, region and year. A measure that does not apply stays
   visible but disabled, with the reason: hiding it would suggest it does
   not exist. */
function renderExemptions(params) {
  const container = el('list-exemptions');
  const chosenList = params.exemptions || [];

  const card = (key) => {
    const status = exemptionStatus(key, params);
    const e = status.hiringExemption;
    const active = chosenList.includes(key);
    const share = status.share;

    const measure = share
      ? (share.annualCap !== undefined
          ? T.measure_2(fmtPct.format(share.percentage * 100), euro(share.annualCap))
          : T.measure_1(fmtPct.format(share.percentage * 100), euro(share.monthlyCap)))
      : '';

    return T.card_4(status.applicable ? 'border-slate-200 hover:border-brand-300 cursor-pointer'
                          : 'border-slate-200 bg-slate-50 cursor-not-allowed', key, active ? 'checked' : '', status.applicable ? '' : 'disabled', e.name, status.expired ? '<span class="ml-1 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-rose-100 text-rose-700">' + T.badgeExpired + '</span>' : '', status.applicable ? `<span class="ml-1 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">vigente</span>` : '', status.applicable ? T.card_3(measure, e.affects === 'employer' ? T.card_2 : T.card_1) : status.reason, e.source, formatDate(e.verifiedOn));
  };

  /* Expired measures are not removed: hiding them would suggest they never
     existed, and whoever looks for the youth bonus must be able to see that it
     was there and when it closed. But keeping them among the others fills the
     card with grey rows that cannot be selected. They sit in a closed dropdown. */
  const keys = Object.keys(HIRING_EXEMPTIONS);
  const lives = keys.filter((c) => !exemptionStatus(c, params).expired);
  const expiredList = keys.filter((c) => exemptionStatus(c, params).expired);

  container.innerHTML = lives.map(card).join('')
    + (expiredList.length ? `
      <details class="dropdown">
        <summary class="flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-700 py-1">
          <svg class="arrow h-3.5 w-3.5 shrink-0 text-slate-600" viewBox="0 0 20 20" fill="none"
               stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M7 4l6 6-6 6" /></svg>
          ${T.expiredMeasures(expiredList.length)}
        </summary>
        <div class="pt-2 space-y-2">${expiredList.map(card).join('')}</div>
      </details>` : '');

  el('emp-exemptions-summary').textContent = chosenList.length
    ? T.exemptionsSummary(chosenList.length) : T.exemptionsSummaryNone;
  if (chosenList.length) el('emp-card-exemptions').open = true;

  const conflict = exemptionsInConflict(chosenList);
  const warning = el('exemptions-conflict');
  if (conflict) {
    warning.classList.remove('hidden');
    warning.textContent = T.renderExemptions_1(HIRING_EXEMPTIONS[conflict[0]].name, HIRING_EXEMPTIONS[conflict[1]].name);
  } else {
    warning.classList.add('hidden');
  }
}

/* The selection lives outside the DOM because the list is redrawn */
let chosenExemptions = [];

document.addEventListener('change', (e) => {
  const box = e.target.closest('.exemption-check');
  if (!box) return;
  const key = box.dataset.hiringExemption;
  chosenExemptions = box.checked
    ? [...chosenExemptions.filter((x) => x !== key), key]
    : chosenExemptions.filter((x) => x !== key);

  // The law rules out combining them: the first one selected is kept
  const conflict = exemptionsInConflict(chosenExemptions);
  if (conflict) chosenExemptions = chosenExemptions.filter((x) => x !== conflict[1]);

  updateEmployee();
});

/* ------------------------------------------- From net to gross salary */
el('btn-invert').addEventListener('click', () => {
  const outcomeEl = el('emp-net-outcome');
  const raw = parseFloat(el('emp-net-target').value);
  const perMonth = el('emp-net-period').value === 'month';

  outcomeEl.classList.remove('hidden');

  if (!Number.isFinite(raw) || raw <= 0) {
    outcomeEl.className = 'text-xs leading-relaxed text-amber-300';
    outcomeEl.textContent = T.top_5;
    return;
  }

  const params = readEmployeeParams();
  const target = perMonth ? raw * params.monthlyPayments : raw;
  const r = invertNet(target, params);

  const apply = (salary) => {
    el('emp-salary').value = Math.round(salary);
    updateEmployee();
  };

  if (r.outcome === 'outOfRange') {
    outcomeEl.className = 'text-xs leading-relaxed text-amber-300';
    outcomeEl.innerHTML = T.top_4(euro(r.maxSalaryFound), euro(r.netMaxFound / params.monthlyPayments));
    return;
  }

  if (r.outcome === 'exact') {
    apply(r.salary);
    outcomeEl.className = 'text-xs leading-relaxed text-emerald-300';

    let message = T.message_1(euro(r.salary), euro(r.net / params.monthlyPayments), params.monthlyPayments);

    if (r.otherSolutions.length) {
      const chosenCost = computeEmployee({ ...params, salary: r.salary }).employerCost;
      const costHigh = computeEmployee({ ...params, salary: Math.max(...r.otherSolutions) }).employerCost;
      message += T.top_8(r.otherSolutions.map((x) => euro(x)).join(T.top_3), euro(costHigh - chosenCost));
    }
    outcomeEl.innerHTML = message;
    return;
  }

  // The target falls inside one of the jumps: no gross salary produces it.
  apply(r.above ? r.above.salary : r.below.salary);
  outcomeEl.className = 'text-xs leading-relaxed text-amber-300';
  outcomeEl.innerHTML =
    T.top_7(euro(Math.abs(r.jump)), euro(r.below.net / params.monthlyPayments), euro(r.below.salary), r.above
        ? T.top_2(euro(r.above.net / params.monthlyPayments), euro(r.above.salary))
        : T.top_1);
});

/* ------------------------------------------- Cost optimisation */
let optimisationMode = 'net';
let optState = null;

/* The net target is entered once, in the box at the top: from there one can
   look for the matching gross salary or for the package that delivers that
   amount at the lowest cost. The budget is the mirror input, and lives next
   to the results. */
function renderOptimisation(mode, rawAmount) {
  optimisationMode = mode;
  const outcome = el('opt-outcome');
  const raw = parseFloat(rawAmount);

  if (!Number.isFinite(raw) || raw <= 0) {
    optState = null;
    outcome.innerHTML = `<p class="px-6 py-8 text-center text-sm text-amber-700">${mode === 'net'
          ? T.renderOptimisation_4
          : T.renderOptimisation_3}</p>`;
    return;
  }

  const params = readEmployeeParams();
  const perMonth = mode === 'net' && el('emp-net-period').value === 'month';
  const value = perMonth ? raw * params.monthlyPayments : raw;

  const packages = optimisedPackages({ type: optimisationMode, value }, params);
  const reference = packages[0];

  const best = optimisationMode === 'net'
    ? packages.reduce((a, b) => (b.employerCost < a.employerCost && !b.bonusOverThreshold ? b : a))
    : packages.reduce((a, b) => (b.totalValue > a.totalValue && !b.bonusOverThreshold ? b : a));

  /* The recommended package opens the reading, but does not close it: from
     here the choice can move to another package, and the two analysis blocks
     are recomputed on it. */
  optState = {
    mode: optimisationMode,
    params, value, packages, reference,
    efficiency: toolEfficiency(params),
    recommendedIndex: packages.indexOf(best),
    chosen: packages.indexOf(best)
  };

  /* The two directions stay aligned: starting from the net, the budget is
     filled with the spending that package implies; starting from the budget,
     the net target is filled with what that budget can deliver. So the user
     can go on in the other direction without copying a number by hand, and
     without finding an old one. */
  if (mode === 'net') {
    el('opt-budget').value = Math.round(best.employerCost);
    el('opt-budget-note').textContent =
      T.renderOptimisation_2(euro(best.employerCost));
  } else {
    el('emp-net-target').value = Math.round(best.totalValue / params.monthlyPayments);
    el('emp-net-period').value = 'month';
    el('opt-budget-note').textContent =
      T.renderOptimisation_1(euro(best.totalValue / params.monthlyPayments));
  }

  paintOptimisation();
}

/* Draw the outcome from the state, without touching the input fields: so it
   can be called at every change of package. */
function paintOptimisation() {
  if (!optState) return;
  const { params, value, packages, reference, efficiency } = optState;
  const recommended = packages[optState.recommendedIndex];
  const chosen = packages[optState.chosen];

  const gain = optState.mode === 'net'
    ? reference.employerCost - recommended.employerCost
    : recommended.totalValue - reference.totalValue;

  const row = (p, index) => {
    const deltaCost = p.employerCost - reference.employerCost;
    const deltaValue = p.totalValue - reference.totalValue;
    const active = index === optState.chosen;
    const locked = !!p.bonusOverThreshold;

    return `
      <tr data-package="${index}"
          class="transition-colors ${locked ? 'opacity-60' : 'cursor-pointer'} ${active ? 'bg-brand-50' : 'hover:bg-slate-50'}">
        <td class="pl-4 pr-0 py-3 align-top">
          <input type="radio" name="opt-choice" value="${index}" ${active ? 'checked' : ''} ${locked ? 'disabled' : ''}
                 class="h-4 w-4 mt-0.5 ${locked ? '' : 'cursor-pointer'}" style="accent-color:#2148e3"
                 aria-label="${T.analysePackageLabel(p.name)}" />
        </td>
        <td class="px-3 py-3">
          <span class="font-semibold text-slate-800 whitespace-nowrap">${p.name}</span>
          ${index === optState.recommendedIndex
            ? '<span class="ml-1.5 align-middle text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">' + T.badgeRecommended + '</span>'
            : ''}
          <span class="block text-xs text-slate-600 mt-0.5">${p.description}</span>
          ${locked ? T.row_1(euro(EMPLOYEE_PARAMS.BONUS_INCOME_MAX)) : ''}
        </td>
        <td class="num px-3 py-3 text-right font-semibold text-slate-900">${euro(p.salary)}</td>
        <td class="num px-3 py-3 text-right text-slate-600">${euro(p.netCash)}</td>
        <td class="num px-3 py-3 text-right text-emerald-700">${p.welfare > 0 ? euro(p.welfare) : '—'}</td>
        <td class="num px-3 py-3 text-right font-bold text-slate-900">${euro(p.employerCost)}</td>
        <td class="num px-6 py-3 text-right font-bold ${index === 0 ? 'text-slate-600' : (optState.mode === 'net' ? (deltaCost < -0.5 ? 'text-emerald-700' : 'text-slate-600') : (deltaValue > 0.5 ? 'text-emerald-700' : 'text-slate-600'))}">
          ${index === 0 ? T.referenceLabel
            : optState.mode === 'net'
              ? (deltaCost < -0.5 ? '− ' + euro(Math.abs(deltaCost)) : '—')
              : (deltaValue > 0.5 ? '+ ' + euro(deltaValue) : '—')}
        </td>
      </tr>`;
  };

  el('opt-outcome').innerHTML = T.paintOptimisation_5(optState.mode === 'net'
          ? T.paintOptimisation_4(euro(value), euro(recommended.employerCost), euro(reference.employerCost), euro(gain))
            + (Math.abs(recommended.totalValue - value) > 1
                ? T.paintOptimisation_3(euro(recommended.totalValue))
                : '')
          : T.paintOptimisation_2(euro(value), euro(recommended.totalValue), euro(reference.totalValue), euro(gain)), fmtPct.format(recommended.cashShare * 100), optState.mode === 'net' ? T.paintOptimisation_6 : T.paintOptimisation_1, packages.map(row).join(''), foregoneBlock(reference, chosen, params), thresholdsBlock(params, chosen), fmtPct2.format(efficiency.salary), fmtPct2.format(efficiency.fringe), fmtPct2.format(efficiency.vouchers), fmtPct2.format(efficiency.bonusWelfare), fmtPct2.format(efficiency.bonusCash), euro(EMPLOYEE_PARAMS.BONUS_INCOME_MAX), params.voucherDays);
}

/* Welfare is not pay: what the worker does not receive in the payslip does
   not feed pension or TFR. It must be said next to the saving. */
function foregoneBlock(reference, chosen, params) {
  const header = (subtitle) => T.header_1(subtitle);

  if (chosen === reference || chosen.welfare <= 0) {
    return T.foregoneBlock_4(header(T.foregoneBlock_6(chosen.name)));
  }

  const a = foregoneAnalysis(reference, chosen);

  return T.foregoneBlock_5(header(T.foregoneBlock_3(chosen.name, reference.name)), euro(a.welfare), a.deltaValue > 0.5
              ? T.foregoneBlock_2(euro(a.deltaValue))
              : T.foregoneBlock_1(euro(a.deltaCost)), euro(a.deltaSalary), euro(a.deltaTfr), euro(a.deltaPensionPot), euro(a.annualForegone));
}

/* Some thresholds are real steps: going one euro over loses a whole amount.
   Moving pay into welfare can bring taxable income back below the step. The
   lever available is the welfare of the chosen package, not the total of
   the legal caps. */
function thresholdsBlock(params, chosen) {
  const capacity = Math.max(0, chosen.welfare);
  const base = { ...params, salary: params.salary || chosen.salary };
  const opportunity = capacity > 0 ? thresholdOpportunity(base, capacity) : null;

  /* If the threshold exists but this package's welfare does not reach it, the
     box does not disappear without explanation: it says how much is missing. */
  if (!opportunity) {
    const caps = exemptCaps(params);
    const fullValue = thresholdOpportunity(base, caps.fringe + caps.vouchers + caps.perfBonus);
    if (!fullValue) return '';
    return T.thresholdsBlock_3(fullValue.name, euro(fullValue.value), euro(fullValue.shift), chosen.name, euro(capacity));
  }

  return T.thresholdsBlock_4(chosen.name, euro(capacity), opportunity.name, euro(opportunity.value), euro(opportunity.shift), euro(opportunity.taxableAfter), euro(opportunity.gain), opportunity.notch
          ? T.thresholdsBlock_2
          : T.thresholdsBlock_1);
}

el('btn-optimise').addEventListener('click', () => {
  renderOptimisation('net', el('emp-net-target').value);
  el('opt-outcome').closest('.bg-white').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

el('btn-optimise-budget').addEventListener('click', () => renderOptimisation('budget', el('opt-budget').value));

/* The whole row is the clickable area: the radio gives keyboard access, the
   row gives mouse comfort. */
el('opt-outcome').addEventListener('click', (e) => {
  const row = e.target.closest('tr[data-package]');
  if (!row || !optState) return;
  const index = Number(row.dataset.package);
  const chosen = optState.packages[index];
  if (!chosen || chosen.bonusOverThreshold || index === optState.chosen) return;
  optState.chosen = index;
  paintOptimisation();
});
el('opt-budget').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); renderOptimisation('budget', el('opt-budget').value); }
});

/* ------------------------------------------- Scenario comparison */
let lockedScenario = null;

function comparisonRow(item, a, b, format, invertColor) {
  const delta = b - a;
  const negligible = Math.abs(delta) < 0.5;
  const positive = invertColor ? delta < 0 : delta > 0;
  const color = negligible ? 'text-slate-600' : positive ? 'text-emerald-700' : 'text-rose-700';
  const sign = negligible ? '' : delta > 0 ? '+ ' : '− ';
  return `<tr><td class="px-6 py-3 font-medium text-slate-700">${item}</td><td class="num px-4 py-3 text-right text-slate-600">${format(a)}</td><td class="num px-4 py-3 text-right font-semibold text-slate-900">${format(b)}</td><td class="num px-6 py-3 text-right font-bold ${color}">${negligible ? '—' : sign + format(Math.abs(delta))}</td></tr>`;
}

function describeScenario(p) {
  const municipality = MUNICIPALITIES_BY_CODE.get(p.municipality);
  return [euro(p.salary), p.year, municipality ? municipality.name : '—', CONTRIBUTION_PROFILES[normaliseProfile(p.profile)].name].join(' · ');
}

/* A difference in figures: green when it improves for the worker, red when
   it gets worse. On costs and on the levy the direction is reversed, because
   going down is good news. */
function pill(item, a, b, format, invertColor) {
  const delta = b - a;
  const negligible = Math.abs(delta) < 0.5;
  const positive = invertColor ? delta < 0 : delta > 0;
  const color = negligible ? 'text-slate-600' : positive ? 'text-emerald-700' : 'text-rose-700';
  const sign = negligible ? '' : delta > 0 ? '+ ' : '− ';
  return `<span class="inline-flex items-baseline gap-1.5">
      <span class="text-slate-600">${item}</span>
      <span class="num font-bold ${color}">${negligible ? '=' : sign + format(Math.abs(delta))}</span>
    </span>`;
}

function renderComparison() {
  const empty = el('comparison-empty');
  const table = el('comparison-table');

  if (!lockedScenario) {
    empty.classList.remove('hidden');
    table.classList.add('hidden');
    el('btn-clear-scenario').classList.add('hidden');
    el('btn-lock-scenario').textContent = T.renderComparison_16;

    el('comparison-bar-state').innerHTML =
      T.renderComparison_15;
    el('btn-lock-bar').textContent = T.renderComparison_14;
    el('btn-clear-bar').classList.add('hidden');
    el('comparison-bar-delta').classList.add('hidden');
    return;
  }

  const paramsB = readEmployeeParams();
  const a = lockedScenario.result;
  const b = computeEmployee(paramsB);

  empty.classList.add('hidden');
  table.classList.remove('hidden');
  el('btn-clear-scenario').classList.remove('hidden');
  el('btn-lock-scenario').textContent = T.renderComparison_13;

  el('tbody-comparison').innerHTML =
      T.renderComparison_20(describeScenario(lockedScenario.params), describeScenario(paramsB), comparisonRow(T.renderComparison_12, a.netMonthly, b.netMonthly, euro), comparisonRow(T.renderComparison_11, a.netAnnual, b.netAnnual, euro), comparisonRow(T.renderComparison_10, a.totalValue, b.totalValue, euro), comparisonRow(T.renderComparison_9, a.totalDeductions, b.totalDeductions, euro, true), comparisonRow(T.renderComparison_19, a.taxPressure, b.taxPressure, pct, true), comparisonRow(T.renderComparison_8, a.employerCost, b.employerCost, euro, true), comparisonRow(T.renderComparison_7, a.efficiency, b.efficiency, pct));

  /* The same difference, at the top of the results and on a single line: it is
     the one people watch while moving the parameters. The table below stays
     for those who want every item. */
  el('comparison-bar-state').innerHTML =
    T.renderComparison_6(describeScenario(lockedScenario.params));
  el('btn-lock-bar').textContent = T.renderComparison_5;
  el('btn-clear-bar').classList.remove('hidden');

  const bar = el('comparison-bar-delta');
  bar.classList.remove('hidden');
  bar.innerHTML = T.renderComparison_17(pill(T.renderComparison_4, a.netMonthly, b.netMonthly, euro), pill(T.renderComparison_3, a.netAnnual, b.netAnnual, euro), pill(T.renderComparison_2, a.totalValue, b.totalValue, euro), pill(T.renderComparison_1, a.employerCost, b.employerCost, euro, true), pill(T.renderComparison_18, a.taxPressure, b.taxPressure, pct, true));

  el('btn-go-comparison').addEventListener('click', () => {
    el('comparison-empty').closest('.bg-white').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

/* Two buttons for the same action, one at the top and one next to the table:
   whoever is looking at the detail must not scroll back up to lock a scenario. */
const lockScenario = () => {
  const params = readEmployeeParams();
  lockedScenario = { params, result: computeEmployee(params) };
  renderComparison();
};
const clearScenario = () => { lockedScenario = null; renderComparison(); };

el('btn-lock-scenario').addEventListener('click', lockScenario);
el('btn-lock-bar').addEventListener('click', lockScenario);
el('btn-clear-scenario').addEventListener('click', clearScenario);
el('btn-clear-bar').addEventListener('click', clearScenario);

/* ------------------------------------------- State in the address */
/* The scenario lives in the URL: someone sets up the simulation and sends
   the link, which reopens identical. Only parameters different from their
   default end up in the address, to keep it readable. */
const URL_FIELDS = {
  'ral': ['emp-salary', '45000'], 'mensilita': ['emp-payments', '13'], 'profilo': ['emp-profile', DEFAULT_PROFILE],
  'rapporto': ['emp-contract', 'indeterminato'],
  'aregime': ['se-regime', 'ordinario'], 'compenso': ['se-revenue', '50000'],
  'agestione': ['se-scheme', 'separata_professionisti'],
  'acosti': ['se-costs', '0'], 'acoeff': ['se-coefficient', 'professionali'],
  'aanno': ['se-year', '2026'], 'aregione': ['se-region', 'Lombardia'], 'regione': ['emp-region', 'Lombardia'], 'giorni': ['emp-days', '365'], 'parttime': ['emp-parttime', '100'],
  'figli': ['emp-children', '0'], 'figlimin': ['emp-young-children', '0'], 'altri': ['emp-others', '0'], 'fringe': ['emp-fringe', '0'],
  'buoni': ['emp-vouchers', '0'], 'buonigiorni': ['emp-vouchers-days', '220'], 'premio': ['emp-bonus', '0'],
  'accessori': ['emp-premiums', '0'], 'rinnovo': ['emp-renewal', '0'], 'fondo': ['emp-fund', '0'],
  'fondodatore': ['emp-fund-employer', '0'], 'trattenute': ['emp-deductions', '0'],
  'regime': ['emp-regime', 'nessuno']
};
const URL_TOGGLES = {
  'massimale': ['emp-ceiling', true], 'coniuge': ['emp-spouse', false], 'figli100': ['emp-children-full', false], 'elettronici': ['emp-vouchers-electronic', true],
  'welfare': ['emp-bonus-welfare', false], 'impatriatifigli': ['emp-inbound-children', false],
  'tfrfondo': ['emp-tfr-fund', false], 'ariduzione': ['se-reduction', false]
};

let restoring = false;
let urlTimer = null;

/* Browsers limit how often history.replaceState can be called: one call per
   keystroke goes over the limit and the following ones are silently dropped,
   leaving the address behind the fields. So it is written once, when the
   user has stopped typing. */
function writeUrl() {
  clearTimeout(urlTimer);
  urlTimer = setTimeout(writeUrlNow, 350);
}

function writeUrlNow() {
  if (restoring) return;
  const q = new URLSearchParams();
  q.set('sezione', !el('panel-selfemployed').classList.contains('hidden') ? 'piva' : 'dipendente');
  q.set('anno', String(currentYear));
  if (currentMunicipality !== 'F205') q.set('comune', currentMunicipality);

  for (const key of Object.keys(URL_FIELDS)) {
    const [id, defaultValue] = URL_FIELDS[key];
    const node = el(id);
    if (node && node.value !== defaultValue) q.set(key, node.value);
  }
  for (const key of Object.keys(URL_TOGGLES)) {
    const [id, defaultValue] = URL_TOGGLES[key];
    const node = el(id);
    if (node && node.checked !== defaultValue) q.set(key, node.checked ? '1' : '0');
  }
  /* The state goes after the #: the fragment stays in the browser and never
     reaches the server, not even when someone opens a shared link. */
  history.replaceState(null, '', location.pathname + '#' + q.toString());
}

function readUrl() {
  /* New links carry the state after the #; old ones in the query string, and
     they must keep opening. A fragment without parameters ("#piva") stays the
     old link to the tab. */
  const fragment = location.hash.slice(1);
  const q = new URLSearchParams(fragment.includes('=') ? fragment : location.search);
  if (![...q.keys()].length) return null;

  restoring = true;
  if (q.has('anno')) currentYear = parseInt(q.get('anno'), 10) === 2025 ? 2025 : 2026;
  if (q.has('comune') && MUNICIPALITIES_BY_CODE.has(q.get('comune'))) {
    currentMunicipality = q.get('comune');
    municipalityChosen = true;
  }

  for (const key of Object.keys(URL_FIELDS)) {
    const node = el(URL_FIELDS[key][0]);
    if (!node || !q.has(key)) continue;
    const value = q.get(key);
    /* A select only accepts the values it really has. Assigning an invented one
       leaves it with no selection, and from then on the engine looks for a key
       that does not exist in any table: a wrong address must not be able to
       break the page. The unknown value is discarded and the default stays. */
    if (node.tagName === 'SELECT' && ![...node.options].some((o) => o.value === value)) continue;
    node.value = value;
  }
  for (const key of Object.keys(URL_TOGGLES)) {
    const node = el(URL_TOGGLES[key][0]);
    if (node && q.has(key)) node.checked = q.get(key) === '1';
  }

  highlightActiveYear();

  const c = MUNICIPALITIES_BY_CODE.get(currentMunicipality);
  if (c) el('emp-municipality-search').value = `${c.name} (${c.province})`;
  if (!q.has('regione')) alignRegionToMunicipality(currentMunicipality);

  fillContributionProfile(el('emp-profile').value);

  restoring = false;
  const section = q.get('sezione');
  /* The old «base» tab no longer exists: saved links open the employee
     calculation, which covers the same scenario. */
  // Public values in the address: 'dipendente' and 'piva'. Older links say
  // 'premium' or 'base' (both are the employee calculation) and still open.
  if (['dipendente', 'premium', 'base'].includes(section)) return 'employee';
  return section === 'piva' ? 'selfEmployed' : null;
}

/* ------------------------------------------ Explanation popover */
const popover = document.createElement('div');
popover.id = 'explain-popover';
popover.setAttribute('role', 'dialog');
popover.hidden = true;
document.body.appendChild(popover);

let trigger = null;
let justOpened = false;
let openTimer = null;

function closeExplanation() {
  if (trigger) trigger.setAttribute('aria-expanded', 'false');
  trigger = null;
  popover.hidden = true;
}

function openExplanation(button) {
  const explanation = EXPLANATIONS.get(button.dataset.explain);
  if (!explanation) return;

  if (trigger && trigger !== button) trigger.setAttribute('aria-expanded', 'false');
  trigger = button;
  button.setAttribute('aria-expanded', 'true');

  justOpened = true;
  clearTimeout(openTimer);
  openTimer = setTimeout(() => { justOpened = false; }, 400);

  popover.innerHTML = T.openExplanation_1(explanation.title, explanation.body, explanation.html || '', explanation.source ? `<p class="exp-source">${explanation.source}</p>` : '');
  popover.hidden = false;

  // On a narrow screen the position is fixed by CSS: the panel takes the
  // bottom of the screen and nothing needs computing.
  if (narrowScreen()) {
    popover.style.left = '';
    popover.style.top = '';
    return;
  }

  // Otherwise: below the button, flipped above if there is no room,
  // and always inside the window.
  const b = button.getBoundingClientRect();
  const p = popover.getBoundingClientRect();
  const margin = 8;

  let left = b.left + b.width / 2 - p.width / 2;
  left = Math.max(margin, Math.min(left, window.innerWidth - p.width - margin));

  let high = b.bottom + margin;
  if (high + p.height > window.innerHeight - margin) {
    high = Math.max(margin, b.top - p.height - margin);
  }

  popover.style.left = left + 'px';
  popover.style.top = high + 'px';
}

const narrowScreen = () => window.matchMedia('(max-width: 640px)').matches;
// Opening on hover only applies where a real pointer exists: on touch the
// browser fires mouseover and immediately after click, and the explanation
// would close by itself in the same tap.
const endPointer = () => window.matchMedia('(hover: hover) and (pointer: fine)').matches;

document.addEventListener('click', (e) => {
  if (e.target.closest('.exp-close')) { closeExplanation(); return; }

  const button = e.target.closest('.explain');
  if (button) {
    e.preventDefault();
    // On touch the previous mouseover has already opened this explanation:
    // the click must not read it as a request to close.
    if (trigger === button && !justOpened) closeExplanation();
    else openExplanation(button);
    return;
  }
  if (!popover.contains(e.target)) closeExplanation();
});

// On hover opening is immediate, but only with a real pointer.
document.addEventListener('mouseover', (e) => {
  if (!endPointer()) return;
  const button = e.target.closest('.explain');
  if (button && button !== trigger) openExplanation(button);
});
document.addEventListener('focusin', (e) => {
  const button = e.target.closest('.explain');
  if (button) openExplanation(button);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeExplanation();
});
// Scrolling moves the button and the explanation would be left orphaned: it
// closes. Not when it is the panel anchored at the bottom, which stays valid,
// and never in the instant right after a tap opened it.
window.addEventListener('scroll', () => {
  if (!narrowScreen() && !justOpened) closeExplanation();
}, true);
window.addEventListener('resize', closeExplanation);

/* ====================================================================
   INTERFACE — VAT NUMBER (PARTITA IVA)
   ==================================================================== */

function readSelfEmployedParams() {
  const choice = FLAT_RATE_COEFFICIENTS.find((c) => c.key === el('se-coefficient').value)
              || FLAT_RATE_COEFFICIENTS[0];
  return {
    year: parseInt(el('se-year').value, 10) === 2025 ? 2025 : 2026,
    revenue: Math.max(0, parseFloat(el('se-revenue').value) || 0),
    costs: Math.max(0, parseFloat(el('se-costs').value) || 0),
    selfEmployedRegime: el('se-regime').value,
    scheme: el('se-scheme').value,
    flatRateReduction: el('se-reduction').checked,
    coefficient: choice.coefficient,
    group: choice,
    region: el('se-region').value,
    municipality: currentMunicipality
  };
}

function selfEmployedRow(item, note, annual, opts = {}) {
  return cascadeRow(item, note, annual, 12, opts);
}

/* The derivations of the self-employed tab. They are needed here more than
   anywhere else: the order of the factors is reversed compared with
   employment - contributions are computed on income and then deducted - and
   in the flat-rate regime income is not what was earned, but a percentage
   of revenue. */
function selfEmployedExplanations(r, scheme) {
  const S = {};

  S.income = r.flatRateRegime ? {
    title: T.selfEmployedExplanations_title_8,
    body: T.selfEmployedExplanations_body_11,
    html: formula([
      [T.selfEmployedExplanations_html_20, euro2(r.revenue)],
      [T.selfEmployedExplanations_html_30, fmtPct.format(r.coefficient * 100) + '%']
    ], [T.selfEmployedExplanations_html_19, euro2(r.grossIncome)])
  } : {
    title: T.selfEmployedExplanations_title_7,
    body: T.selfEmployedExplanations_body_10,
    html: formula([
      [T.selfEmployedExplanations_html_18, euro2(r.revenue)],
      [T.selfEmployedExplanations_html_29, euro2(r.costs)]
    ], [T.selfEmployedExplanations_html_17, euro2(r.grossIncome)])
  };

  S.contributions = {
    title: T.selfEmployedExplanations_title_6,
    body: T.selfEmployedExplanations_body_13(r.contributionsOnMinimum
          ? T.selfEmployedExplanations_body_9
          : '', r.ceilingReached
          ? T.selfEmployedExplanations_body_8
          : ''),
    html: formula(r.contributionsOnMinimum
      ? [[T.selfEmployedExplanations_html_16, euro2(r.grossIncome)],
         [T.selfEmployedExplanations_html_15, euro2(r.schemeMinimum)],
         [T.selfEmployedExplanations_html_14, euro2(r.schemeMinimum)]]
      : [[T.selfEmployedExplanations_html_28, euro2(r.contributionBase)],
         [T.selfEmployedExplanations_html_13, fmtPct2.format(scheme.rate * 100) + '%']],
      [T.selfEmployedExplanations_html_12, euro2(r.contributions)]),
    source: scheme.source
  };

  if (r.contributionReduction > 0) {
    S.reduction = {
      title: T.selfEmployedExplanations_title_5,
      body: T.selfEmployedExplanations_body_7,
      html: formula([
        [T.selfEmployedExplanations_html_11, euro2(r.contributions + r.contributionReduction)],
        [T.selfEmployedExplanations_html_10, euro2(r.contributionReduction)]
      ], [T.selfEmployedExplanations_html_9, euro2(r.contributions)])
    };
  }

  S.taxable = {
    title: T.selfEmployedExplanations_title_10,
    body: T.selfEmployedExplanations_body_6,
    html: formula([
      [T.selfEmployedExplanations_html_8, euro2(r.grossIncome)],
      [T.selfEmployedExplanations_html_7, euro2(r.contributions)]
    ], [T.selfEmployedExplanations_html_27, euro2(r.taxable)])
  };

  if (r.flatRateRegime) {
    const rate = r.selfEmployedRegime === 'forfettario5' ? FLAT_RATE.startUpRate : FLAT_RATE.rate;
    S.tax = {
      title: T.selfEmployedExplanations_title_4,
      body: T.selfEmployedExplanations_body_5,
      html: formula([
        [T.selfEmployedExplanations_html_26, euro2(r.taxable)],
        [T.selfEmployedExplanations_html_6, fmtPct.format(rate * 100) + '%']
      ], [T.selfEmployedExplanations_html_5, euro2(r.substituteTax)])
    };
  } else {
    S.irpef = {
      title: T.selfEmployedExplanations_title_9,
      body: T.selfEmployedExplanations_body_4
        + bracketsDescription(r.year),
      html: formula([
        [T.selfEmployedExplanations_html_25, euro2(r.taxable)]
      ], [T.selfEmployedExplanations_html_24, euro2(r.grossIrpef)])
    };
    S.deduction = {
      title: T.selfEmployedExplanations_title_3,
      body: T.selfEmployedExplanations_body_3,
      html: formula([
        [T.selfEmployedExplanations_html_23, euro2(r.grossIrpef)],
        [T.selfEmployedExplanations_html_4, euro2(r.deduction)]
      ], [T.selfEmployedExplanations_html_22, euro2(r.netIrpef)])
    };
  }

  /* The steps must add up to the result shown, otherwise the explanation
     contradicts the number it claims to explain. Two items are therefore
     included only when they really exist: costs, which are not deducted in the
     flat-rate regime, and the shortfall, which appears when revenue does not
     cover the contributions and the net stops at zero. */
  const netSteps = [[T.netSteps_1, euro2(r.revenue)]];
  if (r.costs > 0) netSteps.push([T.selfEmployedExplanations_4, euro2(r.costs)]);
  netSteps.push([T.selfEmployedExplanations_3, euro2(r.contributions)]);
  netSteps.push([T.selfEmployedExplanations_2, euro2(r.taxes)]);
  if (r.netShortfall > 0.005) netSteps.push([T.selfEmployedExplanations_1, euro2(r.netShortfall)]);

  S.net = {
    title: T.selfEmployedExplanations_title_2,
    body: T.selfEmployedExplanations_body_12(r.netShortfall > 0.005
          ? T.selfEmployedExplanations_body_2
          : ''),
    html: formula(netSteps, [T.selfEmployedExplanations_html_3, euro2(r.netAnnual)])
  };

  S.pressure = {
    title: T.selfEmployedExplanations_title_1,
    body: T.selfEmployedExplanations_body_1,
    html: formula([
      [T.selfEmployedExplanations_html_2, euro2(r.revenue - r.costs)],
      [T.selfEmployedExplanations_html_1, euro2(r.contributions + r.taxes)]
    ], [T.selfEmployedExplanations_html_21, fmtPct.format(r.pressure) + '%'])
  };

  return S;
}

function updateSelfEmployed() {
  const p = readSelfEmployedParams();
  const r = computeSelfEmployed(p);
  const flatRateRegime = r.flatRateRegime;
  openExplanationRegistry('a');

  // Controls with no effect in the chosen regime disappear instead of staying
  // there suggesting that something changes: the coefficient does not exist
  // in the ordinary regime, surcharges do not exist in the flat-rate one.
  el('se-row-coefficient').classList.toggle('hidden', !flatRateRegime);
  el('se-row-costs').classList.toggle('hidden', flatRateRegime);
  el('se-row-region').classList.toggle('hidden', flatRateRegime);
  el('se-regime-note').textContent = (SELF_EMPLOYED_REGIMES[p.selfEmployedRegime] || SELF_EMPLOYED_REGIMES.ordinario).note;

  /* The 35% reduction is an option only for flat-rate taxpayers enrolled in
     the artisans' and traders' schemes: where it does not apply, the box does
     not appear instead of staying there with no effect. */
  const schemeDef = PENSION_SCHEMES[p.scheme] || PENSION_SCHEMES.separata_professionisti;
  const reductionAllowed = flatRateRegime && !!schemeDef.flatRateReductionRate;
  el('se-row-reduction').className = reductionAllowed
    ? 'flex items-start gap-3 cursor-pointer' : 'hidden items-start gap-3 cursor-pointer';
  if (!reductionAllowed) el('se-reduction').checked = false;

  el('se-scheme-note').innerHTML = schemeDef.note
    + (r.contributionsOnMinimum
        ? T.updateSelfEmployed_31
        : '')
    + `<span class="block text-slate-600 mt-0.5">${schemeDef.source}</span>`;
  el('se-coefficient-note').textContent = flatRateRegime
    ? T.updateSelfEmployed_30(p.group.ateco, fmtPct.format(p.coefficient * 100))
    : '';
  el('se-municipality-note').textContent = flatRateRegime
    ? T.updateSelfEmployed_29
    : T.updateSelfEmployed_28(r.municipalityName);
  el('se-threshold-note').textContent = flatRateRegime
    ? T.updateSelfEmployed_27(euro(FLAT_RATE.threshold))
    : T.updateSelfEmployed_26;

  el('se-net-month').textContent = euro(r.netMonthly);
  updateNetBar('selfEmployed', r.netMonthly, r.netAnnual);
  announce(T.updateSelfEmployed_25(euro(r.netMonthly), euro(r.netAnnual)));
  el('se-net-year').textContent = euro(r.netAnnual);
  const S = selfEmployedExplanations(r, r.schemeForYear);
  el('se-pressure').innerHTML = (r.revenue > 0
    ? T.updateSelfEmployed_24(fmtPct.format(r.pressure))
    : '—') + '<span id="tip-se-pressure"></span>';
  el('tip-se-pressure').innerHTML = r.revenue > 0 ? explanationButton(S.pressure) : '';
  el('se-subtitle').textContent = T.updateSelfEmployed_23(r.regimeName, r.year);

  const rows = [
    selfEmployedRow(T.rows_2, T.rows_1, r.revenue, { strong: true })
  ];
  if (!flatRateRegime && r.costs > 0) {
    rows.push(selfEmployedRow(T.updateSelfEmployed_37, T.updateSelfEmployed_22, r.costs, { type: 'negative' }));
  }
  if (flatRateRegime) {
    rows.push(selfEmployedRow(T.updateSelfEmployed_21,
      T.updateSelfEmployed_20(fmtPct.format(r.coefficient * 100)),
      r.grossIncome, { highlight: true, explain: S.income }));
  } else {
    rows.push(selfEmployedRow(T.updateSelfEmployed_19,
      T.updateSelfEmployed_18, r.grossIncome, { highlight: true, explain: S.income }));
  }
  const currentScheme = r.schemeForYear;
  const contributionsNote = r.contributionsOnMinimum
    ? T.contributionsNote_4(euro(r.schemeMinimum))
    : (r.ceilingReached
        ? T.contributionsNote_3(fmtPct2.format(currentScheme.rate * 100), euro(currentScheme.ceiling))
        : T.contributionsNote_2(fmtPct2.format(currentScheme.rate * 100))
          + (currentScheme.rateAbove ? T.contributionsNote_1(fmtPct2.format(currentScheme.rateAbove * 100), euro(currentScheme.bandThreshold)) : ''));
  rows.push(selfEmployedRow(T.updateSelfEmployed_17(r.schemeName), contributionsNote, r.contributions,
    { type: 'negative', explain: S.contributions }));
  if (r.contributionReduction > 0) {
    rows.push(selfEmployedRow(T.updateSelfEmployed_16,
      T.updateSelfEmployed_15,
      r.contributionReduction, { type: 'neutral', indent: true, explain: S.reduction }));
  }
  rows.push(selfEmployedRow(T.updateSelfEmployed_36,
    T.updateSelfEmployed_14, r.taxable,
    { highlight: true, explain: S.taxable }));

  if (flatRateRegime) {
    const rate = r.selfEmployedRegime === 'forfettario5' ? FLAT_RATE.startUpRate : FLAT_RATE.rate;
    rows.push(selfEmployedRow(T.updateSelfEmployed_13,
      T.updateSelfEmployed_12(fmtPct.format(rate * 100)),
      r.substituteTax, { type: 'negative', explain: S.tax }));
  } else {
    rows.push(selfEmployedRow(T.updateSelfEmployed_35, T.updateSelfEmployed_34(r.year), r.grossIrpef,
      { type: 'negative', explain: S.irpef }));
    rows.push(selfEmployedRow(T.updateSelfEmployed_11,
      T.updateSelfEmployed_10, r.deduction,
      { type: 'positive', indent: true, explain: S.deduction }));
    rows.push(selfEmployedRow(T.updateSelfEmployed_33, r.regionName, r.regionalTax, { type: 'negative' }));
    rows.push(selfEmployedRow(T.updateSelfEmployed_32, r.municipalityName, r.municipalTax, { type: 'negative' }));
  }
  rows.push(selfEmployedRow(T.updateSelfEmployed_9, T.updateSelfEmployed_8, r.netAnnual,
    { strong: true, highlight: true, explain: S.net }));
  /* The net stops at zero because below zero it is no longer a net: it is a
     debt to INPS. Saying it on its own row is the only way for the big number
     not to lie. */
  if (r.netShortfall > 0.005) {
    rows.push(selfEmployedRow(T.updateSelfEmployed_7,
      T.updateSelfEmployed_6(euro(r.schemeMinimum)),
      r.netShortfall, { type: 'negative', indent: true }));
  }
  el('se-detail').innerHTML = rows.join('');

  /* The comparison between the three regimes is why this section exists: the
     real question is not how much one pays, but how the regimes compare for
     the same revenue. */
  const comparisons = Object.keys(SELF_EMPLOYED_REGIMES).map((key) => {
    const alt = computeSelfEmployed({ ...p, selfEmployedRegime: key });
    return { key, alt };
  });
  const best = comparisons.reduce((a, b) => (b.alt.netAnnual > a.alt.netAnnual ? b : a));
  el('se-comparison').innerHTML = comparisons.map(({ key, alt }) => {
    const current = key === p.selfEmployedRegime;
    const delta = alt.netAnnual - r.netAnnual;
    return `
      <tr class="${current ? 'bg-slate-50' : ''}">
        <td class="px-6 py-3">
          <span class="font-semibold text-slate-700">${SELF_EMPLOYED_REGIMES[key].name}</span>
          ${key === best.key ? T.updateSelfEmployed_5 : ''}
          ${current ? '<span class="ml-1 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-200 text-slate-600">' + T.badgeSelected + '</span>' : ''}
        </td>
        <td class="num px-4 py-3 text-right font-semibold text-slate-900">${euro2(alt.netAnnual)}</td>
        <td class="num px-6 py-3 text-right ${delta > 0.005 ? 'text-emerald-700' : delta < -0.005 ? 'text-rose-700' : 'text-slate-600'}">
          ${Math.abs(delta) < 0.005 ? '—' : (delta > 0 ? '+ ' : '− ') + euro2(Math.abs(delta))}
        </td>
      </tr>`;
  }).join('');

  // Two warnings that are not calculation errors but eligibility limits:
  // the calculation stays valid, the choice of regime does not.
  const warnings = [];
  if (r.overThreshold) {
    warnings.push(T.updateSelfEmployed_4(euro(r.revenue), euro(FLAT_RATE.threshold)));
  }
  if (best.key === 'forfettario5') {
    warnings.push(T.updateSelfEmployed_3);
  }
  if (r.selfEmployedRegime === 'forfettario5') {
    warnings.push(T.updateSelfEmployed_2);
  }
  if (r.netShortfall > 0.005) {
    warnings.push(T.updateSelfEmployed_1(euro2(r.netShortfall), euro(r.schemeMinimum)));
  }
  const alert = el('se-alert');
  alert.classList.toggle('hidden', warnings.length === 0);
  if (warnings.length) {
    alert.className = 'rounded-2xl border p-4 text-sm border-amber-200 bg-amber-50 text-amber-800';
    alert.innerHTML = warnings.map((t) => `<p>${t}</p>`).join('');
  }

  writeUrl();
}

['se-revenue', 'se-costs', 'se-regime', 'se-coefficient', 'se-year', 'se-region',
 'se-scheme', 'se-reduction'].forEach((id) => listenForChanges(el(id), updateSelfEmployed));

/* ------------------------------------------------------------ Tabs */
const active = 'px-4 py-2 text-sm font-semibold rounded-lg transition-colors bg-white text-brand-700 shadow-sm';
const inactive = 'px-4 py-2 text-sm font-semibold rounded-lg transition-colors text-slate-600 hover:text-slate-700';

/* There are two sections: only the classes change, the content of the
   buttons is left alone. */
const SECTIONS = {
  employee: { tab: 'tab-employee', panel: 'panel-employee', update: () => updateEmployee() },
  selfEmployed: { tab: 'tab-selfemployed', panel: 'panel-selfemployed', update: () => updateSelfEmployed() }
};

function showSection(name) {
  const choice = SECTIONS[name] ? name : 'employee';
  for (const [key, s] of Object.entries(SECTIONS)) {
    const own = key === choice;
    el(s.panel).classList.toggle('hidden', !own);
    const tab = el(s.tab);
    // Only the class is replaced, the content of the button stays.
    tab.className = own ? active : inactive;
    tab.setAttribute('aria-selected', String(own));
  }
  SECTIONS[choice].update();
  paintNetBar();
}

Object.keys(SECTIONS).forEach((name) => {
  el(SECTIONS[name].tab).addEventListener('click', () => showSection(name));
});

/* Declaring role="tablist" is a promise: keyboard users expect the arrows to
   move the selection between tabs and Home and End to reach the ends.
   Without this block the markup promised a behaviour that was not there. */
const sectionNames = Object.keys(SECTIONS);
sectionNames.forEach((name, i) => {
  el(SECTIONS[name].tab).addEventListener('keydown', (e) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    let destination = null;
    if (step !== undefined) destination = (i + step + sectionNames.length) % sectionNames.length;
    else if (e.key === 'Home') destination = 0;
    else if (e.key === 'End') destination = sectionNames.length - 1;
    if (destination === null) return;

    e.preventDefault();
    showSection(sectionNames[destination]);
    el(SECTIONS[sectionNames[destination]].tab).focus();
  });
});

/* ------------------------------------------------------ Bootstrap */
el('engine-version').textContent = ENGINE_VERSION;
el('engine-version-footer').textContent = ENGINE_VERSION;

// The dataset date is written by the update script: it tells the
// reader how recent the embedded municipal resolutions are.
const readableDate = new Date(DATASET_UPDATED)
  .toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });
el('date-dataset').textContent = readableDate;
el('rules-date').textContent = new Date(RULES_VERIFIED_ON)
  .toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });
el('date-dataset-employee').textContent = readableDate;
fillSelects();
const requestedSection = readUrl();
updateEmployee();
updateSelfEmployed();
showSection(requestedSection || (location.hash === '#piva' ? 'selfEmployed' : 'employee'));

// Expose the engine for inspection from the console
window.TaxEngine = { computeEmployee, computeSelfEmployed, invertNet, CONSTANTS, REGIONS, MUNICIPALITIES, ENGINE_VERSION };

/* Outcome of the checks in the page. */
function showTestOutcome(results) {
  const passed = results.filter((r) => r.outcome).length;
  const box = el('test-output');
  box.classList.remove('hidden');
  box.innerHTML = `
    <div class="rounded-xl border ${passed === results.length ? 'border-emerald-200 bg-emerald-50' : 'border-rose-200 bg-rose-50'} p-4">
      <p class="font-bold ${passed === results.length ? 'text-emerald-800' : 'text-rose-800'} text-sm">
        ${T.testsPassed(passed, results.length)}
      </p>
      <ul class="mt-3 space-y-1.5">
        ${results.map((r) => `
          <li class="flex items-start gap-2 text-sm">
            <span class="${r.outcome ? 'text-emerald-700' : 'text-rose-700'} font-bold">${r.outcome ? '✓' : '✗'}</span>
            <span class="text-slate-700">${r.name}
              ${r.detail ? `<span class="text-slate-600 text-xs ml-1">${r.detail}</span>` : ''}
            </span>
          </li>`).join('')}
      </ul>
    </div>`;
}
