/* packZip.js
 * モデルJSON + テクスチャPNG + pack.mcmeta を Minecraft リソースパックの
 * フォルダ構造でZIP化し、ローカルにダウンロードさせる。
 */
async function exportResourcePack(args) {
  const { namespace, itemId, model, canvas, packFormat } = args;

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

  const out = await zip.generateAsync({ type: 'blob' });
  saveAs(out, itemId + '.zip');
}
