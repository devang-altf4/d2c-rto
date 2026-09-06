# H&K — apparel try-on

A fictional H&M-style storefront that exists to host Opentra's L1 fit layer for
apparel. Judges point a camera at themselves, see the hoodie on their body, and
get a size that came from a measurement rather than a guess.

**H&K is not a real brand.** The product, price and copy are scaffolding.

## Run

```bash
pnpm tryon          # http://127.0.0.1:5174/
pnpm tryon:https    # https://<lan-ip>:5174/  (phones)
```

Run from the repo root. It is a static page plus a small Python server — no
install step, no node_modules. Python 3 and `requests` are the only
requirements, and `requests` is needed only for the photoreal try-on call;
everything else works without it.

`getUserMedia` needs a secure origin. `localhost` counts, so the laptop webcam
works with plain http; a phone on the LAN needs `--https`, which generates a
self-signed cert with the LAN IP in its SAN. The phone warns once —
**Advanced → Proceed** — and the camera will not start until you accept.

## If there is no camera

`NotFoundError` means the browser found no camera device — on Linux, check with
`ls /dev/video*`. Two ways round it:

- **Open the page on your phone.** `npm run tryon:https`, accept the certificate
  warning, and the rear/front camera works. This is the demo path anyway.
- **Use a photo.** The panel has *No camera? Use a photo* — it runs the same
  model and the same arithmetic on a single still. Drop a file in
  `assets/sample.jpg` and a **Use sample photo** button appears next to it.

A still gives one frame, so there is no spread to check the reading against. The
panel says so, and the telemetry marks it **Single-frame measurement** rather
than passing it off as a stabilised one.

## The demo

1. **Try it on & find your size** opens the camera.
2. Pose landmarks find the shoulder line; the hoodie is composited onto the
   torso, and the sleeves follow the elbows and wrists.
3. Tap a swatch mid-scan — the garment changes colour on the body.
4. Hold still: the shoulder measurement stabilises and locks.
5. **Use M** drops the size into the product page.

Then pick a different size by hand. The fit note flips to **Size overridden**
and the Opentra panel flags it for dispatch. That override is the L1 signal, and
it is the thing no apparel stack records today.

## How the size is derived

Same idea as the footwear gauge this grew out of: a reference of known size in
the frame converts pixels to millimetres. There the reference is an A4 sheet.
Here it is the wearer, and there are two candidates depending on how she is
standing. The panel says which one it used.

**Height (preferred, ~1-2%).** She gives her height on the slider and stands
back far enough for her feet to be in frame. Nose-to-ankle is 0.89 of stature,
so worldLandmarks give a span to scale against:

```
cm/unit    = height / (nose-to-ankle world span / 0.89)
mm/px      = shoulder world width x cm/unit x 10 / shoulder px
```

The ratio is taken in world space and transferred to pixels through the
shoulder line, not measured vertically in the image — feet are further from the
lens than the face, so an image-space nose-to-ankle count reads short and would
inflate everything derived from it.

**Eye line (fallback, ~5.6%).** No height, or no feet in frame — which is the
natural way to look at a hoodie on yourself. All that is left is
**interpupillary distance, 63 mm mean in adults, SD 3.5 mm**:

```
mm/px      = 63 / eye-to-eye px
```

Either way:

```
shoulder   = shoulder-landmark px x mm/px x 1.10   (pose shoulders sit inside the acromion)
size       = nearest row in SIZE_CHART, steps of 2.5 cm
```

The gap between the two matters more than it looks. Someone whose eyes sit
5 mm off the population mean — about 1.4 SD, so roughly one person in six on
each side — reads **3-4 cm out** on the shoulder from the eye line alone. The
size step is 2.5 cm, so that is a whole size, and it is a confident wrong
answer rather than a visible failure. From height, the same subject reads
exact. Switching reference mid-scan resets the stabiliser, because medianing
two different rulers together is worse than either.

Readings run through a rolling median over 24 frames and only lock once the
p10–p90 spread is under 12 mm, so one bad frame cannot move the recommendation.
Frames where the head is turned are rejected outright — yaw foreshortens the eye
line, which would silently shrink every measurement taken from it.

## Files

| File | What it is |
|---|---|
| `hoodie.js` | The garment: the keyed studio plate for try-on, plus a drawn fallback geometry. |
| `tryon.js` | Pose engine, height/IPD scaling, size chart, rolling-median stabiliser. |
| `index.html` | The storefront, the try-on panel and the Opentra telemetry panel. |
| `assets/*.jpg` | Product photography, one shot per colourway, cropped to 3:4. |
| `assets/garment.png` | The hoodie keyed out of the off-white studio shot — the try-on plate. |
| `vendor/` | MediaPipe tasks-vision + `pose_landmarker_lite`, ~24 MB, committed so the demo runs with the venue wifi down. |

## Imagery

All photography is from **Unsplash**, whose licence permits free commercial use
with no attribution required. Source photo IDs, in case you want to swap or
credit them:

| Colourway | Unsplash ID |
|---|---|
| Off white | `Cglj4LP4GTQ` |
| Black | `a35WWchZgyc` |
| Ecru | `IGrpkZBFiHU` |
| Cobalt | `ueyd8R3Gmqo` |
| Clay | `ikLELWYbyxk` |
| Grey marl | `HRNDJkOGZ9Q` |

`garment.png` is cut from the off-white shot: a luminance key against the plain
studio background, largest blob kept, interior holes filled, alpha feathered.
The plate is near-white, so a `multiply` pass tints it into every other
colourway while keeping the real folds and shading. The shoulder seam sits at
row 20, centre x 156, width 222 px — that is the anchor the overlay scales and
rotates around.

## Photo vs Outline

The try-on panel has a **Garment** toggle:

- **Photo** (default) — the keyed studio plate. Real fabric, folds, drawstrings
  and pocket. Rigid: it scales and rotates with the shoulder line, but the
  sleeves cannot follow the arms, so raising them breaks the illusion.
- **Outline** — the drawn garment. Cartoonish, but the sleeves track elbows and
  wrists, so it survives movement.

Photo sells it standing still; Outline survives someone waving.

## Known limits

- **IPD varies, when it is what we fall back to.** Mean 63 mm, SD about 3.5 mm,
  so the eye line carries roughly 5% error before anything else — which is a
  size step, not a rounding error. Giving a height and stepping back removes
  this entirely; the panel nudges toward that and labels the reading when it
  cannot.
- **Self-reported height is trusted.** It is the scale, so an inch of vanity
  propagates straight into the shoulder figure at about 1.5%. Still far better
  than the eye line, and unlike the eye line it is a number she can correct.
- **Shoulder width alone does not decide apparel fit.** Chest girth and body
  length matter as much and neither is visible in one frontal view.
- **Single-theme by design.** A dark product page hides a black garment on a
  black ground, so this page commits to the white-store look.
- The garment is drawn, not photographed, and it does not drape, wrinkle or
  occlude the hands. It reads as a fit preview, not a photoreal composite.
