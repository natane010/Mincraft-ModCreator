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
    // 面ピクセルレイヤ。key "x,y,z,face" -> Array(faceRes*faceRes) of color|null。
    // 面を res×res に分割して個別色を塗る（ピクセルアート）。空なら既存挙動に影響なし。
    this.facePixels = new Map();
    this.faceRes = 8; // 面ピクセルの解像度（1辺）
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
    // 本体色削除に連動してその voxel の全面色・面ピクセルも削除
    for (const f of VoxelData.FACES) {
      this.faceColors.delete(this.faceKey(x, y, z, f));
      this.facePixels.delete(this.faceKey(x, y, z, f));
    }
    return this.map.delete(this.key(x, y, z));
  }

  get(x, y, z) { return this.map.get(this.key(x, y, z)); }

  has(x, y, z) { return this.map.has(this.key(x, y, z)); }

  clear() { this.map.clear(); this.faceColors.clear(); this.facePixels.clear(); }

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

  /* ---------- 面ピクセルレイヤ（面を res×res に分割して塗る） ---------- */
  /** 面ピクセル配列を取得（無ければ作る）。voxel が無ければ null */
  _ensureFacePixels(x, y, z, face) {
    if (!this.has(x, y, z) || VoxelData.FACES.indexOf(face) < 0) return null;
    const k = this.faceKey(x, y, z, face);
    let arr = this.facePixels.get(k);
    if (!arr) { arr = new Array(this.faceRes * this.faceRes).fill(null); this.facePixels.set(k, arr); }
    return arr;
  }

  /** 面の idx 番ピクセルに色を設定。成功で true */
  setFacePixel(x, y, z, face, idx, color) {
    const arr = this._ensureFacePixels(x, y, z, face);
    if (!arr || idx < 0 || idx >= arr.length) return false;
    arr[idx] = color;
    return true;
  }

  /** 面ピクセル配列を取得（無ければ undefined） */
  getFacePixelArray(x, y, z, face) { return this.facePixels.get(this.faceKey(x, y, z, face)); }

  /** その voxel に1面でも面ピクセルがあるか */
  hasFacePixels(x, y, z) {
    for (const f of VoxelData.FACES) {
      if (this.facePixels.has(this.faceKey(x, y, z, f))) return true;
    }
    return false;
  }

  /** [[x,y,z,face,arr], ...] を返す（arr はコピー） */
  facePixelEntries() {
    const out = [];
    for (const [k, arr] of this.facePixels) {
      const i = k.lastIndexOf(',');
      const face = k.slice(i + 1);
      const [x, y, z] = k.slice(0, i).split(',').map(Number);
      out.push([x, y, z, face, arr.slice()]);
    }
    return out;
  }

  count() { return this.map.size; }

  /**
   * 面ピクセル解像度を変更（4/8/16）。既存 facePixels を nearest 再標本化して保持。
   * 新 arr[nr*newRes+nc] = old[ floor(nr*old/new)*old + floor(nc*old/new) ]（正準 idx=py*res+px）。
   * 同値は no-op で true。範囲外解像度は false。faceColors/map/bones 等は不変。
   */
  setFaceRes(newRes) {
    if ([4, 8, 16].indexOf(newRes) < 0) return false;
    const oldRes = this.faceRes;
    if (newRes === oldRes) return true;
    for (const [k, oldArr] of this.facePixels) {
      const nArr = new Array(newRes * newRes).fill(null);
      for (let nr = 0; nr < newRes; nr++) {
        const sr = Math.floor(nr * oldRes / newRes);
        for (let nc = 0; nc < newRes; nc++) {
          const sc = Math.floor(nc * oldRes / newRes);
          nArr[nr * newRes + nc] = oldArr[sr * oldRes + sc];
        }
      }
      this.facePixels.set(k, nArr);
    }
    this.faceRes = newRes;
    return true;
  }

  /** グリッドサイズ変更。範囲外に出たボクセルは破棄。 */
  resize(sx, sy, sz) {
    this.sx = sx; this.sy = sy; this.sz = sz;
    for (const k of [...this.map.keys()]) {
      const [x, y, z] = k.split(',').map(Number);
      if (!this.inBounds(x, y, z)) this.map.delete(k);
    }
    // 範囲外に出た面色・面ピクセルも破棄（key は "x,y,z,face"）
    for (const map of [this.faceColors, this.facePixels]) {
      for (const k of [...map.keys()]) {
        const p = k.split(',');
        const x = Number(p[0]), y = Number(p[1]), z = Number(p[2]);
        if (!this.inBounds(x, y, z)) map.delete(k);
      }
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
