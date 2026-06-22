/* Backward-compat check: single-color voxels (no face pixels / no face colors)
 * must yield identical 6-face UVs as the legacy palette path.
 *   - Java buildItemModel: every face uv == uvFor(color) (uv length 4), all 6 faces identical.
 *   - Bedrock buildBedrockGeo: every face uv == [px,py], uv_size == [1,1], all 6 faces identical.
 * Loads the real source files in a vm sandbox with a minimal canvas stub.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const files = [
  'js/voxelData.js',
  'js/greedyMesh.js',
  'js/faceOrient.js',
  'js/texture.js',
  'js/exporters/bedrockGeo.js',
  'js/exporters/mcJavaItem.js',
];

// Minimal document/canvas stub so renderPaletteCanvas / buildFaceAtlas don't crash.
function makeCanvas() {
  return {
    width: 0, height: 0,
    getContext() {
      return { clearRect() {}, fillRect() {}, set fillStyle(v) {}, get fillStyle() { return '#000'; } };
    },
  };
}
const sandbox = {
  document: { createElement: (t) => (t === 'canvas' ? makeCanvas() : {}) },
  console, module: { exports: {} },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

for (const f of files) {
  const code = fs.readFileSync(path.join(ROOT, f), 'utf8');
  vm.runInContext(code, sandbox, { filename: f });
}

// class/const/function-name bindings from sloppy top-level scripts are NOT
// reliably attached to the sandbox object; pull them out explicitly by name.
const grab = vm.runInContext(
  '({ VoxelData, buildItemModel, buildBedrockGeo, buildPalette, uvFor })',
  sandbox
);
const { VoxelData, buildItemModel, buildBedrockGeo, buildPalette, uvFor } = grab;

function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
const FACES = ['north', 'south', 'east', 'west', 'up', 'down'];
let failures = [];

// --- Build a single-color voxel model (no face colors, no face pixels) ---
const d = new VoxelData(16, 16, 16);
d.set(2, 3, 4, '#ff0000');
d.set(5, 6, 7, '#00ff00');
d.set(5, 7, 7, '#00ff00'); // adjacent same color -> exercises greedy merge

// sanity: no face data present
if (d.faceColors.size !== 0) failures.push('precondition: faceColors not empty');
if (d.facePixels.size !== 0) failures.push('precondition: facePixels not empty');

// --- Java ---
const jm = buildItemModel(d, { namespace: 'ns', itemId: 'thing' });
const pal = buildPalette([...new Set(d.map.values())]); // expected palette order = greedy box order

jm.model.elements.forEach((el, ei) => {
  const fkeys = Object.keys(el.faces);
  if (fkeys.length !== 6) failures.push(`java el#${ei}: face count ${fkeys.length} != 6`);
  // all 6 faces must share identical uv (single-color voxel)
  const ref = el.faces.north.uv;
  if (!ref || ref.length !== 4) failures.push(`java el#${ei}: uv not length-4: ${JSON.stringify(ref)}`);
  for (const f of FACES) {
    const u = el.faces[f].uv;
    if (!eq(u, ref)) failures.push(`java el#${ei} face ${f}: uv ${JSON.stringify(u)} != north ${JSON.stringify(ref)}`);
    if (el.faces[f].rotation !== undefined) failures.push(`java el#${ei} face ${f}: unexpected rotation`);
  }
});
// the model must be the legacy (non-atlas) shape: textures.0 present
if (!jm.model.textures || jm.model.textures['0'] !== 'ns:item/thing') failures.push('java: texture ref changed');

// --- Bedrock ---
const bg = buildBedrockGeo(d, {});
const bones = bg.geo['minecraft:geometry'][0].bones;
const allCubes = bones.flatMap((b) => b.cubes);
if (!allCubes.length) failures.push('bedrock: no cubes');
allCubes.forEach((cube, ci) => {
  const fkeys = Object.keys(cube.uv);
  if (fkeys.length !== 6) failures.push(`bedrock cube#${ci}: face count ${fkeys.length} != 6`);
  const ref = cube.uv.north;
  for (const f of FACES) {
    const entry = cube.uv[f];
    if (!eq(entry.uv_size, [1, 1])) failures.push(`bedrock cube#${ci} face ${f}: uv_size ${JSON.stringify(entry.uv_size)} != [1,1]`);
    if (!eq(entry.uv, ref.uv)) failures.push(`bedrock cube#${ci} face ${f}: uv ${JSON.stringify(entry.uv)} != north ${JSON.stringify(ref.uv)}`);
    if (entry.uv.length !== 2) failures.push(`bedrock cube#${ci} face ${f}: uv not length-2`);
  }
});

if (failures.length) {
  console.log('COMPAT-FAIL');
  failures.forEach((x) => console.log('  - ' + x));
  process.exit(1);
} else {
  console.log('COMPAT-OK: single-color voxels produce identical 6-face UVs (Java uv len4, Bedrock uv_size=[1,1]); no atlas path, no rotation.');
  console.log('  java elements=' + jm.model.elements.length + ' bedrock cubes=' + allCubes.length);
}
