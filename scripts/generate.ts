/**
 * Synthetic corpus for Kaira — womenswear, kurtas and dresses.
 *
 * The failure modes are injected deliberately, so ground truth is known and
 * recall is computable. Run it, read the recall number off stdout, put THAT
 * number on the slide.
 *
 *   pnpm data:generate
 *
 * THE RULE THAT MAKES ACT 1 HONEST: when trueCause === 'SIZE', the courier
 * reason code emitted must never name size. It comes out as REFUSED_COD or
 * BOUGHT_ELSEWHERE, exactly as it does in a real NDR feed. The diagnosis
 * screen then recovers what the courier could not see, from exchange records
 * on DELIVERED orders — which is also why exchanges only exist on delivered
 * orders here. That distribution shift is real and we say so on stage.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { learnedOffsetFromExchanges } from '../packages/core/src/sizing';
import { scoreFitRisk } from '../packages/core/src/risk';
import { SIZES, type Size } from '../packages/core/src/types';

// ------------------------------------------------------------------ config

const SEED = 20260905;
const N_ORDERS = 45_000;
const N_STYLES = 180;
const N_RUNS_SMALL = 14; // the injected cohort
const MONTHS = 12;

const COD_SHARE = 0.62;
const TIER23_SHARE = 0.60;

// Repeat-buying. `isFirstOrder` is no longer a coin flip — it is DERIVED from
// each customer's own order history, so the share falls out of the buying
// distribution instead of being asserted alongside it.
const REPEAT_P = 0.42; // P(this customer buys again), geometric; mean ~1.7 orders
const MAX_ORDERS_PER_CUSTOMER = 14;

// Planted refusal rings — the ground truth for the graph layer.
const N_RINGS = 40;
const RING_MIN = 3, RING_MAX = 9;
// Legit families sharing one roof. These are the CONFOUNDER: a rule that says
// "shared address = fraud" has to be wrong about all of them.
const HOUSEHOLD_SHARE = 0.07;

const FREIGHT_TWO_WAY_PAISE = 19_000; // ₹190
const OUT = join(process.cwd(), 'data');

/** Garment chest in cm by size, before per-style jitter. */
const CHEST_LADDER: Record<Size, number> = { XS: 86, S: 91, M: 96, L: 102, XL: 108 };

// --------------------------------------------------------------------- rng

