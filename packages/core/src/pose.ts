/**
 * Turning a webcam frame into centimetres.
 *
 * THE CORE PROBLEM: a single RGB camera cannot recover scale. A small person
 * standing close and a large person standing far away project to identical
 * pixels. No model fixes this, because the information is not in the image.
 *
 * MediaPipe's worldLandmarks look like they solve it — they are in metres,
 * origin at the hip midpoint — but that scale is INFERRED from body-proportion
 * priors, not measured. Fine for gesture, off by several cm for anthropometry.
 *
 * So we recover scale from one thing the shopper can tell us for free: her
 * height. worldLandmarks give us reliable RATIOS (they are already partially
 * perspective-corrected, unlike raw image coordinates), and height turns those
 * ratios into centimetres.
 *
 * Everything here is pure. No MediaPipe import, no DOM, no React — so it can
 * be reasoned about and tested on its own.
 */

export interface Landmark {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

/** The seven landmarks we actually use, out of MediaPipe's 33. */
export const LM = {
  NOSE: 0,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
} as const;

/**
 * Nose sits at roughly 0.93 of standing height, ankle at roughly 0.04, so the
 * span between them is about 0.89 of total height. This is how we get from a
 * landmark span to full stature without needing the crown, which MediaPipe
 * does not give us.
 */
export const NOSE_TO_ANKLE_FRACTION = 0.89;

/**
 * Chest girth is inferred, not measured, and it is the weakest link in the
 * pipeline — so it is worth being explicit about how.
 *
 * A frontal camera sees BREADTH. Circumference needs breadth AND depth, and
 * depth is hidden directly behind the breadth we can see. The old model dodged
 * that with a single multiplier (chest = shoulder * 2.45), which quietly
 * asserts that everyone has the same cross-section: a barrel-chested and a
 * flat-chested shopper with the same shoulders got the same answer, and the
 * same size.
 *
 * Instead, model the chest as an ellipse. Breadth comes from the shoulders.
 * Depth comes from a population prior, scaled by how heavy the frame is for
 * its height — a 150cm shopper with 40cm shoulders is built differently from
 * a 185cm one with the same shoulders, and one multiplier cannot tell them
 * apart.
 *
 * It is still an estimate. The honest part is that aggregate() now propagates
 * this prior's uncertainty into the band, instead of reporting frame-to-frame
 * jitter alone — which was the smallest error in the stack, and reporting only
 * it is how you end up claiming +/-1.5cm on a number you guessed.
 */

/** Biacromial breadth -> chest breadth at the nipple line, which sits inside the shoulder points. */
export const CHEST_BREADTH_FROM_BIACROMIAL = 0.82;

/** Chest depth as a fraction of chest breadth, at an average build. */
export const CHEST_DEPTH_TO_BREADTH = 0.72;

/**
 * Biacromial breadth over stature, population mean. The build reference.
 *
 * Deliberately NOT using the hip landmarks here. MediaPipe's LEFT_HIP/RIGHT_HIP
 * are joint centres, not the iliac crests, and there is no published ratio from
 * one to the other — anything built on them would be a number with no way to
 * check it. Shoulder-to-stature is documented and testable, so the build index
 * rests on that alone.
 */
export const BIACROMIAL_TO_STATURE = 0.222;

/**
 * A tape follows a convex path over ribs and scapulae, so it always reads
 * longer than the ellipse through the same two axes. About 13% at torso
 * proportions; without it the ellipse under-reads chest by a full size.
 */
export const TORSO_CONVEXITY = 1.13;

/** Ramanujan's second approximation to the perimeter of an ellipse. */
function ellipsePerimeter(a: number, b: number): number {
  return Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
}

/** Breadth and depth in cm -> girth in cm. */
function girth(breadthCm: number, depthCm: number): number {
  return ellipsePerimeter(breadthCm / 2, depthCm / 2) * TORSO_CONVEXITY;
}

/**
 * How heavy this frame is for its height, as a multiplier around 1.
 *
 * Square-rooted and clamped so it nudges depth rather than driving it. The
 * index is itself measured with noise, and letting it move depth linearly put
 * the chest estimate a full size out at the extremes of the height range.
 */
export function frameIndex(shoulderCm: number, heightCm: number): number {
  const raw = shoulderCm / heightCm / BIACROMIAL_TO_STATURE;
  return Math.min(1.12, Math.max(0.9, Math.sqrt(raw)));
}

export type GateFailure =
  | 'NO_POSE'
  | 'HEAD_CUT_OFF'
  | 'FEET_CUT_OFF'
  | 'TURNED'
  | 'LOW_VISIBILITY';

export const GATE_MESSAGE: Record<GateFailure, string> = {
  NO_POSE: 'Step into frame',
  HEAD_CUT_OFF: 'Move back — your head is out of frame',
  FEET_CUT_OFF: 'Move back so your feet are in frame',
  TURNED: 'Face the camera straight on',
  LOW_VISIBILITY: 'Move somewhere brighter',
};

const MIN_VISIBILITY = 0.6;
const FRAME_MARGIN = 0.02;
/** Metres of front-to-back shoulder separation before the torso counts as turned. */
const MAX_SHOULDER_Z_SPREAD = 0.09;

/**
 * Reject a frame before measuring it.
 *
 * This matters more than the arithmetic. A turned torso foreshortens shoulder
 * width and quietly produces a confident wrong answer, which is the worst
 * outcome available — worse than refusing to answer.
 */
export function gate(image: Landmark[], world: Landmark[]): GateFailure | null {
  if (!image?.length || !world?.length) return 'NO_POSE';

  const needed = [LM.NOSE, LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER, LM.LEFT_ANKLE, LM.RIGHT_ANKLE];
  for (const i of needed) {
    const v = image[i]?.visibility;
    if (v !== undefined && v < MIN_VISIBILITY) return 'LOW_VISIBILITY';
  }

  // Full body must be inside the frame, or the height reference is wrong and
  // every measurement downstream inherits the error.
  if (image[LM.NOSE].y < FRAME_MARGIN) return 'HEAD_CUT_OFF';
  const ankleY = Math.max(image[LM.LEFT_ANKLE].y, image[LM.RIGHT_ANKLE].y);
  if (ankleY > 1 - FRAME_MARGIN) return 'FEET_CUT_OFF';

  if (Math.abs(world[LM.LEFT_SHOULDER].z - world[LM.RIGHT_SHOULDER].z) > MAX_SHOULDER_Z_SPREAD) {
    return 'TURNED';
  }

  return null;
}

export interface FrameMeasurement {
  shoulderCm: number;
  hipCm: number;
  torsoCm: number;
  /** Frontal chest breadth — the part the camera actually sees. */
  chestBreadthCm: number;
  /** Front-to-back chest depth — inferred from the build prior, never measured. */
  chestDepthCm: number;
  bodyChestCm: number;
  /** Build multiplier around 1; >1 is a heavy frame for its height. */
  build: number;
  /** cm per world unit for this frame — used to place the garment overlay. */
  scale: number;
}

const dist3 = (a: Landmark, b: Landmark) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const mid = (a: Landmark, b: Landmark): Landmark => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
  z: (a.z + b.z) / 2,
});

