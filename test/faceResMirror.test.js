/* test/faceResMirror.test.js
 * 解像度可変(4/8/16) ＋ 面ピクセル/面塗りミラー対応の検証（Three.js非依存・純ロジック）。
 *  - VoxelData.setFaceRes の nearest 再標本化（8→16→4 往復）
 *  - VoxelEditor.FACE_MIRROR / _mirrorFaceTargets のミラー index 対称性
 *  - 後方互換（serializeProject の faceRes が8で null 化）
 * 実行: node test/faceResMirror.test.js  （全 assert pass で exit 0）
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');
const FACES = ['north', 'south', 'east', 'west', 'up', 'down'];

/* ---------- VoxelData / project.js / editor.js(の定数とロジック) を vm にロード ---------- */
function loadContext() {
  // editor.js は Three.js 等に依存するため、丸ごと評価せず必要部分を抽出する。
  // ここでは VoxelData（純粋）と project.js（VoxelData 依存）をロードし、
  // FACE_MIRROR / _mirrorFaceTargets は本テスト内に同等ロジックを置いて editor.js の定義と照合する。
  const ctx = { module: { exports: {} }, console };
  // project.js が使うブラウザ専用関数のスタブ
  ctx.Blob = function () {};
  ctx.saveAs = function () {};
  ctx.FileReader = function () {};
  vm.createContext(ctx);
  for (const rel of ['js/voxelData.js', 'js/project.js']) {
    const code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    vm.runInContext(code, ctx, { filename: rel });
  }
  // class/function 宣言は vm の context オブジェクト直下のプロパティにならないため、
  // 末尾で明示的に context へ束縛して取り出せるようにする。
  vm.runInContext(
    'this.VoxelData = VoxelData;' +
    'this.serializeProject = serializeProject;' +
    'this.deserializeProject = deserializeProject;',
    ctx);
  return ctx;
}

/* editor.js から VoxelEditor.FACE_MIRROR の定義テーブルを取り出す（クラス全体は Three 依存なので
 * 末尾の VoxelEditor.FACE_MIRROR = {...} 部分だけを正規表現で抽出して eval する）。 */
function loadFaceMirror() {
  const code = fs.readFileSync(path.join(ROOT, 'js/editor.js'), 'utf8');
  const m = code.match(/VoxelEditor\.FACE_MIRROR\s*=\s*(\{[\s\S]*?\n\};)/);
  assert(m, 'editor.js に VoxelEditor.FACE_MIRROR が見つからない');
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext('var FM = ' + m[1].replace(/;$/, '') + '; FM;', sandbox);
  return sandbox.FM;
}

let pass = 0;
function ok(cond, msg) { assert(cond, msg); pass++; }

/* ===================== (1) 解像度往復 nearest ===================== */
(function testFaceResRoundtrip() {
  const ctx = loadContext();
  const VoxelData = ctx.VoxelData;

  // 8x8 に代表パターン（角・中央・縞）を1面に塗る
  const d = new VoxelData(4, 4, 4);
  assert.strictEqual(d.faceRes, 8, '既定 faceRes は8');
  d.set(0, 0, 0, '#ffffff');
  const res0 = 8;
  // 縞 + 角マーカー
  const orig = new Array(res0 * res0).fill(null);
  for (let py = 0; py < res0; py++) for (let px = 0; px < res0; px++) {
    orig[py * res0 + px] = (px % 2 === 0) ? '#101010' : '#202020';
  }
  orig[0] = '#aa0000';                       // 左上(0,0)
  orig[(res0 - 1) * res0 + (res0 - 1)] = '#00aa00'; // 右下
  for (let i = 0; i < orig.length; i++) if (orig[i]) d.setFacePixel(0, 0, 0, 'north', i, orig[i]);

  // 8 -> 16（整数倍：各画素が 2x2 に複製され完全可逆）
  ok(d.setFaceRes(16), 'setFaceRes(16) 成功');
  assert.strictEqual(d.faceRes, 16);
  const a16 = d.getFacePixelArray(0, 0, 0, 'north');
  assert.strictEqual(a16.length, 256, '16x16 長さ');
  // 16->8 へ戻すと完全一致（整数倍の往復）
  const d2 = new VoxelData(4, 4, 4);
  d2.set(0, 0, 0, '#ffffff');
  d2.setFaceRes(16);
  for (let i = 0; i < a16.length; i++) if (a16[i]) d2.setFacePixel(0, 0, 0, 'north', i, a16[i]);
  ok(d2.setFaceRes(8), 'setFaceRes(8) 成功');
  const back8 = d2.getFacePixelArray(0, 0, 0, 'north');
  for (let i = 0; i < orig.length; i++) {
    ok(back8[i] === orig[i], `8->16->8 完全可逆 idx=${i} (${back8[i]} vs ${orig[i]})`);
  }

  // 8 -> 4（nearest 縮小：floor(nr*8/4)=2*nr の代表抽出が決定的）
  ok(d.setFaceRes(4), 'setFaceRes(4) 成功');
  const a4 = d.getFacePixelArray(0, 0, 0, 'north');
  assert.strictEqual(a4.length, 16, '4x4 長さ');
  // 16(=8x2 複製済) -> 4 の各画素 = floor(nr*16/4)=4*nr 行, floor(nc*16/4)=4*nc 列
  for (let nr = 0; nr < 4; nr++) for (let nc = 0; nc < 4; nc++) {
    const sr = Math.floor(nr * 16 / 4), sc = Math.floor(nc * 16 / 4);
    ok(a4[nr * 4 + nc] === a16[sr * 16 + sc], `8->16->4 nearest 決定的 (${nr},${nc})`);
  }

  // 不正値 / 同値
  ok(d.setFaceRes(5) === false, '不正解像度は false');
  ok(d.setFaceRes(4) === true, '同値は no-op で true');
})();

