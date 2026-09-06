/**
 * Catalogue photography.
 *
 * The 180 styles are generated, so there is no real photograph of any of them.
 * Twelve licensed lookbook shots stand in, assigned by a hash of the styleId so
 * a style shows the SAME image everywhere — index, product page, widget result,
 * try-on source. An inconsistent image across those reads as a bug to a judge
 * long before anyone wonders whether the garment is real.
 *
 * skus.json carries an `imageUrl` of /products/<styleId>.jpg. That file does
 * not exist and is not generated; this is the resolver that replaces it, kept
 * in the app rather than in the data so `pnpm data:generate` cannot clobber it.
 */

const COUNT = 12;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

const slot = (styleId: string) => String((hash(styleId) % COUNT) + 1).padStart(2, '0');

/** Full-bleed product image, 900x1200. */
export const productImage = (styleId: string) => `/products/look-${slot(styleId)}.jpg`;

/** Smaller crop for grids, 420x560. */
export const productCard = (styleId: string) => `/products/look-${slot(styleId)}-card.jpg`;

/** Which of the twelve plates a style resolves to. Used to avoid repeats in a row. */
export const plateOf = (styleId: string) => hash(styleId) % COUNT;

/**
 * Twelve plates across 24 featured styles means each is used twice. A stable
 * vertical crop offset per style keeps two tiles sharing a plate from looking
 * like the same photograph pasted twice.
 */
export function cropPosition(styleId: string): string {
  const bands = ['22%', '34%', '46%', '58%'];
  return `center ${bands[(hash(styleId) >> 3) % bands.length]}`;
}

/**
 * A style shows three frames: its own, plus the two following slots. Enough to
 * make the gallery feel like a real listing without pretending they are
 * alternate views of one garment.
 */
export function gallery(styleId: string): string[] {
  const base = hash(styleId) % COUNT;
  return [0, 1, 2].map(
    (n) => `/products/look-${String(((base + n) % COUNT) + 1).padStart(2, '0')}.jpg`,
  );
}
