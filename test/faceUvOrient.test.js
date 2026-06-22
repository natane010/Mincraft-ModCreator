/* test/faceUvOrient.test.js
 * 面UV向きの厳密一致テスト（Three.js非依存・純ロジック）。
 * faceOrient.js と texture.js を vm で window グローバルとしてロードし、
 * 「正準(px,py)に印を塗る → atlas画素 → 各出力UVが指す画素」の一致を機械検証する。
 * 実行: node test/faceUvOrient.test.js  （全 assert pass で exit 0）
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');
const FACES = ['north', 'south', 'east', 'west', 'up', 'down'];

/* ---------- fake DOM canvas: fillRect ログを蓄積する 2d context ---------- */
function makeFakeDocument() {
  function makeCanvas() {
    const calls = [];
    let fillStyle = '#000000';
    const ctx = {
      get fillStyle() { return fillStyle; },
      set fillStyle(v) { fillStyle = v; },
      clearRect() {},
      fillRect(x, y, w, h) { calls.push({ x, y, w, h, color: fillStyle }); },
    };
    return {
      width: 0, height: 0, _calls: calls,
      getContext() { return ctx; },
    };
  }
  return { createElement(tag) { if (tag === 'canvas') return makeCanvas(); return {}; } };
}

/* ---------- faceOrient.js + texture.js を共有 context にロード ---------- */
function loadContext() {
  const ctx = { window: {}, module: { exports: {} }, console };
  ctx.document = makeFakeDocument();
  ctx.window.document = ctx.document;
  vm.createContext(ctx);
  for (const rel of ['js/faceOrient.js', 'js/texture.js']) {
    const code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    vm.runInContext(code, ctx, { filename: rel });
  }
  // texture.js は関数を context 直下のグローバルに定義（クラシックスクリプト）
  return ctx;
}

/* ---------- VoxelData の最小モック（buildFaceAtlas が使う API のみ） ---------- */
function makeDataMock(res, faceArrays /* {"x,y,z,face": arr} */, body) {
  const entries = [];
  const set = new Set();
  for (const k of Object.keys(faceArrays)) {
    const p = k.split(',');
    const key3 = p[0] + ',' + p[1] + ',' + p[2];
    if (!set.has(key3)) { set.add(key3); entries.push([+p[0], +p[1], +p[2], body]); }
  }
  return {
    faceRes: res,
    facePixelEntries() {
      return Object.keys(faceArrays).map((k) => {
        const p = k.split(',');
        return [+p[0], +p[1], +p[2], p[3], faceArrays[k].slice()];
      });
    },
    allColors() { return [body]; },
    get() { return body; },
    entries() { return entries.map((e) => e.slice()); },
  };
}

let passed = 0;
function ok(cond, msg) { assert.ok(cond, msg); passed++; }

/* ============ 観点1: 正準(px,py) → atlas タイル画素が (px,py) ============ */
function testAtlasCanonical(ctx) {
  for (const res of [4, 8]) {
    const FaceOrient = ctx.window.FaceOrient;
    // 各正準位置に区別可能な色（緑成分=px, 青成分=py を埋め込む）
    const arr = new Array(res * res).fill(null);
    const colorOf = (px, py) => '#00' + (px * 16).toString(16).padStart(2, '0') + (py * 16).toString(16).padStart(2, '0');
    for (let py = 0; py < res; py++) for (let px = 0; px < res; px++) arr[py * res + px] = colorOf(px, py);

    const data = makeDataMock(res, { '0,0,0,north': arr }, '#111111');
    data.faceRes = res;
    const atlas = ctx.buildFaceAtlas(data);
    ok(atlas.used === true, 'atlas used true (res=' + res + ')');

    // render の fillRect ログ（canvas は document.createElement('canvas') 由来）
    // buildFaceAtlas は内部で render() を1回呼んでいる。その canvas の _calls を拾う。
    const canvas = atlas.canvas;
    const calls = canvas._calls;
    // ピクセルタイルの先頭画素群を検証: 色 colorOf(px,py) が (ox+px, oy+py) に描かれる
    const [ox, oy] = atlas.faceTexel(0, 0, 0, 'north');
    for (let py = 0; py < res; py++) for (let px = 0; px < res; px++) {
      const want = colorOf(px, py);
      const hit = calls.find((c) => c.x === ox + px && c.y === oy + py && c.w === 1 && c.h === 1);
      ok(hit && hit.color === want, `atlas画素 res=${res} (${px},${py}) -> color ${want} at (${ox + px},${oy + py})`);
    }
    // 規約: canonToAtlasPixel は恒等
    ok(JSON.stringify(FaceOrient.canonToAtlasPixel(2, 1)) === '[2,1]', 'canonToAtlasPixel 恒等');
  }
}

