/* faceOrient.js
 * 面UV向きの「唯一の真実」を1箇所に集約するモジュール（UMDグローバル window.FaceOrient）。
 *
 * 【正準グリッド(canonical)】
 *   外から面を見て px = 右(0..res-1), py = 下(0..res-1)。配列 index は idx = py*res + px。
 *   facePixels[face] の Array はこの正準順で格納されるものとする（唯一の真実）。
 *
 * 【atlas タイル画素の規約】
 *   texture.js は arr[py*res+px] を canvas(ox+px, oy+py) に描く。
 *   よって「atlas タイル画素(tx,ty) == 正準(px=tx, py=ty)」を全面共通の不変規約とする。
 *
 * 各レンダラ（エディタ Three.js / Java in-game / Bedrock in-game）は、
 * この atlas タイルの (px=0,py=0) を「外から見た面の左上」に表示するよう、
 * 面ごとの UV 反転/回転をここで一元的に与える。
 *
 * 純関数のみ。Three や新APIに依存しない。コメントは日本語。
 *
 * 【FACE_UV 各面パラメータ】
 *   editorFlipX/editorFlipY : (a) エディタ hit.uv→正準 の col/row 反転（Three r137 BoxGeometry UV由来）
 *   javaFlipU/javaFlipV/javaRot : (c) Java face.uv の角入替(反転) と rotation（MC既定面UV由来）
 *   bedrockFlipU/bedrockFlipV   : (d) Bedrock uv/uv_size の符号反転（Bedrock既定面UV由来）
 *
 * 導出（座標系 north=-Z,south=+Z,east=+X,west=-X,up=+Y,down=-Y）:
 *  - (a) Three r137 BoxGeometry の各面 uvX+/uvY+ 方向を正準 px+/py+ に写像 → 全面 swap無しの単純反転。
 *        全面 editorFlipY=true（box の uvY+ は「上」だが正準 py+ は「下」のため）。
 *  - (c) MC既定: side面(N/S/E/W)はそのまま, up/down は V反転（rotation は全面0）。
 *  - (d) Bedrock既定: side面はU反転, up はそのまま, down はV反転。
 */
