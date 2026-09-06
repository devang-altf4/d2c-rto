/* Check the 3D posing arithmetic without a GPU.
 *
 * Loads the real .glb, runs the real pose() on synthetic landmarks, then skins
 * the mesh by hand and asks where the garment actually ended up relative to the
 * body it was posed onto. A render would show this instantly; without one, this
 * is the check that the maths is not quietly mirrored, rotated or mis-scaled.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const P = resolve(dirname(fileURLToPath(import.meta.url)), '..');

Object.defineProperty(globalThis, 'self', { value: globalThis, configurable: true });
globalThis.document = { createElementNS: () => ({ style: {} }), createElement: () => ({ style: {} }) };

const THREE = await import(P + '/vendor/three/three.module.js');
const { GLTFLoader } = await import(P + '/vendor/three/GLTFLoader.js');
const { Hoodie3D } = await import(P + '/hoodie3d.js');
const { specFromRow, BONE } = await import(P + '/garment3d.js');
const { SIZE_CHART } = await import(P + '/tryon.js');

/* ---- a synthetic person, in normalised image coords ---------------------- */
const VW = 720, VH = 1280;
const FIT = { s: 1, ox: 0, oy: 0, width: VW, height: VH };

/**
 * Body with a known shoulder width in cm, standing square to the camera.
 * armAngle is degrees out from straight down: 0 = arms at sides, 90 = T-pose.
 */
function person({ shoulderCm = 44, pxPerCm = 6, armAngle = 20, lean = 0 }) {
  const shPx = shoulderCm * pxPerCm;
  const cx = VW / 2, shY = VH * 0.28;
  const lm = Array.from({ length: 33 }, () => ({ x: .5, y: .5, z: 0, visibility: 1 }));
  const put = (i, px, py) => { lm[i] = { x: px / VW, y: py / VH, z: 0, visibility: 1 }; };

  const upper = 30 * pxPerCm, fore = 26 * pxPerCm;      // cm of arm, to pixels
  const a = (armAngle * Math.PI) / 180;

  put(11, cx + shPx / 2, shY);                          // left shoulder
  put(12, cx - shPx / 2, shY);                          // right shoulder
  put(13, cx + shPx / 2 + Math.sin(a) * upper, shY + Math.cos(a) * upper);   // L elbow
  put(15, cx + shPx / 2 + Math.sin(a) * (upper + fore), shY + Math.cos(a) * (upper + fore));
  put(14, cx - shPx / 2 - Math.sin(a) * upper, shY + Math.cos(a) * upper);   // R elbow
  put(16, cx - shPx / 2 - Math.sin(a) * (upper + fore), shY + Math.cos(a) * (upper + fore));

  const hipY = shY + 45 * pxPerCm, hipDx = lean * pxPerCm;
  put(23, cx + shPx * 0.32 + hipDx, hipY);
  put(24, cx - shPx * 0.32 + hipDx, hipY);

  const world = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0 }));
  world[11] = { x:  shoulderCm / 200, y: 0, z: 0 };
  world[12] = { x: -shoulderCm / 200, y: 0, z: 0 };
  return { lm, world, shPx, cx, shY, pxPerCm };
}

