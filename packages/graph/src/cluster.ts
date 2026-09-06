/**
 * Identity clusters, and the risk that comes out of them.
 *
 * THE DETECTOR NEVER READS GROUND TRUTH. `ringId` and `householdId` are loaded
 * onto the nodes so that precision and recall can be measured afterwards, and
 * nothing in this file queries them. If you add a query here that does, the
 * numbers in the report stop meaning anything.
 *
 * WHY BOTH STRUCTURE AND BEHAVIOUR
 *
 * Structure alone does not work, and it is worth being precise about why. On
 * the generated corpus there are 567 multi-customer components; only 40 are
 * rings and 527 are families sharing a roof. Flagging every component of three
 * or more gives 100% recall at 9% precision — useless. Households are
 * deliberately sized 2-5 so they overlap the rings, which means component size
 * cannot separate them either. What separates them is what the component DOES:
 * a family's refusal rate looks like everyone else's, a ring's does not.
 */
import { NODE, REL, type ClusterRisk } from './schema';
import type { RtoGraph } from './client';

/** Population RTO rate. Anything at or below this is unremarkable. */
export const BASELINE_RTO = 0.21;
/** Below this many orders a component has not shown you enough to judge it. */
export const MIN_ORDERS = 4;
/** A refusal rate this high across a whole component is the top of the scale. */
export const SATURATE_RTO = 0.75;

/**
 * Assign every customer a component id, computed by the graph engine.
 *
 * This is the step that a relational database cannot do in one query: WCC
 * walks Customer -> Phone/Address/Device -> Customer transitively, so a chain
 * of pairwise shares collapses into one component however long it runs.
 */
export async function computeClusters(g: RtoGraph): Promise<number> {
  // SCOPE MATTERS. An unscoped algo.WCC() returns ONE component covering the
  // whole graph, because Customer -> Order -> Style <- Order <- Customer links
  // every shopper who ever bought the same style to every other. That is a
  // true statement about the graph and a useless one about doorsteps. Restrict
  // the walk to the identity subgraph and the components mean what we want.
  await g.query(
    `CALL algo.WCC({
       nodeLabels: ['${NODE.CUSTOMER}', '${NODE.PHONE}', '${NODE.ADDRESS}', '${NODE.DEVICE}'],
       relationshipTypes: ['${REL.USES}']
     }) YIELD node, componentId
     WITH node, componentId
     WHERE node:${NODE.CUSTOMER}
     SET node.clusterId = componentId`,
  );
  // Without this the summarise step below re-scans every customer once per
  // component — 24,622 scans of 26,132 rows, which took 103 seconds. Indexed,
  // it is under a second. The index can only be built after the property
  // exists, so it lives here rather than in INDEX_STATEMENTS.
  try {
    await g.query(`CREATE INDEX FOR (c:${NODE.CUSTOMER}) ON (c.clusterId)`);
  } catch { /* already indexed */ }

  return g.count(
    `MATCH (c:${NODE.CUSTOMER}) WHERE c.clusterId IS NOT NULL
     RETURN count(DISTINCT c.clusterId) AS n`,
  );
}

/**
 * Roll each component up into the numbers the score needs, and cache them on
 * the customer nodes so a per-order lookup is a single indexed match.
 */
export async function summariseClusters(g: RtoGraph): Promise<number> {
  // ONE pass. The obvious phrasing — aggregate per component, then re-MATCH
  // the members to write the totals back — re-scans the customer table once
  // per component and takes about two minutes on this corpus. Collecting the
  // members during the aggregation and UNWINDing them to write does the same
  // work in 320ms, because nothing is looked up twice.
  await g.query(
    `MATCH (c:${NODE.CUSTOMER})
     OPTIONAL MATCH (c)-[:${REL.PLACED}]->(o:${NODE.ORDER})
     WITH c.clusterId AS cid,
          collect(DISTINCT c) AS members,
          count(o) AS orders,
          sum(CASE WHEN o.rto THEN 1 ELSE 0 END) AS rto,
          sum(CASE WHEN o.cod THEN 1 ELSE 0 END) AS cod
     WITH members, size(members) AS memberCount, orders, rto, cod
     UNWIND members AS m
     SET m.clusterSize = memberCount,
         m.clusterOrders = orders,
         m.clusterRto = rto,
         m.clusterCod = cod`,
  );
  return g.count(
    `MATCH (c:${NODE.CUSTOMER}) WHERE c.clusterSize > 1
     RETURN count(DISTINCT c.clusterId) AS n`,
  );
}

