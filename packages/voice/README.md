# L3 — Hinglish voice confirmation · Devang

You own `packages/voice` and `apps/web/app/api/voice/*`. Nothing else, and nobody else
touches these.

---

## What L3 is, in one paragraph

A shopper places a COD order. **L1** (camera sizing) either didn't run or she ignored it.
**L2** sends her a WhatsApp asking her to confirm. She doesn't reply. **L3 is your call** —
a Hinglish voice agent that rings her *before we dispatch*, asks one question, and records
the answer.

**Before dispatch is the whole point.** Nothing has shipped yet, so a cancel here costs us
nothing and a confirm de-risks the parcel. The incumbents (HillTeck, ClickPost) call *after*
a delivery has already failed — ₹5–15 a call, and the freight is already spent. Ours is
₹2–4 and saves the outbound leg too. If a judge asks, that's the answer.

You are **not** building an NDR desk. We say out loud that recovery-after-failure is
somebody else's layer.

---

## Where your context comes from

This is the important bit. You never assemble order details yourself.

```ts
import { buildConfirmationContext } from '@rto/db';

const ctx = await buildConfirmationContext(orderId);
// -> ConfirmationContext | null
```

`ConfirmationContext` is frozen in `packages/core/src/types.ts`:

```ts
{
  orderId, humanId,          // "KA-2401" — say this on the call
  customerName,              // first name only
  phone,                     // E.164
  styleName,                 // "Anaya Cotton Kurta"
  size,                      // "M"
  amountPaise,               // 145000 -> ₹1450
  paymentMode,               // "COD" | "PREPAID"
  recommendedSize?           // present ONLY when L1 disagreed with her choice
}
```

`recommendedSize` is what makes this call worth making. When it's set, L1 measured her and
thinks she picked wrong — so the agent can say *"humein lagta hai L better rahega"* instead
of a generic confirmation. When it's absent, just confirm.

Rohit's WhatsApp calls the same function, so you and he say the same things about the same
order. **If a field is missing, add it to `buildConfirmationContext`, not to your channel.**

### Getting real data right now, without waiting for anyone

`data/demo-orders.json` already exists — twelve pre-scored orders with names, phones,
styles, sizes and a fit-risk breakdown. Point `DEMO_PHONE` in `.env` at your own handset and
you can build and test the entire call flow before L1 or the ops UI exist.

```bash
pnpm data:generate   # already run, but it's deterministic
cat data/demo-orders.json | head -40
```

---

## Your contract

Implement `VoicePort`. That's the only thing the rest of the codebase knows about you.

```ts
export interface VoicePort {
  placeConfirmationCall(ctx: ConfirmationContext): Promise<OutboundResult>;
}
```

The ops UI imports the *interface*, never your implementation, so you can rewrite the
internals whenever you like. `packages/voice/src/index.ts` has a working skeleton.

### Writes you own

| Table | When |
| --- | --- |
| `Call` | one row per attempt — `providerId`, `outcome`, `durationSec`, `transcript` |
| `Event` | `call.placed`, `call.completed`, `call.no_answer` |
| `Order.status` | `CONFIRMED` or `CANCELLED` on a clear answer |

Always append to `Event` via `logEvent()` — the ops timeline renders directly from it, and
it's how the demo shows your level working. A call that doesn't log an event is invisible
on stage.

---

## Vapi setup

Do this first, before writing any orchestration. It's the part with external latency.

1. Vapi account, provision an outbound number
2. Create the assistant, copy the ID into `.env`
3. **Test call to your own phone from the Vapi dashboard** — prove the pipe works before
   any of our code is involved

```bash
VAPI_API_KEY=""
VAPI_ASSISTANT_ID=""
VAPI_PHONE_NUMBER_ID=""
DEMO_PHONE="+9198XXXXXXXX"
```

Verify request/response shapes against the current Vapi docs — the sketch in
`src/index.ts` is a starting point, not gospel.

### Voice

Use an **Indian-English voice**, not a US one. An American accent confirming a COD kurta
order reads as a tech demo; Hinglish reads as something that ships. This is worth more
demo points than any code you write today.

### System prompt

