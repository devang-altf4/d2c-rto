import type { RiskBreakdown, RiskInput } from './types';

/**
 * Fit risk — L2 targeting. Weights are visible on screen, deliberately.
 *
 * This is what makes L2 ours rather than a WhatsApp integration anyone could
 * ship in a weekend: GoKwik scores payment risk, we score fit risk, and it
 * comes out of the same model as L1.
 */
export const WEIGHTS = {
  styleHistory: 0.35,
  noL1: 0.25,
  cod: 0.15,
  firstOrder: 0.15,
  tier: 0.10,
} as const;

export const AT_RISK_THRESHOLD = 0.45;

const tierWeight = (t: 1 | 2 | 3) => (t === 3 ? 1 : t === 2 ? 0.6 : 0.2);

export function scoreFitRisk(input: RiskInput): RiskBreakdown {
  const components = {
    styleHistory: WEIGHTS.styleHistory * input.styleSizeFailureRate,
    noL1: WEIGHTS.noL1 * (input.usedL1 ? 0 : 1),
    cod: WEIGHTS.cod * (input.paymentMode === 'COD' ? 1 : 0),
    firstOrder: WEIGHTS.firstOrder * (input.isFirstOrder ? 1 : 0),
    tier: WEIGHTS.tier * tierWeight(input.tier),
  };
  const score = Object.values(components).reduce((a, b) => a + b, 0);
  return { score, components, atRisk: score >= AT_RISK_THRESHOLD };
}
