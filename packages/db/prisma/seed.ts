/**
 * Seeds the live demo state.
 *
 * Run AFTER `pnpm data:generate`. Reads data/skus.json and data/demo-orders.json
 * and writes the dozen orders that move through L1 -> L2 -> L3 on stage.
 *
 *   pnpm db:push && pnpm data:generate && pnpm db:seed
 *
 * Idempotent — safe to re-run between rehearsals to reset the demo.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { SIZES, type Size } from '../../core/src/types';

const prisma = new PrismaClient();
const root = join(__dirname, '..', '..', '..');
const read = (f: string) => JSON.parse(readFileSync(join(root, 'data', f), 'utf8'));

interface DemoOrder {
  humanId: string;
  customerName: string;
  phone: string;
  tier: 1 | 2 | 3;
  isFirstOrder: boolean;
  skuId: string;
  styleName: string;
  size: Size;
  amountPaise: number;
  paymentMode: 'COD' | 'PREPAID';
  usedL1: boolean;
  risk: { score: number; components: Record<string, number>; atRisk: boolean };
}

async function main() {
  const skus = read('skus.json') as any[];
  const demo = read('demo-orders.json') as DemoOrder[];

  // Wipe live state only. The historical corpus lives in data/*.json and is
  // never touched, so a reset between rehearsals costs nothing.
  await prisma.event.deleteMany();
  await prisma.message.deleteMany();
  await prisma.call.deleteMany();
  await prisma.riskScore.deleteMany();
  await prisma.fitSession.deleteMany();
  await prisma.order.deleteMany();
  await prisma.customer.deleteMany();

  // Only the SKUs the demo actually touches, plus every size of those styles
  // so the widget has a full ladder to recommend across.
  const demoStyleIds = new Set(demo.map((d) => d.skuId.replace(/-(XS|S|M|L|XL)$/, '')));
  const needed = skus.filter((s) => demoStyleIds.has(s.styleId));

  for (const s of needed) {
    await prisma.sku.upsert({ where: { id: s.id }, update: s, create: s });
  }
  console.log(`  skus       ${needed.length} (${demoStyleIds.size} styles)`);

  let atRisk = 0;

  for (const d of demo) {
    const customer = await prisma.customer.create({
      data: {
        name: d.customerName,
        phone: process.env.DEMO_PHONE ?? d.phone,
        tier: d.tier,
        isFirst: d.isFirstOrder,
      },
    });

    const order = await prisma.order.create({
      data: {
        humanId: d.humanId,
        customerId: customer.id,
        skuId: d.skuId,
        size: d.size,
        amountPaise: d.amountPaise,
        paymentMode: d.paymentMode,
        status: d.risk.atRisk ? 'AT_RISK' : 'PLACED',
      },
    });
    if (d.risk.atRisk) atRisk++;

    // L1 ran on some of them. Where it did, half the time it disagreed with
    // what she chose — that disagreement is what gives L2 and L3 something
    // specific to say instead of a generic confirmation.
    if (d.usedL1) {
      const i = SIZES.indexOf(d.size);
      const disagree = i < SIZES.length - 1 && Math.random() < 0.5;
      const recommended = disagree ? SIZES[i + 1] : d.size;

      await prisma.fitSession.create({
        data: {
          orderId: order.id,
          source: Math.random() < 0.6 ? 'CAMERA' : 'CROSS_BRAND',
          heightCm: 158 + Math.round(Math.random() * 14),
          bodyChestCm: 86 + Math.round(Math.random() * 10),
          recommendedSize: recommended,
          chosenSize: d.size,
          followed: !disagree,
          confidence: 0.72 + Math.random() * 0.16,
          learnedOffsetApplied: disagree ? 2.4 : 0,
        },
      });
    }

    await prisma.riskScore.create({
      data: { orderId: order.id, score: d.risk.score, components: d.risk.components },
    });

    await prisma.event.create({
      data: {
        orderId: order.id,
        level: 'L1',
        type: d.usedL1 ? 'fit.recommended' : 'fit.skipped',
        label: d.usedL1
          ? `Sizing ran — ${d.styleName}`
          : `Sizing skipped — ordered ${d.size} off the chart`,
      },
    });
    await prisma.event.create({
      data: {
        orderId: order.id,
        level: 'L2',
        type: 'risk.scored',
        label: `Fit risk ${(d.risk.score * 100).toFixed(0)}%${d.risk.atRisk ? ' — queued for confirmation' : ''}`,
        meta: d.risk.components,
      },
    });
  }

  console.log(`  customers  ${demo.length}`);
  console.log(`  orders     ${demo.length}  (${atRisk} at risk, queued for L2)`);
  console.log(`\n  phone      ${process.env.DEMO_PHONE ?? 'DEMO_PHONE not set — using placeholders'}`);
  console.log(`\n  Rohit and Devang: rows are live, build against them now.\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
