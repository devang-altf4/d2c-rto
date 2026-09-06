/**
 * Is estimateRto() actually calibrated?
 *
 *   pnpm rto:calibrate     (needs pnpm graph:load first)
 *
 * A probability that is not calibrated is a score wearing a percent sign. This
 * bins the corpus by predicted probability and compares each bin against the
 * outcome that actually happened. If the model says 40% for a bucket of
 * orders, roughly 40% of them should have come back.
 *
 * Only the layers that EXIST over the historical corpus are exercised: the
 * order attributes, L1-as-skipped, and L4. L2 and L3 never ran, so their terms
 * cannot be validated here and are excluded rather than faked.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RtoGraph } from '../packages/graph/src/client';
import { clusterScore } from '../packages/graph/src/cluster';
import { estimateRto } from '../packages/core/src/rto';

interface Order {
  id: string; customerId: string; paymentMode: 'COD' | 'PREPAID';
  tier: 1 | 2 | 3; isFirstOrder: boolean; outcome: 'DELIVERED' | 'RTO';
}

async function main() {
  const orders: Order[] = JSON.parse(readFileSync(join(process.cwd(), 'data/orders.json'), 'utf8'));
  const g = new RtoGraph();
  await g.connect();
  const rows = await g.query<Record<string, unknown>>(
    `MATCH (c:Customer) RETURN c.customerId AS id, c.clusterSize AS size,
            c.clusterOrders AS orders, c.clusterRto AS rto`);
  if (!rows.length) { console.error('\n  graph is empty — run pnpm graph:load\n'); process.exit(1); }

  const cluster = new Map<string, number>();
  for (const r of rows as any[]) {
    const n = Number(r.orders ?? 0);
    cluster.set(String(r.id), clusterScore({
      clusterSize: Number(r.size ?? 1), clusterOrders: n,
      clusterRtoRate: n ? Number(r.rto ?? 0) / n : 0,
    }));
  }

  const scored = orders.map((o) => ({
    o,
    p: estimateRto({
      paymentMode: o.paymentMode, tier: o.tier, isFirstOrder: o.isFirstOrder,
      l1: 'SKIPPED',                       // L1 did not exist over this corpus
      clusterScore: cluster.get(o.customerId) ?? 0,
    }).probability,
  }));

  const edges = [0, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.65, 1.01];
  console.log(`\n  calibration over ${orders.length.toLocaleString('en-IN')} orders\n`);
  console.log('    predicted band     n        predicted   actual    gap');
  let worst = 0;
  for (let i = 0; i < edges.length - 1; i++) {
    const bin = scored.filter((s) => s.p >= edges[i] && s.p < edges[i + 1]);
    if (!bin.length) continue;
    const pred = bin.reduce((t, s) => t + s.p, 0) / bin.length;
    const act = bin.filter((s) => s.o.outcome === 'RTO').length / bin.length;
    worst = Math.max(worst, Math.abs(pred - act));
    console.log(
      `    ${(edges[i] * 100).toFixed(0).padStart(3)}-${(Math.min(1, edges[i + 1]) * 100).toFixed(0).padEnd(3)}%       ${String(bin.length).padStart(6)}      ` +
      `${(pred * 100).toFixed(1).padStart(5)}%   ${(act * 100).toFixed(1).padStart(5)}%   ${((act - pred) * 100 >= 0 ? '+' : '')}${((act - pred) * 100).toFixed(1)}pp`);
  }

  const neg = scored.filter((s) => s.o.outcome === 'DELIVERED').map((s) => s.p).sort((a, b) => a - b);
  const pos = scored.filter((s) => s.o.outcome === 'RTO').map((s) => s.p);
  const below = (v: number) => { let lo = 0, hi = neg.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (neg[m] < v) lo = m + 1; else hi = m; } return lo; };
  const auc = pos.reduce((s, v) => s + below(v) / neg.length, 0) / pos.length;
  const brier = scored.reduce((s, x) => s + (x.p - (x.o.outcome === 'RTO' ? 1 : 0)) ** 2, 0) / scored.length;

  console.log(`\n    worst bin gap   ${(worst * 100).toFixed(1)}pp`);
  console.log(`    AUC             ${auc.toFixed(3)}`);
  console.log(`    Brier           ${brier.toFixed(4)}  (lower is better; always-predict-base = ${(0.213 * 0.787).toFixed(4)})\n`);
  await g.close();
}
main().catch((e) => { console.error('\n  failed:', e.message, '\n'); process.exit(1); });
