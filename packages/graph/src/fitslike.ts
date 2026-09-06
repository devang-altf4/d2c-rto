/**
 * The "fits like" style graph.
 *
 * WHAT PROBLEM THIS SOLVES
 *
 * learnedOffsetFromExchanges() returns 0 below 30 delivered orders, which is
 * correct — you cannot learn a garment's grading from four exchanges. But it
 * means a brand new style ships blind, and a brand adds styles every week.
 * That is a permanent cold-start hole, not a transient one.
 *
 * The way out is that garments are not independent. If a shopper corrected her
 * size UP on style A and also bought style B without correcting, that is one
 * observation that B runs larger than A. Aggregate those over every customer
 * who bought both and you get an edge. A new style with three exchanges of its
 * own can then borrow from its neighbours instead of shipping at zero.
 *
 * WHY THIS NEEDS THE GRAPH
 *
 * The pair (styleA, styleB) is only visible through a customer who bought
 * both — a two-hop path, Style <- Order <- Customer -> Order -> Style. In SQL
 * that is a self-join of the orders table against itself keyed on customer,
 * which is exactly the shape that gets expensive and unreadable as you add
 * hops. Here it is the natural traversal.
 */
import { NODE, REL, type FitsLikeEdge } from './schema';
import type { RtoGraph } from './client';

/** Below this many shared customers an edge is noise, not evidence. */
export const MIN_SUPPORT = 4;

interface ExchangeRow { orderId: string; styleId: string; size: string; reason: string }

/**
 * Mark the orders that were corrected, then derive style-to-style edges.
 *
 * Returns the number of edges written.
 */
export async function buildFitsLike(g: RtoGraph, exchanges: ExchangeRow[]): Promise<number> {
  // Stamp the size correction onto the order it happened on. +1 means she
  // needed a bigger size than she bought, so the garment ran small.
  const rows = exchanges
    .filter((e) => e.reason === 'SIZE_TOO_SMALL' || e.reason === 'SIZE_TOO_LARGE')
    .map((e) => ({ orderId: e.orderId, dir: e.reason === 'SIZE_TOO_SMALL' ? 1 : -1 }));

  for (let i = 0; i < rows.length; i += 2000) {
    await g.query(
      `UNWIND $rows AS r
       MATCH (o:${NODE.ORDER} {orderId: r.orderId})
       SET o.sizeCorrection = r.dir`,
      { rows: rows.slice(i, i + 2000) },
    );
  }

  // Two styles bought by the same customer.
  //
  // EDGE EXISTENCE and EDGE WEIGHT are separate questions, and conflating them
  // was worth 3 edges instead of 2,255. Whether two garments are COMPARABLE is
  // answered by co-purchase, which is common. How they differ in grading is
  // answered by size corrections, which are rare — only 3% of orders carry
  // one. So build the edge on co-purchase, and let `observed` say how much
  // correction evidence actually sits behind the delta.
  await g.query(
    `MATCH (a:${NODE.STYLE})<-[:${REL.OF_STYLE}]-(oa:${NODE.ORDER})
            <-[:${REL.PLACED}]-(c:${NODE.CUSTOMER})
            -[:${REL.PLACED}]->(ob:${NODE.ORDER})-[:${REL.OF_STYLE}]->(b:${NODE.STYLE})
     WHERE a.styleId < b.styleId
     WITH a, b,
          count(DISTINCT c) AS support,
          sum(CASE WHEN oa.sizeCorrection IS NOT NULL OR ob.sizeCorrection IS NOT NULL
                   THEN 1 ELSE 0 END) AS observed,
          avg(coalesce(ob.sizeCorrection, 0) - coalesce(oa.sizeCorrection, 0)) AS drift
     WHERE support >= ${MIN_SUPPORT}
     MERGE (a)-[f:${REL.FITS_LIKE}]->(b)
     SET f.support = support, f.observed = observed, f.deltaCm = drift * 2.5`,
  );

  return g.count(`MATCH ()-[f:${REL.FITS_LIKE}]->() RETURN count(f) AS n`);
}

/**
 * Borrow an offset for a style that has too little history of its own.
 *
 * Returns null when the neighbourhood is as ignorant as the style is — which
 * is the honest answer, and better than a confident zero.
 */
export async function borrowedOffset(g: RtoGraph, styleId: string): Promise<{
  offsetCm: number; fromStyles: number; totalSupport: number;
} | null> {
  const rows = await g.query<Record<string, unknown>>(
    `MATCH (s:${NODE.STYLE} {styleId: $styleId})-[f:${REL.FITS_LIKE}]-(n:${NODE.STYLE})
     WHERE n.learnedOffsetCm IS NOT NULL AND n.learnedOffsetCm <> 0
     RETURN sum(f.support * n.learnedOffsetCm) AS weighted,
            sum(f.support) AS support, count(n) AS styles`,
    { styleId },
  );
  if (!rows.length) return null;
  const { weighted, support, styles: n } = rows[0] as any;
  const totalSupport = Number(support ?? 0);
  if (!totalSupport || !Number(n)) return null;
  return {
    offsetCm: Math.round((Number(weighted) / totalSupport) * 10) / 10,
    fromStyles: Number(n),
    totalSupport,
  };
}

/** Write the per-style learned offsets in, so borrowedOffset has something to read. */
export async function setStyleOffsets(
  g: RtoGraph,
  offsets: Array<{ styleId: string; learnedOffsetCm: number }>,
): Promise<void> {
  for (let i = 0; i < offsets.length; i += 2000) {
    await g.query(
      `UNWIND $rows AS r
       MATCH (s:${NODE.STYLE} {styleId: r.styleId})
       SET s.learnedOffsetCm = r.learnedOffsetCm`,
      { rows: offsets.slice(i, i + 2000) },
    );
  }
}

export type { FitsLikeEdge };
