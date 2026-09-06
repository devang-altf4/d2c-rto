/**
 * Does the graph layer actually earn its place?
 *
 *   pnpm graph:eval        (needs pnpm graph:up && pnpm graph:load first)
 *
 * Scores every order in the corpus twice — once with the five features the
 * model has today, once with the identity term added — and compares them
 * against the outcome the generator actually rolled. Ground truth is used
 * ONLY to score the answers, never as an input.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RtoGraph } from '../packages/graph/src/client';
import { clusterScore } from '../packages/graph/src/cluster';
import { scoreFitRisk, scoreRtoRisk, AT_RISK_THRESHOLD } from '../packages/core/src/risk';

const DATA = join(process.cwd(), 'data');
const read = <T,>(f: string): T => JSON.parse(readFileSync(join(DATA, f), 'utf8'));

interface Order {
  id: string; customerId: string; styleId: string; paymentMode: 'COD' | 'PREPAID';
  tier: 1 | 2 | 3; isFirstOrder: boolean; outcome: 'DELIVERED' | 'RTO';
  trueCause?: string; amountPaise: number;
}

async function main() {
  const orders = read<Order[]>('orders.json');
  const diagnosis = read<any>('diagnosis.json');
  const failureRate = new Map<string, number>(
    diagnosis.styles.map((s: any) => [s.styleId, s.sizeExchangeRate]));

  const g = new RtoGraph();
  await g.connect();

  // One query for every customer's cluster stats, rather than 26k round trips.
  const rows = await g.query<Record<string, unknown>>(
    `MATCH (c:Customer)
     RETURN c.customerId AS id, c.clusterSize AS size,
            c.clusterOrders AS orders, c.clusterRto AS rto`);
  if (!rows.length) {
    console.error('\n  the graph is empty — run `pnpm graph:load` first\n');
    process.exit(1);
  }

  const clusterByCustomer = new Map<string, number>();
  for (const r of rows as any[]) {
    const orders_ = Number(r.orders ?? 0);
    clusterByCustomer.set(String(r.id), clusterScore({
      clusterSize: Number(r.size ?? 1),
      clusterOrders: orders_,
      clusterRtoRate: orders_ ? Number(r.rto ?? 0) / orders_ : 0,
    }));
  }

  const scored = orders.map((o) => {
    const base = {
      styleSizeFailureRate: Math.min(1, (failureRate.get(o.styleId) ?? 0) * 4),
      usedL1: false,
      paymentMode: o.paymentMode,
      isFirstOrder: o.isFirstOrder,
      tier: o.tier,
    };
    const identityClusterScore = clusterByCustomer.get(o.customerId) ?? 0;
    return {
      o,
      fit: scoreFitRisk(base).score,
      both: scoreRtoRisk({ ...base, identityClusterScore }).score,
      rec: scoreRtoRisk({ ...base, identityClusterScore }),
    };
  });

  const rto = scored.filter((s) => s.o.outcome === 'RTO');
  const ok = scored.filter((s) => s.o.outcome === 'DELIVERED');

  /** P(a random RTO scores above a random delivered order). 0.5 = useless. */
  const auc = (key: 'fit' | 'both') => {
    const neg = ok.map((s) => s[key]).sort((a, b) => a - b);
    const below = (v: number) => {
      let lo = 0, hi = neg.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (neg[m] < v) lo = m + 1; else hi = m; }
      return lo;
    };
    const ties = (v: number) => neg.filter((x) => x === v).length;
    return rto.reduce((s, r) =>
      s + (below(r[key]) + ties(r[key]) / 2) / neg.length, 0) / rto.length;
  };

  const at = (key: 'fit' | 'both') => {
    const flagged = scored.filter((s) => s[key] >= AT_RISK_THRESHOLD);
    const caught = flagged.filter((s) => s.o.outcome === 'RTO');
    return {
      flagged: flagged.length,
      precision: flagged.length ? caught.length / flagged.length : 0,
      recall: caught.length / rto.length,
      rupees: Math.round(caught.reduce((t, s) => t + s.o.amountPaise, 0) / 100),
    };
  };

  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const f = at('fit'), b = at('both');

  console.log(`\n  ${orders.length.toLocaleString('en-IN')} orders, ${rto.length.toLocaleString('en-IN')} of them RTO\n`);
  console.log('                          fit only    + identity graph');
  console.log(`    AUC                     ${auc('fit').toFixed(3)}        ${auc('both').toFixed(3)}`);
  console.log(`    flagged at ${AT_RISK_THRESHOLD}         ${String(f.flagged).padStart(6)}       ${String(b.flagged).padStart(6)}`);
  console.log(`    precision              ${pct(f.precision).padStart(6)}       ${pct(b.precision).padStart(6)}`);
  console.log(`    recall                 ${pct(f.recall).padStart(6)}       ${pct(b.recall).padStart(6)}`);

  // The part that matters operationally: the two causes need different actions.
  const actions = new Map<string, number>();
  for (const s of scored) actions.set(s.rec.action, (actions.get(s.rec.action) ?? 0) + 1);
  console.log('\n  what the combined model would DO');
  for (const [action, n] of [...actions].sort((a, b) => b[1] - a[1])) {
    const of = scored.filter((s) => s.rec.action === action);
    const hit = of.filter((s) => s.o.outcome === 'RTO').length;
    console.log(`    ${action.padEnd(16)} ${String(n).padStart(6)} orders   ${pct(hit / Math.max(1, n))} of them RTO`);
  }

  // Did it separate the causes, or just relabel them?
  const flaggedIdentity = scored.filter((s) => s.rec.dominant === 'IDENTITY' && s.o.outcome === 'RTO');
  const intent = flaggedIdentity.filter((s) => s.o.trueCause === 'INTENT').length;
  console.log(`\n  of the RTOs it blames on identity, ${pct(intent / Math.max(1, flaggedIdentity.length))} really were INTENT`);
  console.log('  (generator ground truth; the model never sees trueCause)\n');

  await g.close();
}

main().catch((e) => {
  console.error('\n  eval failed:', e.message, '\n');
  process.exit(1);
});
