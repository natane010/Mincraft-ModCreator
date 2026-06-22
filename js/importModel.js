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
 * 回転(rotation)は回転行列でセルを変換して近似反映する(任意角はボクセルで非可逆のため近似)。
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

function _clampDim(n) { n = Math.max(1, Math.round(n)); return Math.min(128, n); }

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

// ===== 回転ヘルパー（取込時に要素/cube の rotation を近似反映する） =====

/** 度→ラジアン */
function _degToRad(d) { return d * Math.PI / 180; }

/** Java用: 単一軸('x|y|z')+角度(度)から 3x3 回転行列(長さ9配列・行優先)を返す */
function _rotMatAxis(axis, angleDeg) {
  const a = _degToRad(angleDeg || 0);
  const c = Math.cos(a), s = Math.sin(a);
  // 行優先 [m00,m01,m02, m10,m11,m12, m20,m21,m22]
  if (axis === 'x') return [1, 0, 0, 0, c, -s, 0, s, c];
  if (axis === 'y') return [c, 0, s, 0, 1, 0, -s, 0, c];
  // 既定 z
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}

/** 2つの 3x3 行列(行優先・長さ9)の積 a*b を返す */
function _matMul(a, b) {
  const out = new Array(9);
  for (let r = 0; r < 3; r++)
    for (let col = 0; col < 3; col++) {
      out[r * 3 + col] =
        a[r * 3 + 0] * b[0 * 3 + col] +
        a[r * 3 + 1] * b[1 * 3 + col] +
        a[r * 3 + 2] * b[2 * 3 + col];
    }
  return out;
}

/** Bedrock用: [rx,ry,rz](度)を合成(Z*Y*X 相当)。全0なら null を返す */
function _rotMatXYZ(rx, ry, rz) {
  rx = rx || 0; ry = ry || 0; rz = rz || 0;
  if (rx === 0 && ry === 0 && rz === 0) return null;
  const mx = _rotMatAxis('x', rx);
  const my = _rotMatAxis('y', ry);
  const mz = _rotMatAxis('z', rz);
  // Blockbench/MoLang の cube 回転は Z,Y,X の順に適用する慣習に合わせる
  return _matMul(_matMul(mz, my), mx);
}

/** 点(列ベクトル)に行列を適用して [x',y',z'] を返す */
function _applyMat(m, x, y, z) {
  return [
    m[0] * x + m[1] * y + m[2] * z,
    m[3] * x + m[4] * y + m[5] * z,
    m[6] * x + m[7] * y + m[8] * z,
  ];
}

/** ピボット p 周りに行列 m を適用: (x-p)→_applyMat→(+p) */
function _rotateAboutPivot(m, p, x, y, z) {
  const r = _applyMat(m, x - p[0], y - p[1], z - p[2]);
  return [r[0] + p[0], r[1] + p[1], r[2] + p[2]];
}

/**
 * モデル単位の点(mx,my,mz)に回転ステージ群 stages を順に適用し、
 * s 倍してグリッドのオフセット(min)を引いた連続グリッド座標 [gx,gy,gz] を返す。
 * stages: [{m, p}, ...]（先頭から順に適用。p はモデル単位ピボット）
 */
function _modelToGrid(mx, my, mz, stages, s, minX, minY, minZ) {
  let x = mx, y = my, z = mz;
  for (const st of stages) {
    if (!st || !st.m) continue;
    const r = _rotateAboutPivot(st.m, st.p, x, y, z);
    x = r[0]; y = r[1]; z = r[2];
  }
  return [x * s - minX, y * s - minY, z * s - minZ];
}

/**
 * 回転ありの箱の整数グリッド境界を返す。
 * originModel/sizeModel はモデル単位の最小角と寸法。stages は回転ステージ群。
 * 箱の8角を変換し floor/ceil で {minX..maxZ} を返す。
 */
