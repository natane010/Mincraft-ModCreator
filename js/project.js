/* project.js
 * プロジェクトの保存/読込/取り込み（DOM非依存の純ロジック＋ファイルI/O）。
 *
 * 1ファイル(.vdf.json)に「グリッド・ボクセル・メタデータ・ロケーター・出力設定」を
 * まとめて保存し、あとで完全復元できるようにする。テンプレートと違い、編集途中の
 * 作品を閉じても続きから再開できる。バッチ出力の1要素としても再利用する。
 *
 *  - serializeProject : 状態オブジェクト -> プロジェクトJSON(プレーンオブジェクト)
 *  - deserializeProject: プロジェクトJSON -> { data:VoxelData, meta, muzzle, ids, grid }
 *  - downloadProject  : JSON を .vdf.json としてDL
 *  - readProjectFile  : <input type=file> の File を読み、検証して返す(Promise)
 */

const PROJECT_FORMAT = 'natane-forge-project/1';

/**
 * @param {{snapshot:{sx,sy,sz,voxels,muzzle}, meta, ids:{namespace,itemId,packFormat,target}}} state
 */
function serializeProject(state) {
  const s = state.snapshot;
  return {
    format: PROJECT_FORMAT,
    generatedBy: "Natane's Voxel & Data Forge",
    ids: state.ids || {},
    grid: { sx: s.sx, sy: s.sy, sz: s.sz },
    // 面ピクセル解像度。既定8（標準）なら null 化＝従来JSONと差分ゼロ（後方互換）
    faceRes: (s.faceRes && s.faceRes !== 8) ? s.faceRes : null,
    // voxels は [[x,y,z,"#rrggbb"], ...]
    voxels: s.voxels,
    muzzle: s.muzzle || null,
    meta: state.meta || null,
    bones: (s.bones && s.bones.length) ? s.bones : null,      // [{name,pivot,parent}]
    boneMap: (s.boneMap && s.boneMap.length) ? s.boneMap : null, // [["x,y,z","name"], ...]
    // 面色レイヤ。未使用時は null 化＝従来JSONと差分なし（後方互換）
    faceColors: (s.faceColors && s.faceColors.length) ? s.faceColors : null, // [[x,y,z,face,color], ...]
    facePixels: (s.facePixels && s.facePixels.length) ? s.facePixels : null, // [[x,y,z,face,[colors...]], ...]
    customAnims: state.customAnims || null,                   // [{name,length,loop,bone,keyframes}]
  };
}

/** プロジェクトJSON(プレーンオブジェクト)を編集可能な状態へ復元 */
function deserializeProject(obj) {
  if (!obj || typeof obj !== 'object') throw new Error('プロジェクトデータが空です');
  if (obj.format && String(obj.format).indexOf('natane-forge-project') !== 0) {
    throw new Error('対応していないファイル形式です: ' + obj.format);
  }
  const g = obj.grid || {};
  const sx = clampGrid(g.sx), sy = clampGrid(g.sy), sz = clampGrid(g.sz);
  const data = new VoxelData(sx, sy, sz);
  // 面ピクセル解像度（未定義/不正は既定8）。facePixels 流し込みより前に確定。
  const faceRes = ([4, 8, 16].indexOf(obj.faceRes) >= 0) ? obj.faceRes : 8;
  data.setFaceRes(faceRes);
  const voxels = Array.isArray(obj.voxels) ? obj.voxels : [];
  let dropped = 0;
  for (const v of voxels) {
    if (!Array.isArray(v) || v.length < 4) { dropped++; continue; }
    const [x, y, z, color] = v;
    if (!data.set(x | 0, y | 0, z | 0, normalizeColor(color))) dropped++;
  }
  return {
    data,
    grid: { sx, sy, sz },
    faceRes,
    muzzle: obj.muzzle && typeof obj.muzzle === 'object'
      ? { x: +obj.muzzle.x || 0, y: +obj.muzzle.y || 0, z: +obj.muzzle.z || 0 } : null,
    meta: obj.meta || null,
    ids: obj.ids || {},
    bones: Array.isArray(obj.bones) ? obj.bones : null,
    boneMap: Array.isArray(obj.boneMap) ? obj.boneMap : null,
    // 面色レイヤ。[x,y,z,face,color] の長さ5要素のみ採用（中身検証は editor.setFace 側に委譲）
    faceColors: Array.isArray(obj.faceColors)
      ? obj.faceColors.filter((e) => Array.isArray(e) && e.length === 5) : null,
    // 面ピクセル。[x,y,z,face,[colors...]] の形のみ採用
    facePixels: Array.isArray(obj.facePixels)
      ? obj.facePixels.filter((e) => Array.isArray(e) && e.length === 5 && Array.isArray(e[4])) : null,
    customAnims: Array.isArray(obj.customAnims) ? obj.customAnims : [],
    dropped,
  };
}

function clampGrid(v) {
  let n = parseInt(v, 10);
  if (isNaN(n)) n = 16;
  return Math.max(1, Math.min(128, n));
}

function normalizeColor(c) {
  if (typeof c !== 'string') return '#888888';
  const m = c.trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(m) ? m : '#888888';
}

/** プロジェクトを .vdf.json としてダウンロード */
function downloadProject(projectObj, fileName) {
  const blob = new Blob([JSON.stringify(projectObj, null, 2)], { type: 'application/json' });
  saveAs(blob, (fileName || 'project') + '.vdf.json');
}

/** File -> プロジェクトJSON(プレーンオブジェクト)。失敗時 reject */
function readProjectFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('ファイルの読み込みに失敗しました'));
    reader.onload = () => {
      try {
        resolve(JSON.parse(reader.result));
      } catch (e) {
        reject(new Error('JSONとして解釈できませんでした: ' + e.message));
      }
    };
    reader.readAsText(file);
  });
}
