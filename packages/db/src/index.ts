import { Prisma, PrismaClient } from '@prisma/client';
import type { ConfirmationContext, Size } from '../../core/src/types';

const g = globalThis as unknown as { prisma?: PrismaClient };
export const prisma = g.prisma ?? new PrismaClient();
const _nodeEnv = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process?.env?.NODE_ENV;
if (_nodeEnv !== 'production') g.prisma = prisma;

export * from '@prisma/client';
export { buildConfirmationContext } from './context';

/** Append to the event log. Every workstream calls this; the ops timeline reads it. */
export async function logEvent(input: {
  orderId: string;
  level: 'L1' | 'L2' | 'L3';
  type: string;
  label: string;
  meta?: Record<string, unknown>;
}) {
  return prisma.event.create({ data: { ...input, meta: (input.meta ?? {}) as unknown as Prisma.InputJsonValue } });
}
