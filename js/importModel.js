/* importModel.js
 * 既存モデルの「逆取り込み」（DOM非依存）。
 *
 * Minecraft Java の item/block モデル(model.json, elements形式) や
 * Bedrock ジオメトリ(.geo.json, cubes形式) を読み込み、直方体をボクセルに
 * 展開して VoxelData を作る。下絵/骨格づくりの出発点に使う。
 *
 * 【色の復元】テクスチャPNGも一緒に渡すと(opts.sampler)、各面のUV領域を
 * サンプリングして実際の色をボクセルへ復元する。sampler が無い場合は従来通り
 * 要素ごとにパレット色を循環で割り当てる“形状のみ取り込み”にフォールバックする。
 * 回転(rotation)は無視して軸平行近似する。
 *
 *  detectImportFormat(obj) -> 'project'|'java-model'|'bedrock-geo'|'unknown'
 *  voxelizeJavaModel(obj, opts) -> { data, grid, dropped, info }
 *  voxelizeBedrockGeo(obj, opts) -> { data, grid, dropped, info }
 *
 *  opts.sampler(u0,v0,u1,v1): 正規化UV(0..1, v は上→下)の矩形を平均した
 *                              '#rrggbb' を返す。全透明なら null。
 */

const IMPORT_PALETTE = [
  '#e6e6e6', '#9aa0a6', '#5a6378', '#3a8ee6', '#2ecc71',
  '#e74c3c', '#f1c40f', '#e67e22', '#9b59b6', '#1ab5b5', '#7f5539',
];

// 面名 → 軸(法線方向)。north=-Z, south=+Z, west=-X, east=+X, up=+Y, down=-Y
const _IMPORT_FACES = ['north', 'south', 'east', 'west', 'up', 'down'];

function detectImportFormat(obj) {
  if (!obj || typeof obj !== 'object') return 'unknown';
  if (typeof obj.format === 'string' && obj.format.indexOf('natane-forge-project') === 0) return 'project';
  if (obj['minecraft:geometry']) return 'bedrock-geo';
  if (Array.isArray(obj.elements)) return 'java-model';
  return 'unknown';
}

function _clamp64(n) { n = Math.max(1, Math.round(n)); return Math.min(64, n); }

/** 直方体 [min,max)（セル単位）を単色で塗る。範囲外はスキップしdropを数える */
function _fillBox(data, x0, y0, z0, x1, y1, z1, color, drop) {
  for (let x = x0; x < x1; x++)
    for (let y = y0; y < y1; y++)
      for (let z = z0; z < z1; z++)
        if (!data.set(x, y, z, color)) drop.n++;
}

/** 直方体を colorAt(局所lx,ly,lz)->色 で塗る（面ごとに色を変える用） */
function _fillBoxFn(data, x0, y0, z0, x1, y1, z1, colorAt, drop) {
  for (let x = x0; x < x1; x++)
    for (let y = y0; y < y1; y++)
      for (let z = z0; z < z1; z++)
        if (!data.set(x, y, z, colorAt(x - x0, y - y0, z - z0))) drop.n++;
}

/** 面色 fc{north,..} と箱サイズから、各ボクセルが接する面の色を返す関数 */
function _faceColorAt(fc, w, h, d) {
  const order = ['up', 'north', 'east', 'south', 'west', 'down'];
  const fallback = fc.up || fc.north || fc.south || fc.east || fc.west || fc.down;
  return (lx, ly, lz) => {
    const on = {
      up: ly === h - 1, down: ly === 0,
      north: lz === 0, south: lz === d - 1,
      west: lx === 0, east: lx === w - 1,
    };
    for (const f of order) if (on[f] && fc[f]) return fc[f];
    return fallback; // 内部ボクセル
  };
}

/** Java の element.faces から面色を引く。1面も取れなければ null */
function _javaFaceColors(el, sampler) {
  if (!sampler || !el.faces) return null;
  const fc = {};
  let any = false;
  for (const f of _IMPORT_FACES) {
    const face = el.faces[f];
    if (face && Array.isArray(face.uv) && face.uv.length === 4) {
      const [a, b, c, d] = face.uv; // Java UV は 0..16
      const col = sampler(Math.min(a, c) / 16, Math.min(b, d) / 16, Math.max(a, c) / 16, Math.max(b, d) / 16);
      if (col) { fc[f] = col; any = true; }
    }
  }
  return any ? fc : null;
}