/* ============ 観点2: hitUv → 正準 往復（display逆写像と一致） ============ */
function testHitUvRoundTrip(ctx) {
  const FaceOrient = ctx.window.FaceOrient;
  for (const res of [4, 8]) for (const face of FACES) {
    for (let py = 0; py < res; py++) for (let px = 0; px < res; px++) {
      // 正準(px,py) → エディタ cell(col,row) → その中心の hit.uv → hitUvToCanon
      const [col, row] = FaceOrient.canonToEditorCell(face, px, py, res);
      const uvx = (col + 0.5) / res;
      const uvy = (row + 0.5) / res;
      const idx = FaceOrient.hitUvToCanon(face, uvx, uvy, res);
      ok(idx === py * res + px, `往復 ${face} res=${res} (${px},${py}) idx=${idx} want=${py * res + px}`);
    }
    // 境界 floor 安定性: uv=0, 1-ε
    const i0 = FaceOrient.hitUvToCanon(face, 0, 0, res);
    const i1 = FaceOrient.hitUvToCanon(face, 0.999999, 0.999999, res);
    ok(i0 >= 0 && i0 < res * res, `境界0 ${face}`);
    ok(i1 >= 0 && i1 < res * res, `境界1 ${face}`);
  }
}

/* ============ 観点3: 出力UVが正準(0,0)=atlas左上画素 を指す ============ */
// Java: uv=[u0,v0,u1,v1](0..16), rotation でテクスチャ回転。
// 「面の左上(外から見た px0,py0)」に atlas タイル左上画素(=正準0,0)が来ることを、
// uv の角と rotation から実効サンプル点を逆算して検証する。
function effectiveTexelJava(jf, res, dim, corner) {
  // corner: 'tl'(左上=px0py0) の面ローカル位置に貼られる texture座標(画素)を返す。
  // 既定(rotation0): uv=[u0,v0,u1,v1]。面左上 = (u0,v0)。flipで角入替済み。
  const k = 16 / dim;
  let [u0, v0, u1, v1] = jf.uv;
  // rotation: テクスチャを時計回り回転。本実装は全面 rot=0 を採用しているので簡略に rot0 のみ対応。
  assert.ok(!jf.rotation, 'this test path assumes javaRot=0 (current design)');
  // 面左上に貼られる texel = (u0,v0)
  return [Math.round(u0 / k), Math.round(v0 / k)];
}

function testJavaUv(ctx) {
  const FaceOrient = ctx.window.FaceOrient;
  const res = 8, dim = 16;       // タイル左上 = (0,0)
  const texel = [0, 0];
  for (const face of FACES) {
    const jf = FaceOrient.javaFaceUv(texel, res, dim, face);
    ok(Array.isArray(jf.uv) && jf.uv.length === 4, `java uv 形 ${face}`);
    // 実効：面左上 (px0,py0) に貼られる atlas画素
    const [tx, ty] = effectiveTexelJava(jf, res, dim, 'tl');
    const m = FaceOrient.FACE_UV[face];
    // flipU なら左上の u は u1 側（=texel[0]+res）, flipV なら v は v1 側
    const wantTx = m.javaFlipU ? texel[0] + res : texel[0];
    const wantTy = m.javaFlipV ? texel[1] + res : texel[1];
    ok(tx === wantTx && ty === wantTy, `java 面左上texel ${face} got(${tx},${ty}) want(${wantTx},${wantTy})`);
  }
}

/* Bedrock: uv=[u,v], uv_size=[w,h]。面左上(px0,py0)に貼られる texel = uv（uv_size符号に依らず起点はuv）。 */
function testBedrockUv(ctx) {
  const FaceOrient = ctx.window.FaceOrient;
  const res = 8;
  const texel = [0, 0];
  for (const face of FACES) {
    const bf = FaceOrient.bedrockFaceUv(texel, res, face);
    ok(bf.uv.length === 2 && bf.uv_size.length === 2, `bedrock 形 ${face}`);
    const m = FaceOrient.FACE_UV[face];
    // flipU: uv.x=texel+res, uv_size.x=-res。flipV: uv.y=texel+res, uv_size.y=-res。
    ok(bf.uv[0] === (m.bedrockFlipU ? texel[0] + res : texel[0]), `bedrock uv.x ${face}`);
    ok(bf.uv[1] === (m.bedrockFlipV ? texel[1] + res : texel[1]), `bedrock uv.y ${face}`);
    ok(bf.uv_size[0] === (m.bedrockFlipU ? -res : res), `bedrock uvsize.x ${face}`);
    ok(bf.uv_size[1] === (m.bedrockFlipV ? -res : res), `bedrock uvsize.y ${face}`);
  }
}

