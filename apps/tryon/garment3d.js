/* Parametric hoodie, in three dimensions.
 *
 * WHY THIS IS GENERATED AND NOT A DOWNLOADED MODEL
 *
 * A fixed mesh scaled to a shopper does not fit her — it is just a bigger
 * hoodie. Real garments do not grow uniformly: between S and XL the chest
 * moves 12cm, the shoulder 7.5cm and the body length 8cm, and those are three
 * independent numbers off the maker's spec sheet. Only a mesh built FROM that
 * spec can show the difference between two sizes on one body.
 *
 * So the mesh is lofted from SIZE_CHART at runtime. Nothing here is fitted to
 * the wearer: this is the GARMENT, at the true dimensions of one SKU. The body
 * underneath is the variable. If M is tight on you, the render is tight on you,
 * which is the whole point — a photoreal composite of a garment that was never
 * measured cannot tell you that.
 *
 * Coordinates are centimetres, origin at the centre of the shoulder line,
 * +x wearer's left, +y up, +z toward the camera. The renderer converts to
 * pixels; nothing in this file knows about screens.
 *
 * Pure: no three.js, no DOM. It returns plain typed arrays so the same code
 * exports the .glb offline and re-lofts geometry in the browser.
 */

/* ---------------------------------------------------------------- skeleton */

/* Joint order is the bone order in the GLB, and the indices in JOINTS_0 refer
   to it. Parent -1 is the root. */
export const BONES = [
  { name: 'hips',       parent: -1 },
  { name: 'chest',      parent: 0 },
  { name: 'neck',       parent: 1 },
  { name: 'upperArm.L', parent: 1 },
  { name: 'foreArm.L',  parent: 3 },
  { name: 'upperArm.R', parent: 1 },
  { name: 'foreArm.R',  parent: 5 },
];
export const BONE = Object.fromEntries(BONES.map((b, i) => [b.name, i]));

/* -------------------------------------------------------------- the spec */

/**
 * Turn one SIZE_CHART row into the dimensions the loft needs.
 *
 * `shoulder` and `chest` on the chart are the garment's own measurements, not
 * the body's. The only thing invented here is depth: a spec sheet gives widths
 * and circumferences and never says how much of one is front-to-back. An
 * oversized hoodie hangs closer to a round tube than a body does, so it takes
 * a higher depth:width ratio than the 0.72 the body model uses.
 */
export const GARMENT_DEPTH_TO_WIDTH = 0.86;

/**
 * ASSUMPTION, stated because it changes every dimension downstream:
 * SIZE_CHART.chest is HALF chest, measured flat, pit to pit — the usual way a
 * spec sheet writes it. So the worn circumference is twice it. Read as a
 * circumference instead, M would be a 58cm chest, which is a garment for a
 * doll. If H&K's real sheet turns out to quote full circumference, halve
 * CHEST_IS_HALF and nothing else needs to move.
 */
export const CHEST_IS_HALF = 2;

export function specFromRow(row) {
  const chestCircumference = row.chest * CHEST_IS_HALF;
  const ratio = GARMENT_DEPTH_TO_WIDTH;
  // Ramanujan inverted numerically is overkill — the ellipse perimeter is very
  // close to linear in width at fixed aspect, so solve once by bisection.
  const perim = (w) => {
    const a = w / 2, b = (w * ratio) / 2;
    return Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
  };
  let lo = 10, hi = 200;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (perim(mid) < chestCircumference) lo = mid; else hi = mid;
  }
  const chestWidth = (lo + hi) / 2;

  return {
    size: row.size,
    shoulderWidth: row.shoulder,          // seam to seam, across the back
    chestWidth,                            // ellipse major axis when worn
    chestDepth: chestWidth * ratio,
    chestCircumference,
    bodyLength: row.length,                // high shoulder point to hem
    // Sleeve is not on the chart. Held proportional to the shoulder, which is
    // how the grading actually runs, and flagged in the UI as derived.
    sleeveLength: row.shoulder * 1.30,
    cuffWidth: 9.5 + (row.shoulder - 47) * 0.18,
    hemRib: 6.0,
    cuffRib: 6.0,
    neckWidth: row.shoulder * 0.42,
  };
}

/* ----------------------------------------------------------------- lofting */

const RING = 24;   // segments around a cross-section
const BODY_RINGS = 18;
const ARM_RINGS = 10;

