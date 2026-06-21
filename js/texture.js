/* texture.js
 * 使用色を1色=1テクセルとして正方形パレットPNG(アトラス)に並べ、
 * 各色のUV(Minecraftモデルの0〜16空間)を引けるようにする。
 */

/** colors: 一意な色配列 -> {dim, index:Map(color->{px,py})} */
function buildPalette(colors) {
  const n = Math.max(1, colors.length);
  const cells = Math.ceil(Math.sqrt(n));
  let dim = 1;
  while (dim < cells) dim *= 2; // テクスチャは2の冪サイズにそろえる
  const index = new Map();
  colors.forEach((c, i) => {
    index.set(c, { px: i % dim, py: Math.floor(i / dim) });
  });
  return { dim, index };
}

/** パレットを描いた canvas を返す（1色=1px） */
function renderPaletteCanvas(palette) {
  const { dim, index } = palette;
  const canvas = document.createElement('canvas');
  canvas.width = dim;
  canvas.height = dim;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, dim, dim); // 余白は透明
  for (const [color, { px, py }] of index) {
    ctx.fillStyle = color;
    ctx.fillRect(px, py, 1, 1);
  }
  return canvas;
}

/** その色の1テクセルを指すUV [u0,v0,u1,v1] (0〜16基準) */
function uvFor(color, palette) {
  const { dim, index } = palette;
  const { px, py } = index.get(color);
  const s = 16 / dim;
  return [px * s, py * s, (px + 1) * s, (py + 1) * s];
}
