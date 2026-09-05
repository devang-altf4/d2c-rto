import { Prisma, PrismaClient } from '@prisma/client';
import type { ConfirmationContext, Size } from '../../core/src/types';

const g = globalThis as unknown as { prisma?: PrismaClient };
export const prisma = g.prisma ?? new PrismaClient();
const _nodeEnv = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process?.env?.NODE_ENV;
if (_nodeEnv !== 'production') g.prisma = prisma;

export * from '@prisma/client';

export async function buildConfirmationContext(
  orderId: string,
): Promise<ConfirmationContext | null> {
  const order = await prisma.order.findFirst({
    where: { OR: [{ id: orderId }, { humanId: orderId }] },
    include: { customer: true, sku: true, fitSession: true },
  });
  if (!order) return null;

  const customerName = order.customer.name.split(' ')[0];

  const ctx: ConfirmationContext = {
    orderId: order.id,
    humanId: order.humanId,
    customerName,
    phone: order.customer.phone,
    styleName: order.sku.styleName,
    size: order.size as Size,
    amountPaise: order.amountPaise,
    paymentMode: order.paymentMode,
  };

  const rec = order.fitSession?.recommendedSize;
  if (rec && rec !== order.size) {
    ctx.recommendedSize = rec as Size;
  }

  return ctx;
}

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
