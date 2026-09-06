/**
 * One number for one order: P(this order comes back).
 *
 * WHY LOG-ODDS
 *
 * The layers contribute independent evidence, and evidence combines by adding
 * log-odds, not by averaging scores. It also means the per-layer terms ADD UP
 * to the answer — so "L4 contributed +2.22" is a true statement about this
 * order's estimate, not a weight pulled out of a stacked bar chart.
 *
 * WHAT IS MEASURED AND WHAT IS ASSUMED
 *
 * This matters more than the arithmetic, so it is marked on every constant:
 *
 *   [CALIBRATED]  fitted to the 45,000-order corpus. Recompute with
 *                 `pnpm rto:calibrate` after any change to generate.ts.
 *   [ASSUMED]     no data exists. L1, L2 and L3 are interventions this
 *                 business has not run yet, so nothing in the history says how
 *                 well they work. These are priors to argue about, and every
 *                 one is a number someone can challenge on stage.
 *
 * Never present an [ASSUMED] term as a measurement.
 */

/** Population log-odds. 21.3% of the corpus came back. [CALIBRATED] */
export const BASE_LOGIT = -1.308;

/** [CALIBRATED] Payment mode. COD is the single largest measured effect. */
export const COD_LOGIT = { COD: 0.271, PREPAID: -0.572 } as const;

/** [CALIBRATED] Delivery-region tier. */
export const TIER_LOGIT = { 1: -0.132, 2: 0.014, 3: 0.165 } as const;

/** [CALIBRATED] First-time buyer. Small — much smaller than the 0.15 weight
 *  the old scoreFitRisk gave it. */
export const FIRST_ORDER_LOGIT = { true: 0.078, false: -0.115 } as const;

/**
 * [CALIBRATED] L1 — what a size mismatch is actually worth.
 *
 * Measured against the generator's ground truth: an order whose size does not
 * fit comes back 31.2% of the time against 19.7% for one that does. This is
 * the CEILING on L1: it is what perfect sizing would buy, and it is smaller
 * than it feels, because size is only 11.8% of RTO causes.
 */
export const FIT_MISMATCH_LOGIT = 0.515;

/**
 * [ASSUMED] P(she ends up in the wrong size), by what L1 saw.
 *
 * The corpus predates L1, so none of this is measured. The prior for SKIPPED
 * is the one honest number here — 13.8% of historical orders carried a
 * mismatch. The rest is a claim about how well the widget works.
 */
export const MISMATCH_PRIOR = {
  /** Never opened the widget. [CALIBRATED] — the historical base rate. */
  SKIPPED: 0.138,
  /** Measured and bought what it recommended. [ASSUMED] */
  ACCEPTED: 0.04,
  /** Measured, then picked a different size by hand. [ASSUMED] This is the
   *  override signal — the thing no apparel stack records today. */
  OVERRODE: 0.42,
  /** Used the cross-brand path rather than the camera. [ASSUMED] */
  CROSS_BRAND: 0.09,
} as const;

/**
 * [CALIBRATED] L4 — identity cluster, by score band.
 *
 * The strongest signal in the model by a wide margin, and the one no
 * single-order feature can see. Empirical RTO rate per band:
 *   0        20.2%   n=43,147
 *   0-0.3    30.7%   n=   972
 *   0.3-0.5  50.2%   n=   253
 *   0.5-0.7  63.2%   n=   152
 *   >0.7     71.4%   n=   476
 */
export function identityLogit(clusterScore: number): number {
  if (clusterScore <= 0) return -0.066;
  if (clusterScore <= 0.3) return 0.492;
  if (clusterScore <= 0.5) return 1.316;
  if (clusterScore <= 0.7) return 1.847;
  return 2.224;
}

/**
 * [ASSUMED] L2 — what a WhatsApp confirmation tells you.
 *
 * Evidence, not a prior: this arrives AFTER the order is scored, and it
 * updates the estimate rather than forming it. A reply confirming the order is
 * the strongest good news available short of delivery; a timeout is the
 * customer declining to engage, which is worse than never asking.
 */
