import skus from '../../../../data/skus.json';

/**
 * One ordering, shared by the index and by generateStaticParams.
 *
 * They used to disagree: the index listed the 24 styles with the largest
 * learned offset while the params prerendered the first 24 by insertion order,
 * so most tiles on the index linked to a page that had not been built.
 */
export const FEATURED = 24;

export interface Style {
  styleId: string;
  styleName: string;
  mrpPaise: number;
  learnedOffsetCm: number;
  [k: string]: unknown;
}

export function featuredStyles(limit = FEATURED): Style[] {
  const seen = new Map<string, Style>();
  for (const s of skus as unknown as Style[]) if (!seen.has(s.styleId)) seen.set(s.styleId, s);
  return [...seen.values()]
    .sort((a, b) => b.learnedOffsetCm - a.learnedOffsetCm)
    .slice(0, limit);
}

/** Every size row for one style, smallest first. */
export function ladder(styleId: string): Style[] {
  const order = ['XS', 'S', 'M', 'L', 'XL'];
  return (skus as unknown as Style[])
    .filter((s) => s.styleId === styleId)
    .sort((a, b) => order.indexOf(String(a.size)) - order.indexOf(String(b.size)));
}