/** Smooth 0..1 ramp, used to shape the silhouette between landmarks. */
const smooth = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;

/**
 * Half-width and half-depth of the body at height fraction t.
 *
 * t = 0 at the shoulder line, 1 at the hem. An oversized hoodie is widest just
 * below the armhole and falls almost straight from there, pulling in slightly
 * at the rib. The shoulder itself is narrower than the chest, which is what
 * gives the garment its shape rather than making it a cylinder.
 */
function bodySection(spec, t) {
  const chestT = 0.28;                       // where the chest measurement sits
  let w;
  if (t < chestT) {
    // shoulder seam out to the full chest
    w = lerp(spec.shoulderWidth, spec.chestWidth, smooth(t / chestT));
  } else {
    // straight fall, then the rib pulls in over the last stretch
    const u = (t - chestT) / (1 - chestT);
    const rib = smooth(Math.max(0, (u - 0.78) / 0.22));
    w = spec.chestWidth * lerp(1.0, 0.90, rib);
  }
  const d = w * GARMENT_DEPTH_TO_WIDTH;
  return { a: w / 2, b: d / 2 };
}

/**
 * Build the mesh for one spec.
 *
 * Returns flat arrays ready for a GLB accessor or a three.js BufferGeometry.
 * The topology is fixed for a given RING/RINGS, so the browser can re-loft a
 * different size straight into the existing buffers without touching indices,
 * weights or the skeleton.
 */
