/**
 * Warm the try-on cache before the demo.
 *
 *   npx tsx scripts/warm-tryon.ts ./me.jpg KAI-110 KAI-118
 *
 * Generation takes 15-30s. Doing that live, on venue wifi, in front of judges,
 * is a lost pitch. Run this during rehearsal with the exact photo you will
 * upload on stage and the on-stage call becomes a disk read.
 *
 * The cache key is a hash of the photo bytes plus the style id, so it only
 * hits if you upload the SAME file. Use the same one.
 */

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const [photo, ...styleIds] = process.argv.slice(2);
const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

if (!photo || !styleIds.length) {
  console.error('usage: tsx scripts/warm-tryon.ts <photo.jpg> <styleId> [styleId...]');
  process.exit(1);
}

const personImage = readFileSync(photo).toString('base64');
console.log(`\n  photo   ${basename(photo)}`);
console.log(`  target  ${base}\n`);

for (const styleId of styleIds) {
  const t = Date.now();
  process.stdout.write(`  ${styleId}  … `);
  try {
    const res = await fetch(`${base}/api/tryon`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personImage, styleId }),
    });
    const json = (await res.json()) as any;
    if (!res.ok) {
      console.log(`FAILED — ${json.error}`);
      continue;
    }
    console.log(`${json.cached ? 'already cached' : 'generated'} in ${((Date.now() - t) / 1000).toFixed(1)}s`);
  } catch (e) {
    console.log(`FAILED — ${e instanceof Error ? e.message : e}`);
  }
}

console.log('\n  Upload the same file on stage and it is instant.\n');
