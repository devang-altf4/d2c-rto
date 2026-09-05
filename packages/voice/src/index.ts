import type { ConfirmationContext, OutboundResult, VoicePort } from '@rto/core';
import { logEvent, prisma } from '@rto/db';

/**
 * L3 — Devang owns this file.
 *
 * Contract: implement VoicePort. Fires only after L2 goes unanswered, and
 * still BEFORE dispatch — that is where the economics come from. Nothing has
 * shipped, so a save here rescues the outbound freight too.
 *
 * Initiates an outbound Hinglish voice call using Sarvam AI.
 */
export class VoiceService implements VoicePort {
  async placeConfirmationCall(ctx: ConfirmationContext): Promise<OutboundResult> {
    const apiKey = process.env.SARVAM_API_KEY;
    const orgId = process.env.SARVAM_ORG_ID;
    const workspaceId = process.env.SARVAM_WORKSPACE_ID;
    const appId = process.env.SARVAM_APP_ID;
    const connectionId = process.env.SARVAM_CONNECTION_ID;
    const agentPhoneNumber = process.env.SARVAM_PHONE_NUMBER;

    if (!apiKey || !orgId || !workspaceId || !appId || !connectionId || !agentPhoneNumber) {
      throw new Error(
        'Missing required Sarvam AI environment variables: SARVAM_API_KEY, SARVAM_ORG_ID, SARVAM_WORKSPACE_ID, SARVAM_APP_ID, SARVAM_CONNECTION_ID, SARVAM_PHONE_NUMBER',
      );
    }

    const call = await prisma.call.create({
      data: { orderId: ctx.orderId, provider: 'sarvam', language: 'hi-IN' },
    });

    try {
      const url = `https://apps.sarvam.ai/api/outbounds/v1/orgs/${orgId}/workspaces/${workspaceId}/outbounds`;
      const firstMessage = `Namaste ${ctx.customerName} ji, Kaira se call hai. Aapka ${ctx.styleName} ka order dispatch karne se pehle confirm karna tha, taaki return ya size issue na ho. Aapka size ${ctx.size} hai aur ₹${Math.round(ctx.amountPaise / 100)} COD hai. Kya hum ye order dispatch kar dein ya cancel karna hai?`;
      const appVersion = Number(process.env.SARVAM_APP_VERSION || 1);

      const payload = {
        app_config: {
          app_id: appId,
          app_version: appVersion,
          connection_config: {
            connection_id: connectionId,
            agent_phone_number: agentPhoneNumber,
          },
          agent_variables: {
            customerName: ctx.customerName,
            styleName: ctx.styleName,
            size: ctx.size,
            amount: String(Math.round(ctx.amountPaise / 100)),
            orderId: ctx.humanId,
            recommendedSize: ctx.recommendedSize ?? '',
          },
          app_overrides: {
            initial_bot_message: firstMessage,
          },
        },
        user_config: {
          user_phone_number: ctx.phone,
        },
      };

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
        },
        body: JSON.stringify(payload),
      });

      const json = (await res.json()) as any;
      if (!res.ok) {
        const errorDetail = json?.error?.data?.details ?? json?.error?.message ?? json?.message ?? 'Sarvam call failed';
        throw new Error(errorDetail);
      }

      const providerId = json.attempt_id;

      await prisma.call.update({
        where: { id: call.id },
        data: { providerId },
      });

      await logEvent({
        orderId: ctx.orderId,
        level: 'L3',
        type: 'call.placed',
        label: `Hinglish call placed via Sarvam (${agentPhoneNumber}) — pre-dispatch`,
        meta: { attemptId: providerId },
      });

      return { ok: true, providerId };
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

export const voice = new VoiceService();

