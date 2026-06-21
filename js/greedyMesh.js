/* greedyMesh.js
 * ボクセル群を「同色の連続した直方体(box)」へ貪欲にまとめる。
 * Minecraftのモデル要素(element)は from/to の直方体なので、隣接同色を
 * 結合することで要素数を大幅に削減できる（=軽く・上限超過しにくい）。
 *
 * 返り値: [{x,y,z,w,h,d,color}, ...]  (x,y,z は最小角、w/h/d はサイズ)
 */
function greedyBoxes(data) {
  const { sx, sy, sz } = data;
  const visited = new Set();
  const boxes = [];
  const k = (x, y, z) => x + ',' + y + ',' + z;

  const usable = (x, y, z, color) =>
    data.get(x, y, z) === color && !visited.has(k(x, y, z));

  for (let y = 0; y < sy; y++) {
    for (let z = 0; z < sz; z++) {
      for (let x = 0; x < sx; x++) {
        const color = data.get(x, y, z);
        if (color === undefined || visited.has(k(x, y, z))) continue;

        // 1) X方向に幅を伸ばす
        let w = 1;
        while (x + w < sx && usable(x + w, y, z, color)) w++;

        // 2) Y方向に高さを伸ばす（幅w全体が同色である限り）
        let h = 1;
        growY: while (y + h < sy) {
          for (let i = 0; i < w; i++) {
            if (!usable(x + i, y + h, z, color)) break growY;
          }
          h++;
        }

        // 3) Z方向に奥行きを伸ばす（w×h面全体が同色である限り）
        let d = 1;
        growZ: while (z + d < sz) {
          for (let j = 0; j < h; j++) {
            for (let i = 0; i < w; i++) {
              if (!usable(x + i, y + j, z + d, color)) break growZ;
            }
          }
          d++;
        }

        // 使用済みマーク
        for (let dz = 0; dz < d; dz++)
          for (let dy = 0; dy < h; dy++)
            for (let dx = 0; dx < w; dx++)
              visited.add(k(x + dx, y + dy, z + dz));

        boxes.push({ x, y, z, w, h, d, color });
      }
    }
  }
  return boxes;
}
