/**
 * Live garment overlay.
 *
 * A keyed photograph of a real kurta, anchored to the shoulder line and drawn
 * over the camera feed every frame. Not a rendering of the style she is looking
 * at — one plate stands in for all of them — so the UI labels it a preview, the
 * same way /api/tryon does.
 *
 * Why a photograph and not a drawn shape: fabric, folds, buttons and a collar
 * are what make it read as clothing rather than a diagram, and none of them
 * survive being redrawn as vectors.
 *
 * The plate is near-white, so a multiply pass tints it into any colourway while
 * keeping the shading. The neck opening is transparent, so the wearer's own
 * neck shows through instead of the model's.
 *
 * How the plate was made, in case it needs rebuilding: the source is a kurta
 * shot against a black seamless. Keying is a luminance threshold plus a warm
 * test (r-b) so skin is dropped rather than filled over. The model stands
 * three-quarter turned, which reads as a person pasted at an angle onto a
 * front-facing wearer, so the camera-side half is mirrored about the placket to
 * synthesise a symmetric front view. It is cut just above the model's hands —
 * they punched two holes straight through the middle of the mirrored garment —
 * and the hem is feathered because that cut is not where the garment ends.
 *
 * LIMIT WORTH SAYING OUT LOUD: this is rigid. It scales and rotates with the
 * shoulder line but the sleeves cannot follow the arms, so it holds while she
 * stands and breaks if she raises them. The measurement underneath does not
 * depend on it.
 */

export interface Colourway {
  id: string;
  name: string;
  swatch: string;
  /** Multiply colour. Undefined keeps the plate's own ivory. */
  tint?: string;
}

export const COLOURWAYS: Colourway[] = [
  { id: 'ivory',    name: 'Ivory',    swatch: '#EFEAE0' },
  { id: 'indigo',   name: 'Indigo',   swatch: '#35507F', tint: '#4A69A0' },
  { id: 'madder',   name: 'Madder',   swatch: '#9B3A3A', tint: '#B85252' },
  { id: 'sage',     name: 'Sage',     swatch: '#7E8C6A', tint: '#98A784' },
  { id: 'marigold', name: 'Marigold', swatch: '#C8892E', tint: '#DDA24A' },
  { id: 'charcoal', name: 'Charcoal', swatch: '#3A3A3C', tint: '#5C5C5F' },
];

/** Measured off the alpha channel of the keyed plate. */
const PLATE = {
  src: '/products/garment-kurta.png',
  shoulderY: 70,
  shoulderCX: 245,
  shoulderW: 403,
};

/** Garment is cut wider than the body it hangs on. */
export const EASE = 1.14;

let image: HTMLImageElement | null = null;
let failed = false;
const tints = new Map<string, HTMLCanvasElement>();

export function loadPlate(): Promise<boolean> {
  if (image) return Promise.resolve(true);
  if (failed) return Promise.resolve(false);
  return new Promise((resolve) => {
    const im = new Image();
    im.onload = () => { image = im; resolve(true); };
    im.onerror = () => { failed = true; resolve(false); };
    im.src = PLATE.src;
  });
}

export const plateReady = () => image !== null;

function surfaceFor(c: Colourway): CanvasImageSource | null {
  if (!image) return null;
  if (!c.tint) return image;
  const hit = tints.get(c.id);
  if (hit) return hit;

  const cv = document.createElement('canvas');
  cv.width = image.width;
  cv.height = image.height;
  const g = cv.getContext('2d')!;
  g.drawImage(image, 0, 0);
  g.globalCompositeOperation = 'multiply';
  g.fillStyle = c.tint;
  g.fillRect(0, 0, cv.width, cv.height);
  // multiply painted the transparent margin too; clip back to the plate's alpha
  g.globalCompositeOperation = 'destination-in';
  g.drawImage(image, 0, 0);
  g.globalCompositeOperation = 'source-over';
  tints.set(c.id, cv);
  return cv;
}

export interface DrawnGarment {
  shoulderPx: number;
  angleRad: number;
}

/**
 * @param lm    image-space landmarks, normalised 0..1
 * @param w,h   canvas size in pixels (the video's natural size)
 */
export function drawGarment(
  ctx: CanvasRenderingContext2D,
  lm: { x: number; y: number; visibility?: number }[],
  w: number,
  h: number,
  colourId: string,
): DrawnGarment | null {
  if (!image || lm.length < 25) return null;

  const c = COLOURWAYS.find((x) => x.id === colourId) ?? COLOURWAYS[0];
  const surface = surfaceFor(c);
  if (!surface) return null;

  const ls = lm[11];
  const rs = lm[12];
  if (!ls || !rs) return null;
  if ((ls.visibility ?? 1) < 0.5 || (rs.visibility ?? 1) < 0.5) return null;

  const lx = ls.x * w, ly = ls.y * h;
  const rx = rs.x * w, ry = rs.y * h;
  const shoulderPx = Math.hypot(lx - rx, ly - ry);
  if (shoulderPx < 24) return null;

  const midX = (lx + rx) / 2;
  const midY = (ly + ry) / 2;
  const angleRad = Math.atan2(ly - ry, lx - rx);
  const scale = (shoulderPx * EASE) / PLATE.shoulderW;

  ctx.save();
  ctx.translate(midX, midY);
  ctx.rotate(angleRad);
  ctx.scale(scale, scale);
  ctx.drawImage(surface, -PLATE.shoulderCX, -PLATE.shoulderY);
  ctx.restore();

  return { shoulderPx, angleRad };
}