function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(SEED);
const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
const chance = (p: number) => rnd() < p;
const gauss = (mu: number, sd: number) => {
  const u = Math.max(1e-9, rnd()), v = rnd();
  return mu + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
const round1 = (n: number) => Math.round(n * 10) / 10;

// ------------------------------------------------------------------ styles

const FIRST = ['Anaya', 'Meher', 'Rehana', 'Suhani', 'Aarohi', 'Ishita', 'Nayra', 'Zoya',
  'Kiara', 'Tara', 'Amara', 'Rukmini', 'Saanvi', 'Mira', 'Devika', 'Alia', 'Noor', 'Ira'];
const FABRIC = ['Cotton', 'Chanderi', 'Linen', 'Rayon', 'Muslin', 'Silk-Blend', 'Khadi', 'Georgette'];
const SHAPE = ['Kurta', 'A-Line Kurta', 'Straight Kurta', 'Anarkali', 'Kurta Set', 'Midi Dress', 'Angrakha'];
const FITS = [
  { name: 'fitted', ease: 4 },
  { name: 'regular', ease: 7 },
  { name: 'relaxed', ease: 10 },
];

interface Style {
  styleId: string;
  styleName: string;
  easeCm: number;
  chestBase: Record<Size, number>;
  /** GROUND TRUTH. cm the garment runs small by. 0 for most styles. */
  runsSmallBy: number;
  mrpPaise: number;
  cogsPaise: number;
}

const styles: Style[] = [];
const runsSmallIdx = new Set<number>();
while (runsSmallIdx.size < N_RUNS_SMALL) runsSmallIdx.add(Math.floor(rnd() * N_STYLES));

for (let i = 0; i < N_STYLES; i++) {
  const fit = pick(FITS);
  const jitter = gauss(0, 1.2);
  const chestBase = {} as Record<Size, number>;
  for (const s of SIZES) chestBase[s] = round1(CHEST_LADDER[s] + jitter);

  const mrp = Math.round(gauss(1450, 420));
  const mrpPaise = Math.max(69_900, Math.round(mrp / 50) * 50 * 100);

  styles.push({
    styleId: `KAI-${String(i + 1).padStart(3, '0')}`,
    styleName: `${pick(FIRST)} ${pick(FABRIC)} ${pick(SHAPE)}`,
    easeCm: fit.ease,
    chestBase,
    runsSmallBy: runsSmallIdx.has(i) ? round1(1.6 + rnd() * 2.0) : 0,
    mrpPaise,
    cogsPaise: Math.round(mrpPaise * 0.36),
  });
}

// ------------------------------------------------------------------ orders

type Cause = 'SIZE' | 'INTENT' | 'ADDRESS' | 'PAYMENT' | 'DAMAGE';

/** Courier vocabulary. Note what is absent: nothing here can say "ran small". */
const NDR_BY_CAUSE: Record<Cause, string[]> = {
  // Size failure surfaces as remorse. This is the whole point of act 1.
  SIZE: ['REFUSED_COD', 'REFUSED_COD', 'REFUSED_COD', 'BOUGHT_ELSEWHERE', 'NO_LONGER_NEEDED'],
  INTENT: ['REFUSED_COD', 'BOUGHT_ELSEWHERE', 'NO_LONGER_NEEDED', 'DUPLICATE_ORDER'],
  ADDRESS: ['ADDR_INCOMPLETE', 'PREMISES_CLOSED', 'CONSIGNEE_MOVED', 'PIN_UNSERVICEABLE'],
  PAYMENT: ['CASH_NOT_READY', 'AMOUNT_DISPUTE'],
  // Per the Atlas: damage reads as refusal in most panels.
  DAMAGE: ['REFUSED_COD', 'REFUSED_COD', 'DAMAGED_TRANSIT'],
};

interface Order {
  id: string;
  /** The link that makes a graph possible. Absent from the old corpus. */
  customerId: string;
  styleId: string;
  size: Size;
  bodyChestCm: number;
  paymentMode: 'COD' | 'PREPAID';
  tier: 1 | 2 | 3;
  isFirstOrder: boolean;
  placedAt: string;
  amountPaise: number;
  outcome: 'DELIVERED' | 'RTO';
  ndrCode?: string;
  trueCause?: Cause;
  /** Ground truth: she ordered a size that does not fit her. Never an input. */
  fitMismatch: boolean;
}

interface Exchange {
  orderId: string;
  styleId: string;
  size: Size;
  reason: 'SIZE_TOO_SMALL' | 'SIZE_TOO_LARGE' | 'COLOR' | 'DEFECTIVE' | 'UNWANTED';
}

// --------------------------------------------------------------- customers
//
// WHY THIS EXISTS: every feature in scoreFitRisk is a property of ONE order in
// isolation. Nothing in the model can see that two orders came from the same
// person, or that two people share a doorstep. This section creates the
// entities and the shared identifiers that make those questions askable.
//
// HOW THE RINGS ARE BUILT, AND WHY IT MATTERS: a ring's members are chained,
// and each consecutive pair shares exactly ONE identifier, chosen at random
// from phone / address / device. So no single GROUP BY recovers a ring —
// grouping by phone finds a pair, grouping by device finds a different pair,
// and the ring only appears once you take the transitive closure. That is the
// honest test of whether a graph is doing work a relational query could not.

interface Customer {
  customerId: string;
  phone: string;
  addressHash: string;
  deviceId: string;
  pincode: string;
  tier: 1 | 2 | 3;
  orderCount: number;
  /** GROUND TRUTH. Ring membership, or null. Never an input to any score. */
  ringId: string | null;
  /** GROUND TRUTH. A legitimate shared-address household — the false positive. */
  householdId: string | null;
}

const PINCODES = ['110001', '110024', '400001', '400058', '560001', '560076', '600028',
  '700019', '500034', '411004', '302001', '380015', '226010', '160022'];

const phoneOf = (n: number) => `+9198${String(10_000_000 + n).slice(0, 8)}`;
const addrOf = (n: number) => `ADDR-${String(n).padStart(6, '0')}`;
const devOf = (n: number) => `DEV-${String(n).padStart(6, '0')}`;

const customers: Customer[] = [];
{
  let placed = 0, n = 0;
  while (placed < N_ORDERS) {
    let count = 1;
    while (chance(REPEAT_P) && count < MAX_ORDERS_PER_CUSTOMER) count++;
    count = Math.min(count, N_ORDERS - placed);
    customers.push({
      customerId: `C-${String(n).padStart(6, '0')}`,
      phone: phoneOf(n),
      addressHash: addrOf(n),
      deviceId: devOf(n),
      pincode: pick(PINCODES),
      tier: chance(TIER23_SHARE) ? (chance(0.55) ? 2 : 3) : 1,
      orderCount: count,
      ringId: null,
      householdId: null,
    });
    placed += count;
    n++;
  }
}

/* Households: a few customers genuinely share an address and a pincode. They
   behave completely normally. If the graph layer cannot tell these from a
   ring, it is not worth running. */
{
  const pool = customers.filter((c) => chance(HOUSEHOLD_SHARE));
  let i = 0, h = 0;
  while (i < pool.length) {
    // 2-5 people. Deliberately overlapping the ring size range: if component
    // SIZE alone separated households from rings, the detector would not need
    // to look at behaviour, and the whole exercise would be a straw man.
    const size = 2 + Math.floor(rnd() * 4);
    const members = pool.slice(i, i + size);
    i += size;
    if (members.length < 2) break;
    const id = `HH-${String(h++).padStart(4, '0')}`;
    const head = members[0];
    for (const m of members) {
      m.householdId = id;
      m.addressHash = head.addressHash;
      m.pincode = head.pincode;
      // A family shares a tablet as readily as a fraud ring does.
      if (m !== head && chance(0.35)) m.deviceId = head.deviceId;
    }
  }
}

/* Rings: chained identifier sharing, so only transitive closure finds them.
   Members are drawn from REPEAT buyers on purpose — the existing risk model
   scores a repeat customer LOW (firstOrder contributes 0), so these accounts
   look safe on every feature the model currently has. That is the point. */
const ringIds: string[] = [];
{
  const eligible = customers.filter((c) => c.orderCount >= 2 && !c.householdId);
  let cursor = 0;
  for (let r = 0; r < N_RINGS && cursor + RING_MAX < eligible.length; r++) {
    const size = RING_MIN + Math.floor(rnd() * (RING_MAX - RING_MIN + 1));
    const members = eligible.slice(cursor, cursor + size);
    cursor += size;
    if (members.length < RING_MIN) break;

    const ringId = `RING-${String(r).padStart(3, '0')}`;
    ringIds.push(ringId);
    for (const m of members) {
      m.ringId = ringId;
      m.tier = chance(0.7) ? 1 : 2;      // look like good customers
    }
    // Chain them. Each link shares exactly one identifier with the previous.
    for (let i = 1; i < members.length; i++) {
      const prev = members[i - 1], cur = members[i];
      const link = pick(['phone', 'address', 'device'] as const);
      if (link === 'phone') cur.phone = prev.phone;
      else if (link === 'address') { cur.addressHash = prev.addressHash; cur.pincode = prev.pincode; }
      else cur.deviceId = prev.deviceId;
    }
  }
}

const orders: Order[] = [];
const exchanges: Exchange[] = [];
const now = Date.UTC(2026, 8, 5);

/** Smallest size whose TRUE chest clears her body chest plus ease. */
function bestSize(style: Style, bodyChest: number): Size {
  const need = bodyChest + style.easeCm;
  return SIZES.find((s) => style.chestBase[s] - style.runsSmallBy >= need) ?? 'XL';
}
/** What the manufacturer's chart tells her to buy — it does not know it runs small. */
function chartSize(style: Style, bodyChest: number): Size {
  const need = bodyChest + style.easeCm;
  return SIZES.find((s) => style.chestBase[s] >= need) ?? 'XL';
}

let orderSeq = 0;
for (const cust of customers) {
  // Her own orders in time order, so "first order" means what it says.
  const stamps = Array.from({ length: cust.orderCount },
    () => now - Math.floor(rnd() * MONTHS * 30 * 864e5)).sort((a, b) => a - b);
  // One body per person, not one per order. This is the other thing an order
  // table cannot say: the same woman has the same measurements every time.
  const custChest = round1(Math.min(112, Math.max(76, gauss(90, 7.5))));

  for (let k = 0; k < cust.orderCount; k++) {
  const style = pick(styles);
  const bodyChest = round1(Math.min(112, Math.max(76, custChest + gauss(0, 0.8))));

  // Most shoppers follow the chart; a few guess.
  const ordered = chance(0.86) ? chartSize(style, bodyChest) : pick(SIZES);
  const fitMismatch = ordered !== bestSize(style, bodyChest);

  const inRing = cust.ringId !== null;
  // A ring account is here to take delivery of goods it will not pay for, so
  // it picks COD almost every time.
  const paymentMode = chance(inRing ? 0.95 : COD_SHARE) ? 'COD' : 'PREPAID';
  const tier = cust.tier;
  const isFirstOrder = k === 0;

  // Baseline RTO pressure, then the fit penalty on top.
  let p = 0.07;
  if (paymentMode === 'COD') p += 0.11;
  if (tier === 2) p += 0.03;
  if (tier === 3) p += 0.06;
  if (isFirstOrder) p += 0.04;
  // She cannot try it on before paying, so fit doubt becomes a doorstep refusal.
  if (fitMismatch) p += paymentMode === 'COD' ? 0.16 : 0.05;
  // Ring behaviour swamps everything else, and has nothing to do with fit.
  if (inRing) p += 0.42;

  const isRto = chance(Math.min(inRing ? 0.88 : 0.62, p));

  let trueCause: Cause | undefined;
  let ndrCode: string | undefined;

  if (isRto) {
    // A ring refusal is never a size problem. Attributing it to fit is the
    // mistake the graph layer exists to stop the fit model from making.
    trueCause = inRing
      ? 'INTENT'
      : fitMismatch && chance(0.62)
        ? 'SIZE'
        : (pick(['INTENT', 'INTENT', 'ADDRESS', 'PAYMENT', 'DAMAGE']) as Cause);
    ndrCode = pick(NDR_BY_CAUSE[trueCause]);
  }

  const id = `KA-${(10_000 + orderSeq++).toString()}`;
  orders.push({
    id,
    customerId: cust.customerId,
    styleId: style.styleId,
    size: ordered,
    bodyChestCm: bodyChest,
    paymentMode,
    tier,
    isFirstOrder,
    placedAt: new Date(stamps[k]).toISOString(),
    amountPaise: style.mrpPaise,
    outcome: isRto ? 'RTO' : 'DELIVERED',
    ndrCode,
    trueCause,
    fitMismatch,
  });

  // Exchanges exist ONLY on delivered orders. This is the distribution shift,
  // baked into the data so we can point at it when asked.
  if (!isRto) {
    if (fitMismatch && chance(0.34)) {
      const tooSmall = SIZES.indexOf(ordered) < SIZES.indexOf(bestSize(style, bodyChest));
      exchanges.push({
        orderId: id,
        styleId: style.styleId,
        size: ordered,
        reason: tooSmall ? 'SIZE_TOO_SMALL' : 'SIZE_TOO_LARGE',
      });
    } else if (chance(0.045)) {
      exchanges.push({
        orderId: id,
        styleId: style.styleId,
        size: ordered,
        reason: pick(['COLOR', 'DEFECTIVE', 'UNWANTED']) as Exchange['reason'],
      });
    }
  }
  }
}

// ------------------------------------------- reconciliation and diagnosis

interface Agg {
  delivered: number; rto: number; tooSmall: number; tooLarge: number; rtoPaise: number;
}
const agg = new Map<string, Agg>();
for (const s of styles) agg.set(s.styleId, { delivered: 0, rto: 0, tooSmall: 0, tooLarge: 0, rtoPaise: 0 });

const styleById = new Map(styles.map((s) => [s.styleId, s]));
for (const o of orders) {
  const a = agg.get(o.styleId)!;
  if (o.outcome === 'RTO') {
    a.rto++;
    a.rtoPaise += styleById.get(o.styleId)!.cogsPaise + FREIGHT_TWO_WAY_PAISE;
  } else a.delivered++;
}
for (const e of exchanges) {
  const a = agg.get(e.styleId)!;
  if (e.reason === 'SIZE_TOO_SMALL') a.tooSmall++;
  if (e.reason === 'SIZE_TOO_LARGE') a.tooLarge++;
}

/**
 * Not everyone who gets the wrong size raises an exchange — most just keep it
 * or give up. So the exchange rate is a FLOOR on fit failure, not a measure of
 * it. A brand can estimate its own propensity from a returns survey; we assume
 * roughly one in three, and report both numbers so nobody has to trust it.
 */
const ASSUMED_EXCHANGE_PROPENSITY = 0.35;

const diagStyles = styles.map((s) => {
  const a = agg.get(s.styleId)!;
  const sizeExchangeRate = a.delivered ? (a.tooSmall + a.tooLarge) / a.delivered : 0;
  const attributedSizeRto = a.rto * sizeExchangeRate;
  const adjustedSizeRto = a.rto * Math.min(1, sizeExchangeRate / ASSUMED_EXCHANGE_PROPENSITY);
  const costPerRto = s.cogsPaise + FREIGHT_TWO_WAY_PAISE;
  return {
    styleId: s.styleId,
    styleName: s.styleName,
    rtoCount: a.rto,
    deliveredCount: a.delivered,
    sizeExchangeRate: round1(sizeExchangeRate * 1000) / 1000,
    attributedSizeRto: Math.round(attributedSizeRto),
    attributedRupees: Math.round((attributedSizeRto * costPerRto) / 100),
    adjustedRupees: Math.round((adjustedSizeRto * costPerRto) / 100),
    actuallyRunsSmall: s.runsSmallBy > 0,
    learnedOffsetCm: round1(learnedOffsetFromExchanges(a.tooSmall, a.tooLarge, a.delivered)),
  };
});

// Recall: does ranking by exchange signal recover the injected cohort?
const ranked = [...diagStyles].sort((a, b) => b.sizeExchangeRate - a.sizeExchangeRate);
const topN = ranked.slice(0, N_RUNS_SMALL);
const recovered = topN.filter((s) => s.actuallyRunsSmall).length;
const recall = recovered / N_RUNS_SMALL;

const courierCounts = new Map<string, { count: number; paise: number }>();
for (const o of orders) {
  if (!o.ndrCode) continue;
  const c = courierCounts.get(o.ndrCode) ?? { count: 0, paise: 0 };
  c.count++;
  c.paise += styleById.get(o.styleId)!.cogsPaise + FREIGHT_TWO_WAY_PAISE;
  courierCounts.set(o.ndrCode, c);
}

const totalRto = orders.filter((o) => o.outcome === 'RTO').length;
const totalRtoPaise = orders
  .filter((o) => o.outcome === 'RTO')
  .reduce((t, o) => t + styleById.get(o.styleId)!.cogsPaise + FREIGHT_TWO_WAY_PAISE, 0);
const attributedSizeRupees = diagStyles.reduce((t, s) => t + s.attributedRupees, 0);
const adjustedSizeRupees = diagStyles.reduce((t, s) => t + s.adjustedRupees, 0);

// Ground truth, for validating the estimator. Never shown to the model as input.
const trueSizeRto = orders.filter((o) => o.trueCause === 'SIZE');
const trueSizeRupees = Math.round(
  trueSizeRto.reduce((t, o) => t + styleById.get(o.styleId)!.cogsPaise + FREIGHT_TWO_WAY_PAISE, 0) / 100,
);

// ------------------------------------------------------------------- rings
//
// Ground truth for the graph layer, computed the same way the fit recall is:
// the generator knows which accounts are a ring, the detector will not.

const byCustomer = new Map<string, typeof orders>();
for (const o of orders) {
  const list = byCustomer.get(o.customerId) ?? [];
  list.push(o);
  byCustomer.set(o.customerId, list);
}

const ringStats = ringIds.map((ringId) => {
  const members = customers.filter((c) => c.ringId === ringId);
  const ringOrders = members.flatMap((m) => byCustomer.get(m.customerId) ?? []);
  const rto = ringOrders.filter((o) => o.outcome === 'RTO');
  return {
    ringId,
    members: members.length,
    orders: ringOrders.length,
    rtoCount: rto.length,
    rtoRate: ringOrders.length ? round1((rto.length / ringOrders.length) * 1000) / 1000 : 0,
    rupees: Math.round(
      rto.reduce((s, o) => s + styleById.get(o.styleId)!.cogsPaise + FREIGHT_TWO_WAY_PAISE, 0) / 100),
  };
});

const ringOrderIds = new Set(
  customers.filter((c) => c.ringId).flatMap((c) => (byCustomer.get(c.customerId) ?? []).map((o) => o.id)));
const ringRto = orders.filter((o) => ringOrderIds.has(o.id) && o.outcome === 'RTO');
const cleanOrders = orders.filter((o) => !ringOrderIds.has(o.id));
const baselineRate = cleanOrders.filter((o) => o.outcome === 'RTO').length / cleanOrders.length;

const rings = {
  count: ringStats.length,
  members: customers.filter((c) => c.ringId).length,
  households: customers.filter((c) => c.householdId).length,
  orders: ringOrderIds.size,
  rtoCount: ringRto.length,
  rtoRate: Math.round((ringRto.length / Math.max(1, ringOrderIds.size)) * 1000) / 1000,
  baselineRtoRate: Math.round(baselineRate * 1000) / 1000,
  rupees: Math.round(
    ringRto.reduce((s, o) => s + styleById.get(o.styleId)!.cogsPaise + FREIGHT_TWO_WAY_PAISE, 0) / 100),
  /**
   * Can the CURRENT model tell a ring order from an ordinary COD order?
   *
   * The claim is not "it scores them low" — it is that it cannot SEPARATE
   * them, because every feature it has (cod, tier, firstOrder, styleHistory)
   * reads identically for both. Compared against non-ring COD orders so the
   * payment mode is held constant and the comparison is fair.
   */
  separation: (() => {
    const rate = new Map(diagStyles.map((s) => [s.styleId, s.sizeExchangeRate]));
    const score = (o: (typeof orders)[number]) => scoreFitRisk({
      styleSizeFailureRate: Math.min(1, (rate.get(o.styleId) ?? 0) * 4),
      usedL1: false,                       // L1 did not exist over this corpus
      paymentMode: o.paymentMode,
      isFirstOrder: o.isFirstOrder,
      tier: o.tier,
    }).score;
    const med = (xs: number[]) => {
      const s = [...xs].sort((a, b) => a - b);
      return s.length ? Math.round(s[s.length >> 1] * 1000) / 1000 : 0;
    };
    const ring = orders.filter((o) => ringOrderIds.has(o.id)).map(score);
    const codClean = orders
      .filter((o) => !ringOrderIds.has(o.id) && o.paymentMode === 'COD').map(score);
    // Fraction of (ring, clean) pairs the model orders correctly. 0.5 = coin flip.
    const sorted = [...codClean].sort((a, b) => a - b);
    const below = (v: number) => {
      let lo = 0, hi = sorted.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < v) lo = m + 1; else hi = m; }
      return lo;
    };
    const auc = ring.reduce((s, v) => s + below(v) / sorted.length, 0) / Math.max(1, ring.length);
    return {
      medianRingOrder: med(ring),
      medianCleanCodOrder: med(codClean),
      auc: Math.round(auc * 1000) / 1000,
    };
  })(),
  detail: ringStats.sort((a, b) => b.rupees - a.rupees),
};

