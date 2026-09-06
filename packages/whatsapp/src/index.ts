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
 *
 * Provider: Twilio Programmable Messaging (WhatsApp channel).
 *
 * Two send modes, picked by whether TWILIO_WHATSAPP_CONTENT_SID is set:
 *
 *   freeform (default) — sends our own copy as Body. Only allowed inside the
 *     24h customer-service window, i.e. after the customer has messaged the
 *     sender. On the sandbox that window opens when they send "join <keyword>".
 *     This is the demo path: the text is the real, per-order copy.
 *
 *   template — sends an approved Content template by SID. Required to open a
 *     conversation cold (outside the 24h window) and therefore the production
 *     path. Body variables go in as {{1}}..{{5}} in the order below.
 */

const API = 'https://api.twilio.com/2010-04-01';

export class WhatsAppService implements WhatsAppPort {
  async sendConfirmation(ctx: ConfirmationContext): Promise<OutboundResult> {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const from = process.env.TWILIO_WHATSAPP_FROM;
    const contentSid = process.env.TWILIO_WHATSAPP_CONTENT_SID;

    // Twilio recommends an API key over the account auth token — it is scoped
    // and revocable without rotating the whole account.
    const authUser = process.env.TWILIO_API_KEY_SID || accountSid;
    const authPass = process.env.TWILIO_API_KEY_SECRET || process.env.TWILIO_AUTH_TOKEN;

    const body = renderBody(ctx);

    const msg = await prisma.message.create({
      data: {
        orderId: ctx.orderId,
        direction: 'OUTBOUND',
        templateName: contentSid ?? null,
        body,
        status: 'queued',
      },
    });

    try {
      if (!accountSid || !authUser || !authPass || !from) {
        throw new Error(
          'Missing Twilio env: TWILIO_ACCOUNT_SID, TWILIO_WHATSAPP_FROM and either TWILIO_API_KEY_SID/TWILIO_API_KEY_SECRET or TWILIO_AUTH_TOKEN',
        );
      }

      const form = new URLSearchParams({
        To: toWhatsApp(ctx.phone),
        From: toWhatsApp(from),
      });

      if (contentSid) {
        form.set('ContentSid', contentSid);
        form.set('ContentVariables', JSON.stringify(templateVariables(ctx)));
      } else {
        form.set('Body', body);
      }

      // Delivery receipts land here when it is set; without it a message stays
      // at whatever status the create call returned.
      const statusCallback = process.env.TWILIO_STATUS_CALLBACK_URL;
      if (statusCallback) form.set('StatusCallback', statusCallback);

      const res = await fetch(`${API}/Accounts/${accountSid}/Messages.json`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${base64(`${authUser}:${authPass}`)}`,
        },
        body: form,
      });

      const json = (await res.json()) as any;
      if (!res.ok) {
        throw new Error(
          json?.message
            ? `${json.message}${json.code ? ` (Twilio ${json.code})` : ''}`
            : 'send failed',
        );
      }

      const providerId = json.sid as string | undefined;

      await prisma.message.update({
        where: { id: msg.id },
        // queued|sending|sent|delivered|undelivered|failed — Twilio's own
        // vocabulary already matches the column.
        data: { status: json.status ?? 'sent', providerId },
      });
      await logEvent({
        orderId: ctx.orderId,
        level: 'L2',
        type: 'wa.sent',
        label: `WhatsApp sent to ${maskPhone(ctx.phone)}`,
        meta: { providerId, mode: contentSid ? 'template' : 'freeform' },
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
 * Twilio numbers body placeholders from 1, so this order is the contract with
 * whoever authored the Content template.
 */
function templateVariables(ctx: ConfirmationContext) {
  return {
    '1': ctx.customerName,
    '2': ctx.humanId,
    '3': ctx.styleName,
    '4': ctx.size,
    '5': String(Math.round(ctx.amountPaise / 100)),
  };
}

function renderBody(ctx: ConfirmationContext) {
  const nudge = ctx.recommendedSize && ctx.recommendedSize !== ctx.size
    ? ` We'd suggest ${ctx.recommendedSize} for this style.`
    : '';
  return `Hi ${ctx.customerName}, confirming order ${ctx.humanId} — ${ctx.styleName}, size ${ctx.size}, ₹${Math.round(ctx.amountPaise / 100)} COD.${nudge}`;
}

/** Twilio addresses the WhatsApp channel with a prefix on the E.164 number. */
const toWhatsApp = (phone: string) =>
  phone.startsWith('whatsapp:') ? phone : `whatsapp:${phone}`;

const base64 = (s: string) =>
  typeof btoa === 'function' ? btoa(s) : Buffer.from(s).toString('base64');

const maskPhone = (p: string) => p.slice(0, 3) + '•••••' + p.slice(-3);

/** Handy while L1 does not exist yet — lets Rohit build against a real row. */
export const whatsapp = new WhatsAppService();
