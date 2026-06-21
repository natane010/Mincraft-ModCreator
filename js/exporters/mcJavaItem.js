/* exporters/mcJavaItem.js
 * ボクセルデータ -> Minecraft Java アイテムモデルJSON へ変換。
 *
 * ・greedyBoxes で同色直方体にまとめ、各boxを1 elementに変換
 * ・テクスチャは buildPalette/renderPaletteCanvas でパレットPNGを生成
 * ・全面UVは該当色の1テクセルを指す（=面は単色で塗られる）
 *
 * 後でモブ用(GeckoLib geo)など別フォーマットを追加する場合は、
 * このファイルと同じ「data -> {model, canvas}」インターフェースで実装する。
 */
const FACES = ['north', 'south', 'east', 'west', 'up', 'down'];

function buildItemModel(data, opts) {
  const namespace = opts.namespace;
  const itemId = opts.itemId;

  const boxes = greedyBoxes(data);
  const colors = [...new Set(boxes.map(b => b.color))];
  const palette = buildPalette(colors);

  const elements = boxes.map(b => {
    const uv = uvFor(b.color, palette);
    const faces = {};
    for (const f of FACES) {
      faces[f] = { uv: [uv[0], uv[1], uv[2], uv[3]], texture: '#0' };
    }
    return {
      from: [b.x, b.y, b.z],
      to: [b.x + b.w, b.y + b.h, b.z + b.d],
      faces,
    };
  });

  const texRef = namespace + ':item/' + itemId;
  const model = {
    credit: 'Made with Natane Voxel & Data Forge',
    textures: { 0: texRef, particle: texRef },
    elements,
    // インベントリ等での見え方の既定値（必要なら出力後に調整可）
    display: {
      gui: { rotation: [30, 225, 0], translation: [0, 0, 0], scale: [0.625, 0.625, 0.625] },
      ground: { rotation: [0, 0, 0], translation: [0, 3, 0], scale: [0.25, 0.25, 0.25] },
      fixed: { rotation: [0, 0, 0], translation: [0, 0, 0], scale: [0.5, 0.5, 0.5] },
      thirdperson_righthand: { rotation: [75, 45, 0], translation: [0, 2.5, 0], scale: [0.375, 0.375, 0.375] },
      firstperson_righthand: { rotation: [0, 45, 0], translation: [0, 0, 0], scale: [0.4, 0.4, 0.4] },
    },
  };

  const canvas = renderPaletteCanvas(palette);
  return { model, canvas, boxCount: boxes.length };
}