const diagnosis = {
  totalOrders: orders.length,
  totalRto,
  totalRtoRupees: Math.round(totalRtoPaise / 100),
  attributedSizeRupees,
  adjustedSizeRupees,
  assumedExchangePropensity: ASSUMED_EXCHANGE_PROPENSITY,
  recall,
  rings,
  courierBreakdown: [...courierCounts.entries()]
    .map(([code, v]) => ({ code, count: v.count, rupees: Math.round(v.paise / 100) }))
    .sort((a, b) => b.count - a.count),
  styles: diagStyles.sort((a, b) => b.attributedRupees - a.attributedRupees),
};

// --------------------------------------------------------------------- skus

const offsetByStyle = new Map(diagStyles.map((s) => [s.styleId, s.learnedOffsetCm]));
const skus = styles.flatMap((s) =>
  SIZES.map((size) => ({
    id: `${s.styleId}-${size}`,
    styleId: s.styleId,
    styleName: s.styleName,
    size,
    imageUrl: `/products/${s.styleId}.jpg`,
    mrpPaise: s.mrpPaise,
    cogsPaise: s.cogsPaise,
    chestCm: s.chestBase[size],
    lengthCm: round1(gauss(112, 5)),
    shoulderCm: round1(s.chestBase[size] / 2.6),
    easeCm: s.easeCm,
    learnedOffsetCm: offsetByStyle.get(s.styleId) ?? 0,
  })),
);

