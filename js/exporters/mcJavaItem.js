/* exporters/mcJavaItem.js
 * ボクセルデータ -> Minecraft Java アイテムモデルJSON へ変換。
 *
 * ・greedyBoxes で同色直方体にまとめ、各boxを1 elementに変換
 * ・テクスチャは buildPalette/renderPaletteCanvas でパレットPNGを生成
 * ・全面UVは該当色の1テクセルを指す（=面は単色で塗られる）
 *
 * 後でモブ用(GeckoLib geo)など別フォーマットを追加する場合は、
 * このファイルと同じ「data -> {model, canvas}」インターフェースで実装する。
 */
const FACES = ['north', 'south', 'east', 'west', 'up', 'down'];

function buildItemModel(data, opts) {
  const namespace = opts.namespace;
  const itemId = opts.itemId;
  const s = opts.scale || 1; // 1ボクセルあたりの model 単位（細かい造形用）

  // 面ピクセル（ピクセルアート）があればアトラス方式へ分岐（無ければ従来パレット＝後方互換）
  const atlas = (typeof buildFaceAtlas === 'function') ? buildFaceAtlas(data) : { used: false };
  if (atlas.used) return _buildItemModelAtlas(data, opts, atlas, s);

  // 面色を持つ voxel は greedyBoxes から分離し、1 voxel=1 element で個別に面別UV出力する。
  // 面色なし voxel だけを greedyBoxes でまとめる（面色未使用時は元 data と完全一致＝後方互換）。
  const facedVoxels = data.entries().filter(([x, y, z]) => data.hasFace(x, y, z));
  let plainData = data;
  if (facedVoxels.length) {
    plainData = new VoxelData(data.sx, data.sy, data.sz);
    for (const [x, y, z, c] of data.entries()) {
      if (!data.hasFace(x, y, z)) plainData.set(x, y, z, c);
    }
  }

  const boxes = greedyBoxes(plainData);
  // パレット: boxes の本体色 ＋ faced voxel の本体色＋全面色（既存色を先に並べてindex採番を安定化）
  const colorSet = [];
  const seen = new Set();
  const addColor = (c) => { if (c != null && !seen.has(c)) { seen.add(c); colorSet.push(c); } };
  boxes.forEach((b) => addColor(b.color));
  facedVoxels.forEach(([x, y, z, c]) => {
    addColor(c);
    const fc = data.facesOf(x, y, z);
    for (const f of FACES) if (fc[f] !== undefined) addColor(fc[f]);
  });
  const palette = buildPalette(colorSet);

  const elements = boxes.map(b => {
    const uv = uvFor(b.color, palette);
    const faces = {};
    for (const f of FACES) {
      faces[f] = { uv: [uv[0], uv[1], uv[2], uv[3]], texture: '#0' };
    }
    return {
      from: [b.x * s, b.y * s, b.z * s],
      to: [(b.x + b.w) * s, (b.y + b.h) * s, (b.z + b.d) * s],
      faces,
    };
  });

  // 面色 voxel を 1 element として追加（各面ごとに面色 or 本体色のUVへ向ける）
  for (const [x, y, z, body] of facedVoxels) {
    const fc = data.facesOf(x, y, z);
    const faces = {};
    for (const f of FACES) {
      const uv = uvFor(fc[f] !== undefined ? fc[f] : body, palette);
      faces[f] = { uv: [uv[0], uv[1], uv[2], uv[3]], texture: '#0' };
    }
    elements.push({
      from: [x * s, y * s, z * s],
      to: [(x + 1) * s, (y + 1) * s, (z + 1) * s],
      faces,
    });
  }

  const texRef = namespace + ':item/' + itemId;
  const model = {
    credit: 'Made with Natane Voxel & Data Forge',
    textures: { 0: texRef, particle: texRef },
    elements,
    // インベントリ等での見え方の既定値（必要なら出力後に調整可）
    display: {
      gui: { rotation: [30, 225, 0], translation: [0, 0, 0], scale: [0.625, 0.625, 0.625] },
      ground: { rotation: [0, 0, 0], translation: [0, 3, 0], scale: [0.25, 0.25, 0.25] },
      fixed: { rotation: [0, 0, 0], translation: [0, 0, 0], scale: [0.5, 0.5, 0.5] },
      thirdperson_righthand: { rotation: [75, 45, 0], translation: [0, 2.5, 0], scale: [0.375, 0.375, 0.375] },
      firstperson_righthand: { rotation: [0, 45, 0], translation: [0, 0, 0], scale: [0.4, 0.4, 0.4] },
    },
  };

  const canvas = renderPaletteCanvas(palette);
  return { model, canvas, boxCount: boxes.length + facedVoxels.length };
}

/** 面ピクセル対応版（アトラス使用）。面色/面ピクセルのある voxel は 1 element で面別UV */
function _buildItemModelAtlas(data, opts, atlas, s) {
  const namespace = opts.namespace;
  const itemId = opts.itemId;
  const res = atlas.res, dim = atlas.dim;

  const facedVoxels = data.entries().filter(([x, y, z]) => data.hasFace(x, y, z) || data.hasFacePixels(x, y, z));
  const plainData = new VoxelData(data.sx, data.sy, data.sz);
  for (const [x, y, z, c] of data.entries()) {
    if (!data.hasFace(x, y, z) && !data.hasFacePixels(x, y, z)) plainData.set(x, y, z, c);
  }
  const boxes = greedyBoxes(plainData);

  const elements = boxes.map((b) => {
    const uv = atlasUv(atlas.colorTexel(b.color), res, dim);
    const faces = {};
    for (const f of FACES) faces[f] = { uv: uv.slice(), texture: '#0' };
    return {
      from: [b.x * s, b.y * s, b.z * s],
      to: [(b.x + b.w) * s, (b.y + b.h) * s, (b.z + b.d) * s],
      faces,
    };
  });

  for (const [x, y, z, body] of facedVoxels) {
    const fc = data.facesOf(x, y, z);
    const faces = {};
    for (const f of FACES) {
      let texel;
      if (atlas.hasPix(x, y, z, f)) texel = atlas.faceTexel(x, y, z, f);
      else texel = atlas.colorTexel(fc[f] !== undefined ? fc[f] : body);
      faces[f] = { uv: atlasUv(texel, res, dim), texture: '#0' };
    }
    elements.push({
      from: [x * s, y * s, z * s],
      to: [(x + 1) * s, (y + 1) * s, (z + 1) * s],
      faces,
    });
  }

  const texRef = namespace + ':item/' + itemId;
  const model = {
    credit: 'Made with Natane Voxel & Data Forge',
    textures: { 0: texRef, particle: texRef },
    elements,
    display: {
      gui: { rotation: [30, 225, 0], translation: [0, 0, 0], scale: [0.625, 0.625, 0.625] },
      ground: { rotation: [0, 0, 0], translation: [0, 3, 0], scale: [0.25, 0.25, 0.25] },
      fixed: { rotation: [0, 0, 0], translation: [0, 0, 0], scale: [0.5, 0.5, 0.5] },
      thirdperson_righthand: { rotation: [75, 45, 0], translation: [0, 2.5, 0], scale: [0.375, 0.375, 0.375] },
      firstperson_righthand: { rotation: [0, 45, 0], translation: [0, 0, 0], scale: [0.4, 0.4, 0.4] },
    },
  };
  return { model, canvas: atlas.canvas, boxCount: boxes.length + facedVoxels.length };
}
