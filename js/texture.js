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

/**
 * 面ピクセル（ピクセルアート）対応アトラス。
 * data に1つでも面ピクセルがあれば used:true を返し、本体色/面色は res×res の単色タイル、
 * 面ピクセルは res×res の絵タイルとして並べる。面ピクセル未使用時は used:false（既存パレット維持）。
 *
 * 返り値（used 時）:
 *   { used:true, res, dim, canvas,
 *     colorTexel(color)        -> [px,py]（タイル左上のアトラス画素座標）
 *     faceTexel(x,y,z,face)    -> [px,py]
 *     hasPix(x,y,z,face)       -> bool }
 */
function buildFaceAtlas(data) {
  const res = data.faceRes || 8;
  const pixelEntries = (typeof data.facePixelEntries === 'function') ? data.facePixelEntries() : [];
  if (!pixelEntries.length) return { used: false };

  const colorSlot = new Map();
  const pixSlot = new Map();
  const tiles = []; // {type:'color', color} | {type:'pix', arr, body}
  for (const c of data.allColors()) { colorSlot.set(c, tiles.length); tiles.push({ type: 'color', color: c }); }
  for (const [x, y, z, face, arr] of pixelEntries) {
    pixSlot.set(x + ',' + y + ',' + z + ',' + face, tiles.length);
    tiles.push({ type: 'pix', arr, body: data.get(x, y, z) });
  }

  let perRow = 1; const need = Math.ceil(Math.sqrt(tiles.length));
  while (perRow < need) perRow *= 2;            // 1行のタイル数（2の冪）
  const dim = perRow * res;                     // res が2の冪なら dim も2の冪
  const slot = (i) => [(i % perRow) * res, Math.floor(i / perRow) * res];

  function render() {
    const canvas = document.createElement('canvas');
    canvas.width = dim; canvas.height = dim;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, dim, dim);
    tiles.forEach((t, i) => {
      const [ox, oy] = slot(i);
      if (t.type === 'color') {
        ctx.fillStyle = t.color; ctx.fillRect(ox, oy, res, res);
      } else {
        // 規約: タイル画素(tx,ty) == 正準(px,py)。arr[py*res+px] を (ox+px, oy+py) に描く。
        // （旧式 r*res+c→ox+c,oy+r と数式同一＝canvas バイト不変。faceOrient.js の唯一の真実と一致）
        for (let py = 0; py < res; py++) {
          for (let px = 0; px < res; px++) {
            ctx.fillStyle = t.arr[py * res + px] || t.body || '#000000';
            ctx.fillRect(ox + px, oy + py, 1, 1);
          }
        }
      }
    });
    return canvas;
  }

  return {
    used: true, res, dim, canvas: render(),
    colorTexel: (c) => slot(colorSlot.has(c) ? colorSlot.get(c) : 0),
    faceTexel: (x, y, z, face) => slot(pixSlot.get(x + ',' + y + ',' + z + ',' + face)),
    hasPix: (x, y, z, face) => pixSlot.has(x + ',' + y + ',' + z + ',' + face),
  };
}

/** アトラスのタイル(px,py,res) を Java モデル UV [u0,v0,u1,v1]（0〜16基準）へ */
function atlasUv(texel, res, dim) {
  const k = 16 / dim;
  return [texel[0] * k, texel[1] * k, (texel[0] + res) * k, (texel[1] + res) * k];
}
