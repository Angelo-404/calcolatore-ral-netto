// Fixed list of scenarios for the golden master: tools/check_golden.mjs runs
// every one through the engine and compares the results, to the cent, with
// tools/golden/expected.json. The list must stay deterministic: same order,
// same parameters, same "today" for the hiring exemptions.
export const TODAY = '2026-10-02T12:00:00';

export function* employeeScenarios(engine) {
  const profiles = Object.keys(engine.CONTRIBUTION_PROFILES);
  const municipalities = ['F205', 'H501', 'L219', 'F839', 'A944', 'D612', 'E506', 'A060', 'L378', 'A952', 'C351', 'G273'];
  const regionOf = { F205: 'Lombardia', H501: 'Lazio', L219: 'Piemonte', F839: 'Campania', A944: 'Emilia-Romagna',
    D612: 'Toscana', E506: 'Puglia', A060: 'Lombardia', L378: 'Trento', A952: 'Bolzano', C351: 'Sicilia', G273: 'Sicilia' };
  const salaries = [0, 5000, 8000, 9500, 12000, 15000, 16500, 18000, 20000, 22000, 25000, 25328, 28000, 30000, 32000,
    35000, 38542, 40000, 45000, 50000, 55000, 56224, 60000, 75000, 90000, 122295, 150000, 200000, 400000];
  const contracts = ['indeterminato', 'determinato', 'apprendistato', 'collaboratore', 'tirocinio'];
  for (const year of [2025, 2026]) {
    for (const municipality of municipalities) {
      for (const salary of salaries) {
        yield { year, salary, municipality, region: regionOf[municipality], profile: 'commercio|impiegato|fino50', today: TODAY };
      }
    }
    for (const profile of profiles) {
      for (const salary of [15000, 30000, 60000, 130000]) {
        yield { year, salary, profile, municipality: 'F205', region: 'Lombardia', today: TODAY };
      }
    }
    for (const contractType of contracts) {
      for (const salary of [6000, 12000, 30000, 80000]) {
        for (const daysWorked of [365, 182, 62]) {
          yield { year, salary, contractType, daysWorked, municipality: 'F205', region: 'Lombardia', today: TODAY };
        }
      }
    }
    const extras = [
      { dependentSpouse: true, children: 2, otherDependants: 1 },
      { children: 1, youngChildren: 1 }, { children: 2, childDeductionFull: true },
      { partTime: 50 }, { monthlyPayments: 14 }, { monthlyPayments: 12 },
      { fringeBenefit: 1500 }, { fringeBenefit: 2500, children: 1 },
      { mealVoucherPerDay: 10, electronicVouchers: true }, { mealVoucherPerDay: 9, electronicVouchers: false },
      { performanceBonus: 3000 }, { performanceBonus: 3000, bonusAsWelfare: true },
      { shiftPremiums: 2000 }, { renewalIncrease: 1200 }, { pensionFund: 3000, employerFundContribution: 1.5 },
      { pensionFund: 2000, tfrToFund: true }, { otherDeductions: 1200 },
      { regime: 'impatriati' }, { regime: 'impatriati', inboundMinorChildren: true },
      { regime: 'ricercatori' }, { regime: 'frontalieri' }, { ceilingActive: true },
      { exemptions: ['giovani'] }, { exemptions: ['donne'] },
      { exemptions: ['sud_pmi'], region: 'Campania', municipality: 'F839' },
      { profile: 'dirigente' }, { profile: 'dirigente', daysWorked: 120 }
    ];
    for (const extra of extras) {
      for (const salary of [9000, 18000, 28000, 45000, 70000, 140000]) {
        yield { year, salary, municipality: 'F205', region: 'Lombardia', today: TODAY, ...extra };
      }
    }
  }
}

export function* selfEmployedScenarios(engine) {
  const regimes = ['ordinario', 'forfettario15', 'forfettario5'];
  const schemes = Object.keys(engine.PENSION_SCHEMES);
  for (const year of [2025, 2026]) {
    for (const selfEmployedRegime of regimes) {
      for (const scheme of schemes) {
        for (const revenue of [0, 8000, 15000, 22000, 40000, 70000, 90000, 110000, 200000]) {
          yield { year, selfEmployedRegime, scheme, revenue, costs: revenue * 0.2, coefficient: 0.78,
                  flatRateReduction: false, region: 'Lombardia', municipality: 'F205' };
          yield { year, selfEmployedRegime, scheme, revenue, costs: 0, coefficient: 0.67,
                  flatRateReduction: true, region: 'Lazio', municipality: 'H501' };
        }
      }
    }
  }
}

export function* inverseScenarios() {
  for (const year of [2025, 2026]) {
    for (const net of [8000, 15000, 17433, 22000, 26000, 35000, 60000]) {
      yield { net, params: { year, municipality: 'F205', region: 'Lombardia', today: TODAY } };
      yield { net, params: { year, municipality: 'H501', region: 'Lazio', today: TODAY, monthlyPayments: 14 } };
    }
  }
}