function _boxRotatedBounds(originModel, sizeModel, stages, s) {
  const ox = originModel[0], oy = originModel[1], oz = originModel[2];
  const w = sizeModel[0], h = sizeModel[1], d = sizeModel[2];
  let mnX = Infinity, mnY = Infinity, mnZ = Infinity;
  let mxX = -Infinity, mxY = -Infinity, mxZ = -Infinity;
  for (let cx = 0; cx <= 1; cx++)
    for (let cy = 0; cy <= 1; cy++)
      for (let cz = 0; cz <= 1; cz++) {
        const g = _modelToGrid(ox + cx * w, oy + cy * h, oz + cz * d, stages, s, 0, 0, 0);
        mnX = Math.min(mnX, g[0]); mxX = Math.max(mxX, g[0]);
        mnY = Math.min(mnY, g[1]); mxY = Math.max(mxY, g[1]);
        mnZ = Math.min(mnZ, g[2]); mxZ = Math.max(mxZ, g[2]);
      }
  return {
    minX: Math.floor(mnX), minY: Math.floor(mnY), minZ: Math.floor(mnZ),
    maxX: Math.ceil(mxX), maxY: Math.ceil(mxY), maxZ: Math.ceil(mxZ),
  };
}

/**
 * 回転ありの塗り込み中核。
 * 箱(originModel/sizeModel, モデル単位)をサブセルで走査し、各サブセル中心を
 * stages で回転→s倍→min を引いて floor で data に書き込む。
 * color: 文字列 または colorAt(lx,ly,lz)->色（回転前の局所座標で面色を引く）。
 * s はグリッド解像度倍率、sub は1モデル単位あたりのサブセル分割数(=subdiv)。
 */