/** One frame's worth of centimetres. Call gate() first. */
export function measureFrame(world: Landmark[], heightCm: number): FrameMeasurement {
  const ankle = mid(world[LM.LEFT_ANKLE], world[LM.RIGHT_ANKLE]);
  const shoulderMid = mid(world[LM.LEFT_SHOULDER], world[LM.RIGHT_SHOULDER]);
  const hipMid = mid(world[LM.LEFT_HIP], world[LM.RIGHT_HIP]);

  // Vertical span only — using 3D distance here would inflate the reference
  // whenever she leans, and shrink every measurement to compensate.
  const noseToAnkle = Math.abs(world[LM.NOSE].y - ankle.y);
  // Full stature in world units, then centimetres per world unit.
  const statureWorld = noseToAnkle / NOSE_TO_ANKLE_FRACTION;
  const cmPerUnit = heightCm / statureWorld;

  const shoulderCm = dist3(world[LM.LEFT_SHOULDER], world[LM.RIGHT_SHOULDER]) * cmPerUnit;
  const hipCm = dist3(world[LM.LEFT_HIP], world[LM.RIGHT_HIP]) * cmPerUnit;
  const torsoCm = Math.abs(shoulderMid.y - hipMid.y) * cmPerUnit;

  // Breadth is measured; depth is the prior, tilted by build. Both axes then
  // go through the same ellipse, so chest and hip stay on one model.
  const build = frameIndex(shoulderCm, heightCm);
  const chestBreadthCm = shoulderCm * CHEST_BREADTH_FROM_BIACROMIAL;
  const chestDepthCm = chestBreadthCm * CHEST_DEPTH_TO_BREADTH * build;

  return {
    shoulderCm,
    hipCm,
    torsoCm,
    chestBreadthCm,
    chestDepthCm,
    bodyChestCm: girth(chestBreadthCm, chestDepthCm),
    build,
    scale: cmPerUnit,
  };
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export interface AggregateResult {
  shoulderCm: number;
  hipCm: number;
  torsoCm: number;
  chestBreadthCm: number;
  chestDepthCm: number;
  bodyChestCm: number;
  build: number;
  scale: number;
  /** 0..1, derived from the total band — not from frame agreement alone. */
  confidence: number;
  /** ± cm on the chest estimate: jitter and the depth prior, combined. */
  bandCm: number;
  /** The part of bandCm that more frames cannot reduce. */
  systematicCm: number;
  frames: number;
}

/**
 * Relative 1-sigma on the depth prior. Chest depth at a given breadth varies
 * by about this much across adults of the same build, and — this is the point
 * — it does not shrink with more frames. Holding still for longer makes the
 * camera agree with itself, not with a tape measure.
 */
export const DEPTH_PRIOR_CV = 0.10;

/**
 * How a relative depth error carries into girth. The ellipse perimeter is
 * roughly twice as sensitive to breadth as to depth at torso aspect ratios,
 * so 10% off on depth is about 4% off on chest.
 */
const GIRTH_SENSITIVITY_TO_DEPTH = 0.4;

/** Self-reported height is good to a couple of cm, and scale is linear in it. */
export const HEIGHT_CV = 0.012;

export const MIN_FRAMES = 24; // roughly two seconds at 12fps

/**
 * Median across frames, with the spread turned into a confidence.
 *
 * A single frame is noisy and a mean is dragged by the one frame where she
 * blinked out of pose. The spread is not a nuisance to hide — it is the honest
 * uncertainty, and it is what lets the widget say "M, possibly L" instead of
 * committing to a confident wrong answer.
 */
export function aggregate(frames: FrameMeasurement[]): AggregateResult | null {
  if (frames.length < MIN_FRAMES) return null;

  const chest = frames.map((f) => f.bodyChestCm);
  const medChest = median(chest);

  // Robust spread: median absolute deviation, scaled to a standard-deviation
  // equivalent so the band means something.
  const jitterCm = median(chest.map((c) => Math.abs(c - medChest))) * 1.4826;

  // The error that does not average out. The old code reported jitter alone,
  // which is the smallest term here — it could claim ±1.5cm on a chest that
  // was inferred from a population prior. Adding the two in quadrature puts
  // the floor where it actually belongs, around ±4cm.
  const systematicCm =
    medChest * Math.hypot(DEPTH_PRIOR_CV * GIRTH_SENSITIVITY_TO_DEPTH, HEIGHT_CV);
  const bandCm = Math.min(9, Math.hypot(jitterCm, systematicCm));

  // Confidence now tracks the band it is actually reporting. The ceiling is
  // lower than it used to be because the systematic term never goes away.
  const confidence = Math.max(0.3, Math.min(0.8, 1 - (bandCm / medChest) * 6));

  return {
    shoulderCm: median(frames.map((f) => f.shoulderCm)),
    hipCm: median(frames.map((f) => f.hipCm)),
    torsoCm: median(frames.map((f) => f.torsoCm)),
    chestBreadthCm: median(frames.map((f) => f.chestBreadthCm)),
    chestDepthCm: median(frames.map((f) => f.chestDepthCm)),
    bodyChestCm: medChest,
    build: median(frames.map((f) => f.build)),
    scale: median(frames.map((f) => f.scale)),
    confidence,
    bandCm,
    systematicCm,
    frames: frames.length,
  };
}

/**
 * Where the hem lands on her, for the overlay.
 *
 * Garment length is measured from the high point of the shoulder down, so the
 * hem sits that many centimetres below her shoulder line. Returns a normalized
 * y in image space, ready to draw.
 */
export function hemPosition(
  image: Landmark[],
  garmentLengthCm: number,
  cmPerUnit: number,
  world: Landmark[],
): number {
  const shoulderImgY = (image[LM.LEFT_SHOULDER].y + image[LM.RIGHT_SHOULDER].y) / 2;
  const ankleImgY = Math.max(image[LM.LEFT_ANKLE].y, image[LM.RIGHT_ANKLE].y);

  const shoulderWorldY =
    (world[LM.LEFT_SHOULDER].y + world[LM.RIGHT_SHOULDER].y) / 2;
  const ankleWorldY = Math.max(world[LM.LEFT_ANKLE].y, world[LM.RIGHT_ANKLE].y);

  const spanCm = Math.abs(ankleWorldY - shoulderWorldY) * cmPerUnit;
  const spanImg = ankleImgY - shoulderImgY;

  return shoulderImgY + (garmentLengthCm / spanCm) * spanImg;
}
