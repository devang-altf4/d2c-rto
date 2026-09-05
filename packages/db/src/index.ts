import { PrismaClient } from '@prisma/client';

const g = globalThis as unknown as { prisma?: PrismaClient };
export const prisma = g.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') g.prisma = prisma;

export * from '@prisma/client';

/** Append to the event log. Every workstream calls this; the ops timeline reads it. */
export async function logEvent(input: {
  orderId: string;
  level: 'L1' | 'L2' | 'L3';
  type: string;
  label: string;
  meta?: Record<string, unknown>;
}) {
  return prisma.event.create({ data: { ...input, meta: input.meta ?? {} } });
}