/** Body chest in cm that each brand's label size actually fits. Powers the
 *  cross-brand path — the L1 input that cannot fail. */
const brandSizes = {
  Zara: { XS: 80, S: 85, M: 90, L: 95, XL: 101 },
  'H&M': { XS: 82, S: 86, M: 91, L: 96, XL: 102 },
  Biba: { XS: 79, S: 84, M: 89, L: 94, XL: 100 },
  'W for Woman': { XS: 81, S: 86, M: 91, L: 97, XL: 103 },
  FabIndia: { XS: 83, S: 88, M: 93, L: 98, XL: 104 },
  'Global Desi': { XS: 80, S: 85, M: 90, L: 96, XL: 102 },
  Max: { XS: 82, S: 87, M: 92, L: 97, XL: 103 },
};

// -------------------------------------------------------------- demo orders

const failureRate = new Map(diagStyles.map((s) => [s.styleId, s.sizeExchangeRate]));
const NAMES = ['Ananya Iyer', 'Priya Nair', 'Shreya Kulkarni', 'Divya Menon', 'Ritika Shah',
  'Neha Bansal', 'Pooja Reddy', 'Kavya Rao', 'Sneha Joshi', 'Aditi Verma', 'Megha Pillai', 'Tanvi Desai'];

const badStyles = diagStyles.filter((s) => s.actuallyRunsSmall).slice(0, 4);
const okStyles = diagStyles.filter((s) => !s.actuallyRunsSmall).slice(0, 8);

