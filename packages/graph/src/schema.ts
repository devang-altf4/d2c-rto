/**
 * The RTO identity graph — what it holds, and why it is not a table.
 *
 * THE ARGUMENT FOR A GRAPH HERE, IN ONE PARAGRAPH
 *
 * Every feature in scoreFitRisk is a property of a single order: its payment
 * mode, its tier, whether the buyer is new, how the style has behaved. None of
 * them can see that two orders came from the same doorstep. Refusal rings
 * exploit exactly that blind spot — they open several accounts, each of which
 * looks like an ordinary repeat customer, and share identifiers only in pairs.
 * Account A shares a phone with B, B shares an address with C, C shares a
 * device with D. No `GROUP BY` over any one column recovers that chain: on the
 * generated corpus, grouping by phone finds 42% of an average ring, by address
 * 41%, by device 41%. Taking the transitive closure over all three finds 100%
 * of them. That gap is the entire case for this package.
 *
 * WHAT IT IS NOT FOR
 *
 * Not speed. At 45k orders Postgres beats this on every aggregate the
 * diagnosis screen computes, and those should stay where they are. This exists
 * to compute two features that are not otherwise computable, and nothing else.
 */

/** Node labels. Identifiers are NODES, not properties — that is what lets two
 *  customers be linked by sharing one, without either knowing about the other. */
export const NODE = {
  // shared spine
  CUSTOMER: 'Customer',
  ORDER: 'Order',
  STYLE: 'Style',
  SKU: 'Sku',
  // L4 — identity. These are NODES, not properties, which is what lets two
  // customers be linked by sharing one without either knowing about the other.
  PHONE: 'Phone',
  ADDRESS: 'Address',
  DEVICE: 'Device',
  // L1 — fit
  FIT_SESSION: 'FitSession',
  // L2 — WhatsApp
  MESSAGE: 'Message',
  // L3 — voice
  CALL: 'Call',
} as const;

export const REL = {
  PLACED: 'PLACED',           // (:Customer)-[:PLACED]->(:Order)
  OF_STYLE: 'OF_STYLE',       // (:Order)-[:OF_STYLE]->(:Style)
  OF_SKU: 'OF_SKU',           // (:Order)-[:OF_SKU]->(:Sku)
  USES: 'USES',               // (:Customer)-[:USES]->(:Phone|:Address|:Device)   L4
  FITS_LIKE: 'FITS_LIKE',     // (:Style)-[:FITS_LIKE {deltaCm, support}]->(:Style)  L4
  MEASURED_BY: 'MEASURED_BY', // (:Order)-[:MEASURED_BY]->(:FitSession)           L1
  RECOMMENDED: 'RECOMMENDED', // (:FitSession)-[:RECOMMENDED]->(:Sku)            L1
  CONFIRMED_VIA: 'CONFIRMED_VIA', // (:Order)-[:CONFIRMED_VIA]->(:Message)       L2
  ESCALATED_TO: 'ESCALATED_TO',   // (:Order)-[:ESCALATED_TO]->(:Call)           L3
} as const;

/**
 * THE ONTOLOGY, AND WHY L4 IS NOT JUST ANOTHER LAYER
 *
 * L1, L2 and L3 each produce evidence about one order and stop there. A fit
 * session knows what she measured; a WhatsApp message knows whether she
 * replied; a call knows whether she answered. None of them can see each other,
 * and none can see any other order.
 *
 * L4 is the layer where those become one connected object:
 *
 *      (:Phone)   (:Address)   (:Device)          <- L4, shared identity
 *          ^          ^            ^
 *           \         |           /
 *            +---- (:Customer) --+
 *                       |
 *                   [:PLACED]
 *                       v
 *   (:FitSession) <- (:Order) -> (:Message)  -> (:Call)
 *        L1            |            L2            L3
 *                  [:OF_STYLE]
 *                       v
 *                   (:Style) -[:FITS_LIKE]- (:Style)     <- L4, shared garment
 *
 * Two hubs, and both are L4. Identity joins orders that share a doorstep;
 * FITS_LIKE joins garments that behave alike. Everything L1/L2/L3 records
 * hangs off an Order, so once the Order is in the graph every layer's evidence
 * is reachable from every other layer's — which is the only reason a single
 * per-order estimate can be assembled at all.
 */

export const GRAPH_NAME = 'rto';

/** Indexes worth having before a load of this size. */
export const INDEX_STATEMENTS = [
  `CREATE INDEX FOR (c:${NODE.CUSTOMER}) ON (c.customerId)`,
  `CREATE INDEX FOR (o:${NODE.ORDER}) ON (o.orderId)`,
  `CREATE INDEX FOR (s:${NODE.STYLE}) ON (s.styleId)`,
  `CREATE INDEX FOR (p:${NODE.PHONE}) ON (p.value)`,
  `CREATE INDEX FOR (a:${NODE.ADDRESS}) ON (a.value)`,
  `CREATE INDEX FOR (d:${NODE.DEVICE}) ON (d.value)`,
  `CREATE INDEX FOR (f:${NODE.FIT_SESSION}) ON (f.orderId)`,
  `CREATE INDEX FOR (m:${NODE.MESSAGE}) ON (m.orderId)`,
  `CREATE INDEX FOR (k:${NODE.CALL}) ON (k.orderId)`,
];

// --------------------------------------------------------------- the inputs

export interface GraphCustomer {
  customerId: string;
  phone: string;
  addressHash: string;
  deviceId: string;
  pincode: string;
  tier: number;
  /** Ground truth. Loaded so precision/recall can be measured, NEVER queried
   *  by the detector — see cluster.ts, which does not read it. */
  ringId?: string | null;
  householdId?: string | null;
}

export interface GraphOrder {
  id: string;
  customerId: string;
  styleId: string;
  size: string;
  paymentMode: 'COD' | 'PREPAID';
  outcome: 'DELIVERED' | 'RTO';
  ndrCode?: string;
  amountPaise: number;
  placedAt: string;
}

// -------------------------------------------------------------- the outputs

/**
 * What the graph knows about the doorstep behind one order.
 *
 * `clusterRtoRate` is the number that carries the signal, and `clusterSize`
 * is what stops one person's bad month from reading as a ring.
 */
export interface ClusterRisk {
  customerId: string;
  /** Stable id of the connected component this customer falls in. */
  clusterId: string;
  clusterSize: number;
  clusterOrders: number;
  clusterRtoRate: number;
  clusterCodShare: number;
  /** How many identifiers this customer shares with anyone else. 0 = an island. */
  sharedIdentifiers: number;
  /** 0..1, ready to drop into a risk model. */
  score: number;
}

/** One learned "this garment fits like that one" edge. */
export interface FitsLikeEdge {
  from: string;
  to: string;
  /** Positive means `to` runs smaller than `from` by this many cm. */
  deltaCm: number;
  /** Customers who bought both — the confidence behind the edge. */
  support: number;
}
