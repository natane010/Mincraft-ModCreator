/* importModel.js
 * 既存モデルの「逆取り込み」（DOM非依存）。
 *
 * Minecraft Java の item/block モデル(model.json, elements形式) や
 * Bedrock ジオメトリ(.geo.json, cubes形式) を読み込み、直方体をボクセルに
 * 展開して VoxelData を作る。下絵/骨格づくりの出発点に使う。
 *
 * 【重要・非可逆】色はテクスチャPNG側にあるためJSONからは復元できない。
 * ここでは要素(element/cube)ごとにパレット色を循環で割り当てる“形状取り込み”。
 * 回転(rotation)は無視して軸平行近似する。
 *
 *  detectImportFormat(obj) -> 'project'|'java-model'|'bedrock-geo'|'unknown'
 *  voxelizeJavaModel(obj, opts) -> { data, grid, dropped, info }
 *  voxelizeBedrockGeo(obj, opts) -> { data, grid, dropped, info }
 */

const IMPORT_PALETTE = [
  '#e6e6e6', '#9aa0a6', '#5a6378', '#3a8ee6', '#2ecc71',
  '#e74c3c', '#f1c40f', '#e67e22', '#9b59b6', '#1ab5b5', '#7f5539',
];

function detectImportFormat(obj) {
  if (!obj || typeof obj !== 'object') return 'unknown';
  if (typeof obj.format === 'string' && obj.format.indexOf('natane-forge-project') === 0) return 'project';
  if (obj['minecraft:geometry']) return 'bedrock-geo';
  if (Array.isArray(obj.elements)) return 'java-model';
  return 'unknown';
}

function _clamp64(n) { n = Math.max(1, Math.round(n)); return Math.min(64, n); }

/** 直方体 [min,max)（セル単位）を data に塗る。範囲外はスキップしdropを数える */
function _fillBox(data, x0, y0, z0, x1, y1, z1, color, drop) {
  for (let x = x0; x < x1; x++)
    for (let y = y0; y < y1; y++)
      for (let z = z0; z < z1; z++)
        if (!data.set(x, y, z, color)) drop.n++;
}

/** Java モデル(elements: from/to は 0..16 が基本)をボクセル化 */
function voxelizeJavaModel(obj, opts) {
  const palette = (opts && opts.palette) || IMPORT_PALETTE;
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

  els.forEach((el, i) => {
    if (!el.from || !el.to) return;
    const color = palette[i % palette.length];
    const x0 = Math.floor(el.from[0]) - minX, y0 = Math.floor(el.from[1]) - minY, z0 = Math.floor(el.from[2]) - minZ;
    let x1 = Math.ceil(el.to[0]) - minX, y1 = Math.ceil(el.to[1]) - minY, z1 = Math.ceil(el.to[2]) - minZ;
    // 平面要素(厚み0)は1セルとして取り込む
    if (x1 <= x0) x1 = x0 + 1;
    if (y1 <= y0) y1 = y0 + 1;
    if (z1 <= z0) z1 = z0 + 1;
    _fillBox(data, x0, y0, z0, x1, y1, z1, color, drop);
  });

  const info = `Javaモデル取り込み: 要素 ${els.length} / グリッド ${sx}×${sy}×${sz}` +
    (rotated ? ` / 回転要素 ${rotated} 個は軸平行に近似` : '');
  return { data, grid: { sx, sy, sz }, dropped: drop.n, info };
}

/** Bedrock ジオメトリ(.geo.json, bones[].cubes[] の origin/size)をボクセル化 */
function voxelizeBedrockGeo(obj, opts) {
  const palette = (opts && opts.palette) || IMPORT_PALETTE;
  const geos = obj['minecraft:geometry'];
  if (!Array.isArray(geos) || !geos.length) throw new Error('minecraft:geometry が見つかりません。');
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

  cubes.forEach((c, i) => {
    const color = palette[i % palette.length];
    const x0 = Math.floor(c.origin[0]) - minX, y0 = Math.floor(c.origin[1]) - minY, z0 = Math.floor(c.origin[2]) - minZ;
    let x1 = Math.ceil(c.origin[0] + c.size[0]) - minX;
    let y1 = Math.ceil(c.origin[1] + c.size[1]) - minY;
    let z1 = Math.ceil(c.origin[2] + c.size[2]) - minZ;
    if (x1 <= x0) x1 = x0 + 1;
    if (y1 <= y0) y1 = y0 + 1;
    if (z1 <= z0) z1 = z0 + 1;
    _fillBox(data, x0, y0, z0, x1, y1, z1, color, drop);
  });

  const info = `Bedrockジオメトリ取り込み: cube ${cubes.length} / グリッド ${sx}×${sy}×${sz}` +
    (rotated ? ` / 回転 ${rotated} 件は軸平行に近似` : '');
  return { data, grid: { sx, sy, sz }, dropped: drop.n, info };
}