const demoOrders = NAMES.map((name, i) => {
  const st = i < 4 ? badStyles[i % badStyles.length] : okStyles[i % okStyles.length];
  const style = styleById.get(st.styleId)!;
  const size = pick(SIZES);
  const usedL1 = chance(0.35);
  const paymentMode = chance(0.7) ? 'COD' : 'PREPAID';
  const tier: 1 | 2 | 3 = chance(0.6) ? (chance(0.5) ? 2 : 3) : 1;
  const isFirstOrder = chance(0.6);

  const risk = scoreFitRisk({
    styleSizeFailureRate: Math.min(1, (failureRate.get(st.styleId) ?? 0) * 4),
    usedL1,
    paymentMode,
    isFirstOrder,
    tier,
  });

  return {
    humanId: `KA-2${String(400 + i)}`,
    customerName: name,
    // Replace with real handsets before the demo — these must ring on stage.
    phone: process.env.DEMO_PHONE ?? '+919800000000',
    tier,
    isFirstOrder,
    skuId: `${st.styleId}-${size}`,
    styleName: st.styleName,
    size,
    amountPaise: style.mrpPaise,
    paymentMode,
    usedL1,
    risk,
  };
}).sort((a, b) => b.risk.score - a.risk.score);

// -------------------------------------------------------------------- write

