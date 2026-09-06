/* Parse the exported .glb with the REAL GLTFLoader, so the check is that a
   glTF consumer accepts it — not that my writer agrees with itself. */
import { readFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const P = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// GLTFLoader needs a few browser globals even for an ArrayBuffer parse.
Object.defineProperty(globalThis, 'self', { value: globalThis, configurable: true });
globalThis.TextDecoder = TextDecoder;
globalThis.createImageBitmap = undefined;
globalThis.document = { createElementNS: () => ({ style: {} }), createElement: () => ({ style: {} }) };

const THREE = await import(P + '/vendor/three/three.module.js');
const { GLTFLoader } = await import(P + '/vendor/three/GLTFLoader.js');

const buf = readFileSync(P + '/assets/hoodie.glb');
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

const gltf = await new Promise((res, rej) =>
  new GLTFLoader().parse(ab, '', res, rej));

console.log('\n  GLTFLoader accepted the file.\n');
let skinned = null, meshes = 0;
gltf.scene.traverse((o) => {
  if (o.isSkinnedMesh) { skinned = o; meshes++; }
  else if (o.isMesh) meshes++;
});
if (!skinned) { console.log('  NO SKINNED MESH — sleeves could not follow arms'); process.exit(1); }

const g = skinned.geometry;
const attr = Object.keys(g.attributes).sort().join(', ');
console.log(`  meshes                ${meshes} (skinned: yes)`);
console.log(`  attributes            ${attr}`);
console.log(`  vertices              ${g.attributes.position.count}`);
console.log(`  triangles             ${g.index.count / 3}`);
console.log(`  bones in skeleton     ${skinned.skeleton.bones.length}`);
console.log(`  bone names            ${skinned.skeleton.bones.map((b) => b.name).join(', ')}`);
console.log(`  inverse bind matrices ${skinned.skeleton.boneInverses.length}`);

g.computeBoundingBox();
const bb = g.boundingBox;
const d = (n) => n.toFixed(1).padStart(7);
console.log(`\n  bounds (cm)  x ${d(bb.min.x)} .. ${d(bb.max.x)}   width  ${d(bb.max.x - bb.min.x)}`);
console.log(`               y ${d(bb.min.y)} .. ${d(bb.max.y)}   height ${d(bb.max.y - bb.min.y)}`);
console.log(`               z ${d(bb.min.z)} .. ${d(bb.max.z)}   depth  ${d(bb.max.z - bb.min.z)}`);

// Every vertex must be fully weighted, or it collapses toward the origin.
const w = g.attributes.skinWeight;
let bad = 0, minSum = Infinity;
for (let i = 0; i < w.count; i++) {
  const s = w.getX(i) + w.getY(i) + w.getZ(i) + w.getW(i);
  minSum = Math.min(minSum, s);
  if (Math.abs(s - 1) > 1e-3) bad++;
}
console.log(`\n  skin weights          ${bad === 0 ? 'all sum to 1' : bad + ' VERTICES NOT NORMALISED'} (min ${minSum.toFixed(4)})`);

// Joint indices must be inside the skeleton.
const j = g.attributes.skinIndex;
let oob = 0;
for (let i = 0; i < j.count; i++)
  for (const k of ['getX', 'getY', 'getZ', 'getW'])
    if (j[k](i) >= skinned.skeleton.bones.length) oob++;
console.log(`  joint indices         ${oob === 0 ? 'all in range' : oob + ' OUT OF RANGE'}`);

// Non-manifold check: every edge should be shared by exactly two triangles.
const edges = new Map();
const ix = g.index.array;
for (let i = 0; i < ix.length; i += 3) {
  for (const [a, b] of [[ix[i], ix[i+1]], [ix[i+1], ix[i+2]], [ix[i+2], ix[i]]]) {
    const key = a < b ? `${a}_${b}` : `${b}_${a}`;
    edges.set(key, (edges.get(key) || 0) + 1);
  }
}
const boundary = [...edges.values()].filter((n) => n === 1).length;
const weird = [...edges.values()].filter((n) => n > 2).length;
console.log(`  mesh                  ${boundary} boundary edges, ${weird} edges shared by >2 tris`);
console.log('');
