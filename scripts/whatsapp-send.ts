/**
 * Send one real WhatsApp confirmation through the L2 path.
 *
 *   pnpm wa:send            # first order in the DB
 *   pnpm wa:send ORD87254   # a specific humanId or order id
 *
 * This goes through WhatsAppService, so it writes a Message row and a
 * wa.sent event exactly like the ops UI will — the point is to prove the
 * whole path, not just that the credentials work.
 *
 * Sandbox note: the recipient must have sent "join <keyword>" to the sandbox
 * number within the last 24h, otherwise Twilio rejects freeform sends (63016)
 * and you need TWILIO_WHATSAPP_CONTENT_SID set to an approved template.
 */
import { buildConfirmationContext, prisma } from '../packages/db/src';
import { whatsapp } from '../packages/whatsapp/src';

async function main() {
  const arg = process.argv[2];

  const target = arg
    ? await prisma.order.findFirst({ where: { OR: [{ id: arg }, { humanId: arg }] } })
    : await prisma.order.findFirst({ orderBy: { placedAt: 'asc' } });

  if (!target) {
    console.error(arg ? `No order matching "${arg}".` : 'No orders in the DB — run pnpm db:seed first.');
    process.exit(1);
  }

  const ctx = await buildConfirmationContext(target.id);
  if (!ctx) {
    console.error(`Could not build a confirmation context for ${target.humanId}.`);
    process.exit(1);
  }

  console.log(`→ ${ctx.humanId} · ${ctx.styleName} · size ${ctx.size} · ${ctx.phone}`);

  const result = await whatsapp.sendConfirmation(ctx);

  if (result.ok) {
    console.log(`✓ sent — Twilio SID ${result.providerId}`);
  } else {
    console.error(`✗ failed — ${result.error}`);
    process.exitCode = 1;
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
