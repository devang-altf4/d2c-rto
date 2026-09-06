# RTO — L1 accuracy layer

Three levels, one story. **L1** camera sizing before purchase, **L2** WhatsApp confirmation
after it, **L3** Hinglish voice call when that goes unanswered — L2 and L3 both fire
*before dispatch*, which is where their economics come from.

---

## The one rule

**The contract freezes at H1.** `packages/core/src/types.ts` and
`packages/db/prisma/schema.prisma` are written first and then left alone. Everyone codes
against them. Changing either means shouting in the group first, because someone else is
already building on it.

With three people and twenty-four hours, integration at H16 is the risk — not the camera.

---

## Ownership

| Who | Owns | Never touches |
| --- | --- | --- |
| **Hritik** | `apps/web`, `apps/embed`, `packages/widget`, `core/sizing.ts` | `packages/whatsapp`, `packages/voice` |
| **Rohit** | `packages/whatsapp`, `apps/web/app/api/whatsapp/*` | `core/sizing.ts`, `packages/voice` |
| **Devang** | `packages/voice`, `apps/web/app/api/voice/*` | `core/sizing.ts`, `packages/whatsapp` |

Shared and frozen: `packages/core/src/types.ts`, `packages/db/prisma/schema.prisma`.

---

## Nobody waits for anybody

Two things make the parallel work possible.

**Ports.** `WhatsAppPort` and `VoicePort` in `@rto/core` are interfaces. The ops UI depends
on the interface, never on the implementation, so it can be built while both are stubs.

**The event log.** Every workstream appends to `Event`; the ops timeline reads it. A level
that isn't built yet just produces no events — nothing breaks.

Seed the demo orders at H1 so Rohit and Devang have real rows immediately. Neither of them
should be blocked waiting on the camera.

---

## Layout

```
apps/
  web/        Next.js — diagnosis, PDP, ops, thesis        Hritik
  embed/      the iframe: camera, MediaPipe, sizing math   Hritik
packages/
  core/       FROZEN types, ports, sizing, risk scoring    shared
  db/         Prisma schema, client, seed                  shared
  widget/     widget.js — the 3KB script tag               Hritik
  whatsapp/   L2 — WhatsAppPort implementation             Rohit
  voice/      L3 — VoicePort implementation                Devang
data/         generated fixtures, committed, read-only
scripts/      generate.ts — the synthetic corpus
```

### Why two data stores

`data/*.json` holds the 45,000-order historical corpus, exchanges, garment specs and the
precomputed diagnosis. It never changes, so it doesn't need a database and can't be broken
by one. The diagnosis screen reads it directly.

Postgres holds only what moves during the demo — a dozen live orders and the event log.

---

## Setup

```bash
pnpm install
cp .env.example .env          # one shared Neon URL for all three of us
pnpm db:push
pnpm data:generate            # writes data/*.json, prints the recall number
pnpm db:seed
pnpm dev
```

---

## Widget architecture

A thin inline script that opens an iframe modal.

```
widget.js  (~3KB)   injects the button, reads product context, opens the iframe,
                    receives postMessage, selects the variant in the theme picker
/embed     (iframe) camera, MediaPipe, sizing math, our CSS — allow="camera"
```

**Never load MediaPipe on PDP render.** The button is 3KB; the model downloads when she
taps *Find my size*. Say that out loud in the demo — anyone with ecommerce background is
already thinking about page weight.

Serve `pose_landmarker_lite.task` from `apps/embed/public`, not a third-party CDN.

---

## Language

Build it as a widget. Don't pitch it as one — *"the widget is the easy half."* Use
"widget" and "script tag" only at the install moment; everywhere else it's the accuracy
layer. What's behind it is per-SKU garment spec reconciled against exchange outcomes, and
that's the part nobody has.

On the thesis slide the market layers are **Accuracy / Confirmation / Recovery** — words,
never numbers, so they don't collide with our own L1/L2/L3.

---

## The storefront

`/shop` is the demo store — a fictional label called Kaira selling the 180 generated
styles. It exists so the widget is demonstrated on something that looks like a shop
rather than a wireframe, because "install a script tag on your PDP" is a claim a judge
should be able to check with view-source.

```
app/shop/layout.tsx      store chrome, scoped palette in store.css
app/shop/page.tsx        index, ordered by learned offset
app/shop/[slug]/         product page — the widget's host
app/shop/catalogue.ts    ONE ordering, shared by the index and generateStaticParams
app/shop/lookbook.ts     styleId -> photograph, deterministic
public/products/         twelve licensed lookbook plates
```

Two things on the PDP are load-bearing for the embed and must not be renamed:
`window.__RTO_PRODUCT`, and the `.product-form__input--size` wrapper that `SizePicker`
renders. widget.js finds its anchor by that class and hangs its button off the parent,
so the chips get their own wrapper — put the CTA inside it and the injected button lands
under the wrong control.

The catalogue is generated, so no photograph of any style exists. Twelve licensed plates
stand in, assigned by a hash of the styleId so a style shows the same image on the index,
the product page and in the widget. Provenance is in `public/products/README.txt`.
Say that out loud too, alongside "synthetic".

## Live garment preview

The capture screen draws a garment on her as soon as a pose is found, before the
gate passes, because seeing it is what makes her stand still long enough to be
measured. Colour swatches sit over the camera view and re-tint it live.

`app/embed/garment.ts` holds the renderer, `public/products/garment-kurta.png`
the plate. It is a keyed photograph — real fabric, folds, collar and buttons —
tinted per colourway with a multiply pass, anchored to the shoulder line and
rotated with it.

**It is rigid.** It scales and rotates with the shoulders but the sleeves cannot
follow the arms, so it holds while she stands and breaks if she raises them.
Nothing in the measurement depends on it: that still comes from `worldLandmarks`
and her stated height. Say "preview" out loud, the same as for `/api/tryon`.

One plate stands in for all 180 styles. Rebuilding it from a different source is
documented in the header comment of `garment.ts`.

### Two stages, deliberately

The canvas composite is instant and on-device. `/api/tryon` is photoreal and
takes 15-30s cold. So the composite carries the moment and the generative render
is offered after the size is decided, from **the frame she was measured in** —
PoseCapture hands that frame to Result, so nobody is asked to go and find a
full-length photo of themselves mid-checkout. The cross-brand path has no frame,
and there the upload prompt still appears.

Warm the cache in rehearsal (`pnpm tryon:warm`) or the render is a 30s hole in
the demo.

## Demo data

Synthetic, with failure modes injected deliberately so ground truth is known. Fourteen of
the 180 styles carry a size chart that runs small. `scripts/generate.ts` prints the recall
our ranking achieves against that truth — **put the real number on the slide, not a round
one.**

Say "synthetic" out loud during the demo.
# d2c-rto