/** Bedrock box-uv [U,V] を6面のテクセル矩形へ展開（標準レイアウト） */
function _boxUvRects(U, V, w, h, d) {
  return {
    up:    [U + d,         V,       U + d + w,       V + d],
    down:  [U + d + w,     V,       U + d + 2 * w,   V + d],
    east:  [U,             V + d,   U + d,           V + d + h],
    north: [U + d,         V + d,   U + d + w,       V + d + h],
    west:  [U + d + w,     V + d,   U + 2 * d + w,   V + d + h],
    south: [U + 2 * d + w, V + d,   U + 2 * d + 2 * w, V + d + h],
  };
}

/** Bedrock cube の uv(per-face / box) から面色を引く。texW/H で正規化 */
function _bedrockFaceColors(cube, sampler, texW, texH) {
  if (!sampler) return null;
  const w = cube.size[0], h = cube.size[1], d = cube.size[2];
  let rects = null;
  if (cube.uv && !Array.isArray(cube.uv)) {           // per-face オブジェクト形式
    rects = {};
    for (const f of _IMPORT_FACES) {
      const face = cube.uv[f];
      if (face && Array.isArray(face.uv)) {
        const us = face.uv_size || [1, 1];
        rects[f] = [face.uv[0], face.uv[1], face.uv[0] + us[0], face.uv[1] + us[1]];
      }
    }
  } else if (Array.isArray(cube.uv) && cube.uv.length === 2) { // box-uv 形式
    rects = _boxUvRects(cube.uv[0], cube.uv[1], w, h, d);
  } else { return null; }

  const fc = {};
  let any = false;
  for (const f of _IMPORT_FACES) {
    const r = rects[f];
    if (!r) continue;
    const col = sampler(
      Math.min(r[0], r[2]) / texW, Math.min(r[1], r[3]) / texH,
      Math.max(r[0], r[2]) / texW, Math.max(r[1], r[3]) / texH);
    if (col) { fc[f] = col; any = true; }
  }
  return any ? fc : null;
}

/** Java モデル(elements: from/to は 0..16 が基本)をボクセル化 */
function voxelizeJavaModel(obj, opts) {
  opts = opts || {};
  const sampler = opts.sampler || null;
  const palette = opts.palette || IMPORT_PALETTE;
  const els = obj.elements || [];
  if (!els.length) throw new Error('elements が見つかりません（Java item/block モデルではない可能性）。');

  // 全要素のバウンディングボックス（floor/ceil でセルに丸め）
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let rotated = 0;
  for (const el of els) {
    if (!el.from || !el.to) continue;
    if (el.rotation) rotated++;
    minX = Math.min(minX, Math.floor(el.from[0]));
    minY = Math.min(minY, Math.floor(el.from[1]));
    minZ = Math.min(minZ, Math.floor(el.from[2]));
    maxX = Math.max(maxX, Math.ceil(el.to[0]));
    maxY = Math.max(maxY, Math.ceil(el.to[1]));
    maxZ = Math.max(maxZ, Math.ceil(el.to[2]));
  }
  if (!isFinite(minX)) throw new Error('有効な from/to を持つ要素がありません。');

  const sx = _clamp64(maxX - minX), sy = _clamp64(maxY - minY), sz = _clamp64(maxZ - minZ);
  const data = new VoxelData(sx, sy, sz);
  const drop = { n: 0 };
  let coloredN = 0;

  els.forEach((el, i) => {
    if (!el.from || !el.to) return;
    const x0 = Math.floor(el.from[0]) - minX, y0 = Math.floor(el.from[1]) - minY, z0 = Math.floor(el.from[2]) - minZ;
    let x1 = Math.ceil(el.to[0]) - minX, y1 = Math.ceil(el.to[1]) - minY, z1 = Math.ceil(el.to[2]) - minZ;
    // 平面要素(厚み0)は1セルとして取り込む
    if (x1 <= x0) x1 = x0 + 1;
    if (y1 <= y0) y1 = y0 + 1;
    if (z1 <= z0) z1 = z0 + 1;

    const fc = _javaFaceColors(el, sampler);
    if (fc) {
      _fillBoxFn(data, x0, y0, z0, x1, y1, z1, _faceColorAt(fc, x1 - x0, y1 - y0, z1 - z0), drop);
      coloredN++;
    } else {
      _fillBox(data, x0, y0, z0, x1, y1, z1, palette[i % palette.length], drop);
    }
  });

  const info = `Javaモデル取り込み: 要素 ${els.length} / グリッド ${sx}×${sy}×${sz}` +
    (sampler ? `（テクスチャから ${coloredN} 要素の色を復元）` : '') +
    (rotated ? ` / 回転要素 ${rotated} 個は軸平行に近似` : '');
  return { data, grid: { sx, sy, sz }, dropped: drop.n, info, colored: !!sampler };
}

