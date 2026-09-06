/**
 * The per-order number, and where it came from.
 *
 *   pnpm rto:explain              a spread of real orders
 *   pnpm rto:explain KA-10042     one order
 *
 * Attaches L1/L2/L3 records to a handful of orders so all four layers have
 * something to say, then walks the ontology once per order and itemises the
 * estimate. Log-odds are additive, so the per-layer numbers genuinely sum to
 * the answer — nothing here is a stacked bar drawn after the fact.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RtoGraph } from '../packages/graph/src/client';
import { loadFitSessions, loadMessages, loadCalls, orderView, l1PathOf } from '../packages/graph/src/ontology';
import { estimateRto, recommendedAction, type L2Outcome, type L3Outcome } from '../packages/core/src/rto';

interface Order { id: string; customerId: string; outcome: string; paymentMode: string; size: string }

async function main() {
  const orders: Order[] = JSON.parse(readFileSync(join(process.cwd(), 'data/orders.json'), 'utf8'));
  const byId = new Map(orders.map((o) => [o.id, o]));
  const g = new RtoGraph();
  await g.connect();

  const wanted = process.argv[2];

  // Pick a spread: a clean order, a ring order, and a couple in between, so the
  // layers are visibly doing different things rather than all agreeing.
  const ranked = await g.query<Record<string, unknown>>(
    `MATCH (c:Customer)-[:PLACED]->(o:Order)
     WHERE c.clusterSize > 1 AND c.clusterOrders >= 4
     RETURN o.orderId AS id, c.clusterSize AS sz, c.clusterOrders AS n, c.clusterRto AS rto
     LIMIT 4000`);
  const worst = (ranked as any[])
    .map((r) => ({ id: String(r.id), rate: Number(r.n) ? Number(r.rto) / Number(r.n) : 0, sz: Number(r.sz) }))
    .sort((a, b) => b.rate * b.sz - a.rate * a.sz);

  const picks = wanted ? [wanted] : [
    orders.find((o) => o.paymentMode === 'PREPAID')!.id,
    orders.find((o) => o.paymentMode === 'COD')!.id,
    worst[Math.floor(worst.length / 2)]?.id,
    worst[0]?.id,
  ].filter(Boolean) as string[];

  // Give these orders L1/L2/L3 evidence so every layer has something to report.
  // Synthetic: L1, L2 and L3 have not run over the historical corpus.
  const l1 = picks.map((id, i) => ({
    orderId: id,
    source: ['SKIPPED', 'CAMERA', 'CAMERA', 'SKIPPED'][i % 4],
    recommendedSize: ['', byId.get(id)?.size ?? 'M', 'XL', ''][i % 4],
  })).filter((r) => r.source !== 'SKIPPED');
  const l2 = picks.map((id, i) => ({
    orderId: id, status: ['CONFIRMED', 'READ', 'TIMEOUT', 'TIMEOUT'][i % 4],
  }));
  const l3 = picks.map((id, i) => ({ orderId: id, outcome: ['', '', 'NO_ANSWER', 'UNREACHABLE'][i % 4] }))
    .filter((r) => r.outcome);

  if (l1.length) await loadFitSessions(g, l1 as any);
  if (l2.length) await loadMessages(g, l2 as any);
  if (l3.length) await loadCalls(g, l3 as any);

  for (const id of picks) {
    const v = await orderView(g, id);
    if (!v) { console.log(`\n  ${id} — not in the graph\n`); continue; }
    const truth = byId.get(id);

    const est = estimateRto({
      paymentMode: v.cod ? 'COD' : 'PREPAID',
      tier: (v.tier as 1 | 2 | 3) ?? 2,
      isFirstOrder: false,
      l1: l1PathOf(v),
      l2: (v.messageStatus as L2Outcome) ?? undefined,
      l3: (v.callOutcome as L3Outcome) ?? undefined,
      clusterScore: v.clusterScore,
    });
    const act = recommendedAction(est);

    console.log(`\n${'='.repeat(72)}`);
    console.log(`  ${v.orderId}   customer ${v.customerId}   ${v.cod ? 'COD' : 'PREPAID'}   tier ${v.tier}`);
    console.log(`${'='.repeat(72)}`);
    console.log(`  L1  fit        ${v.fitSource ?? 'skipped'}${v.recommendedSize ? `, recommended ${v.recommendedSize}, bought ${v.boughtSize}${v.overrode ? '  << OVERRIDE' : ''}` : ''}`);
    console.log(`  L2  whatsapp   ${v.messageStatus ?? 'not sent'}`);
    console.log(`  L3  call       ${v.callOutcome ?? 'not placed'}`);
    console.log(`  L4  identity   cluster of ${v.clusterSize} account(s), ${v.clusterOrders} orders, ` +
      `${(v.clusterRtoRate * 100).toFixed(0)}% RTO -> score ${v.clusterScore.toFixed(2)}`);
    console.log(`      ${v.directNeighbours} account(s) share a phone, address or device with this one`);

    console.log(`\n  how the estimate is built (log-odds add; * = not measured)`);
    for (const c of est.contributions) {
      const sign = c.logit >= 0 ? '+' : '';
      console.log(`    ${c.layer.padEnd(5)} ${c.label.padEnd(46)} ${sign}${c.logit.toFixed(3).padStart(6)}   ${(c.deltaPct >= 0 ? '+' : '')}${c.deltaPct.toFixed(1)}pp ${c.measured ? '' : '*'}`);
    }

    console.log(`\n  >>> RTO ESTIMATE  ${est.percent.toFixed(1)}%   driven by ${est.dominant}`);
    console.log(`      action        ${act.action} — ${act.reason}`);
    if (est.assumedShare > 0)
      console.log(`      caution       ${(est.assumedShare * 100).toFixed(0)}% of the movement comes from unmeasured priors`);
    if (truth) console.log(`      (what actually happened: ${truth.outcome})`);
  }
  console.log();
  await g.close();
}
main().catch((e) => { console.error('\n  failed:', e.message, '\n'); process.exit(1); });
