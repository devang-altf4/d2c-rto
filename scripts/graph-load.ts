/**
 * Load the corpus into FalkorDB and score the detector against ground truth.
 *
 *   docker run -d --name rto-falkordb -p 6380:6379 falkordb/falkordb:latest
 *   pnpm graph:load
 *
 * The precision and recall printed at the end are computed the same way the
 * fit recall is: the generator planted the rings, the detector never sees
 * which accounts they are, and the gap between the two is the number you are
 * allowed to put on a slide.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RtoGraph } from '../packages/graph/src/client';
import { computeClusters, summariseClusters, flaggedClusters } from '../packages/graph/src/cluster';
import { buildFitsLike } from '../packages/graph/src/fitslike';
import type { GraphCustomer, GraphOrder } from '../packages/graph/src/schema';

const DATA = join(process.cwd(), 'data');
const read = <T,>(f: string): T => JSON.parse(readFileSync(join(DATA, f), 'utf8'));

const customers = read<GraphCustomer[]>('customers.json');
const orders = read<GraphOrder[]>('orders.json');
const exchanges = read<Array<{ orderId: string; styleId: string; size: string; reason: string }>>('exchanges.json');

async function main() {
  const g = new RtoGraph();
  await g.connect();

  console.log(`\n  loading ${customers.length.toLocaleString('en-IN')} customers and ${orders.length.toLocaleString('en-IN')} orders …`);
  await g.dropIfExists();

  let lastPct = -1;
  const stats = await g.load(customers, orders, {
    onProgress: (done, total) => {
      const pct = Math.floor((done / total) * 10) * 10;
      if (pct !== lastPct) { lastPct = pct; process.stdout.write(`\r  ${pct}%   `); }
    },
  });
  process.stdout.write('\r        \r');

  console.log(`  loaded in ${(stats.ms / 1000).toFixed(1)}s — ${stats.identifiers.toLocaleString('en-IN')} identifier nodes\n`);

  // ------------------------------------------------------------- components

  const t1 = Date.now();
  const components = await computeClusters(g);
  const multi = await summariseClusters(g);
  console.log(`  algo.WCC          ${components.toLocaleString('en-IN')} components, ${multi} with more than one customer  (${Date.now() - t1}ms)`);

  // ------------------------------------------------ measure against truth

  const truthRing = new Map(customers.map((c) => [c.customerId, c.ringId ?? null]));
  const ringIds = new Set(customers.map((c) => c.ringId).filter(Boolean) as string[]);

  console.log('\n  detector operating points (ground truth never queried)\n');
  console.log('    minScore   flagged   accounts   precision   recall');
  for (const minScore of [0.3, 0.4, 0.5, 0.6, 0.7]) {
    const flagged = await flaggedClusters(g, minScore);
    const accounts = flagged.flatMap((f) => f.customerIds);
    const hits = accounts.filter((id) => truthRing.get(id));
    const found = new Set(hits.map((id) => truthRing.get(id)!));
    const precision = accounts.length ? hits.length / accounts.length : 0;
    const recall = found.size / ringIds.size;
    console.log(
      `    ${minScore.toFixed(2)}       ${String(flagged.length).padStart(4)}      ${String(accounts.length).padStart(5)}` +
      `      ${(precision * 100).toFixed(0).padStart(4)}%     ${(recall * 100).toFixed(0).padStart(4)}%`,
    );
  }

  // What a household-blind rule would have done, for contrast.
  const structureOnly = await g.query<Record<string, unknown>>(
    `MATCH (c:Customer) WHERE c.clusterSize >= 3
     RETURN count(c) AS n, sum(CASE WHEN c.ringId <> '' THEN 1 ELSE 0 END) AS ring`,
  );
  {
    const { n, ring } = (structureOnly[0] ?? { n: 0, ring: 0 }) as any;
    console.log(`\n    structure alone (clusterSize >= 3, no behaviour):` +
      `  ${Number(n)} accounts, ${(Number(ring) / Math.max(1, Number(n)) * 100).toFixed(0)}% precision`);
  }

  // ------------------------------------------------------------- fits-like

  console.log('\n  building the FITS_LIKE style graph …');
  const edges = await buildFitsLike(g, exchanges);
  console.log(`  ${edges} edges from customers who bought two styles and corrected size on one\n`);

  await g.close();
}

main().catch((e) => {
  console.error('\n  graph load failed:', e.message);
  console.error('  is FalkorDB up?  pnpm graph:up\n');
  process.exit(1);
});
