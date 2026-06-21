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
  }

  key(x, y, z) { return x + ',' + y + ',' + z; }

  inBounds(x, y, z) {
    return x >= 0 && y >= 0 && z >= 0 && x < this.sx && y < this.sy && z < this.sz;
  }

  set(x, y, z, color) {
    if (!this.inBounds(x, y, z)) return false;
    this.map.set(this.key(x, y, z), color);
    return true;
  }

  remove(x, y, z) { return this.map.delete(this.key(x, y, z)); }

  get(x, y, z) { return this.map.get(this.key(x, y, z)); }

  has(x, y, z) { return this.map.has(this.key(x, y, z)); }

  clear() { this.map.clear(); }

  count() { return this.map.size; }

  /** グリッドサイズ変更。範囲外に出たボクセルは破棄。 */
  resize(sx, sy, sz) {
    this.sx = sx; this.sy = sy; this.sz = sz;
    for (const k of [...this.map.keys()]) {
      const [x, y, z] = k.split(',').map(Number);
      if (!this.inBounds(x, y, z)) this.map.delete(k);
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

  /** 使用色の一覧（重複なし） */
  colors() { return [...new Set(this.map.values())]; }
}
