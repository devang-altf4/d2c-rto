/**
 * FalkorDB connection and the bulk load.
 *
 * The load is batched with UNWIND rather than one CREATE per row. 45k orders
 * and 26k customers as individual statements is minutes of round trips; as
 * UNWIND batches it is seconds. That is the only performance decision in this
 * package and it is a client-side one.
 */
import { FalkorDB } from 'falkordb';
import {
  GRAPH_NAME, INDEX_STATEMENTS, NODE, REL,
  type GraphCustomer, type GraphOrder,
} from './schema';

export interface GraphConfig {
  url?: string;
  graphName?: string;
}

export class RtoGraph {
  private db: FalkorDB | null = null;
  private graph: any = null;
  readonly name: string;
  private readonly url: string;

  constructor(cfg: GraphConfig = {}) {
    // 6379 is usually already a plain Redis on a dev box, and a plain Redis
    // answers PING but not GRAPH.QUERY — a confusing failure. Default off it.
    this.url = cfg.url ?? process.env.FALKORDB_URL ?? 'redis://127.0.0.1:6380';
    this.name = cfg.graphName ?? GRAPH_NAME;
  }

  async connect(): Promise<void> {
    this.db = await FalkorDB.connect({ url: this.url });
    this.graph = this.db.selectGraph(this.name);
  }

  async close(): Promise<void> {
    await this.db?.close();
    this.db = null;
  }

  /**
   * Run one Cypher statement. Params are bound, never interpolated.
   *
   * Rows come back as OBJECTS keyed by the RETURN alias — not tuples. Always
   * alias what you return and read it by name; destructuring a row as an array
   * silently yields undefined rather than throwing, which is a long afternoon.
   */
  async query<T = any>(cypher: string, params?: Record<string, unknown>): Promise<T[]> {
    if (!this.graph) throw new Error('call connect() first');
    const res = await this.graph.query(cypher, params ? { params } : undefined);
    return (res?.data ?? []) as T[];
  }

  /** First column of the first row, as a number. Zero when there is no row. */
  async count(cypher: string, alias = 'n', params?: Record<string, unknown>): Promise<number> {
    const rows = await this.query<Record<string, unknown>>(cypher, params);
    return Number(rows[0]?.[alias] ?? 0);
  }

  async dropIfExists(): Promise<void> {
    try {
      await this.graph?.delete();
    } catch {
      // FalkorDB throws when the key is absent; a missing graph is a fine
      // starting state, so this is not an error worth surfacing.
    }
    this.graph = this.db?.selectGraph(this.name);
  }

  /**
   * Load the corpus.
   *
   * Identifiers become their own nodes. That is the whole trick: a phone
   * number is not a column on Customer, it is a thing two customers can both
   * point at, which turns "same phone" into a traversable edge rather than a
   * join predicate.
   */
  async load(
    customers: GraphCustomer[],
    orders: GraphOrder[],
    opts: { batch?: number; onProgress?: (done: number, total: number) => void } = {},
  ): Promise<{ customers: number; orders: number; identifiers: number; ms: number }> {
    const batch = opts.batch ?? 2000;
    const t0 = Date.now();

    for (const stmt of INDEX_STATEMENTS) {
      try { await this.query(stmt); } catch { /* index already there */ }
    }

    let done = 0;
    const total = customers.length + orders.length;

    for (let i = 0; i < customers.length; i += batch) {
      const rows = customers.slice(i, i + batch).map((c) => ({
        customerId: c.customerId,
        phone: c.phone,
        address: c.addressHash,
        device: c.deviceId,
        pincode: c.pincode,
        tier: c.tier,
        ringId: c.ringId ?? '',
        householdId: c.householdId ?? '',
      }));
      await this.query(
        `UNWIND $rows AS r
         MERGE (c:${NODE.CUSTOMER} {customerId: r.customerId})
           SET c.pincode = r.pincode, c.tier = r.tier,
               c.ringId = r.ringId, c.householdId = r.householdId
         MERGE (p:${NODE.PHONE}   {value: r.phone})
         MERGE (a:${NODE.ADDRESS} {value: r.address})
         MERGE (d:${NODE.DEVICE}  {value: r.device})
         MERGE (c)-[:${REL.USES}]->(p)
         MERGE (c)-[:${REL.USES}]->(a)
         MERGE (c)-[:${REL.USES}]->(d)`,
        { rows },
      );
      done += rows.length;
      opts.onProgress?.(done, total);
    }

    for (let i = 0; i < orders.length; i += batch) {
      const rows = orders.slice(i, i + batch).map((o) => ({
        orderId: o.id,
        customerId: o.customerId,
        styleId: o.styleId,
        size: o.size,
        cod: o.paymentMode === 'COD',
        rto: o.outcome === 'RTO',
        ndrCode: o.ndrCode ?? '',
        amountPaise: o.amountPaise,
      }));
      await this.query(
        `UNWIND $rows AS r
         MATCH (c:${NODE.CUSTOMER} {customerId: r.customerId})
         MERGE (s:${NODE.STYLE} {styleId: r.styleId})
         CREATE (o:${NODE.ORDER} {
           orderId: r.orderId, size: r.size, cod: r.cod, rto: r.rto,
           ndrCode: r.ndrCode, amountPaise: r.amountPaise })
         CREATE (c)-[:${REL.PLACED}]->(o)
         CREATE (o)-[:${REL.OF_STYLE}]->(s)`,
        { rows },
      );
      done += rows.length;
      opts.onProgress?.(done, total);
    }

    const identifiers = await this.count(
      `MATCH (n) WHERE n:${NODE.PHONE} OR n:${NODE.ADDRESS} OR n:${NODE.DEVICE}
       RETURN count(n) AS n`,
    );

    return {
      customers: customers.length,
      orders: orders.length,
      identifiers,
      ms: Date.now() - t0,
    };
  }
}