/* ---- build a Hoodie3D with the real glb, minus the WebGL context ---------- */
const buf = readFileSync(P + '/assets/hoodie.glb');
const gltf = await new Promise((res, rej) => new GLTFLoader().parse(
  buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', res, rej));

const h3 = new Hoodie3D();
gltf.scene.traverse((o) => { if (o.isSkinnedMesh) h3.mesh = o; });
h3.bones = h3.mesh.skeleton.bones;
h3.root = new THREE.Group();
h3.root.add(gltf.scene);
h3.ready = true;
h3.setSize(SIZE_CHART.find((r) => r.size === 'M'));

/** World position of one skinned vertex, after the current pose. */
function skinnedVertex(i) {
  h3.root.updateMatrixWorld(true);
  const v = new THREE.Vector3().fromBufferAttribute(h3.mesh.geometry.attributes.position, i);
  return h3.mesh.applyBoneTransform(i, v).applyMatrix4(h3.mesh.matrixWorld);
}

/** Extremes of the garment across x, in overlay pixels. */
function garmentSpan(fromRing, count) {
  let lo = Infinity, hi = -Infinity, ylo = Infinity, yhi = -Infinity;
  for (let i = fromRing; i < fromRing + count; i++) {
    const p = skinnedVertex(i);
    lo = Math.min(lo, p.x); hi = Math.max(hi, p.x);
    ylo = Math.min(ylo, -p.y); yhi = Math.max(yhi, -p.y);
  }
  return { lo, hi, width: hi - lo, top: ylo, bottom: yhi };
}

const spec = specFromRow(SIZE_CHART.find((r) => r.size === 'M'));
const pass = [], fail = [];
const check = (name, ok, detail) => (ok ? pass : fail).push(`${ok ? 'ok  ' : 'FAIL'}  ${name}  ${detail}`);

/* ---- 1. scale and centring ---------------------------------------------- */
{
  const b = person({ shoulderCm: 44, pxPerCm: 6, armAngle: 0 });
  h3.pose(b.lm, b.world, VW, VH, FIT, 44);

  // Top ring of the torso is the shoulder seam: RING=24 verts starting at 0.
  const span = garmentSpan(0, 24);
  const expected = spec.shoulderWidth * b.pxPerCm;      // 47cm garment at 6px/cm
  check('garment shoulder width', Math.abs(span.width - expected) < expected * 0.03,
    `${span.width.toFixed(0)}px, spec ${spec.shoulderWidth}cm x ${b.pxPerCm}px/cm = ${expected.toFixed(0)}px`);

  const centre = (span.lo + span.hi) / 2;
  check('garment centred on body', Math.abs(centre - b.cx) < 4,
    `garment centre ${centre.toFixed(0)}px, body centre ${b.cx}px`);

  check('shoulder seam on shoulder line', Math.abs(span.top - b.shY) < 6,
    `seam y ${span.top.toFixed(0)}px, shoulders at ${b.shY.toFixed(0)}px`);

  // The garment must be WIDER than the body it is on — 47cm on 44cm shoulders.
  check('garment wider than body (ease is visible)', span.width > b.shPx,
    `garment ${span.width.toFixed(0)}px vs body ${b.shPx.toFixed(0)}px, ` +
    `ease ${((span.width - b.shPx) / b.pxPerCm).toFixed(1)}cm`);
}

/* ---- 2. the size actually changes the garment ---------------------------- */
{
  const b = person({ shoulderCm: 44, pxPerCm: 6, armAngle: 0 });
  const widths = {};
  for (const size of ['S', 'M', 'XL']) {
    h3.setSize(SIZE_CHART.find((r) => r.size === size));
    h3.pose(b.lm, b.world, VW, VH, FIT, 44);
    widths[size] = garmentSpan(0, 24).width;
  }
  check('S < M < XL on the same body',
    widths.S < widths.M && widths.M < widths.XL,
    `S ${widths.S.toFixed(0)}px, M ${widths.M.toFixed(0)}px, XL ${widths.XL.toFixed(0)}px`);
  const grade = (widths.XL - widths.S) / 6;      // px -> cm
  const chartGrade = SIZE_CHART.find((r) => r.size === 'XL').shoulder
                   - SIZE_CHART.find((r) => r.size === 'S').shoulder;
  check('S->XL grades exactly by the chart', Math.abs(grade - chartGrade) < 0.3,
    `${grade.toFixed(1)}cm on screen, chart says ${chartGrade.toFixed(1)}cm`);
  for (const [size, px] of Object.entries(widths)) {
    const cm = px / 6, want = SIZE_CHART.find((r) => r.size === size).shoulder;
    check(`${size} renders at its spec width`, Math.abs(cm - want) < 0.3,
      `${cm.toFixed(1)}cm on screen, spec ${want.toFixed(1)}cm`);
  }
  h3.setSize(SIZE_CHART.find((r) => r.size === 'M'));
}

/* ---- 3. scale is tied to the MEASUREMENT, not the zoom -------------------- */
{
  // Same person, camera twice as close. The garment must grow with them, and
  // must still be 47cm of garment — not resized to fit the new pixel width.
  const near = person({ shoulderCm: 44, pxPerCm: 12, armAngle: 0 });
  h3.pose(near.lm, near.world, VW, VH, FIT, 44);
  const w = garmentSpan(0, 24).width;
  check('garment tracks zoom', Math.abs(w - spec.shoulderWidth * 12) < w * 0.03,
    `${w.toFixed(0)}px at 12px/cm, expected ${(spec.shoulderWidth * 12).toFixed(0)}px`);

  // A BIGGER person at the same zoom must get the same garment in cm, so the
  // garment covers relatively less of them.
  const big = person({ shoulderCm: 52, pxPerCm: 6, armAngle: 0 });
  h3.pose(big.lm, big.world, VW, VH, FIT, 52);
  const wb = garmentSpan(0, 24).width;
  check('same SKU on a bigger body stays the same cm',
    Math.abs(wb - spec.shoulderWidth * 6) < wb * 0.03,
    `${wb.toFixed(0)}px, still ${spec.shoulderWidth}cm; body is now ${(52 * 6).toFixed(0)}px so M is tight`);
  check('M reads tight on 52cm shoulders', wb < 52 * 6,
    `garment ${wb.toFixed(0)}px < body ${(52 * 6).toFixed(0)}px`);
}

/* ---- 4. sleeves follow the arms ------------------------------------------ */
{
  // Cuff centre vertex: last vertex pushed for each sleeve. Torso is
  // 19*24+1 = 457 verts; each sleeve is 11*24+1 = 265.
  const TORSO = 19 * 24 + 1, SLEEVE = 11 * 24 + 1;
  const cuffL = TORSO + SLEEVE - 1;            // left sleeve cuff centre
  const cuffR = TORSO + 2 * SLEEVE - 1;        // right sleeve cuff centre

  for (const angle of [0, 45, 90]) {
    const b = person({ shoulderCm: 44, pxPerCm: 6, armAngle: angle });
    h3.pose(b.lm, b.world, VW, VH, FIT, 44);
    const c = skinnedVertex(cuffL);
    const wristPx = { x: b.lm[15].x * VW, y: b.lm[15].y * VH };
    const d = Math.hypot(c.x - wristPx.x, -c.y - wristPx.y) / b.pxPerCm;
    // Sleeve is 61cm and the arm to the wrist is 56cm, so the cuff should land
    // near the wrist but is allowed to overhang.
    check(`left cuff near wrist at ${angle}deg`, d < 9,
      `cuff is ${d.toFixed(1)}cm from the wrist landmark`);
  }

  const b = person({ shoulderCm: 44, pxPerCm: 6, armAngle: 90 });
  h3.pose(b.lm, b.world, VW, VH, FIT, 44);
  const cl = skinnedVertex(cuffL), cr = skinnedVertex(cuffR);
  check('sleeves are not swapped', cl.x > b.cx && cr.x < b.cx,
    `left cuff x ${cl.x.toFixed(0)}, right cuff x ${cr.x.toFixed(0)}, centre ${b.cx}`);
}

/* ---- 5. degenerate input is refused, not drawn wrong --------------------- */
{
  const b = person({ shoulderCm: 44, pxPerCm: 6 });
  const flat = JSON.parse(JSON.stringify(b.lm));
  flat[23] = { ...flat[11] }; flat[24] = { ...flat[12] };   // hips on top of shoulders
  check('collapsed torso refused', h3.pose(flat, b.world, VW, VH, FIT, 44) === false,
    'pose() returned false instead of a NaN transform');

  const tiny = JSON.parse(JSON.stringify(b.lm));
  tiny[11] = { ...tiny[12] };                                // zero shoulder width
  check('zero shoulder refused', h3.pose(tiny, b.world, VW, VH, FIT, 44) === false,
    'pose() returned false');
}

console.log('\n' + [...pass, ...fail].map((l) => '  ' + l).join('\n'));
console.log(`\n  ${pass.length} passed, ${fail.length} failed\n`);
process.exit(fail.length ? 1 : 0);