function _fillBoxRotated(data, originModel, sizeModel, stages, s, sub, color, drop, minX, minY, minZ) {
  const w = sizeModel[0], h = sizeModel[1], d = sizeModel[2];
  const colorAt = (typeof color === 'function') ? color : null;
  // 各軸のサブセル分割数（最低1）。s*sub 相当の解像度で走査する。
  const nx = Math.max(1, Math.round(w * s * sub));
  const ny = Math.max(1, Math.round(h * s * sub));
  const nz = Math.max(1, Math.round(d * s * sub));
  for (let ix = 0; ix < nx; ix++) {
    const lmx = (ix + 0.5) / nx * w; // 箱内の局所モデル座標（0..w）
    for (let iy = 0; iy < ny; iy++) {
      const lmy = (iy + 0.5) / ny * h;
      for (let iz = 0; iz < nz; iz++) {
        const lmz = (iz + 0.5) / nz * d;
        const g = _modelToGrid(originModel[0] + lmx, originModel[1] + lmy, originModel[2] + lmz,
          stages, s, minX, minY, minZ);
        const gx = Math.floor(g[0]), gy = Math.floor(g[1]), gz = Math.floor(g[2]);
        let col;
        if (colorAt) {
          // 回転前の局所セル座標で面判定（テクスチャ復元色を維持）
          const lx = Math.min(Math.floor(lmx * s), Math.max(0, Math.round(w * s) - 1));
          const ly = Math.min(Math.floor(lmy * s), Math.max(0, Math.round(h * s) - 1));
          const lz = Math.min(Math.floor(lmz * s), Math.max(0, Math.round(d * s) - 1));
          col = colorAt(lx, ly, lz);
        } else {
          col = color;
        }
        if (!data.set(gx, gy, gz, col)) drop.n++;
      }
    }
  }
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
  const s = Math.max(1, opts.subdiv || 1); // 細分化（小数座標の細部を保持）
  const els = obj.elements || [];
  if (!els.length) throw new Error('elements が見つかりません（Java item/block モデルではない可能性）。');

  // 全要素のバウンディングボックス（細分化後に floor/ceil でセルに丸め）
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let rotated = 0;
  for (const el of els) {
    if (!el.from || !el.to) continue;
    if (el.rotation) {
      rotated++;
      // 回転要素は回転後の8角を含む境界で BB を広げる（rotation.origin 既定は中心[8,8,8]）
      const mat = _rotMatAxis(el.rotation.axis, el.rotation.angle);
      const pivot = el.rotation.origin || [8, 8, 8];
      const sizeM = [el.to[0] - el.from[0], el.to[1] - el.from[1], el.to[2] - el.from[2]];
      const b = _boxRotatedBounds(el.from, sizeM, [{ m: mat, p: pivot }], s);
      minX = Math.min(minX, b.minX); minY = Math.min(minY, b.minY); minZ = Math.min(minZ, b.minZ);
      maxX = Math.max(maxX, b.maxX); maxY = Math.max(maxY, b.maxY); maxZ = Math.max(maxZ, b.maxZ);
      continue;
    }
    minX = Math.min(minX, Math.floor(el.from[0] * s));
    minY = Math.min(minY, Math.floor(el.from[1] * s));
    minZ = Math.min(minZ, Math.floor(el.from[2] * s));
    maxX = Math.max(maxX, Math.ceil(el.to[0] * s));
    maxY = Math.max(maxY, Math.ceil(el.to[1] * s));
    maxZ = Math.max(maxZ, Math.ceil(el.to[2] * s));
  }
  if (!isFinite(minX)) throw new Error('有効な from/to を持つ要素がありません。');

  const sx = _clampDim(maxX - minX), sy = _clampDim(maxY - minY), sz = _clampDim(maxZ - minZ);
  const data = new VoxelData(sx, sy, sz);
  const drop = { n: 0 };
  let coloredN = 0;

  els.forEach((el, i) => {
    if (!el.from || !el.to) return;
    const x0 = Math.floor(el.from[0] * s) - minX, y0 = Math.floor(el.from[1] * s) - minY, z0 = Math.floor(el.from[2] * s) - minZ;
    let x1 = Math.ceil(el.to[0] * s) - minX, y1 = Math.ceil(el.to[1] * s) - minY, z1 = Math.ceil(el.to[2] * s) - minZ;
    // 平面要素(厚み0)は1セルとして取り込む
    if (x1 <= x0) x1 = x0 + 1;
    if (y1 <= y0) y1 = y0 + 1;
    if (z1 <= z0) z1 = z0 + 1;

    const fc = _javaFaceColors(el, sampler);
    if (el.rotation) {
      // 回転あり: サブセルを回転行列で変換して塗る（rescale は未対応＝近似）
      const mat = _rotMatAxis(el.rotation.axis, el.rotation.angle);
      const pivot = el.rotation.origin || [8, 8, 8];
      const sizeM = [el.to[0] - el.from[0], el.to[1] - el.from[1], el.to[2] - el.from[2]];
      const stages = [{ m: mat, p: pivot }];
      if (fc) {
        _fillBoxRotated(data, el.from, sizeM, stages, s, s,
          _faceColorAt(fc, x1 - x0, y1 - y0, z1 - z0), drop, minX, minY, minZ);
        coloredN++;
      } else {
        _fillBoxRotated(data, el.from, sizeM, stages, s, s, palette[i % palette.length], drop, minX, minY, minZ);
      }
      return;
    }
    if (fc) {
      _fillBoxFn(data, x0, y0, z0, x1, y1, z1, _faceColorAt(fc, x1 - x0, y1 - y0, z1 - z0), drop);
      coloredN++;
    } else {
      _fillBox(data, x0, y0, z0, x1, y1, z1, palette[i % palette.length], drop);
    }
  });

  const info = `Javaモデル取り込み: 要素 ${els.length} / グリッド ${sx}×${sy}×${sz}` +
    (sampler ? `（テクスチャから ${coloredN} 要素の色を復元）` : '') +
    (rotated ? ` / 回転 ${rotated} 件を反映(近似)` : '');
  return { data, grid: { sx, sy, sz }, dropped: drop.n, info, colored: !!sampler };
}

