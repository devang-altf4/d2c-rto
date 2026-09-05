import { prisma } from '../packages/db/src/index';

async function check() {
  const calls = await prisma.call.findMany({ orderBy: { createdAt: 'desc' }, take: 2 });
  const events = await prisma.event.findMany({ where: { level: 'L3' }, orderBy: { createdAt: 'desc' }, take: 2 });
  console.log('Recent Calls:', JSON.stringify(calls, null, 2));
  console.log('Recent L3 Events:', JSON.stringify(events, null, 2));
  await prisma.$disconnect();
}

check().catch(console.error);
