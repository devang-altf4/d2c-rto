/* Export the parametric hoodie as a rigged .glb.
 *
 *   node tools/export-glb.mjs [size]        default M, writes assets/hoodie.glb
 *
 * The browser re-lofts this mesh for whatever size the shopper is looking at,
 * so the size baked in here only decides the bind pose. It is a real glTF
 * binary all the same — skinned, with an inverse-bind-matrix accessor — so it
 * opens in any viewer and can be swapped for a modelled garment later without
 * the renderer changing.
 *
 * Written by hand rather than through three's GLTFExporter because the export
 * runs in Node with no DOM, and the format's binary layout is short enough
 * that a dependency costs more than it saves.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildHoodie, bindPose, specFromRow, BONES, BONE } from '../garment3d.js';
import { SIZE_CHART } from '../tryon.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '..', 'assets', 'hoodie.glb');

const wanted = (process.argv[2] || 'M').toUpperCase();
const row = SIZE_CHART.find((r) => r.size === wanted);
if (!row) {
  console.error(`no such size ${wanted}; have ${SIZE_CHART.map((r) => r.size).join(', ')}`);
  process.exit(1);
}

const spec = specFromRow(row);
const mesh = buildHoodie(spec);
const bind = bindPose(spec);

/* ------------------------------------------------------------ buffer build */

const chunks = [];
let offset = 0;
/** Append a typed array to the BIN chunk, 4-byte aligned, return its view. */
function view(arr, target) {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  const pad = (4 - (offset % 4)) % 4;
  if (pad) { chunks.push(new Uint8Array(pad)); offset += pad; }
  const v = { buffer: 0, byteOffset: offset, byteLength: bytes.byteLength };
  if (target !== undefined) v.target = target;
  chunks.push(bytes);
  offset += bytes.byteLength;
  return v;
}

const ARRAY_BUFFER = 34962, ELEMENT_ARRAY_BUFFER = 34963;
const FLOAT = 5126, UNSIGNED_INT = 5125, UNSIGNED_SHORT = 5123;

const bufferViews = [], accessors = [];
function accessor(arr, type, componentType, target, extra = {}) {
  const count = arr.length / { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[type];
  bufferViews.push(view(arr, target));
  accessors.push({
    bufferView: bufferViews.length - 1,
    componentType, count, type, ...extra,
  });
  return accessors.length - 1;
}

// min/max on POSITION is required by the spec — viewers use it for culling.
const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < mesh.position.length; i += 3) {
  for (let k = 0; k < 3; k++) {
    min[k] = Math.min(min[k], mesh.position[i + k]);
    max[k] = Math.max(max[k], mesh.position[i + k]);
  }
}

const aPos = accessor(mesh.position, 'VEC3', FLOAT, ARRAY_BUFFER, { min, max });
const aNrm = accessor(mesh.normal, 'VEC3', FLOAT, ARRAY_BUFFER);
const aUv = accessor(mesh.uv, 'VEC2', FLOAT, ARRAY_BUFFER);
const aJnt = accessor(mesh.joints, 'VEC4', UNSIGNED_SHORT, ARRAY_BUFFER);
const aWgt = accessor(mesh.weights, 'VEC4', FLOAT, ARRAY_BUFFER);
const aIdx = accessor(mesh.index, 'SCALAR', UNSIGNED_INT, ELEMENT_ARRAY_BUFFER);

/* Inverse bind matrices: bind pose is a pure translation per joint, so the
   inverse is a translation by the negated world position. Column-major. */
const ibm = new Float32Array(BONES.length * 16);
BONES.forEach((b, i) => {
  const p = bind[b.name];
  const m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -p[0], -p[1], -p[2], 1];
  ibm.set(m, i * 16);
});
const aIbm = accessor(ibm, 'MAT4', FLOAT);

/* ------------------------------------------------------------------- nodes */

// Joint nodes carry translations relative to their parent.
const nodes = BONES.map((b, i) => {
  const p = bind[b.name];
  const parent = b.parent < 0 ? [0, 0, 0] : bind[BONES[b.parent].name];
  const node = {
    name: b.name,
    translation: [p[0] - parent[0], p[1] - parent[1], p[2] - parent[2]],
  };
  const kids = BONES.map((c, j) => (c.parent === i ? j : -1)).filter((j) => j >= 0);
  if (kids.length) node.children = kids;
  return node;
});

const meshNodeIndex = nodes.length;
nodes.push({ name: 'hoodie', mesh: 0, skin: 0 });

const gltf = {
  asset: { version: '2.0', generator: 'H&K parametric hoodie (garment3d.js)' },
  scene: 0,
  scenes: [{ nodes: [0, meshNodeIndex] }],
  nodes,
  meshes: [{
    name: `hoodie-${spec.size}`,
    primitives: [{
      attributes: {
        POSITION: aPos, NORMAL: aNrm, TEXCOORD_0: aUv,
        JOINTS_0: aJnt, WEIGHTS_0: aWgt,
      },
      indices: aIdx,
      material: 0,
    }],
  }],
  skins: [{
    name: 'hoodie-rig',
    inverseBindMatrices: aIbm,
    skeleton: 0,
    joints: BONES.map((_, i) => i),
  }],
  materials: [{
    name: 'shell',
    doubleSided: true,
    pbrMetallicRoughness: {
      baseColorFactor: [0.894, 0.902, 0.906, 1],   // off white; tinted at runtime
      metallicFactor: 0.0,
      roughnessFactor: 0.86,
    },
  }],
  bufferViews,
  accessors,
  buffers: [{ byteLength: offset }],
};

/* ------------------------------------------------------------- GLB packing */

const enc = new TextEncoder();
let json = enc.encode(JSON.stringify(gltf));
const jsonPad = (4 - (json.length % 4)) % 4;
if (jsonPad) {
  const padded = new Uint8Array(json.length + jsonPad);
  padded.set(json);
  padded.fill(0x20, json.length);          // JSON chunk pads with spaces
  json = padded;
}

const bin = new Uint8Array(offset + ((4 - (offset % 4)) % 4));
{
  let o = 0;
  for (const c of chunks) { bin.set(c, o); o += c.length; }
}

const total = 12 + 8 + json.length + 8 + bin.length;
const out = new Uint8Array(total);
const dv = new DataView(out.buffer);
let o = 0;
dv.setUint32(o, 0x46546c67, true); o += 4;   // 'glTF'
dv.setUint32(o, 2, true); o += 4;
dv.setUint32(o, total, true); o += 4;
dv.setUint32(o, json.length, true); o += 4;
dv.setUint32(o, 0x4e4f534a, true); o += 4;   // 'JSON'
out.set(json, o); o += json.length;
dv.setUint32(o, bin.length, true); o += 4;
dv.setUint32(o, 0x004e4942, true); o += 4;   // 'BIN\0'
out.set(bin, o);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, out);

console.log(`\n  wrote ${OUT}`);
console.log(`  size ${spec.size}  shoulder ${spec.shoulderWidth}cm  chest ${row.chest}cm  length ${spec.bodyLength}cm`);
console.log(`  ${mesh.vertexCount} verts, ${mesh.index.length / 3} tris, ${BONES.length} bones`);
console.log(`  ${(total / 1024).toFixed(1)} KB\n`);
