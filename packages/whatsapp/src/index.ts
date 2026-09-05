import type { ConfirmationContext, OutboundResult, WhatsAppPort } from '@rto/core';
import { logEvent, prisma } from '@rto/db';

/**
 * L2 — Rohit owns this file.
 *
 * Contract: implement WhatsAppPort. The ops UI never imports anything else
 * from here, so you can rewrite the internals freely.
 *
 * Decision already made: send for real, update the UI optimistically, do NOT
 * build the inbound webhook round-trip. The judge's evidence is the message
 * landing on the demo phone. Reply handling is optional polish.
 */

const GRAPH = 'https://graph.facebook.com/v21.0';

export class WhatsAppService implements WhatsAppPort {
  async sendConfirmation(ctx: ConfirmationContext): Promise<OutboundResult> {
    const body = renderBody(ctx);

    const msg = await prisma.message.create({
      data: {
        orderId: ctx.orderId,
        direction: 'OUTBOUND',
        templateName: process.env.WHATSAPP_TEMPLATE_NAME,
        body,
        status: 'queued',
      },
    });

    try {
      const res = await fetch(
        `${GRAPH}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(buildTemplatePayload(ctx)),
        },
      );

      const json = (await res.json()) as any;
      if (!res.ok) throw new Error(json?.error?.message ?? 'send failed');

      const providerId = json.messages?.[0]?.id as string | undefined;

      await prisma.message.update({
        where: { id: msg.id },
        data: { status: 'sent', providerId },
      });
      await logEvent({
        orderId: ctx.orderId,
        level: 'L2',
        type: 'wa.sent',
        label: `WhatsApp sent to ${maskPhone(ctx.phone)}`,
        meta: { providerId },
      });

      return { ok: true, providerId };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      await prisma.message.update({
        where: { id: msg.id },
        data: { status: 'failed', error },
      });
      return { ok: false, error };
    }
  }
}

/**
 * Quick-reply buttons must be defined when the template is CREATED — they
 * cannot be added at send time. Buttons: CONFIRM | CHANGE_SIZE | CANCEL.
 */
function buildTemplatePayload(ctx: ConfirmationContext) {
  return {
    messaging_product: 'whatsapp',
    to: ctx.phone,
    type: 'template',
    template: {
      name: process.env.WHATSAPP_TEMPLATE_NAME,
      language: { code: 'en' },
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: ctx.customerName },
            { type: 'text', text: ctx.humanId },
            { type: 'text', text: ctx.styleName },
            { type: 'text', text: ctx.size },
            { type: 'text', text: `₹${Math.round(ctx.amountPaise / 100)}` },
          ],
        },
      ],
    },
  };
}

function renderBody(ctx: ConfirmationContext) {
  const nudge = ctx.recommendedSize && ctx.recommendedSize !== ctx.size
    ? ` We'd suggest ${ctx.recommendedSize} for this style.`
    : '';
  return `Hi ${ctx.customerName}, confirming order ${ctx.humanId} — ${ctx.styleName}, size ${ctx.size}, ₹${Math.round(ctx.amountPaise / 100)} COD.${nudge}`;
}

const maskPhone = (p: string) => p.slice(0, 3) + '•••••' + p.slice(-3);

/** Handy while L1 does not exist yet — lets Rohit build against a real row. */
export const whatsapp = new WhatsAppService();
