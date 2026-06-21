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

/** 汎用: テキストファイル群＋PNG群＋仕様書/READMEをZIP化してDL
 *  files: [{path,text}], pngEntries: [{path,canvas}]
 */
async function exportFileSet(opts) {
  const { zipName, files, pngEntries, spec, specMarkdown, readme } = opts;
  const zip = new JSZip();
  (files || []).forEach((f) => zip.file(f.path, f.text));
  for (const p of (pngEntries || [])) {
    const blob = await new Promise((resolve) => p.canvas.toBlob(resolve, 'image/png'));
    zip.file(p.path, blob);
  }
  if (spec) zip.file(spec.itemId + '.spec.json', JSON.stringify(spec.data, null, 2));
  if (specMarkdown) zip.file('BUILD_SPEC.md', specMarkdown);
  if (readme) zip.file('README.txt', readme);
  const out = await zip.generateAsync({ type: 'blob' });
  saveAs(out, zipName);
}

/** KubeJS用ZIP（kubejs/ フォルダ一式＋仕様書）を出力 */
async function exportKubeJs(args) {
  const { itemId, canvas, kubeFiles, texturePath, spec, specMarkdown } = args;

  const zip = new JSZip();
  kubeFiles.forEach((f) => zip.file(f.path, f.text));

  const pngBlob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  zip.file(texturePath, pngBlob);

  if (spec) zip.file(itemId + '.spec.json', JSON.stringify(spec, null, 2));
  if (specMarkdown) zip.file('BUILD_SPEC.md', specMarkdown);

  zip.file('README.txt', [
    'KubeJS 出力 — 導入方法',
    '',
    '1. このZIP内の "kubejs" フォルダを、Minecraftインスタンスのルート',
    '   (.minecraft または各インスタンスフォルダ) に配置してください。',
    '   既に kubejs フォルダがある場合は中身をマージします。',
    '2. 必要Mod: KubeJS (1.20.1 / 2001.x系)。ドロップ設定を使う場合は LootJS も。',
    '3. ゲーム内で /reload (サーバースクリプト) または再起動 (登録) で反映。',
    '',
    'BUILD_SPEC.md / *.spec.json は Mod実装の参照用です(ゲームには不要)。',
  ].join('\n'));

  const out = await zip.generateAsync({ type: 'blob' });
  saveAs(out, itemId + '_kubejs.zip');
}