export const L2_LOGIT = {
  NOT_SENT: 0,
  SENT: 0,
  DELIVERED: -0.1,
  READ: -0.2,
  CONFIRMED: -1.4,
  CHANGED_SIZE: -0.9,
  CANCELLED: 0,      // a save, not a loss — it never ships, so it cannot RTO
  TIMEOUT: 0.7,
} as const;

/** [ASSUMED] L3 — the voice call, fired only after L2 goes unanswered. */
export const L3_LOGIT = {
  NOT_PLACED: 0,
  CONFIRMED: -1.6,
  CANCELLED: 0,
  NO_ANSWER: 0.8,
  UNREACHABLE: 1.1,
} as const;

export type L1Path = keyof typeof MISMATCH_PRIOR;
export type L2Outcome = keyof typeof L2_LOGIT;
export type L3Outcome = keyof typeof L3_LOGIT;

export interface RtoEstimateInput {
  paymentMode: 'COD' | 'PREPAID';
  tier: 1 | 2 | 3;
  isFirstOrder: boolean;
  /** L1 — how the shopper arrived at the size on the order. */
  l1: L1Path;
  /** L2 — the confirmation message, if one has been sent. */
  l2?: L2Outcome;
  /** L3 — the call, if one has been placed. */
  l3?: L3Outcome;
  /** L4 — identity cluster score from @rto/graph. 0 when the graph is down. */
  clusterScore?: number;
}

export interface LayerContribution {
  layer: 'BASE' | 'L1' | 'L2' | 'L3' | 'L4';
  label: string;
  /** Added to the running log-odds. Positive raises the estimate. */
  logit: number;
  /** Percentage points this term moved the final estimate. */
  deltaPct: number;
  measured: boolean;
}

