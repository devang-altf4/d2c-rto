import type { ConfirmationContext, OutboundResult, VoicePort } from '@rto/core';
import { logEvent, prisma } from '@rto/db';

/**
 * L3 — Devang owns this file.
 *
 * Contract: implement VoicePort. Fires only after L2 goes unanswered, and
 * still BEFORE dispatch — that is where the economics come from. Nothing has
 * shipped, so a save here rescues the outbound freight too.
 *
 * Keep the agent to one job: confirm or cancel. A voice agent attempting open
 * conversation over venue wifi is how demos die.
 */

const VAPI = 'https://api.vapi.ai';

export class VoiceService implements VoicePort {
  async placeConfirmationCall(ctx: ConfirmationContext): Promise<OutboundResult> {
    const call = await prisma.call.create({
      data: { orderId: ctx.orderId, provider: 'vapi', language: 'hi-IN' },
    });

    try {
      const res = await fetch(`${VAPI}/call`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.VAPI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          assistantId: process.env.VAPI_ASSISTANT_ID,
          phoneNumberId: process.env.VAPI_PHONE_NUMBER_ID,
          customer: { number: ctx.phone, name: ctx.customerName },
          assistantOverrides: {
            variableValues: {
              name: ctx.customerName,
              orderId: ctx.humanId,
              style: ctx.styleName,
              size: ctx.size,
              amount: Math.round(ctx.amountPaise / 100),
            },
            firstMessage: firstMessage(ctx),
          },
        }),
      });

      const json = (await res.json()) as any;
      if (!res.ok) throw new Error(json?.message ?? 'call failed');

      await prisma.call.update({
        where: { id: call.id },
        data: { providerId: json.id },
      });
      await logEvent({
        orderId: ctx.orderId,
        level: 'L3',
        type: 'call.placed',
        label: `Hinglish call placed — pre-dispatch`,
        meta: { callId: json.id },
      });

      return { ok: true, providerId: json.id };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      await prisma.call.update({
        where: { id: call.id },
        data: { outcome: 'FAILED', transcript: error },
      });
      return { ok: false, error };
    }
  }
}

function firstMessage(ctx: ConfirmationContext) {
  return `Namaste ${ctx.customerName} ji, Kaira se baat kar rahe hain. Aapka order hai ${ctx.styleName}, size ${ctx.size}. Bas confirm karna tha — order chahiye, ya cancel kar dein?`;
}

export const voice = new VoiceService();
