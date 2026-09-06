/* Execute the page's module body against a stub DOM.
 *
 * node --check only parses. It cannot see a temporal-dead-zone reference, an
 * undefined global, or a call on a missing element — all of which throw at
 * module-evaluation time and, in a module script, take every line below them
 * with them. That is what silently killed the product photography. */
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const P = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(join(tmpdir(), 'tryon-test-'));
const html = readFileSync(process.argv[2] || (P + '/index.html'), 'utf8');

// Every id the markup actually defines — so a typo'd getElementById is caught
// rather than silently stubbed.
const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));

const seen = { missing: new Set(), listeners: 0 };
const make = (id) => new Proxy(function () {}, {
  get(t, k) {
    if (k === 'id') return id;
    if (k === 'style' || k === 'dataset' || k === 'classList') return make(id + '.' + String(k));
    if (k === 'value') return '170';
    if (k === 'textContent' || k === 'innerHTML' || k === 'src') return '';
    if (k === 'children' || k === 'files') return [];
    if (k === 'hidden' || k === 'disabled') return false;
    if (k === 'length') return 0;
    if (k === Symbol.iterator) return [][Symbol.iterator].bind([]);
    if (k === 'getContext') return () => make(id + '.ctx');
    if (k === 'getBoundingClientRect') return () => ({ width: 100, height: 100, top: 0, left: 0 });
    if (k === 'addEventListener') return () => { seen.listeners++; };
    return make(id + '.' + String(k));
  },
  set() { return true; },
  apply() { return make(id + '()'); },
});

globalThis.document = {
  getElementById(id) { if (!ids.has(id)) seen.missing.add(id); return make(id); },
  createElement: (t) => make('<' + t + '>'),
  querySelector: () => make('q'), querySelectorAll: () => [],
  addEventListener() {}, body: make('body'), documentElement: make('html'),
};
globalThis.window = globalThis;
globalThis.devicePixelRatio = 1;
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};
globalThis.Image = class { set src(_) {} addEventListener() {} };
Object.defineProperty(globalThis, 'navigator', {
  value: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) } },
  configurable: true, writable: true,
});
globalThis.fetch = async () => ({ ok: true, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) });
globalThis.WebGL2RenderingContext = class {};
globalThis.self = globalThis;
Object.defineProperty(globalThis, 'performance', { value: { now: () => 0 }, configurable: true, writable: true });
globalThis.HTMLElement = class {};
globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });

// Vendor stub: the real bundle needs a browser, and we are testing OUR code.
writeFileSync(dir + '/vendorstub.mjs',
  'export const FilesetResolver={forVisionTasks:async()=>({})};' +
  'export const PoseLandmarker={createFromOptions:async()=>({})};');

const body = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1]
  .replaceAll('./hoodie3d.js', P + '/hoodie3d.js')
  .replaceAll('./hoodie.js', P + '/hoodie.js')
  .replaceAll('./tryon.js', dir + '/tryon_t.mjs');
writeFileSync(dir + '/tryon_t.mjs',
  readFileSync(P + '/tryon.js', 'utf8')
    .replace('./vendor/vision_bundle.mjs', './vendorstub.mjs'));
writeFileSync(dir + '/page.mjs', body);

try {
  await import(dir + '/page.mjs');
  console.log(`\n  module evaluated OK — ${seen.listeners} listeners bound`);
  console.log(seen.missing.size
    ? `  getElementById on ids NOT in the markup: ${[...seen.missing].join(', ')}`
    : '  every getElementById matched an id in the markup');
} catch (e) {
  console.log(`\n  MODULE THREW AT EVALUATION: ${e.name}: ${e.message}`);
  console.log('  -> everything below this line in the page is dead\n');
  process.exit(1);
}
