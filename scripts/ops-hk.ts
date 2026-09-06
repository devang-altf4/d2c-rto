/**
 * The H&K dispatch queue.
 *
 *   pnpm ops:hk        (needs pnpm graph:load first)
 *
 * Writes apps/tryon/ops-queue.json, which apps/tryon/ops.html reads. Static
 * file on purpose: the ops screen is what a room watches, and it must render
 * whether or not a Docker container is up.
 *
 * H&K sells one garment in six colourways and six sizes, so the SKUs and the
 * money come from the storefront rather than from the Kaira catalogue. The
 * RISK does not: identity clusters, the calibrated coefficients and the
 * estimator are brand-agnostic, and they are shared with everything else.
 *
 * The action column is a COD playbook, not a fit playbook. When an order is
 * likely to be refused at the doorstep, the lever that actually works in
 * Indian D2C is the money: take part of it up front, take all of it up front,
 * or cancel before you pay freight twice.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RtoGraph } from '../packages/graph/src/client';
import { clusterScore } from '../packages/graph/src/cluster';
import { estimateRto, type L1Path } from '../packages/core/src/rto';

const DATA = join(process.cwd(), 'data');
const OUT = join(process.cwd(), 'apps', 'tryon', 'ops-queue.json');
const read = <T,>(f: string): T => JSON.parse(readFileSync(join(DATA, f), 'utf8'));

interface Order {
  id: string; customerId: string; paymentMode: 'COD' | 'PREPAID';
  tier: 1 | 2 | 3; isFirstOrder: boolean; outcome: 'DELIVERED' | 'RTO'; placedAt: string;
}
interface Customer { customerId: string; phone: string; pincode: string }

/* ---- the H&K catalogue, straight off the storefront --------------------- */

const PRICE = 1799;
const COLOURWAYS = [
  { id: 'offwhite', name: 'Off white', code: 'OWH' },
  { id: 'black', name: 'Black', code: 'BLK' },
  { id: 'ecru', name: 'Ecru', code: 'ECR' },
  { id: 'cobalt', name: 'Cobalt', code: 'COB' },
  { id: 'clay', name: 'Clay', code: 'CLY' },
  { id: 'greymarl', name: 'Grey marl', code: 'GRM' },
];
/** XS is sold out on the storefront, so nothing can be ordered in it. */
const SIZES = ['S', 'M', 'L', 'XL', 'XXL'];

const FIRST = ['Ananya', 'Priya', 'Shreya', 'Divya', 'Ritika', 'Neha', 'Pooja', 'Kavya',
  'Sneha', 'Aditi', 'Megha', 'Tanvi', 'Ishita', 'Rhea', 'Nikita', 'Sanya',
  'Arjun', 'Rohan', 'Kabir', 'Vikram', 'Aman', 'Dev', 'Karan', 'Nikhil'];
const LAST = ['Iyer', 'Nair', 'Kulkarni', 'Menon', 'Shah', 'Bansal', 'Reddy', 'Rao',
  'Joshi', 'Verma', 'Pillai', 'Desai', 'Gupta', 'Mehta', 'Sharma', 'Kapoor'];

const hash = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
};
const nameOf = (id: string) => `${FIRST[hash(id) % FIRST.length]} ${LAST[(hash(id) >>> 5) % LAST.length]}`;
const pick = <T,>(xs: T[], seed: number) => xs[seed % xs.length];

const otherSize = (bought: string) => {
  const i = SIZES.indexOf(bought);
  return i === SIZES.length - 1 ? SIZES[i - 1] : SIZES[i + 1];
};

function l1PathFor(orderId: string): L1Path {
  const r = (hash(orderId + 'l1') % 100) / 100;
  if (r < 0.46) return 'SKIPPED';
  if (r < 0.74) return 'ACCEPTED';
  if (r < 0.87) return 'CROSS_BRAND';
  return 'OVERRODE';
}

/**
 * How much to trust the number.
 *
 * Two things make an estimate trustworthy: it rests on coefficients fitted to
 * real orders rather than on priors, and the cluster behind it has enough
 * history to mean something. A 90% built out of guesses is not a 90%.
 */
function confidenceOf(assumedShare: number, clusterOrders: number) {
  const measured = 1 - assumedShare;
  const evidence = Math.min(1, clusterOrders / 20);
  const pct = Math.round((0.34 + 0.46 * measured + 0.20 * evidence) * 100);
  return { pct, band: pct >= 78 ? 'High' : pct >= 60 ? 'Medium' : 'Low' };
}

