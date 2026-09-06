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

/* ------------------------------------------------------------------ L2+L4
 *
 * Fit risk and identity risk are NOT the same quantity and must not be added
 * into one number.
 *
 * This whole codebase exists because RTO gets misattributed — a size failure
 * arrives as REFUSED_COD and nobody can see it. Blending a refusal ring into
 * "fit risk" would commit exactly that error in the other direction, and it
 * would waste the intervention: a shopper who is unsure about a size needs a
 * message asking her to confirm it, and an account that refuses COD on
 * principle needs to be taken off COD. Those are different actions, so they
 * need different scores.
 *
 * identityClusterScore comes from @rto/graph. Core stays pure and never
 * imports it, so scoring still works — with the identity term at zero — when
 * the graph is not running.
 */

export interface RtoRiskInput extends RiskInput {
  /** 0..1 from the identity graph. Absent or 0 means "no evidence", not "safe". */
  identityClusterScore?: number;
}

export type RtoAction = 'NONE' | 'CONFIRM_SIZE' | 'REMOVE_COD' | 'VERIFY_IDENTITY';

export interface RtoRiskBreakdown {
  /** The higher of the two, because either one alone can lose the parcel. */
  score: number;
  fit: RiskBreakdown;
  identity: number;
  dominant: 'FIT' | 'IDENTITY' | 'NONE';
  atRisk: boolean;
  action: RtoAction;
  reason: string;
}

/** Above this, an identity cluster is worth acting on rather than watching. */
export const IDENTITY_THRESHOLD = 0.5;
/** Above this it is not worth a confirmation message — take the COD away. */
export const IDENTITY_HARD = 0.7;

export function scoreRtoRisk(input: RtoRiskInput): RtoRiskBreakdown {
  const fit = scoreFitRisk(input);
  const identity = Math.min(1, Math.max(0, input.identityClusterScore ?? 0));

  // Max, not sum. Two independent ways to lose the parcel; the worse one sets
  // the urgency, and summing would let two mild signals fake a severe one.
  const score = Math.max(fit.score, identity);
  const identityWins = identity >= IDENTITY_THRESHOLD && identity >= fit.score;

  const dominant: RtoRiskBreakdown['dominant'] =
    identityWins ? 'IDENTITY' : fit.atRisk ? 'FIT' : 'NONE';

  let action: RtoAction = 'NONE';
  if (identity >= IDENTITY_HARD) action = 'VERIFY_IDENTITY';
  else if (identityWins && input.paymentMode === 'COD') action = 'REMOVE_COD';
  else if (identityWins) action = 'VERIFY_IDENTITY';
  else if (fit.atRisk) action = 'CONFIRM_SIZE';

  const reason =
    action === 'VERIFY_IDENTITY'
      ? 'This doorstep is linked to other accounts that refuse delivery. Verify before dispatch.'
      : action === 'REMOVE_COD'
        ? 'Linked accounts at this address refuse COD. Offer prepaid only.'
        : action === 'CONFIRM_SIZE'
          ? 'Size is the likely failure here. Confirm the size before dispatch.'
          : 'Nothing stands out. Ship it.';

  return { score, fit, identity, dominant, atRisk: score >= AT_RISK_THRESHOLD, action, reason };
}