/** Bedrock ジオメトリ(.geo.json, bones[].cubes[] の origin/size)をボクセル化 */
function voxelizeBedrockGeo(obj, opts) {
  opts = opts || {};
  const sampler = opts.sampler || null;
  const palette = opts.palette || IMPORT_PALETTE;
  const geos = obj['minecraft:geometry'];
  if (!Array.isArray(geos) || !geos.length) throw new Error('minecraft:geometry が見つかりません。');
  const desc = geos[0].description || {};
  const texW = desc.texture_width || 16, texH = desc.texture_height || 16;
  const bones = geos[0].bones || [];
  const cubes = [];
  let rotated = 0;
  for (const b of bones) {
    if (b.rotation) rotated++;
    for (const c of (b.cubes || [])) {
      if (c.rotation) rotated++;
      if (c.origin && c.size) cubes.push(c);
    }
  }
  if (!cubes.length) throw new Error('cube が見つかりません。');

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const c of cubes) {
    minX = Math.min(minX, Math.floor(c.origin[0]));
    minY = Math.min(minY, Math.floor(c.origin[1]));
    minZ = Math.min(minZ, Math.floor(c.origin[2]));
    maxX = Math.max(maxX, Math.ceil(c.origin[0] + c.size[0]));
    maxY = Math.max(maxY, Math.ceil(c.origin[1] + c.size[1]));
    maxZ = Math.max(maxZ, Math.ceil(c.origin[2] + c.size[2]));
  }

  const sx = _clamp64(maxX - minX), sy = _clamp64(maxY - minY), sz = _clamp64(maxZ - minZ);
  const data = new VoxelData(sx, sy, sz);
  const drop = { n: 0 };
  let coloredN = 0;

  cubes.forEach((c, i) => {
    const x0 = Math.floor(c.origin[0]) - minX, y0 = Math.floor(c.origin[1]) - minY, z0 = Math.floor(c.origin[2]) - minZ;
    let x1 = Math.ceil(c.origin[0] + c.size[0]) - minX;
    let y1 = Math.ceil(c.origin[1] + c.size[1]) - minY;
    let z1 = Math.ceil(c.origin[2] + c.size[2]) - minZ;
    if (x1 <= x0) x1 = x0 + 1;
    if (y1 <= y0) y1 = y0 + 1;
    if (z1 <= z0) z1 = z0 + 1;

    const fc = _bedrockFaceColors(c, sampler, texW, texH);
    if (fc) {
      _fillBoxFn(data, x0, y0, z0, x1, y1, z1, _faceColorAt(fc, x1 - x0, y1 - y0, z1 - z0), drop);
      coloredN++;
    } else {
      _fillBox(data, x0, y0, z0, x1, y1, z1, palette[i % palette.length], drop);
    }
  });

  const info = `Bedrockジオメトリ取り込み: cube ${cubes.length} / グリッド ${sx}×${sy}×${sz}` +
    (sampler ? `（テクスチャから ${coloredN} cube の色を復元）` : '') +
    (rotated ? ` / 回転 ${rotated} 件は軸平行に近似` : '');
  return { data, grid: { sx, sy, sz }, dropped: drop.n, info, colored: !!sampler };
}