/* ============ 観点4: ミラー index 対称性 ============ */
function testMirrorIdx(ctx) {
  const FaceOrient = ctx.window.FaceOrient;
  for (const res of [4, 8]) for (let py = 0; py < res; py++) for (let px = 0; px < res; px++) {
    const idx = py * res + px;
    ok(FaceOrient.mirrorIdxX(idx, res) === py * res + (res - 1 - px), `mirrorX ${res} ${px},${py}`);
    ok(FaceOrient.mirrorIdxY(idx, res) === (res - 1 - py) * res + px, `mirrorY ${res} ${px},${py}`);
    // involution
    ok(FaceOrient.mirrorIdxX(FaceOrient.mirrorIdxX(idx, res), res) === idx, `mirrorX involution`);
    ok(FaceOrient.mirrorIdxY(FaceOrient.mirrorIdxY(idx, res), res) === idx, `mirrorY involution`);
  }
}

/* ============ 後方互換: 面ピクセル空 → used:false ============ */
function testBackCompat(ctx) {
  const empty = {
    faceRes: 8,
    facePixelEntries() { return []; },
    allColors() { return ['#fff']; },
    get() { return '#fff'; },
    entries() { return []; },
  };
  const atlas = ctx.buildFaceAtlas(empty);
  ok(atlas.used === false, '面ピクセル空 → used:false（従来パレット経路維持）');
}

/* ============ 統合: 塗り→atlas→Java/Bedrock UV が同一画素を指す ============ */
// 正準(0,0)=左上 に固有色を塗り、エディタで塗った位置(=hitUv逆算)と
// 出力UVが指す atlas 画素が共に (0,0) であることを確認（3者一致）。
function testIntegration(ctx) {
  const FaceOrient = ctx.window.FaceOrient;
  const res = 8, dim = 16;
  for (const face of FACES) {
    // (a) 塗り: 正準(0,0)の中心 uv を逆算 → hitUvToCanon で idx=0 になる
    const [col, row] = FaceOrient.canonToEditorCell(face, 0, 0, res);
    const idx = FaceOrient.hitUvToCanon(face, (col + 0.5) / res, (row + 0.5) / res, res);
    ok(idx === 0, `統合 塗り正準(0,0) ${face} idx=${idx}`);
    // (c) Java: 面左上に貼られる atlas画素 = (0,0)（flip後の起点）。
    const jf = FaceOrient.javaFaceUv([0, 0], res, dim, face);
    const [jtx, jty] = effectiveTexelJava(jf, res, dim, 'tl');
    const m = FaceOrient.FACE_UV[face];
    // flip 後の左上起点は (flipU?res:0, flipV?res:0)。逆写像でタイル内 (0,0) を指すことを確認。
    const inTileX = m.javaFlipU ? res - jtx : jtx;   // flipUなら起点=res → タイル内0
    const inTileY = m.javaFlipV ? res - jty : jty;
    ok(inTileX === 0 && inTileY === 0, `統合 java左上→タイル内(0,0) ${face}`);
    // (d) Bedrock 同様
    const bf = FaceOrient.bedrockFaceUv([0, 0], res, face);
    const bInX = m.bedrockFlipU ? res - bf.uv[0] : bf.uv[0];
    const bInY = m.bedrockFlipV ? res - bf.uv[1] : bf.uv[1];
    ok(bInX === 0 && bInY === 0, `統合 bedrock左上→タイル内(0,0) ${face}`);
  }
}

/* ---------- 実行 ---------- */
(function main() {
  const ctx = loadContext();
  testAtlasCanonical(ctx);
  testHitUvRoundTrip(ctx);
  testJavaUv(ctx);
  testBedrockUv(ctx);
  testMirrorIdx(ctx);
  testBackCompat(ctx);
  testIntegration(ctx);
  console.log('faceUvOrient.test.js: all ' + passed + ' assertions passed.');
})();
