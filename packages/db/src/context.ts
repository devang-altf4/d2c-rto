import type { ConfirmationContext, Size } from '@rto/core';
import { prisma } from './index';

/**
 * The single source of context for BOTH L2 and L3.
 *
 * Rohit's WhatsApp and Devang's voice agent must say the same things about the
 * same order, so neither of them assembles this themselves — they both call
 * this. If a field is missing here, add it here, not in one channel.
 */
export async function buildConfirmationContext(
  orderId: string,
): Promise<ConfirmationContext | null> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { customer: true, sku: true, fitSession: true },
  });
  if (!order) return null;

  // recommendedSize is set ONLY when L1 ran and disagreed with what she chose.
  // That disagreement is the whole reason this call is worth making — it turns
  // "confirm your order" into "we think you picked the wrong size".
  const fit = order.fitSession;
  const recommendedSize =
    fit?.recommendedSize && fit.recommendedSize !== order.size
      ? (fit.recommendedSize as Size)
      : undefined;

  return {
    orderId: order.id,
    humanId: order.humanId,
    customerName: order.customer.name.split(' ')[0], // first name only on a call
    phone: order.customer.phone,
    styleName: order.sku.styleName,
    size: order.size as Size,
    amountPaise: order.amountPaise,
    paymentMode: order.paymentMode,
    recommendedSize,
  };
}