/** Bedrock ジオメトリ(.geo.json, bones[].cubes[] の origin/size)をボクセル化 */
function voxelizeBedrockGeo(obj, opts) {
  opts = opts || {};
  const sampler = opts.sampler || null;
  const palette = opts.palette || IMPORT_PALETTE;
  const s = Math.max(1, opts.subdiv || 1); // 細分化（小数座標の細部を保持）
  const geos = obj['minecraft:geometry'];
  if (!Array.isArray(geos) || !geos.length) throw new Error('minecraft:geometry が見つかりません。');
  const desc = geos[0].description || {};
  const texW = desc.texture_width || 16, texH = desc.texture_height || 16;
  const bones = geos[0].bones || [];
  // 各 cube に回転ステージ群(stages)を付けて保持する。
  // stages: 先に cube 回転(c.pivot)→次に bone 回転(b.pivot) の順で適用（Blockbench準拠）
  const cubes = [];
  let rotated = 0;
  for (const b of bones) {
    const boneMat = b.rotation ? _rotMatXYZ(b.rotation[0], b.rotation[1], b.rotation[2]) : null;
    const bonePivot = b.pivot || [0, 0, 0];
    if (boneMat) rotated++;
    for (const c of (b.cubes || [])) {
      if (!(c.origin && c.size)) continue;
      const cubeMat = c.rotation ? _rotMatXYZ(c.rotation[0], c.rotation[1], c.rotation[2]) : null;
      const cubePivot = c.pivot || [0, 0, 0];
      if (cubeMat) rotated++;
      const stages = [];
      if (cubeMat) stages.push({ m: cubeMat, p: cubePivot });
      if (boneMat) stages.push({ m: boneMat, p: bonePivot });
      cubes.push({ cube: c, stages: stages });
    }
  }
  if (!cubes.length) throw new Error('cube が見つかりません。');

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const item of cubes) {
    const c = item.cube;
    if (item.stages.length) {
      // 回転あり: 回転後の8角を含む境界で BB を広げる
      const b = _boxRotatedBounds(c.origin, c.size, item.stages, s);
      minX = Math.min(minX, b.minX); minY = Math.min(minY, b.minY); minZ = Math.min(minZ, b.minZ);
      maxX = Math.max(maxX, b.maxX); maxY = Math.max(maxY, b.maxY); maxZ = Math.max(maxZ, b.maxZ);
      continue;
    }
    minX = Math.min(minX, Math.floor(c.origin[0] * s));
    minY = Math.min(minY, Math.floor(c.origin[1] * s));
    minZ = Math.min(minZ, Math.floor(c.origin[2] * s));
    maxX = Math.max(maxX, Math.ceil((c.origin[0] + c.size[0]) * s));
    maxY = Math.max(maxY, Math.ceil((c.origin[1] + c.size[1]) * s));
    maxZ = Math.max(maxZ, Math.ceil((c.origin[2] + c.size[2]) * s));
  }

  const sx = _clampDim(maxX - minX), sy = _clampDim(maxY - minY), sz = _clampDim(maxZ - minZ);
  const data = new VoxelData(sx, sy, sz);
  const drop = { n: 0 };
  let coloredN = 0;

  cubes.forEach((item, i) => {
    const c = item.cube;
    const x0 = Math.floor(c.origin[0] * s) - minX, y0 = Math.floor(c.origin[1] * s) - minY, z0 = Math.floor(c.origin[2] * s) - minZ;
    let x1 = Math.ceil((c.origin[0] + c.size[0]) * s) - minX;
    let y1 = Math.ceil((c.origin[1] + c.size[1]) * s) - minY;
    let z1 = Math.ceil((c.origin[2] + c.size[2]) * s) - minZ;
    if (x1 <= x0) x1 = x0 + 1;
    if (y1 <= y0) y1 = y0 + 1;
    if (z1 <= z0) z1 = z0 + 1;

    const fc = _bedrockFaceColors(c, sampler, texW, texH);
    if (item.stages.length) {
      // 回転あり: cube→bone の順に2段でピボット回転しながら塗る
      if (fc) {
        _fillBoxRotated(data, c.origin, c.size, item.stages, s, s,
          _faceColorAt(fc, x1 - x0, y1 - y0, z1 - z0), drop, minX, minY, minZ);
        coloredN++;
      } else {
        _fillBoxRotated(data, c.origin, c.size, item.stages, s, s, palette[i % palette.length], drop, minX, minY, minZ);
      }
      return;
    }
    if (fc) {
      _fillBoxFn(data, x0, y0, z0, x1, y1, z1, _faceColorAt(fc, x1 - x0, y1 - y0, z1 - z0), drop);
      coloredN++;
    } else {
      _fillBox(data, x0, y0, z0, x1, y1, z1, palette[i % palette.length], drop);
    }
  });

  const info = `Bedrockジオメトリ取り込み: cube ${cubes.length} / グリッド ${sx}×${sy}×${sz}` +
    (sampler ? `（テクスチャから ${coloredN} cube の色を復元）` : '') +
    (rotated ? ` / 回転 ${rotated} 件を反映(近似)` : '');
  return { data, grid: { sx, sy, sz }, dropped: drop.n, info, colored: !!sampler };
}
