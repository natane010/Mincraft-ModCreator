/* templates.js
 * 防具・武器・モブの「ざっくりした形」プリセット集。
 * 各テンプレートの build() は VoxelData を返す（編集の出発点）。
 * 雛形を足したいときは TEMPLATES に1件追加するだけでUIに出る。
 */

// ---- 生成ヘルパ ----
function fill(d, x0, y0, z0, w, h, dep, color) {
  for (let x = x0; x < x0 + w; x++)
    for (let y = y0; y < y0 + h; y++)
      for (let z = z0; z < z0 + dep; z++) d.set(x, y, z, color);
}
function carve(d, x0, y0, z0, w, h, dep) {
  for (let x = x0; x < x0 + w; x++)
    for (let y = y0; y < y0 + h; y++)
      for (let z = z0; z < z0 + dep; z++) d.remove(x, y, z);
}

// ---- 共通カラー ----
const C = {
  metal: '#9aa0a6', darkmetal: '#5a6378', blade: '#d9dde3',
  wood: '#7f5539', skin: '#e0ac69', zombie: '#5a8f3c',
  shirt: '#3a8ee6', pants: '#2b3140', pink: '#e79fb0',
  snout: '#d98f9e', slime: '#5fd35f', eye: '#2b2b2b',
};

const TEMPLATES = [
  // ===== 武器 =====
  {
    id: 'sword', name: '剣', category: '武器', sx: 16, sy: 16, sz: 16,
    build() {
      const d = new VoxelData(16, 16, 16);
      fill(d, 7, 1, 7, 2, 3, 2, C.wood);      // 柄
      fill(d, 5, 4, 7, 6, 1, 2, C.darkmetal); // 鍔(つば)
      fill(d, 7, 5, 7, 2, 10, 2, C.blade);    // 刃
      return d;
    },
  },
  {
    id: 'gun', name: '銃(ライフル)', category: '武器', sx: 16, sy: 10, sz: 16,
    build() {
      const d = new VoxelData(16, 10, 16);
      fill(d, 1, 5, 7, 13, 2, 2, C.darkmetal); // 銃身
      fill(d, 4, 3, 7, 6, 3, 2, C.metal);      // 機関部
      fill(d, 5, 0, 7, 2, 3, 2, C.wood);       // グリップ
      fill(d, 9, 3, 7, 4, 2, 2, C.wood);       // ストック
      fill(d, 6, 7, 7, 1, 1, 2, C.darkmetal);  // 照準
      return d;
    },
  },
  {
    id: 'axe', name: '斧', category: '武器', sx: 16, sy: 16, sz: 16,
    build() {
      const d = new VoxelData(16, 16, 16);
      fill(d, 7, 0, 7, 2, 12, 2, C.wood);   // 柄
      fill(d, 9, 8, 7, 4, 5, 2, C.metal);   // 斧頭
      fill(d, 13, 8, 7, 1, 5, 2, C.blade);  // 刃先
      return d;
    },
  },

  // ===== 防具 =====
  {
    id: 'helmet', name: 'ヘルメット', category: '防具', sx: 10, sy: 10, sz: 10,
    build() {
      const d = new VoxelData(10, 10, 10);
      fill(d, 1, 2, 1, 8, 6, 8, C.metal); // 頭部ブロック
      carve(d, 2, 2, 7, 6, 3, 2);          // 顔の開口部(前面下)
      return d;
    },
  },
  {
    id: 'chestplate', name: '胸当て', category: '防具', sx: 10, sy: 14, sz: 6,
    build() {
      const d = new VoxelData(10, 14, 6);
      fill(d, 1, 1, 1, 8, 12, 4, C.metal); // 胴
      carve(d, 3, 11, 1, 4, 3, 4);          // 首まわりの抜き
      return d;
    },
  },

  // ===== モブ =====
  {
    id: 'humanoid', name: '人型(ゾンビ風)', category: 'モブ', sx: 12, sy: 32, sz: 8,
    build() {
      const d = new VoxelData(12, 32, 8);
      fill(d, 2, 24, 0, 8, 8, 8, C.zombie);  // 頭
      fill(d, 2, 12, 2, 8, 12, 4, C.shirt);  // 胴
      fill(d, 0, 12, 2, 2, 12, 4, C.zombie); // 右腕
      fill(d, 10, 12, 2, 2, 12, 4, C.zombie);// 左腕
      fill(d, 2, 0, 2, 3, 12, 4, C.pants);   // 右脚
      fill(d, 7, 0, 2, 3, 12, 4, C.pants);   // 左脚
      return d;
    },
  },
  {
    id: 'quadruped', name: '四足(豚風)', category: 'モブ', sx: 14, sy: 14, sz: 18,
    build() {
      const d = new VoxelData(14, 14, 18);
      fill(d, 2, 6, 2, 10, 6, 12, C.pink);    // 胴
      fill(d, 3, 5, 14, 8, 7, 4, C.pink);     // 頭
      fill(d, 5, 6, 17, 4, 3, 1, C.snout);    // 鼻先
      fill(d, 3, 0, 3, 2, 6, 2, C.pink);      // 脚x4
      fill(d, 9, 0, 3, 2, 6, 2, C.pink);
      fill(d, 3, 0, 11, 2, 6, 2, C.pink);
      fill(d, 9, 0, 11, 2, 6, 2, C.pink);
      return d;
    },
  },
  {
    id: 'slime', name: 'スライム', category: 'モブ', sx: 12, sy: 12, sz: 12,
    build() {
      const d = new VoxelData(12, 12, 12);
      fill(d, 2, 0, 2, 8, 8, 8, C.slime); // 本体
      fill(d, 3, 4, 9, 1, 1, 1, C.eye);   // 目
      fill(d, 7, 4, 9, 1, 1, 1, C.eye);
      fill(d, 5, 2, 9, 2, 1, 1, C.eye);   // 口
      return d;
    },
  },
];
