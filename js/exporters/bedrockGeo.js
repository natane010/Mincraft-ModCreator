/* exporters/bedrockGeo.js
 * ボクセル -> Bedrock形式ジオメトリ(.geo.json, format_version 1.12.0)変換。
 * TaCZ と GeckoLib が共通で消費する。
 *
 * ・greedyBoxes で同色直方体に結合 → 各boxを1 cubeに
 * ・per-face UV はテクセル単位(0..texture_width)。色1つ=1テクセルを指す
 * ・origin = 立方体の最小角（ボクセル座標そのまま。Bedrockは+8オフセット無し）
 *
 * 返り値: { geo, canvas, boxCount }
 */
const _GEO_FACES = ['north', 'south', 'east', 'west', 'up', 'down'];

function buildBedrockGeo(data, opts) {
  const boxes = greedyBoxes(data);
  const colors = [...new Set(boxes.map(b => b.color))];
  const palette = buildPalette(colors);

  const cubes = boxes.map(b => {
    const { px, py } = palette.index.get(b.color);
    const uv = {};
    for (const f of _GEO_FACES) uv[f] = { uv: [px, py], uv_size: [1, 1] };
    return { origin: [b.x, b.y, b.z], size: [b.w, b.h, b.d], uv };
  });

  const h = data.sy, w = Math.max(data.sx, data.sz);
  const geo = {
    format_version: '1.12.0',
    'minecraft:geometry': [{
      description: {
        identifier: opts.identifier || 'geometry.model',
        texture_width: palette.dim,
        texture_height: palette.dim,
        visible_bounds_width: Math.ceil(w / 16) + 2,
        visible_bounds_height: Math.ceil(h / 16) + 2,
        visible_bounds_offset: [0, (h / 16) / 2, 0],
      },
      bones: [{ name: 'root', pivot: [0, 0, 0], cubes }],
    }],
  };

  return { geo, canvas: renderPaletteCanvas(palette), boxCount: boxes.length };
}