export function buildHoodie(spec) {
  const pos = [], nrm = [], uv = [], idx = [], jnt = [], wgt = [];

  const push = (p, n, u, j, w) => {
    pos.push(p[0], p[1], p[2]);
    nrm.push(n[0], n[1], n[2]);
    uv.push(u[0], u[1]);
    jnt.push(j[0], j[1], 0, 0);
    wgt.push(w[0], w[1], 0, 0);
  };

  // ---------------------------------------------------------------- torso
  const torsoStart = 0;
  for (let r = 0; r <= BODY_RINGS; r++) {
    const t = r / BODY_RINGS;
    const y = -t * spec.bodyLength;
    const { a, b } = bodySection(spec, t);
    // Torso rides the chest bone at the top and the hips bone lower down, so
    // leaning bends the garment instead of sliding it.
    const wChest = 1 - smooth(Math.min(1, Math.max(0, (t - 0.25) / 0.5)));
    for (let s = 0; s < RING; s++) {
      const ang = (s / RING) * Math.PI * 2;
      const c = Math.cos(ang), si = Math.sin(ang);
      push(
        [a * c, y, b * si],
        [c, 0, si],
        [s / RING, t],
        [BONE.chest, BONE.hips],
        [wChest, 1 - wChest],
      );
    }
  }
  for (let r = 0; r < BODY_RINGS; r++) {
    for (let s = 0; s < RING; s++) {
      const s2 = (s + 1) % RING;
      const A = torsoStart + r * RING + s, B = torsoStart + r * RING + s2;
      const C = torsoStart + (r + 1) * RING + s, D = torsoStart + (r + 1) * RING + s2;
      idx.push(A, C, B, B, C, D);
    }
  }

  // Cap the hem with a fan so the garment is a closed solid and never shows
  // its inside face when the wearer turns.
  const hemCentre = pos.length / 3;
  push([0, -spec.bodyLength, 0], [0, -1, 0], [0.5, 1], [BONE.hips, BONE.hips], [1, 0]);
  for (let s = 0; s < RING; s++) {
    const s2 = (s + 1) % RING;
    idx.push(hemCentre, torsoStart + BODY_RINGS * RING + s2, torsoStart + BODY_RINGS * RING + s);
  }

  // --------------------------------------------------------------- sleeves
  // Built straight down the -y axis from the shoulder in bind pose; the
  // renderer rotates the bones onto the wearer's actual arms.
  for (const side of [+1, -1]) {
    const upper = side > 0 ? BONE['upperArm.L'] : BONE['upperArm.R'];
    const fore = side > 0 ? BONE['foreArm.L'] : BONE['foreArm.R'];
    const shoulderX = side * spec.shoulderWidth / 2;
    const armStart = pos.length / 3;
    const topR = spec.chestWidth * 0.185;      // armhole is generous on this cut

    for (let r = 0; r <= ARM_RINGS; r++) {
      const t = r / ARM_RINGS;
      const rad = lerp(topR, spec.cuffWidth / 2, smooth(t));
      const y = -t * spec.sleeveLength;
      // Weight blends across the elbow so the sleeve creases instead of
      // shearing where the two bones meet.
      const wUpper = 1 - smooth(Math.min(1, Math.max(0, (t - 0.38) / 0.28)));
      for (let s = 0; s < RING; s++) {
        const ang = (s / RING) * Math.PI * 2;
        const c = Math.cos(ang), si = Math.sin(ang);
        push(
          [shoulderX + rad * c, y, rad * si],
          [c, 0, si],
          [s / RING, t],
          [upper, fore],
          [wUpper, 1 - wUpper],
        );
      }
    }
    for (let r = 0; r < ARM_RINGS; r++) {
      for (let s = 0; s < RING; s++) {
        const s2 = (s + 1) % RING;
        const A = armStart + r * RING + s, B = armStart + r * RING + s2;
        const C = armStart + (r + 1) * RING + s, D = armStart + (r + 1) * RING + s2;
        idx.push(A, C, B, B, C, D);
      }
    }
    const cuffCentre = pos.length / 3;
    push([shoulderX, -spec.sleeveLength, 0], [0, -1, 0], [0.5, 1], [fore, fore], [1, 0]);
    for (let s = 0; s < RING; s++) {
      const s2 = (s + 1) % RING;
      idx.push(cuffCentre, armStart + ARM_RINGS * RING + s2, armStart + ARM_RINGS * RING + s);
    }
  }

  // ------------------------------------------------------------------ hood
  // Lying down on the upper back, not up over the head: an up-hood would paint
  // across the wearer's face in a mirror view, which reads as a bug however
  // correct it is.
  const hoodStart = pos.length / 3;
  const hoodRings = 8;
  const hw = spec.neckWidth * 0.95;
  for (let r = 0; r <= hoodRings; r++) {
    const t = r / hoodRings;
    const y = lerp(2.5, -14.0, smooth(t));
    const z = lerp(-1.0, -spec.chestDepth * 0.62, smooth(t));
    const rad = hw * lerp(1.0, 1.22, Math.sin(t * Math.PI));
    for (let s = 0; s < RING; s++) {
      const ang = (s / RING) * Math.PI * 2;
      const c = Math.cos(ang), si = Math.sin(ang);
      push(
        [rad * c, y + rad * si * 0.30, z + rad * si * 0.45],
        [c, si * 0.5, -0.6],
        [s / RING, t],
        [BONE.neck, BONE.chest],
        [0.65, 0.35],
      );
    }
  }
  for (let r = 0; r < hoodRings; r++) {
    for (let s = 0; s < RING; s++) {
      const s2 = (s + 1) % RING;
      const A = hoodStart + r * RING + s, B = hoodStart + r * RING + s2;
      const C = hoodStart + (r + 1) * RING + s, D = hoodStart + (r + 1) * RING + s2;
      idx.push(A, C, B, B, C, D);
    }
  }

  return {
    position: new Float32Array(pos),
    normal: new Float32Array(nrm),
    uv: new Float32Array(uv),
    joints: new Uint16Array(jnt),
    weights: new Float32Array(wgt),
    index: new Uint32Array(idx),
    vertexCount: pos.length / 3,
  };
}

/**
 * Re-loft positions only, into an existing buffer.
 *
 * Topology, weights and the skeleton do not depend on the size, so switching
 * from M to L is a position rewrite and nothing else — no reallocation, no
 * reupload of indices, and the skinning stays bound.
 */
export function reloft(spec, target) {
  const built = buildHoodie(spec);
  if (target && target.length === built.position.length) {
    target.set(built.position);
    return target;
  }
  return built.position;
}

/** Bind-pose head positions, in cm, matching the geometry above. */
export function bindPose(spec) {
  const sx = spec.shoulderWidth / 2;
  return {
    hips: [0, -spec.bodyLength * 0.62, 0],
    chest: [0, 0, 0],
    neck: [0, 4, 0],
    'upperArm.L': [sx, 0, 0],
    'foreArm.L': [sx, -spec.sleeveLength * 0.46, 0],
    'upperArm.R': [-sx, 0, 0],
    'foreArm.R': [-sx, -spec.sleeveLength * 0.46, 0],
  };
}
