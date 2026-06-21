/* packZip.js
 * 生成済みのファイル群(テキスト/PNG)を Minecraft の正しいフォルダ構造で
 * ZIP化し、ローカルにダウンロードさせる。
 *
 *  - exportFileSet  : 1アイテム分の任意ファイル群をZIP化
 *  - exportBundleSet: 複数アイテムのバンドルを1つのZIPに統合（一括出力）
 */

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

/** 複数バンドルを1つのZIPに統合（一括出力）。
 *  bundles: [{ itemId, target, files:[{path,text}], pngEntries:[{path,canvas}],
 *             readme, specJson, specMarkdown }]
 *  各リソースは各形式の正しいパスに配置し、衝突しがちな仕様書/READMEは集約する。
 */
async function exportBundleSet(bundles, zipName) {
  const zip = new JSZip();
  const readmes = [];
  for (const b of bundles) {
    (b.files || []).forEach((f) => zip.file(f.path, f.text));
    for (const p of (b.pngEntries || [])) {
      const blob = await new Promise((resolve) => p.canvas.toBlob(resolve, 'image/png'));
      zip.file(p.path, blob);
    }
    // 仕様書は衝突を避けて _specs/ にアイテムごと格納
    if (b.specJson) zip.file('_specs/' + b.itemId + '.spec.json', JSON.stringify(b.specJson, null, 2));
    if (b.specMarkdown) zip.file('_specs/' + b.itemId + '.BUILD_SPEC.md', b.specMarkdown);
    if (b.readme) readmes.push('### ' + b.itemId + '  (' + b.target + ')\n' + b.readme);
  }

  zip.file('BATCH_README.txt', [
    'Natane Voxel & Data Forge — 一括出力',
    '',
    bundles.length + ' 個のアイテムを同梱しています。',
    '各リソースは形式ごとの正しいフォルダ構造で配置済みです。',
    'Mod実装用の仕様書は _specs/ 以下にアイテムごとにまとめています。',
    '',
    '==== 形式別の導入手順 ====',
    '',
    readmes.join('\n\n----------------\n\n'),
  ].join('\n'));

  const out = await zip.generateAsync({ type: 'blob' });
  saveAs(out, zipName || 'natane_forge_batch.zip');
}
