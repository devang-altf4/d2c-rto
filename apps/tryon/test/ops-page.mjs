/* Execute the ops page module against a stub DOM and the real queue file.
 *
 * Parsing is not running. This catches a bad field name in the data, a render
 * that throws on the first row, or a getElementById that returns nothing —
 * none of which `node --check` can see, and all of which would show the ops
 * team an empty table. */
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const P = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(join(tmpdir(), 'ops-test-'));
const html = readFileSync(join(P, 'ops.html'), 'utf8');
const queue = JSON.parse(readFileSync(join(P, 'ops-queue.json'), 'utf8'));

const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
const missing = new Set();
const sinks = {};            // innerHTML written per element id

const el = (id) => ({
  id,
  set innerHTML(v) { sinks[id] = String(v); },
  get innerHTML() { return sinks[id] ?? ''; },
  set textContent(v) { sinks[id + '.text'] = String(v); },
  get textContent() { return sinks[id + '.text'] ?? ''; },
  dataset: {},
  className: '',
  setAttribute() {}, getAttribute: () => null, addEventListener() {},
  querySelectorAll: () => [],
});

globalThis.document = {
  getElementById(id) { if (!ids.has(id)) missing.add(id); return el(id); },
  querySelectorAll: () => [],
  createElement: () => el('new'),
  addEventListener() {},
};
globalThis.fetch = async () => ({ ok: true, json: async () => queue });

const body = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
writeFileSync(join(dir, 'page.mjs'), body);

try {
  await import(join(dir, 'page.mjs'));
} catch (e) {
  console.log(`\n  MODULE THREW: ${e.name}: ${e.message}\n`);
  process.exit(1);
}

const rows = sinks['rows'] ?? '';
const checks = [
  ['renders rows', rows.length > 1000],
  ['one <tr> per queued order', (rows.match(/<tr data-id=/g) ?? []).length === queue.orders.length],
  ['order id in the markup', rows.includes(queue.orders[0].orderId)],
  ['contact column filled', rows.includes(queue.orders[0].contact)],
  ['sku column filled', rows.includes(queue.orders[0].sku)],
  ['action dropdown present', rows.includes('<select class="act')],
  ['all four actions offered', ['Ship as is', 'partial payment', 'full payment', 'Cancel the order']
    .every((t) => rows.includes(t))],
  ['confidence shown', rows.includes('confidence')],
  ['no undefined leaked into the html', !rows.includes('undefined')],
  ['no NaN leaked into the html', !rows.includes('NaN')],
  ['summary tiles filled', Boolean(sinks['sQueued.text'] && sinks['sValue.text'] && sinks['sLoss.text'])],
  ['every getElementById matched an id', missing.size === 0],
];

let bad = 0;
for (const [name, ok] of checks) { if (!ok) bad++; console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}`); }
console.log(`\n  ${checks.length - bad} passed, ${bad} failed`);
if (missing.size) console.log(`  missing ids: ${[...missing].join(', ')}`);
console.log(`  summary: queued ${sinks['sQueued.text']}, value ${sinks['sValue.text']}, loss ${sinks['sLoss.text']}\n`);
process.exit(bad ? 1 : 0);