mkdirSync(OUT, { recursive: true });
const write = (f: string, data: unknown) => {
  writeFileSync(join(OUT, f), JSON.stringify(data, null, f === 'orders.json' ? 0 : 2));
};

write('skus.json', skus);
write('orders.json', orders);
write('exchanges.json', exchanges);
write('diagnosis.json', diagnosis);
write('brand-sizes.json', brandSizes);
write('customers.json', customers);
write('demo-orders.json', demoOrders);

// -------------------------------------------------------------------- report

const lakh = (rupees: number) => `₹${(rupees / 100000).toFixed(1)}L`;
console.log(`
  Kaira corpus — seed ${SEED}

  orders            ${orders.length.toLocaleString('en-IN')}
  styles            ${styles.length}  (${N_RUNS_SMALL} injected as running small)
  RTO               ${totalRto.toLocaleString('en-IN')}  (${((totalRto / orders.length) * 100).toFixed(1)}%)
  exchanges         ${exchanges.length.toLocaleString('en-IN')}  (delivered orders only)

  total RTO cost    ${lakh(Math.round(totalRtoPaise / 100))}

  size exposure
    observed floor  ${lakh(attributedSizeRupees)}   (only shoppers who exchanged)
    adjusted        ${lakh(adjustedSizeRupees)}   <- act 1 headline
    ground truth    ${lakh(trueSizeRupees)}   (generator knows; estimator does not)
    estimator is    ${((adjustedSizeRupees / trueSizeRupees) * 100).toFixed(0)}% of truth — conservative, say so

  RECALL            ${(recall * 100).toFixed(0)}%  (${recovered}/${N_RUNS_SMALL} recovered)
                    ^ put THIS on the slide, not a round number

  courier panel sees:
${diagnosis.courierBreakdown.slice(0, 5).map((c) => `    ${c.code.padEnd(20)} ${String(c.count).padStart(6)}`).join('\n')}

  nothing in that list can say "ran small".

  identity graph
    customers       ${customers.length.toLocaleString('en-IN')}  (${(orders.length / customers.length).toFixed(2)} orders each)
    first-order     ${((customers.length / orders.length) * 100).toFixed(0)}%  <- derived now, not asserted
    households      ${rings.households}  legitimate shared addresses (the confounder)

  planted rings     ${rings.count}  spanning ${rings.members} accounts, ${rings.orders} orders
    their RTO rate  ${(rings.rtoRate * 100).toFixed(0)}%  vs ${(rings.baselineRtoRate * 100).toFixed(0)}% baseline
    cost            ${lakh(rings.rupees)}
    fit risk median ${rings.separation.medianRingOrder.toFixed(2)} for a ring order
                    ${rings.separation.medianCleanCodOrder.toFixed(2)} for an honest COD order
    separation AUC  ${rings.separation.auc.toFixed(3)}  (0.5 = coin flip)  <- the gap the graph closes

  every ring is CHAINED: each pair shares one identifier, so no single
  GROUP BY recovers one. Transitive closure does. That is the whole argument.
`);
