// Golden master: runs a fixed list of scenarios through the engine and
// compares the main results, to the cent, with tools/golden/expected.json.
//   node tools/check_golden.mjs            compare (CI)
//   node tools/check_golden.mjs --update   rewrite the expected values
// A difference is not necessarily an error: after a deliberate change of the
// rules, check that every difference is the expected one, then --update.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as engine from '../src/engine/index.js';
import { employeeScenarios, selfEmployedScenarios, inverseScenarios } from './golden/scenarios.mjs';

const EXPECTED = fileURLToPath(new URL('./golden/expected.json', import.meta.url));
const EMPLOYEE_FIELDS = ['netAnnual', 'netMonthly', 'inps', 'taxable', 'grossIrpef', 'netIrpef', 'regionalTax',
  'municipalTax', 'wedgeBonus', 'integrativeTreatment', 'employerCost'];
const SELF_EMPLOYED_FIELDS = ['netAnnual', 'contributions', 'taxable', 'netIrpef', 'regionalTax', 'municipalTax',
  'substituteTax'];

const cents = (value) => Math.round(value * 100) / 100;
const pick = (result, fields) => fields.map((field) => cents(result[field]));

function run() {
  const rows = [];
  for (const params of employeeScenarios(engine)) {
    rows.push(['employee', params, pick(engine.computeEmployee(params), EMPLOYEE_FIELDS)]);
  }
  for (const params of selfEmployedScenarios(engine)) {
    rows.push(['selfEmployed', params, pick(engine.computeSelfEmployed(params), SELF_EMPLOYED_FIELDS)]);
  }
  for (const { net, params } of inverseScenarios()) {
    const r = engine.invertNet(net, params);
    rows.push(['inverse', { net, ...params }, [r.outcome, r.salary === undefined ? null : cents(r.salary)]]);
  }
  return rows;
}

const rows = run();
if (process.argv.includes('--update')) {
  writeFileSync(EXPECTED, JSON.stringify({ fields: { employee: EMPLOYEE_FIELDS, selfEmployed: SELF_EMPLOYED_FIELDS },
    results: rows.map((row) => row[2]) }) + '\n');
  console.log(`${rows.length} scenarios written to tools/golden/expected.json`);
  process.exit(0);
}

const expected = JSON.parse(readFileSync(EXPECTED, 'utf8')).results;
let differences = 0;
if (expected.length !== rows.length) {
  console.error(`  ✗ ${rows.length} scenarios against ${expected.length} expected: the scenario list changed`);
  process.exit(1);
}
rows.forEach(([kind, params, actual], i) => {
  if (JSON.stringify(actual) === JSON.stringify(expected[i])) return;
  differences++;
  if (differences <= 20) {
    console.error(`  ✗ ${kind} ${JSON.stringify(params)}\n      expected ${JSON.stringify(expected[i])}\n      got      ${JSON.stringify(actual)}`);
  }
});
console.log(`${rows.length - differences}/${rows.length} scenarios identical to the cent`);
process.exit(differences ? 1 : 0);
