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

/** opts から「ボーン名 -> そのボーンのboxes」を作る */
function _geoBoneGroups(data, opts) {
  const def = (opts.bones && opts.bones.length)
    ? opts.bones : [{ name: 'root', pivot: [0, 0, 0], parent: '' }];
  const names = def.map((b) => b.name);
  const boneOf = opts.boneOf || (() => names[0]);

  const buckets = {};
  for (const n of names) buckets[n] = new VoxelData(data.sx, data.sy, data.sz);
  for (const [x, y, z, c] of data.entries()) {
    let n = boneOf(x, y, z);
    if (!buckets[n]) n = names[0];
    buckets[n].set(x, y, z, c);
  }
  return def.map((b) => ({
    name: b.name, pivot: b.pivot || [0, 0, 0], parent: b.parent || '',
    boxes: greedyBoxes(buckets[b.name]),
  }));
}

function buildBedrockGeo(data, opts) {
  opts = opts || {};
  const s = opts.unitScale || 1; // 1ボクセルあたりの model 単位（細かい造形用）
  const groups = _geoBoneGroups(data, opts);

  // 全ボーンの色を集めて共有パレットを作る
  const colors = [...new Set(groups.reduce((a, g) => a.concat(g.boxes.map((b) => b.color)), []))];
  const palette = buildPalette(colors);

  let boxCount = 0;
  const bones = groups.map((g) => {
    const cubes = g.boxes.map((b) => {
      const { px, py } = palette.index.get(b.color);
      const uv = {};
      for (const f of _GEO_FACES) uv[f] = { uv: [px, py], uv_size: [1, 1] };
      return { origin: [b.x * s, b.y * s, b.z * s], size: [b.w * s, b.h * s, b.d * s], uv };
    });
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
