/**
 * The four-layer view of one order.
 *
 * This is what the ontology is FOR. L1 knows what she measured, L2 knows
 * whether she replied, L3 knows whether she answered, L4 knows who else uses
 * her doorstep — and each of them, on its own, is a fact about a different
 * table. `orderView` is one traversal that returns all four, which is the only
 * reason a single per-order estimate can be assembled without four queries and
 * a join in application code.
 */
import { NODE, REL } from './schema';
import type { RtoGraph } from './client';
import { clusterScore } from './cluster';

export interface FitSessionRow {
  orderId: string;
  /** CAMERA | CROSS_BRAND | SKIPPED */
  source: string;
  heightCm?: number;
  bodyChestCm?: number;
  confidence?: number;
  bandCm?: number;
  recommendedSize?: string;
}

export interface MessageRow {
  orderId: string;
  /** SENT | DELIVERED | READ | CONFIRMED | CHANGED_SIZE | CANCELLED | TIMEOUT */
  status: string;
  templateName?: string;
}

export interface CallRow {
  orderId: string;
  /** CONFIRMED | CANCELLED | NO_ANSWER | UNREACHABLE */
  outcome: string;
  durationSec?: number;
}

/** L1 — attach fit sessions to their orders. */
export async function loadFitSessions(g: RtoGraph, rows: FitSessionRow[]): Promise<number> {
  for (let i = 0; i < rows.length; i += 1000) {
    await g.query(
      `UNWIND $rows AS r
       MATCH (o:${NODE.ORDER} {orderId: r.orderId})
       MERGE (f:${NODE.FIT_SESSION} {orderId: r.orderId})
         SET f.source = r.source, f.heightCm = r.heightCm,
             f.bodyChestCm = r.bodyChestCm, f.confidence = r.confidence,
             f.bandCm = r.bandCm, f.recommendedSize = r.recommendedSize
       MERGE (o)-[:${REL.MEASURED_BY}]->(f)`,
      { rows: rows.slice(i, i + 1000) },
    );
  }
  return g.count(`MATCH (f:${NODE.FIT_SESSION}) RETURN count(f) AS n`);
}

/** L2 — attach WhatsApp confirmations. */
export async function loadMessages(g: RtoGraph, rows: MessageRow[]): Promise<number> {
  for (let i = 0; i < rows.length; i += 1000) {
    await g.query(
      `UNWIND $rows AS r
       MATCH (o:${NODE.ORDER} {orderId: r.orderId})
       MERGE (m:${NODE.MESSAGE} {orderId: r.orderId})
         SET m.status = r.status, m.templateName = r.templateName
       MERGE (o)-[:${REL.CONFIRMED_VIA}]->(m)`,
      { rows: rows.slice(i, i + 1000) },
    );
  }
  return g.count(`MATCH (m:${NODE.MESSAGE}) RETURN count(m) AS n`);
}

/** L3 — attach voice calls. */
export async function loadCalls(g: RtoGraph, rows: CallRow[]): Promise<number> {
  for (let i = 0; i < rows.length; i += 1000) {
    await g.query(
      `UNWIND $rows AS r
       MATCH (o:${NODE.ORDER} {orderId: r.orderId})
       MERGE (k:${NODE.CALL} {orderId: r.orderId})
         SET k.outcome = r.outcome, k.durationSec = r.durationSec
       MERGE (o)-[:${REL.ESCALATED_TO}]->(k)`,
      { rows: rows.slice(i, i + 1000) },
    );
  }
  return g.count(`MATCH (k:${NODE.CALL}) RETURN count(k) AS n`);
}

