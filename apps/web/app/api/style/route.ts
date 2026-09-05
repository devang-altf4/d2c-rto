import { NextResponse } from 'next/server';
import skus from '../../../../../data/skus.json';

export const runtime = 'nodejs';

/** Styles the demo storefront can show. Ones with a learned offset come first —
 *  those are where the M-becomes-L moment lives. */
export async function GET() {
  const seen = new Map<string, any>();
  for (const s of skus as any[]) if (!seen.has(s.styleId)) seen.set(s.styleId, s);
  const all = [...seen.values()].sort(
    (a, b) => b.learnedOffsetCm - a.learnedOffsetCm || a.styleId.localeCompare(b.styleId),
  );
  return NextResponse.json(all.slice(0, 24).map((s) => ({
    styleId: s.styleId, styleName: s.styleName,
    mrpPaise: s.mrpPaise, learnedOffsetCm: s.learnedOffsetCm,
  })));
}
