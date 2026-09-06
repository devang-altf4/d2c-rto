import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const P = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(join(tmpdir(), 'tryon-test-'));
writeFileSync(dir + '/vendorstub.mjs', 'export const FilesetResolver={};export const PoseLandmarker={};');
writeFileSync(dir + '/tryon_t.mjs',
  readFileSync(P + '/tryon.js', 'utf8')
    .replace('./vendor/vision_bundle.mjs', './vendorstub.mjs'));
const { readBody, NOSE_TO_ANKLE_FRACTION, IPD_MM } = await import(pathToFileURL(dir + '/tryon_t.mjs').href);

const W = 720, H = 1280;
const ACROMION = 1.10;                 // the correction tryon.js applies
const HEIGHT_CM = 172;
const TRUE_SHOULDER_CM = 44.0;         // true acromion-to-acromion
const LANDMARK_CM = TRUE_SHOULDER_CM / ACROMION;   // what MediaPipe actually reports

// Fix the camera geometry, then derive the pixel counts from it so the scene is
// self-consistent: everything below is the SAME person, photographed the same
// way. Only the subject's real IPD and the framing change.
const MM_PER_PX = 1.55;
const shPx = (LANDMARK_CM * 10) / MM_PER_PX;

function subject({ trueIpdMm, ankles }) {
  const ipdPx = trueIpdMm / MM_PER_PX;
  const lm = Array.from({ length: 33 }, () => ({ x: .5, y: .5, z: 0, visibility: 1 }));
  lm[0]  = { x: .5, y: .20, z: 0, visibility: 1 };
  lm[2]  = { x: .5 - ipdPx / 2 / W, y: .19, z: 0, visibility: 1 };
  lm[5]  = { x: .5 + ipdPx / 2 / W, y: .19, z: 0, visibility: 1 };
  lm[11] = { x: .5 - shPx / 2 / W, y: .30, z: 0, visibility: 1 };
  lm[12] = { x: .5 + shPx / 2 / W, y: .30, z: 0, visibility: 1 };
  lm[23] = { x: .46, y: .55, z: 0, visibility: 1 };
  lm[24] = { x: .54, y: .55, z: 0, visibility: 1 };
  const av = ankles ? 1 : 0.2;
  lm[27] = { x: .47, y: .95, z: 0, visibility: av };
  lm[28] = { x: .53, y: .95, z: 0, visibility: av };

  const span = (HEIGHT_CM / 100) * NOSE_TO_ANKLE_FRACTION;
  const world = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0 }));
  world[0]  = { x: 0, y: span, z: 0 };
  world[27] = { x: -.05, y: 0, z: 0 };
  world[28] = { x:  .05, y: 0, z: 0 };
  world[11] = { x: -LANDMARK_CM / 200, y: span * .78, z: 0 };
  world[12] = { x:  LANDMARK_CM / 200, y: span * .78, z: 0 };
  return { lm, world };
}

console.log(`\n  One subject: ${HEIGHT_CM}cm tall, true shoulder ${TRUE_SHOULDER_CM.toFixed(1)}cm.`);
console.log(`  Hoodie size steps are 2.5cm, so a half-step (1.25cm) decides the size.\n`);
console.log('  their real IPD   framing        ref      reads      error');
console.log('  ' + '-'.repeat(60));

for (const ipd of [63, 58, 68]) {              // mean, then -1.4 SD and +1.4 SD
  for (const ankles of [true, false]) {
    const b = readBody(subject({ trueIpdMm: ipd, ankles }), W, H, HEIGHT_CM);
    const cm = b.shoulderMM / 10;
    const err = cm - TRUE_SHOULDER_CM;
    const flag = Math.abs(err) > 1.25 ? '  <- wrong size' : '';
    console.log(`  ${String(ipd).padStart(3)}mm${ipd === IPD_MM ? ' (mean)' : '       '}   ` +
      `${(ankles ? 'feet in frame' : 'torso only   ')}  ${b.scaleRef.padEnd(7)}  ` +
      `${cm.toFixed(1)}cm    ${err >= 0 ? '+' : ''}${err.toFixed(2)}cm${flag}`);
  }
}
console.log('\n  no height given, feet in frame ->',
  readBody(subject({ trueIpdMm: 63, ankles: true }), W, H, undefined).scaleRef);
console.log('  null pose ->', JSON.stringify(readBody(null, W, H, 172)), '\n');
