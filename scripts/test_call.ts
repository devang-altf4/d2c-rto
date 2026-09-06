import { voice } from '../packages/voice/src/index';
import { prisma, buildConfirmationContext } from '../packages/db/src/index';

async function main() {
  const argPhone = process.argv[2];
  const argOrder = process.argv[3] || 'KA-2401';

  console.log(`\n📞 [L3 Voice Call] Building context for order ${argOrder}...`);
  const ctx = await buildConfirmationContext(argOrder);
  if (!ctx) {
    console.error(`❌ Order ${argOrder} not found in database!`);
    process.exit(1);
  }

  // Format phone number: CLI arg > DEMO_PHONE env > order phone
  let targetPhone = (argPhone || process.env.DEMO_PHONE || ctx.phone).trim();
  if (!targetPhone.startsWith('+')) {
    targetPhone = targetPhone.length === 10 ? `+91${targetPhone}` : `+${targetPhone}`;
  }
  ctx.phone = targetPhone;

  console.log(`🚀 Initiating Hinglish confirmation call via Sarvam AI...`);
  console.log(`   Customer: ${ctx.customerName}`);
  console.log(`   Phone:    ${ctx.phone}`);
  console.log(`   Item:     ${ctx.styleName} (${ctx.size})`);
  console.log(`   Amount:   ₹${Math.round(ctx.amountPaise / 100)} (${ctx.paymentMode})\n`);

  const result = await voice.placeConfirmationCall(ctx);
  if (result.ok) {
    console.log(`✅ Call placed successfully!`);
    console.log(`   Attempt ID: ${result.providerId}`);
  } else {
    console.error(`❌ Call failed:`, result.error);
  }

  const call = await prisma.call.findFirst({
    where: { orderId: ctx.orderId },
    orderBy: { createdAt: 'desc' },
  });
  if (call) {
    console.log(`   DB Call Record ID: ${call.id}\n`);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
