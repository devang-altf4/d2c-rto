import { NextResponse } from 'next/server';
import skus from '../../../../../../data/skus.json';

export const runtime = 'nodejs';

/** The garment ladder for one style, plus the offset learned from exchanges. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ styleId: string }> },
) {
  const { styleId } = await params;
  const ladder = (skus as any[]).filter((s) => s.styleId === styleId);
  if (!ladder.length) return NextResponse.json({ error: 'unknown style' }, { status: 404 });

  return NextResponse.json({
    styleId,
    styleName: ladder[0].styleName,
    lengthCm: ladder[0].lengthCm,
    specs: ladder.map((s) => ({
      skuId: s.id, styleId: s.styleId, styleName: s.styleName, size: s.size,
      chestCm: s.chestCm, easeCm: s.easeCm, learnedOffsetCm: s.learnedOffsetCm,
    })),
  });
}