```
You are Kaira's order confirmation assistant. Kaira is an Indian womenswear brand.

Speak natural Hinglish — Hindi sentence structure with English for product and
commerce words (order, size, confirm, cancel, delivery). Never pure formal Hindi,
never pure English.

YOU HAVE EXACTLY ONE JOB: find out whether she still wants this order.

Order: {{style}}, size {{size}}, ₹{{amount}}, cash on delivery. Order ID {{orderId}}.

Rules:
- Keep it under 45 seconds. This is a confirmation, not a conversation.
- Do NOT upsell, do NOT offer discounts, do NOT negotiate.
- If she confirms, thank her and end the call.
- If she cancels, accept it immediately and warmly. A clean cancel before
  dispatch is a good outcome for us — never talk her out of it.
- If she is unsure about size and {{recommendedSize}} is set, say we'd suggest
  {{recommendedSize}} for this style and offer to change it.
- If she says she's busy, offer to send it on WhatsApp and end.
- If it's the wrong person, apologise and end.
- Never invent delivery dates, prices, offers or policies.
```

`firstMessage` is already drafted in `src/index.ts`.

### Structured outcome

Have Vapi extract the outcome rather than parsing the transcript yourself. Map it to:

```
CONFIRMED | CANCELLED | SIZE_CHANGED | NO_ANSWER | VOICEMAIL | FAILED
```

Set `endCallPhrases` so it hangs up cleanly instead of trailing off.

---

## Webhook

`apps/web/app/api/voice/webhook/route.ts` — Vapi posts an end-of-call report.

```ts
export const runtime = 'nodejs';   // required — Prisma does not run on edge
```

Update the `Call` row, append the event, set `Order.status`. Keep it defensive: if the
payload shape surprises you, log it and return 200. A webhook that throws during the demo
is worse than one that silently records nothing.

---

## Demo-day rules

**One job.** A voice agent attempting open conversation over conference wifi is how demos
die. Confirm or cancel, nothing else.

**Fail gracefully.** No answer after ~20 seconds → log `call.no_answer`, fall back to SMS,
move on. Never let the UI hang waiting on a call.

**You are first on the cut ladder.** If we're behind at H17, L3 gets cut to one screenshot
and one sentence. That's not a judgement on your work — it's the highest-variance piece on
the board and we decided in advance rather than at 3am. So:

> **Take a clean screenshot of a completed call — timeline, transcript, outcome — as soon
> as it works.** Well before H17. That screenshot is the fallback, and having it early is
> what lets you keep building without risk.

---

## Your track

You start at H0, not H16 — the run sheet's hour numbers are for the serial critical path,
and you're parallel to it.

| Hour | What |
| --- | --- |
| H0–H1 | Vapi account, number, assistant, dashboard test call to your phone |
| H1–H2 | `pnpm install`, `.env`, `pnpm db:push`, read `data/demo-orders.json` |
| H2–H4 | `placeConfirmationCall` end to end — your phone rings from our code |
| H4–H5 | Webhook, outcome mapping, `Event` writes |
| H5–H6 | Hinglish prompt tuning. Call yourself ten times. This is where the points are. |
| **H6** | **Screenshot the working call. Post it in the group.** |
| H6+ | Help with the ops timeline or the thesis screen |

---

## Test without depending on anyone

```bash
npx tsx -e "
  import { voice } from './packages/voice/src/index';
  voice.placeConfirmationCall({
    orderId: 'test', humanId: 'KA-2401',
    customerName: 'Ananya', phone: process.env.DEMO_PHONE!,
    styleName: 'Anaya Cotton Kurta', size: 'M',
    amountPaise: 145000, paymentMode: 'COD',
    recommendedSize: 'L',
  }).then(console.log);
"
```

If your phone rings and the agent speaks Hinglish, you're done with the hard part.

---

## Things that will cost you an hour if nobody warns you

- **Prisma on edge runtime silently fails.** `export const runtime = 'nodejs'` in every
  route that touches the DB.
- **E.164 or nothing.** `+919876543210`, not `9876543210`.
- **Outbound to Indian mobiles** can be slow to connect. Test on the venue network before
  you trust it on stage.
- **Don't touch** `core/sizing.ts` or `packages/whatsapp`. If you need something from
  either, ask — merge conflicts at hour 18 are the actual enemy here.
