import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { NextResponse } from 'next/server';
import skus from '../../../../../data/skus.json';

export const runtime = 'nodejs';
export const maxDuration = 60; // generation runs 15-30s; the platform default will cut it off

/**
 * Try-on preview.
 *
 * A generative edit, not a rendering of the actual garment — the model returns
 * *a* hoodie, not *this* hoodie with its exact print and hardware. That is fine
 * for a preview and not fine as a purchase promise, so the UI labels it and we
 * say so out loud rather than letting a judge discover it.
 *
 * CACHING IS NOT AN OPTIMISATION HERE, IT IS THE DEMO. A 15-30s round trip over
 * venue wifi, live on stage, is a lost pitch. Warm the cache during rehearsal
 * (POST with warm:true) and the on-stage call is a disk read.
 */

const CACHE = join(process.cwd(), '.tryon-cache');
const OPENAI = 'https://api.openai.com/v1/images/edits';

const key = (personB64: string, styleId: string) =>
  createHash('sha256').update(styleId).update(personB64).digest('hex').slice(0, 32);

function promptFor(styleName: string) {
  // Explicit about what must NOT change — identity drift is the usual failure
  // mode, and a preview that alters her face is worse than no preview.
  return [
    `Dress the person in the second image in this garment: ${styleName}.`,
    'Keep the person\'s face, hair, skin tone, body proportions, pose and the',
    'background exactly as they are. Replace only their upper-body clothing.',
    'Match the garment\'s colour, texture and length faithfully.',
    'Photographic, natural lighting consistent with the original photo.',
  ].join(' ');
}

export async function POST(req: Request) {
  const apiKey = process.env.OPENAI_API_KEY;

  let body: { personImage?: string; styleId?: string; warm?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'expected JSON' }, { status: 400 });
  }

  const { personImage, styleId } = body;
  if (!personImage || !styleId) {
    return NextResponse.json({ error: 'personImage and styleId required' }, { status: 400 });
  }

  const style = (skus as any[]).find((s) => s.styleId === styleId);
  if (!style) return NextResponse.json({ error: 'unknown style' }, { status: 404 });

  // Strip any data: prefix so the cache key is stable across clients.
  const raw = personImage.replace(/^data:image\/\w+;base64,/, '');

  await mkdir(CACHE, { recursive: true });
  const cacheFile = join(CACHE, `${key(raw, styleId)}.txt`);

  if (existsSync(cacheFile)) {
    return NextResponse.json({
      image: `data:image/png;base64,${await readFile(cacheFile, 'utf8')}`,
      cached: true,
    });
  }

  if (!apiKey) {
    return NextResponse.json(
      { error: 'OPENAI_API_KEY not set — try-on preview is disabled' },
      { status: 503 },
    );
  }

  try {
    const form = new FormData();
    form.append('model', 'gpt-image-1');
    form.append('prompt', promptFor(style.styleName));
    form.append('size', '1024x1536');
    form.append('n', '1');

    // Garment reference first, person second — the prompt refers to "the second
    // image". Skipped when the brand has no flat-lay, in which case the model
    // works from the style name alone and fidelity drops further.
    const flat = join(process.cwd(), 'public', 'products', `${styleId}.jpg`);
    if (existsSync(flat)) {
      form.append('image[]', new Blob([await readFile(flat)], { type: 'image/jpeg' }), 'garment.jpg');
    }
    form.append(
      'image[]',
      new Blob([Buffer.from(raw, 'base64')], { type: 'image/png' }),
      'person.png',
    );

    const res = await fetch(OPENAI, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });

    const json = (await res.json()) as any;
    if (!res.ok) {
      return NextResponse.json(
        { error: json?.error?.message ?? 'generation failed' },
        { status: res.status },
      );
    }

    const b64 = json?.data?.[0]?.b64_json;
    if (!b64) return NextResponse.json({ error: 'no image returned' }, { status: 502 });

    await writeFile(cacheFile, b64, 'utf8');
    return NextResponse.json({ image: `data:image/png;base64,${b64}`, cached: false });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'generation failed' },
      { status: 500 },
    );
  }
}
