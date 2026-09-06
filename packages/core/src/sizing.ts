import type {
  BodyMeasurement, FitRecommendation, GarmentSpec, Size,
} from './types';
import { SIZES } from './types';

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

  // The measurement carries a band, so the honest question is not "which size"
  // but "does the band still fit inside this size". Walk the band's edges
  // through the same picker: if either lands elsewhere, say so rather than
  // committing to one letter the measurement cannot actually distinguish.
  let alternativeSize: Size | undefined;
  if (body.bandCm && body.bandCm > 0) {
    const at = (chestCm: number) => {
      const req = chestCm + ease;
      return (ordered.find((s) => (applyOffset ? effectiveChest(s) : s.chestCm) >= req)
        ?? ordered[ordered.length - 1]).size;
    };
    const lo = at(body.bodyChestCm - body.bandCm);
    const hi = at(body.bodyChestCm + body.bandCm);
    alternativeSize = [lo, hi].find((s) => s !== chosen.size);
  }

  return {
    recommendedSize: chosen.size,
    naiveSize: naive.size,
    correctionApplied: corrected,
    learnedOffsetCm: chosen.learnedOffsetCm,
    bodyChestCm: Math.round(body.bodyChestCm * 10) / 10,
    alternativeSize,
    confidence: body.confidence * (corrected ? 1 : 0.95),
    reason: corrected
      ? `This style runs about ${chosen.learnedOffsetCm.toFixed(1)}cm small — ${chosen.size}, not ${naive.size}.`
      : alternativeSize
        ? `${chosen.size} for your ${Math.round(body.bodyChestCm)}cm chest, though ${alternativeSize} is within the margin.`
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