export interface RtoEstimate {
  /** 0..1. The number to put in front of a human. */
  probability: number;
  /** Same, as the percentage the ops screen shows. */
  percent: number;
  logit: number;
  /** Every term, in the order it was applied. They sum to `logit`. */
  contributions: LayerContribution[];
  /** Which layer moved the estimate most, and therefore what to do about it. */
  dominant: 'L1' | 'L2' | 'L3' | 'L4' | 'BASE';
  /** How much of this estimate rests on numbers nobody has measured. */
  assumedShare: number;
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const round = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d;

/**
 * Estimate P(RTO) for one order, with every layer's contribution itemised.
 *
 * The layers are applied in the order they become available in real life:
 * the order's own attributes, then L1 at checkout, then L4 as soon as the
 * identity graph is consulted, then L2 and L3 as they report back. So the
 * same function produces the pre-dispatch estimate and each revision, and
 * `contributions` reads as the story of the order.
 */
export function estimateRto(input: RtoEstimateInput): RtoEstimate {
  const contributions: LayerContribution[] = [];
  let logit = BASE_LOGIT;

  const add = (
    layer: LayerContribution['layer'], label: string, value: number, measured: boolean,
  ) => {
    if (value === 0 && layer !== 'BASE') return;
    const before = sigmoid(logit);
    logit += value;
    contributions.push({
      layer, label, logit: round(value),
      deltaPct: round((sigmoid(logit) - before) * 100, 1),
      measured,
    });
  };

  contributions.push({
    layer: 'BASE', label: `population rate ${(sigmoid(BASE_LOGIT) * 100).toFixed(1)}%`,
    logit: round(BASE_LOGIT), deltaPct: round(sigmoid(BASE_LOGIT) * 100, 1), measured: true,
  });

  add('BASE', input.paymentMode, COD_LOGIT[input.paymentMode], true);
  add('BASE', `tier ${input.tier}`, TIER_LOGIT[input.tier], true);
  add('BASE', input.isFirstOrder ? 'first order' : 'repeat buyer',
    FIRST_ORDER_LOGIT[String(input.isFirstOrder) as 'true' | 'false'], true);

  // L1 — expected mismatch risk, scaled by what a mismatch is measured to cost.
  const pMismatch = MISMATCH_PRIOR[input.l1];
  add('L1', `fit ${input.l1.toLowerCase().replace('_', ' ')} (P(wrong size) ${(pMismatch * 100).toFixed(0)}%)`,
    round(pMismatch * FIT_MISMATCH_LOGIT), input.l1 === 'SKIPPED');

  // L4 — the doorstep. Applied before L2/L3 because the graph is queryable at
  // checkout, whereas L2 and L3 have not happened yet.
  const cluster = input.clusterScore ?? 0;
  add('L4', cluster > 0
    ? `identity cluster ${cluster.toFixed(2)}`
    : 'no shared identifiers', identityLogit(cluster), true);

  if (input.l2) add('L2', `whatsapp ${input.l2.toLowerCase().replace('_', ' ')}`, L2_LOGIT[input.l2], false);
  if (input.l3) add('L3', `call ${input.l3.toLowerCase().replace('_', ' ')}`, L3_LOGIT[input.l3], false);

  const probability = sigmoid(logit);

  // Cancelled at either layer means it never ships, so it cannot come back.
  const cancelled = input.l2 === 'CANCELLED' || input.l3 === 'CANCELLED';

  const movers = contributions.filter((c) => c.layer !== 'BASE');
  const dominant = movers.length
    ? movers.reduce((a, b) => (Math.abs(b.logit) > Math.abs(a.logit) ? b : a)).layer
    : 'BASE';

  const assumedMagnitude = movers.filter((c) => !c.measured)
    .reduce((s, c) => s + Math.abs(c.logit), 0);
  const totalMagnitude = movers.reduce((s, c) => s + Math.abs(c.logit), 0);

  return {
    probability: cancelled ? 0 : round(probability, 4),
    percent: cancelled ? 0 : round(probability * 100, 1),
    logit: round(logit),
    contributions,
    dominant,
    assumedShare: totalMagnitude ? round(assumedMagnitude / totalMagnitude, 2) : 0,
  };
}

/**
 * What to do about it.
 *
 * Ranking on the estimate alone is wrong, because the INTERVENTIONS differ in
 * cost. Taking COD off an order is a real imposition on a real customer and
 * needs to be nearly certain. Asking "is M right for you?" costs one WhatsApp
 * template and, if she answers, is the single most useful thing this system
 * can learn. So a cheap action fires at a much lower bar than an expensive
 * one, and an override fires it regardless of the total.
 *
 * The override case matters most: she measured, the widget said one size, and
 * she chose another. That disagreement is the signal no apparel stack records
 * today, and it is worth a message even on a 30% order.
 */
export function recommendedAction(
  e: RtoEstimate,
  ctx?: { l1?: L1Path },
): {
  action: 'SHIP' | 'CONFIRM_SIZE' | 'CONFIRM_ORDER' | 'REMOVE_COD' | 'HOLD';
  reason: string;
} {
  if (e.percent >= 60 && e.dominant === 'L4')
    return { action: 'REMOVE_COD', reason: 'Linked accounts at this doorstep refuse delivery. Offer prepaid only.' };
  if (e.percent >= 60)
    return { action: 'HOLD', reason: 'Too likely to come back. Hold for a human before dispatch.' };

  // Cheap intervention, high information: fire it on the disagreement itself.
  if (ctx?.l1 === 'OVERRODE')
    return { action: 'CONFIRM_SIZE', reason: 'She measured, then picked a different size. Confirm which one she wants.' };
  if (e.percent >= 40 && e.dominant === 'L1')
    return { action: 'CONFIRM_SIZE', reason: 'Size is the weak point here. Confirm it before dispatch.' };
  if (ctx?.l1 === 'SKIPPED' && e.percent >= 35)
    return { action: 'CONFIRM_SIZE', reason: 'No measurement taken and the order is borderline. Ask before shipping.' };

  if (e.percent >= 40)
    return { action: 'CONFIRM_ORDER', reason: 'Worth one confirmation message before dispatch.' };
  return { action: 'SHIP', reason: 'Nothing stands out. Ship it.' };
}