(function (global) {
  'use strict';

  // 6面の唯一の真実テーブル
  var FACE_UV = {
    north: { editorFlipX: false, editorFlipY: true, javaFlipU: false, javaFlipV: false, javaRot: 0, bedrockFlipU: true,  bedrockFlipV: false },
    south: { editorFlipX: false, editorFlipY: true, javaFlipU: false, javaFlipV: false, javaRot: 0, bedrockFlipU: true,  bedrockFlipV: false },
    east:  { editorFlipX: true,  editorFlipY: true, javaFlipU: false, javaFlipV: false, javaRot: 0, bedrockFlipU: true,  bedrockFlipV: false },
    west:  { editorFlipX: true,  editorFlipY: true, javaFlipU: false, javaFlipV: false, javaRot: 0, bedrockFlipU: true,  bedrockFlipV: false },
    up:    { editorFlipX: false, editorFlipY: true, javaFlipU: false, javaFlipV: true,  javaRot: 0, bedrockFlipU: false, bedrockFlipV: false },
    down:  { editorFlipX: false, editorFlipY: true, javaFlipU: false, javaFlipV: true,  javaRot: 0, bedrockFlipU: false, bedrockFlipV: true },
  };

  function _clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  /**
   * (a) エディタ hit.uv → 正準 idx。
   * col=floor(uvx*res), row=floor(uvy*res)（Three の素の面ローカルUV, u右/v上）。
   * 面別 editorFlipX/Y で col/row を反転し、px,py（正準）へ。idx=py*res+px。
   */
  function hitUvToCanon(face, uvx, uvy, res) {
    var m = FACE_UV[face];
    if (!m) return 0;
    var col = _clamp(Math.floor(uvx * res), 0, res - 1);
    var row = _clamp(Math.floor(uvy * res), 0, res - 1);
    var px = m.editorFlipX ? (res - 1 - col) : col;
    var py = m.editorFlipY ? (res - 1 - row) : row;
    return py * res + px;
  }

  /**
   * (a') 正準 idx → エディタ用 (col,row)（hitUvToCanon の逆写像）。
   * エディタ表示で「正準 arr を Three の素のUVへ正しく貼る」ために、
   * _faceTexture が canvas のどこに各正準画素を描けばよいかを返す。
   * canvas(col,row) に arr[py*res+px] を描けば、hit.uv=col/row の位置と一致する（自己整合）。
   */
  function canonToEditorCell(face, px, py, res) {
    var m = FACE_UV[face];
    if (!m) return [px, py];
    var col = m.editorFlipX ? (res - 1 - px) : px;
    var row = m.editorFlipY ? (res - 1 - py) : py;
    return [col, row];
  }

  /** (b) 正準 → atlas タイル画素（恒等。規約の明示）。 */
  function canonToAtlasPixel(px, py) { return [px, py]; }

  /**
   * (c) Java face.uv（0〜16基準）。texel=[tx,ty]（タイル左上画素）, dim=アトラス1辺画素。
   * 既定は [左,上,右,下]=[u0,v0,u1,v1]。面別 flip で角を入替え、必要なら rotation を付ける。
   * 返り値: { uv:[..], rotation? }。rotation が 0 のときは付けない（後方互換のため最小差分）。
   */
  function javaFaceUv(texel, res, dim, face) {
    var m = FACE_UV[face] || { javaFlipU: false, javaFlipV: false, javaRot: 0 };
    var k = 16 / dim;
    var u0 = texel[0] * k, v0 = texel[1] * k;
    var u1 = (texel[0] + res) * k, v1 = (texel[1] + res) * k;
    var uu0 = u0, uu1 = u1, vv0 = v0, vv1 = v1;
    if (m.javaFlipU) { uu0 = u1; uu1 = u0; } // 左右反転（u1>u2）
    if (m.javaFlipV) { vv0 = v1; vv1 = v0; } // 上下反転（v1>v2）
    var out = { uv: [uu0, vv0, uu1, vv1] };
    if (m.javaRot) out.rotation = m.javaRot;
    return out;
  }

  /**
   * (d) Bedrock face uv/uv_size。texel=[tx,ty]（タイル左上画素）。
   * uv_size 負で軸反転。flipU: uv=[tx+res,ty], uv_size[-res]。flipV: uv=[tx,ty+res], uv_size[-res]。
   */
  function bedrockFaceUv(texel, res, face) {
    var m = FACE_UV[face] || { bedrockFlipU: false, bedrockFlipV: false };
    var ux = texel[0], uy = texel[1], uw = res, uh = res;
    if (m.bedrockFlipU) { ux = texel[0] + res; uw = -res; }
    if (m.bedrockFlipV) { uy = texel[1] + res; uh = -res; }
    return { uv: [ux, uy], uv_size: [uw, uh] };
  }

  /** 正準 idx の左右ミラー（px→res-1-px）。健全性検証/将来のミラー対応用 */
  function mirrorIdxX(idx, res) { var px = idx % res, py = (idx - px) / res; return py * res + (res - 1 - px); }
  /** 正準 idx の上下ミラー（py→res-1-py） */
  function mirrorIdxY(idx, res) { var px = idx % res, py = (idx - px) / res; return (res - 1 - py) * res + px; }

  var FaceOrient = {
    FACE_UV: FACE_UV,
    hitUvToCanon: hitUvToCanon,
    canonToEditorCell: canonToEditorCell,
    canonToAtlasPixel: canonToAtlasPixel,
    javaFaceUv: javaFaceUv,
    bedrockFaceUv: bedrockFaceUv,
    mirrorIdxX: mirrorIdxX,
    mirrorIdxY: mirrorIdxY,
  };

  global.FaceOrient = FaceOrient;
  // Node テスト用（vm/グローバル両対応）。window!=真のグローバルな vm 環境でも
  // bare な FaceOrient で参照できるよう、真のグローバルにも公開する。
  if (typeof globalThis !== 'undefined' && globalThis !== global) globalThis.FaceOrient = FaceOrient;
  if (typeof module !== 'undefined' && module.exports) module.exports = FaceOrient;
})(typeof window !== 'undefined' ? window : this);
