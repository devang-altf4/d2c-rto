import type {
  BodyMeasurement, FitRecommendation, GarmentSpec, Size,
} from './types';
import { SIZES } from './types';

/**
 * Frontal biacromial (shoulder point to shoulder point) to chest circumference.
 * An estimate, not a measurement — say so in the demo. The accuracy that
 * matters comes from the garment side, not the camera.
 */
export const SHOULDER_TO_CHEST = 2.1;

/** MediaPipe world landmarks -> body measurements. */
export function measureFromPose(
  lm: { x: number; y: number; z: number }[],
  heightCm: number,
): BodyMeasurement {
  const d = (a: number, b: number) =>
    Math.hypot(lm[a].x - lm[b].x, lm[a].y - lm[b].y, lm[a].z - lm[b].z);

  // Landmark height: mid-ankle to nose, then corrected for the crown.
  const ankleY = (lm[27].y + lm[28].y) / 2;
  const landmarkHeight = Math.abs(ankleY - lm[0].y) * 1.08;
  const scale = heightCm / landmarkHeight;

  const shoulderCm = d(11, 12) * scale;

  return {
    source: 'CAMERA',
    heightCm,
    shoulderCm,
    bodyChestCm: shoulderCm * SHOULDER_TO_CHEST,
    confidence: 0.72,
  };
}

/** The path that cannot fail. Same output type, so everything downstream is shared. */
export function measureFromCrossBrand(
  chestCmForThatBrandSize: number,
): BodyMeasurement {
  return {
    source: 'CROSS_BRAND',
    bodyChestCm: chestCmForThatBrandSize,
    confidence: 0.85,
  };
}

/**
 * Effective garment chest, after reconciliation against exchange outcomes.
 * A positive learned offset means the style runs small, so it behaves as if
 * its chest measurement were smaller than the manufacturer claims.
 */
export function effectiveChest(spec: GarmentSpec): number {
  return spec.chestCm - spec.learnedOffsetCm;
}

/**
 * ONE function, two input sources. The camera is an upgrade to a working
 * screen, never a dependency of one.
 */
export function recommend(
  body: BodyMeasurement,
  specs: GarmentSpec[], // every size of one style
  opts: { applyLearnedOffset?: boolean } = {},
): FitRecommendation {
  const applyOffset = opts.applyLearnedOffset ?? true;
  const ordered = [...specs].sort(
    (a, b) => SIZES.indexOf(a.size) - SIZES.indexOf(b.size),
  );
  const ease = ordered[0]?.easeCm ?? 6;
  const required = body.bodyChestCm + ease;

  const pick = (useOffset: boolean): GarmentSpec =>
    ordered.find((s) => (useOffset ? effectiveChest(s) : s.chestCm) >= required)
      ?? ordered[ordered.length - 1];

  const naive = pick(false);
  const chosen = applyOffset ? pick(true) : naive;
  const corrected = chosen.size !== naive.size;

  return {
    recommendedSize: chosen.size,
    naiveSize: naive.size,
    correctionApplied: corrected,
    learnedOffsetCm: chosen.learnedOffsetCm,
    bodyChestCm: Math.round(body.bodyChestCm * 10) / 10,
    confidence: body.confidence * (corrected ? 1 : 0.95),
    reason: corrected
      ? `This style runs about ${chosen.learnedOffsetCm.toFixed(1)}cm small — ${chosen.size}, not ${naive.size}.`
      : `${chosen.size} fits your ${Math.round(body.bodyChestCm)}cm chest with room to move.`,
  };
}

/**
 * The reconciliation loop, and the moat in three lines.
 * Recomputed at seed time from the brand's own exchange records.
 */
export function learnedOffsetFromExchanges(
  tooSmallCount: number,
  tooLargeCount: number,
  deliveredCount: number,
): number {
  if (deliveredCount < 30) return 0; // not enough signal — cold start
  const net = (tooSmallCount - tooLargeCount) / deliveredCount;
  return Math.max(-4, Math.min(4, net * 25));
}
