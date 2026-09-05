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
 * Biacromial breadth to chest circumference. Adult women average roughly
 * 35.5cm across the shoulders and 90cm around the chest. MediaPipe's shoulder
 * landmarks sit slightly inside the acromion, which pushes the ratio up a
 * little from the textbook 2.54.
 *
 * This is an ESTIMATE, not a measurement. Say so. The accuracy that decides
 * the recommendation comes from the garment side, not from here.
 */
export const CHEST_FROM_BIACROMIAL = 2.45;

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
  bodyChestCm: number;
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

  return {
    shoulderCm,
    hipCm,
    torsoCm,
    bodyChestCm: shoulderCm * CHEST_FROM_BIACROMIAL,
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
  bodyChestCm: number;
  scale: number;
  /** 0..1, derived from how much the samples disagreed. */
  confidence: number;
  /** ± cm on the chest estimate, for honest UI. */
  bandCm: number;
  frames: number;
}

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
  const mad = median(chest.map((c) => Math.abs(c - medChest))) * 1.4826;
  const bandCm = Math.max(1.5, Math.min(6, mad * 2));

  // 1.5cm spread is as good as this method gets; 6cm is unusable.
  const confidence = Math.max(0.35, Math.min(0.88, 1 - (bandCm - 1.5) / 6));

  return {
    shoulderCm: median(frames.map((f) => f.shoulderCm)),
    hipCm: median(frames.map((f) => f.hipCm)),
    torsoCm: median(frames.map((f) => f.torsoCm)),
    bodyChestCm: medChest,
    scale: median(frames.map((f) => f.scale)),
    confidence,
    bandCm,
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
