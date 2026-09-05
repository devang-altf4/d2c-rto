import { voice } from '../packages/voice/src/index';
import { prisma, buildConfirmationContext } from '../packages/db/src/index';

async function main() {
  console.log('Building confirmation context for KA-2401...');
  const ctx = await buildConfirmationContext('KA-2401');
  if (!ctx) {
    console.error('Order KA-2401 not found!');
    process.exit(1);
  }

  // Use DEMO_PHONE for testing so it rings the real test phone
  ctx.phone = process.env.DEMO_PHONE || ctx.phone;
  console.log('Placing call with context:', ctx);

  const result = await voice.placeConfirmationCall(ctx);
  console.log('Call Result:', result);

  const call = await prisma.call.findFirst({
    where: { orderId: ctx.orderId },
    orderBy: { createdAt: 'desc' },
  });
  console.log('Recorded Call in DB:', call);

  const event = await prisma.event.findFirst({
    where: { orderId: ctx.orderId, level: 'L3' },
    orderBy: { createdAt: 'desc' },
  });
  console.log('Recorded L3 Event in DB:', event);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