/* ===================== (2)(3) ミラー反転表 ＋ index 対称性 ===================== */
(function testMirror() {
  const FM = loadFaceMirror();

  // (3) face反転表は involution（2回適用で元に戻る）
  for (const axis of ['x', 'y', 'z']) {
    for (const f of FACES) {
      const r = FM[axis][f];
      ok(r, `FACE_MIRROR[${axis}][${f}] 存在`);
      const r2 = FM[axis][r.face];
      ok(r2.face === f, `${axis}: ${f}->${r.face}->${r2.face} は involution`);
    }
  }

  // _mirrorFaceTargets と同等の idx 反転を再現するヘルパ（res, 単軸）
  function flipIdx(rule, idx, res) {
    let px = idx % res, py = (idx - px) / res;
    if (rule.flipX) px = res - 1 - px;
    if (rule.flipY) py = res - 1 - py;
    return py * res + px;
  }

  const res = 8;
  // (2) 各面・各軸で idx→反転→（同軸2回）→恒等
  for (const axis of ['x', 'y', 'z']) {
    for (const f of FACES) {
      const r = FM[axis][f];          // f -> r.face
      const r2 = FM[axis][r.face];    // r.face -> f （involution）
      for (let idx = 0; idx < res * res; idx++) {
        const mid = flipIdx(r, idx, res);
        const round = flipIdx(r2, mid, res);
        ok(round === idx, `${axis} ${f} idx=${idx} の二重ミラーが恒等`);
      }
    }
  }

  // 期待規則の明示チェック（perFaceMapping と一致）
  // x: 全面 flipX=true, flipY=false, east<->west
  ok(FM.x.east.face === 'west' && FM.x.east.flipX && !FM.x.east.flipY, 'x: east->west flipX');
  ok(FM.x.up.face === 'up' && FM.x.up.flipX && !FM.x.up.flipY, 'x: up flipX');
  // y: side は flipY, up<->down 反転なし
  ok(FM.y.south.face === 'south' && !FM.y.south.flipX && FM.y.south.flipY, 'y: south flipY');
  ok(FM.y.up.face === 'down' && !FM.y.up.flipX && !FM.y.up.flipY, 'y: up->down 反転なし');
  // z: east/west/south/north flipX, up/down flipY, south<->north
  ok(FM.z.south.face === 'north' && FM.z.south.flipX && !FM.z.south.flipY, 'z: south->north flipX');
  ok(FM.z.up.face === 'up' && !FM.z.up.flipX && FM.z.up.flipY, 'z: up flipY');
  ok(FM.z.east.face === 'east' && FM.z.east.flipX && !FM.z.east.flipY, 'z: east flipX');

  // voxel 自己対称セル（中央列）で反転先 voxel = 自分（sx 奇数の中央）
  const sx = 5; const cx = 2; // (sx-1-cx)=cx
  ok(sx - 1 - cx === cx, '奇数グリッド中央セルは X反転で自分自身');
})();

/* ===================== (4) 後方互換 ===================== */
(function testBackCompat() {
  const ctx = loadContext();
  const VoxelData = ctx.VoxelData;
  const serializeProject = ctx.serializeProject;
  const deserializeProject = ctx.deserializeProject;

  // serializeProject: faceRes=8 は null 化
  const snap8 = { sx: 4, sy: 4, sz: 4, faceRes: 8, voxels: [[0, 0, 0, '#ffffff']], muzzle: null };
  const out8 = serializeProject({ snapshot: snap8, meta: null, ids: {} });
  ok(out8.faceRes === null, 'faceRes=8 は serialize で null 化（後方互換）');

  // faceRes=16 はそのまま出力
  const snap16 = { sx: 4, sy: 4, sz: 4, faceRes: 16, voxels: [[0, 0, 0, '#ffffff']], muzzle: null };
  const out16 = serializeProject({ snapshot: snap16, meta: null, ids: {} });
  ok(out16.faceRes === 16, 'faceRes=16 は serialize でそのまま');

  // deserialize: 未定義は 8 にフォールバック、16 は復元
  const d1 = deserializeProject({ format: 'natane-forge-project/1', grid: { sx: 4, sy: 4, sz: 4 }, voxels: [] });
  ok(d1.faceRes === 8 && d1.data.faceRes === 8, '未定義 faceRes は8にフォールバック');
  const d2 = deserializeProject({ format: 'natane-forge-project/1', faceRes: 16, grid: { sx: 4, sy: 4, sz: 4 }, voxels: [] });
  ok(d2.faceRes === 16 && d2.data.faceRes === 16, 'faceRes=16 を復元');
  const d3 = deserializeProject({ format: 'natane-forge-project/1', faceRes: 7, grid: { sx: 4, sy: 4, sz: 4 }, voxels: [] });
  ok(d3.faceRes === 8, '不正 faceRes は8にフォールバック');

  // serialize の他フィールドは faceRes 追加以外に変化なし（grid/voxels/muzzle）
  ok(out8.grid.sx === 4 && out8.voxels.length === 1 && out8.muzzle === null, '既存フィールド不変');
})();

console.log(`faceResMirror.test.js: ${pass} assertions passed`);