/**
 * Turn a component's shape and behaviour into 0..1.
 *
 * Multiplicative on purpose: a big well-behaved family and a tiny pair with
 * one bad month should both score near zero. Only a component that is BOTH
 * unusually connected and unusually refusing gets near the top.
 */
export function clusterScore(input: {
  clusterSize: number;
  clusterOrders: number;
  clusterRtoRate: number;
}): number {
  const { clusterSize, clusterOrders, clusterRtoRate } = input;
  if (clusterSize < 2 || clusterOrders < MIN_ORDERS) return 0;

  // 2 members is weak evidence, 6+ is as structural as it gets. Square-rooted
  // so the curve rises fast then flattens.
  const sizeFactor = Math.sqrt(Math.min(1, (clusterSize - 1) / 5));
  const rateFactor = Math.min(1, Math.max(0,
    (clusterRtoRate - BASELINE_RTO) / (SATURATE_RTO - BASELINE_RTO)));

  return Math.round(sizeFactor * rateFactor * 1000) / 1000;
}

/** Everything the risk model needs about one customer's doorstep. */
export async function clusterRiskFor(g: RtoGraph, customerId: string): Promise<ClusterRisk | null> {
  const rows = await g.query<Record<string, unknown>>(
    `MATCH (c:${NODE.CUSTOMER} {customerId: $customerId})
     OPTIONAL MATCH (c)-[:${REL.USES}]->(i)<-[:${REL.USES}]-(other:${NODE.CUSTOMER})
     RETURN c.clusterId AS clusterId, c.clusterSize AS size, c.clusterOrders AS orders,
            c.clusterRto AS rto, c.clusterCod AS cod, count(DISTINCT i) AS shared`,
    { customerId },
  );
  if (!rows.length) return null;
  const { clusterId, size, orders, rto, cod, shared } = rows[0] as any;

  const clusterOrders = Number(orders ?? 0);
  const clusterRtoRate = clusterOrders ? Number(rto ?? 0) / clusterOrders : 0;
  const clusterSize = Number(size ?? 1);

  return {
    customerId,
    clusterId: String(clusterId ?? ''),
    clusterSize,
    clusterOrders,
    clusterRtoRate: Math.round(clusterRtoRate * 1000) / 1000,
    clusterCodShare: clusterOrders
      ? Math.round((Number(cod ?? 0) / clusterOrders) * 1000) / 1000 : 0,
    sharedIdentifiers: Number(shared ?? 0),
    score: clusterScore({ clusterSize, clusterOrders, clusterRtoRate }),
  };
}

/** Every component worth a human's attention, worst first. */
export async function flaggedClusters(g: RtoGraph, minScore = 0.5): Promise<Array<{
  clusterId: string; members: number; orders: number; rtoRate: number; score: number;
  customerIds: string[];
}>> {
  const rows = await g.query<Record<string, unknown>>(
    `MATCH (c:${NODE.CUSTOMER})
     WHERE c.clusterSize > 1 AND c.clusterOrders >= ${MIN_ORDERS}
     WITH c.clusterId AS cid, c.clusterSize AS members, c.clusterOrders AS orders,
          c.clusterRto AS rto, collect(c.customerId) AS ids
     RETURN cid, members, orders, rto, ids`,
  );
  return rows
    .map((row) => {
      const { cid, members, orders, rto, ids } = row as any;
      const clusterOrders = Number(orders ?? 0);
      const rtoRate = clusterOrders ? Number(rto ?? 0) / clusterOrders : 0;
      return {
        clusterId: String(cid),
        members: Number(members ?? 0),
        orders: clusterOrders,
        rtoRate: Math.round(rtoRate * 1000) / 1000,
        score: clusterScore({
          clusterSize: Number(members ?? 0), clusterOrders, clusterRtoRate: rtoRate,
        }),
        customerIds: (ids ?? []) as string[],
      };
    })
    .filter((c) => c.score >= minScore)
    .sort((a, b) => b.score - a.score);
}
