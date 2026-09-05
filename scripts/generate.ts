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
const FIRST_ORDER_SHARE = 0.55;

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

for (let i = 0; i < N_ORDERS; i++) {
  const style = pick(styles);
  const bodyChest = round1(Math.min(112, Math.max(76, gauss(90, 7.5))));

  // Most shoppers follow the chart; a few guess.
  const ordered = chance(0.86) ? chartSize(style, bodyChest) : pick(SIZES);
  const fitMismatch = ordered !== bestSize(style, bodyChest);

  const paymentMode = chance(COD_SHARE) ? 'COD' : 'PREPAID';
  const tier: 1 | 2 | 3 = chance(TIER23_SHARE) ? (chance(0.55) ? 2 : 3) : 1;
  const isFirstOrder = chance(FIRST_ORDER_SHARE);

  // Baseline RTO pressure, then the fit penalty on top.
  let p = 0.07;
  if (paymentMode === 'COD') p += 0.11;
  if (tier === 2) p += 0.03;
  if (tier === 3) p += 0.06;
  if (isFirstOrder) p += 0.04;
  // She cannot try it on before paying, so fit doubt becomes a doorstep refusal.
  if (fitMismatch) p += paymentMode === 'COD' ? 0.16 : 0.05;

  const isRto = chance(Math.min(0.62, p));

  let trueCause: Cause | undefined;
  let ndrCode: string | undefined;

  if (isRto) {
    trueCause = fitMismatch && chance(0.62)
      ? 'SIZE'
      : (pick(['INTENT', 'INTENT', 'ADDRESS', 'PAYMENT', 'DAMAGE']) as Cause);
    ndrCode = pick(NDR_BY_CAUSE[trueCause]);
  }

  const id = `KA-${(10_000 + i).toString()}`;
  orders.push({
    id,
    styleId: style.styleId,
    size: ordered,
    bodyChestCm: bodyChest,
    paymentMode,
    tier,
    isFirstOrder,
    placedAt: new Date(now - Math.floor(rnd() * MONTHS * 30 * 864e5)).toISOString(),
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

const diagnosis = {
  totalOrders: orders.length,
  totalRto,
  totalRtoRupees: Math.round(totalRtoPaise / 100),
  attributedSizeRupees,
  adjustedSizeRupees,
  assumedExchangePropensity: ASSUMED_EXCHANGE_PROPENSITY,
  recall,
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
`);
