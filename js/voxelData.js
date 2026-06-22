/* voxelData.js
 * ボクセルデータの保持クラス（可変グリッド対応）。
 * 形状フォーマットに依存しない中立データ。後でモブ用エクスポーター等が
 * この構造を読むだけで動くよう、描画/出力ロジックからは切り離している。
 */
class VoxelData {
  constructor(sx = 16, sy = 16, sz = 16) {
    this.sx = sx;
    this.sy = sy;
    this.sz = sz;
    this.map = new Map(); // key "x,y,z" -> color("#rrggbb")
    // 面色レイヤ（オーバーレイ）。key "x,y,z,face" -> color。
    // デフォルト空＝面色なし＝本体色を使用。空のときは既存挙動・既存出力に一切影響しない。
    this.faceColors = new Map();
  }

  key(x, y, z) { return x + ',' + y + ',' + z; }

  faceKey(x, y, z, face) { return x + ',' + y + ',' + z + ',' + face; }

  inBounds(x, y, z) {
    return x >= 0 && y >= 0 && z >= 0 && x < this.sx && y < this.sy && z < this.sz;
  }

  set(x, y, z, color) {
    if (!this.inBounds(x, y, z)) return false;
    this.map.set(this.key(x, y, z), color);
    return true;
  }

  remove(x, y, z) {
    // 本体色削除に連動してその voxel の全面色も削除
    for (const f of VoxelData.FACES) this.faceColors.delete(this.faceKey(x, y, z, f));
    return this.map.delete(this.key(x, y, z));
  }

  get(x, y, z) { return this.map.get(this.key(x, y, z)); }

  has(x, y, z) { return this.map.has(this.key(x, y, z)); }

  clear() { this.map.clear(); this.faceColors.clear(); }

  /* ---------- 面色レイヤ ---------- */
  /** 面色を設定（voxel が存在するときのみ）。成功で true */
  setFace(x, y, z, face, color) {
    if (!this.inBounds(x, y, z)) return false;
    if (!this.has(x, y, z)) return false;
    if (VoxelData.FACES.indexOf(face) < 0) return false;
    this.faceColors.set(this.faceKey(x, y, z, face), color);
    return true;
  }

  /** 面色を取得（無ければ undefined） */
  getFace(x, y, z, face) { return this.faceColors.get(this.faceKey(x, y, z, face)); }

  /** 面色を削除 */
  removeFace(x, y, z, face) { return this.faceColors.delete(this.faceKey(x, y, z, face)); }

  /** その voxel に1面でも面色があるか */
  hasFace(x, y, z) {
    for (const f of VoxelData.FACES) {
      if (this.faceColors.has(this.faceKey(x, y, z, f))) return true;
    }
    return false;
  }

  /** その voxel の面色 {face:color}（無ければ空オブジェクト） */
  facesOf(x, y, z) {
    const out = {};
    for (const f of VoxelData.FACES) {
      const c = this.faceColors.get(this.faceKey(x, y, z, f));
      if (c !== undefined) out[f] = c;
    }
    return out;
  }

  /** [[x,y,z,face,color], ...] を返す */
  faceEntries() {
    const out = [];
    for (const [k, color] of this.faceColors) {
      const i = k.lastIndexOf(',');
      const face = k.slice(i + 1);
      const [x, y, z] = k.slice(0, i).split(',').map(Number);
      out.push([x, y, z, face, color]);
    }
    return out;
  }

  count() { return this.map.size; }

  /** グリッドサイズ変更。範囲外に出たボクセルは破棄。 */
  resize(sx, sy, sz) {
    this.sx = sx; this.sy = sy; this.sz = sz;
    for (const k of [...this.map.keys()]) {
      const [x, y, z] = k.split(',').map(Number);
      if (!this.inBounds(x, y, z)) this.map.delete(k);
    }
    // 範囲外に出た面色も破棄（key は "x,y,z,face"）
    for (const k of [...this.faceColors.keys()]) {
      const p = k.split(',');
      const x = Number(p[0]), y = Number(p[1]), z = Number(p[2]);
      if (!this.inBounds(x, y, z)) this.faceColors.delete(k);
    }
  }

  /** [[x,y,z,color], ...] を返す */
  entries() {
    const out = [];
    for (const [k, color] of this.map) {
      const [x, y, z] = k.split(',').map(Number);
      out.push([x, y, z, color]);
    }
    return out;
  }

  /** 使用色の一覧（重複なし）。本体色のみ（既存維持） */
  colors() { return [...new Set(this.map.values())]; }

  /** 本体色＋面色を含む全色（重複なし。本体色を先に並べる） */
  allColors() {
    const set = new Set(this.map.values());
    for (const c of this.faceColors.values()) set.add(c);
    return [...set];
  }
}

// 面名定数（north=-Z, south=+Z, east=+X, west=-X, up=+Y, down=-Y）
VoxelData.FACES = ['north', 'south', 'east', 'west', 'up', 'down'];
