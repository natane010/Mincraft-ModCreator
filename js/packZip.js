/* packZip.js
 * モデルJSON + テクスチャPNG + pack.mcmeta を Minecraft リソースパックの
 * フォルダ構造でZIP化し、ローカルにダウンロードさせる。
 */
async function exportResourcePack(args) {
  const { namespace, itemId, model, canvas, packFormat, spec, specMarkdown } = args;

  const zip = new JSZip();

  zip.file('pack.mcmeta', JSON.stringify({
    pack: {
      pack_format: packFormat,
      description: itemId + ' — Natane Voxel & Data Forge',
    },
  }, null, 2));

  const base = 'assets/' + namespace;
  zip.file(base + '/models/item/' + itemId + '.json', JSON.stringify(model, null, 2));

  // canvas -> PNG Blob
  const pngBlob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  zip.file(base + '/textures/item/' + itemId + '.png', pngBlob);

  // Mod実装用の仕様書（Minecraftは無視する追加ファイル）
  if (spec) zip.file(itemId + '.spec.json', JSON.stringify(spec, null, 2));
  if (specMarkdown) zip.file('BUILD_SPEC.md', specMarkdown);

  const out = await zip.generateAsync({ type: 'blob' });
  saveAs(out, itemId + '.zip');
}
