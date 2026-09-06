/* Every check for the try-on demo.  node test/run.mjs
 *
 * There is no test framework here on purpose: the app is a static page with no
 * build step, and a runner that needs installing is a runner that stops being
 * run. These are four plain scripts that exit non-zero when something is wrong.
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const suites = [
  ['page-loads     ', 'the page module evaluates (catches TDZ, missing ids)'],
  ['glb-valid      ', 'hoodie.glb parses as a rigged glTF'],
  ['pose-maths     ', 'the garment lands on the body at its spec size'],
  ['scale-reference', 'height beats the eye line for scale'],
  ['ops-page      ', 'the dispatch queue renders every row'],
].map(([f, why]) => [f.trim(), f, why]);

let failed = 0;
for (const [file, label, why] of suites) {
  const r = spawnSync(process.execPath, [join(HERE, file + '.mjs')], { encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  const ok = r.status === 0 && !/FAIL|THREW/.test(out);
  if (!ok) failed++;
  console.log(`\n${ok ? '  PASS' : '  FAIL'}  ${label}  ${why}`);
  if (!ok) console.log(out.split('\n').map((l) => '        ' + l).join('\n'));
}
console.log(failed ? `\n  ${failed} suite(s) failed\n` : '\n  all suites passed\n');
process.exit(failed ? 1 : 0);