export interface OrderView {
  orderId: string;
  customerId: string;
  styleId: string;
  cod: boolean;
  tier: number;
  /** L1 */
  fitSource: string | null;
  recommendedSize: string | null;
  boughtSize: string | null;
  /** True when she measured and then chose something else — the override. */
  overrode: boolean;
  /** L2 */
  messageStatus: string | null;
  /** L3 */
  callOutcome: string | null;
  /** L4 */
  clusterId: string | null;
  clusterSize: number;
  clusterOrders: number;
  clusterRtoRate: number;
  clusterScore: number;
  /** L4 — how many accounts share an identifier with this one directly. */
  directNeighbours: number;
}

/**
 * Every layer's evidence about one order, in one traversal.
 *
 * OPTIONAL MATCH throughout, deliberately: an order with no fit session, no
 * message and no call is the normal case, and it must come back as a row with
 * nulls rather than no row at all. A missing layer is information.
 */
export async function orderView(g: RtoGraph, orderId: string): Promise<OrderView | null> {
  const rows = await g.query<Record<string, unknown>>(
    `MATCH (c:${NODE.CUSTOMER})-[:${REL.PLACED}]->(o:${NODE.ORDER} {orderId: $orderId})
     OPTIONAL MATCH (o)-[:${REL.OF_STYLE}]->(s:${NODE.STYLE})
     OPTIONAL MATCH (o)-[:${REL.MEASURED_BY}]->(f:${NODE.FIT_SESSION})
     OPTIONAL MATCH (o)-[:${REL.CONFIRMED_VIA}]->(m:${NODE.MESSAGE})
     OPTIONAL MATCH (o)-[:${REL.ESCALATED_TO}]->(k:${NODE.CALL})
     OPTIONAL MATCH (c)-[:${REL.USES}]->(i)<-[:${REL.USES}]-(n:${NODE.CUSTOMER})
     RETURN o.orderId AS orderId, c.customerId AS customerId, s.styleId AS styleId,
            o.cod AS cod, c.tier AS tier, o.size AS boughtSize,
            f.source AS fitSource, f.recommendedSize AS recommendedSize,
            m.status AS messageStatus, k.outcome AS callOutcome,
            c.clusterId AS clusterId, c.clusterSize AS clusterSize,
            c.clusterOrders AS clusterOrders, c.clusterRto AS clusterRto,
            count(DISTINCT n) AS neighbours`,
    { orderId },
  );
  if (!rows.length) return null;
  const r = rows[0] as any;

  const clusterOrders = Number(r.clusterOrders ?? 0);
  const clusterRtoRate = clusterOrders ? Number(r.clusterRto ?? 0) / clusterOrders : 0;
  const clusterSize = Number(r.clusterSize ?? 1);
  const boughtSize = r.boughtSize ?? null;
  const recommendedSize = r.recommendedSize ?? null;

  return {
    orderId: String(r.orderId),
    customerId: String(r.customerId),
    styleId: r.styleId ?? null,
    cod: Boolean(r.cod),
    tier: Number(r.tier ?? 2),
    fitSource: r.fitSource ?? null,
    recommendedSize,
    boughtSize,
    overrode: Boolean(recommendedSize && boughtSize && recommendedSize !== boughtSize),
    messageStatus: r.messageStatus ?? null,
    callOutcome: r.callOutcome ?? null,
    clusterId: r.clusterId != null ? String(r.clusterId) : null,
    clusterSize,
    clusterOrders,
    clusterRtoRate: Math.round(clusterRtoRate * 1000) / 1000,
    clusterScore: clusterScore({ clusterSize, clusterOrders, clusterRtoRate }),
    directNeighbours: Number(r.neighbours ?? 0),
  };
}

/** Map the graph's L1 record onto the estimator's paths. */
export function l1PathOf(v: OrderView): 'SKIPPED' | 'ACCEPTED' | 'OVERRODE' | 'CROSS_BRAND' {
  if (!v.fitSource || v.fitSource === 'SKIPPED') return 'SKIPPED';
  if (v.fitSource === 'CROSS_BRAND') return 'CROSS_BRAND';
  return v.overrode ? 'OVERRODE' : 'ACCEPTED';
}
