// Run the engine test suite outside the browser (used by CI and locally).
//   node tools/run_tests.mjs
// The same suite runs in the page behind the "Esegui i controlli" button.
import { runTests } from '../src/tests/suite.js';

const results = runTests();
const failed = results.filter((r) => !r.outcome);
for (const f of failed) console.error(`  ✗ ${f.name}${f.detail ? ' — ' + f.detail : ''}`);
console.log(`${results.length - failed.length}/${results.length} tests passed`);
process.exit(failed.length ? 1 : 0);
