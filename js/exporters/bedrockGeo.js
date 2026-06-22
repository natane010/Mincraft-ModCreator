/* exporters/bedrockGeo.js
 * ボクセル -> Bedrock形式ジオメトリ(.geo.json, format_version 1.12.0)変換。
 * TaCZ と GeckoLib が共通で消費する。
 *
 * ・ボーン分割対応: opts.bones（[{name,pivot,parent}]）と opts.boneOf(x,y,z)->name
 *   が与えられたら、ボーンごとにボクセルを分けて greedyMeshing し、複数 bone を出力。
 *   未指定なら全ボクセルを単一の 'root' bone にまとめる（従来動作）。
 * ・テクスチャは全ボーン共通の1枚パレットPNG（色1つ=1テクセル）。
 * ・origin = 立方体の最小角（ボクセル座標そのまま。Bedrockは+8オフセット無し）
 *
 * 返り値: { geo, canvas, boxCount }
 */
const _GEO_FACES = ['north', 'south', 'east', 'west', 'up', 'down'];

/** opts から「ボーン名 -> そのボーンのboxes」を作る。
 * 面色を持つ voxel は greedyBoxes(色のみ結合)では面別UVが出せないため、
 * バケツから分離して faced（[x,y,z,body], ...）として個別に1cube出力する。
 * faced 判定は元 data 基準（バケツには面色をコピーしていないため）。 */
function _geoBoneGroups(data, opts) {
  const def = (opts.bones && opts.bones.length)
    ? opts.bones : [{ name: 'root', pivot: [0, 0, 0], parent: '' }];
  const names = def.map((b) => b.name);
  const boneOf = opts.boneOf || (() => names[0]);

  const buckets = {};   // 面色なし voxel のみ（従来通り greedyBoxes 対象）
  const faced = {};     // 面色あり voxel（個別 cube 対象）
  for (const n of names) { buckets[n] = new VoxelData(data.sx, data.sy, data.sz); faced[n] = []; }
  for (const [x, y, z, c] of data.entries()) {
    let n = boneOf(x, y, z);
    if (!buckets[n]) n = names[0];
    if (data.hasFace(x, y, z)) faced[n].push([x, y, z, c]);
    else buckets[n].set(x, y, z, c);
  }
  return def.map((b) => ({
    name: b.name, pivot: b.pivot || [0, 0, 0], parent: b.parent || '',
    boxes: greedyBoxes(buckets[b.name]),
    faced: faced[b.name],
  }));
}

function buildBedrockGeo(data, opts) {
  opts = opts || {};
  const s = opts.unitScale || 1; // 1ボクセルあたりの model 単位（細かい造形用）
  const groups = _geoBoneGroups(data, opts);

  // 全ボーンの色を集めて共有パレットを作る（既存色＝boxes本体色を先に並べ、面色を後ろに追加）
  const colorSet = [];
  const seen = new Set();
  const addColor = (c) => { if (c != null && !seen.has(c)) { seen.add(c); colorSet.push(c); } };
  groups.forEach((g) => g.boxes.forEach((b) => addColor(b.color)));
  groups.forEach((g) => g.faced.forEach(([x, y, z, c]) => {
    addColor(c);
    const fc = data.facesOf(x, y, z);
    for (const f of _GEO_FACES) if (fc[f] !== undefined) addColor(fc[f]);
  }));
  const palette = buildPalette(colorSet);

  let boxCount = 0;
  const bones = groups.map((g) => {
    const cubes = g.boxes.map((b) => {
      const { px, py } = palette.index.get(b.color);
      const uv = {};
      for (const f of _GEO_FACES) uv[f] = { uv: [px, py], uv_size: [1, 1] };
      return { origin: [b.x * s, b.y * s, b.z * s], size: [b.w * s, b.h * s, b.d * s], uv };
    });
    // 面色 voxel を 1 cube として追加（各面ごとに面色 or 本体色のテクセルへ）
    for (const [x, y, z, body] of g.faced) {
      const fc = data.facesOf(x, y, z);
      const uv = {};
      for (const f of _GEO_FACES) {
        const { px, py } = palette.index.get(fc[f] !== undefined ? fc[f] : body);
        uv[f] = { uv: [px, py], uv_size: [1, 1] };
      }
      cubes.push({ origin: [x * s, y * s, z * s], size: [s, s, s], uv });
    }
    boxCount += cubes.length;
    const bone = { name: g.name, pivot: [g.pivot[0] * s, g.pivot[1] * s, g.pivot[2] * s], cubes };
    if (g.parent) bone.parent = g.parent;
    return bone;
  });

  const h = data.sy, w = Math.max(data.sx, data.sz);
  const geo = {
    format_version: '1.12.0',
    'minecraft:geometry': [{
      description: {
        identifier: opts.identifier || 'geometry.model',
        texture_width: palette.dim,
        texture_height: palette.dim,
        visible_bounds_width: Math.ceil(w / 16) + 2,
        visible_bounds_height: Math.ceil(h / 16) + 2,
        visible_bounds_offset: [0, (h / 16) / 2, 0],
      },
      bones,
    }],
  };

  // 銃口/発射点ロケーター（root骨に付与。TaCZ/GeckoLib のアニメ・発射原点に利用）
  if (opts.muzzle) {
    const m = opts.muzzle;
    bones[0].locators = { muzzle: [m.x * s, m.y * s, m.z * s] };
  }

  return { geo, canvas: renderPaletteCanvas(palette), boxCount };
}