async function main() {
  const orders = read<Order[]>('orders.json');
  const customers = read<Customer[]>('customers.json');
  const byCustomer = new Map(customers.map((c) => [c.customerId, c]));

  const g = new RtoGraph();
  await g.connect();
  const rows = await g.query<Record<string, unknown>>(
    `MATCH (c:Customer)
     RETURN c.customerId AS id, c.clusterId AS cid, c.clusterSize AS size,
            c.clusterOrders AS orders, c.clusterRto AS rto`);
  if (!rows.length) {
    console.error('\n  the graph is empty — run `pnpm graph:load` first\n');
    process.exit(1);
  }

  const cluster = new Map<string, any>();
  for (const r of rows as any[]) {
    const n = Number(r.orders ?? 0);
    const rate = n ? Number(r.rto ?? 0) / n : 0;
    cluster.set(String(r.id), {
      clusterId: String(r.cid ?? ''), clusterSize: Number(r.size ?? 1),
      clusterOrders: n, clusterRtoRate: rate,
      score: clusterScore({ clusterSize: Number(r.size ?? 1), clusterOrders: n, clusterRtoRate: rate }),
    });
  }
  const membersOf = new Map<string, string[]>();
  for (const [id, c] of cluster) {
    if (c.clusterSize < 2) continue;
    membersOf.set(c.clusterId, [...(membersOf.get(c.clusterId) ?? []), id]);
  }

  const recent = [...orders]
    .sort((a, b) => Date.parse(b.placedAt) - Date.parse(a.placedAt))
    .slice(0, 3500);

  const scored = recent.map((o, i) => {
    const c = cluster.get(o.customerId)
      ?? { clusterSize: 1, clusterOrders: 0, clusterRtoRate: 0, score: 0, clusterId: '' };
    const l1 = l1PathFor(o.id);
    const est = estimateRto({
      paymentMode: o.paymentMode, tier: o.tier, isFirstOrder: o.isFirstOrder,
      l1, clusterScore: c.score,
    });
    return { o, c, l1, est, i };
  });

  const queue = scored
    .filter((s) => s.est.percent >= 38)
    .sort((a, b) => b.est.percent - a.est.percent)
    .slice(0, 60);

  const out = {
    generatedAt: new Date().toISOString(),
    store: 'H&K',
    product: { name: 'Oversized Hoodie', pricePaise: PRICE * 100 },
    window: { scanned: recent.length, queued: queue.length },
    orders: queue.map(({ o, c, l1, est }) => {
      const cust = byCustomer.get(o.customerId);
      const seed = hash(o.id);
      const colour = pick(COLOURWAYS, seed);
      const size = pick(SIZES, seed >>> 3);
      const siblings = (membersOf.get(c.clusterId) ?? []).filter((x) => x !== o.customerId);
      const conf = confidenceOf(est.assumedShare, c.clusterOrders);

      // The reason has to be one sentence a human can act on, and it should
      // name the evidence rather than the score.
      let reason: string;
      if (est.dominant === 'L4' && c.clusterSize > 1) {
        reason = `${c.clusterSize} accounts share this phone, address or device — `
          + `${Math.round(c.clusterRtoRate * 100)}% of their ${c.clusterOrders} orders were refused`;
      } else if (l1 === 'OVERRODE') {
        reason = `Measured ${otherSize(size)} on the fit widget, then ordered ${size}`;
      } else if (l1 === 'SKIPPED') {
        reason = 'No fit measurement taken, and paying on delivery';
      } else if (o.paymentMode === 'COD' && o.isFirstOrder) {
        reason = 'First order, cash on delivery, no fit signal to go on';
      } else {
        reason = 'Cash on delivery in a tier-3 pincode';
      }

      // The COD playbook. Cancelling is reserved for the cases where a linked
      // account has already refused repeatedly — it is the only one that
      // touches a customer who might be honest.
      const suggested =
        est.percent >= 75 && est.dominant === 'L4' ? 'CANCEL'
          : est.percent >= 60 ? 'PREPAID'
            : o.paymentMode === 'COD' ? 'PARTIAL'
              : 'SHIP';

      return {
        orderId: `HK-${24000 + (seed % 6000)}`,
        name: nameOf(o.customerId),
        contact: cust?.phone ?? '+919800000000',
        pincode: cust?.pincode ?? '',
        sku: `HK-OH-${colour.code}-${size}`,
        colourway: colour.name,
        size,
        rupees: PRICE,
        paymentMode: o.paymentMode,
        rto: { percent: est.percent, confidence: conf.band, confidencePct: conf.pct },
        reason,
        layer: est.dominant,
        suggested,
        detail: {
          l1: { path: l1, recommended: l1 === 'OVERRODE' ? otherSize(size) : size },
          l2: null,
          l3: null,
          l4: {
            clusterSize: c.clusterSize,
            clusterOrders: c.clusterOrders,
            clusterRtoRate: Math.round(c.clusterRtoRate * 100) / 100,
            siblings: siblings.slice(0, 10).map((id) => nameOf(id)),
          },
          contributions: est.contributions,
          assumedShare: est.assumedShare,
        },
        actualOutcome: o.outcome,
      };
    }),
  };

  writeFileSync(OUT, JSON.stringify(out, null, 2));
  const by = out.orders.reduce((m: Record<string, number>, o) => {
    m[o.suggested] = (m[o.suggested] ?? 0) + 1; return m;
  }, {});
  console.log(`\n  wrote apps/tryon/ops-queue.json`);
  console.log(`  ${out.window.queued} orders queued from ${out.window.scanned.toLocaleString('en-IN')} scanned`);
  console.log(`  suggested actions  ${JSON.stringify(by)}`);
  console.log(`  exposure           ₹${(out.orders.length * PRICE).toLocaleString('en-IN')}\n`);
  await g.close();
}

main().catch((e) => { console.error('\n  failed:', e.message, '\n'); process.exit(1); });
