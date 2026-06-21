/* exporters/geckolib.js
 * メタ＋Bedrockジオメトリ から GeckoLib(4.x / 1.20.1)用アセットを生成する。
 * ★GeckoLibは登録/描画にJavaが必須（geo.jsonだけでは動かない）。
 *   そのため assets ＋ Java実装の雛形(README)を出力する。
 *
 * 返り値: { files:[{path,text}], texturePath, readme, zipName }
 */
function buildGeckolibPack(meta, ctx, geoJson) {
  const ns = ctx.namespace, id = ctx.itemId;
  const isEntity = meta.type === 'mob';
  const files = [];

  files.push({ path: `assets/${ns}/geo/${id}.geo.json`, text: JSON.stringify(geoJson, null, 2) });

  files.push({ path: `assets/${ns}/animations/${id}.animation.json`, text: JSON.stringify({
    format_version: '1.8.0',
    animations: {
      [`animation.${id}.idle`]: { loop: true, animation_length: 0 },
    },
  }, null, 2) });

  // GeckoLibが参照するテクスチャ
  const texturePath = `assets/${ns}/textures/${isEntity ? 'entity' : 'item'}/${id}.png`;

  const cls = id.replace(/(^|[_\-])(\w)/g, (_, __, c) => c.toUpperCase());
  const base = isEntity ? 'GeoEntity (extends PathfinderMob)' : 'GeoItem (extends Item)';
  const readme = [
    'GeckoLib アセット — ★Java実装が必要★',
    '',
    `種別: ${meta.type} / 想定: ${isEntity ? 'エンティティ' : 'アイテム'}`,
    '必要Mod: GeckoLib 4.x (1.20.1)。',
    '',
    '同梱アセット:',
    `  geo:       assets/${ns}/geo/${id}.geo.json`,
    `  animation: assets/${ns}/animations/${id}.animation.json`,
    `  texture:   ${texturePath}  (←パレット画像。配置してください)`,
    '',
    'Javaで以下を実装して登録してください（雛形）:',
    '',
    `  // ${cls} : ${base}`,
    `  // GeoModel<${cls}> で 3つの ResourceLocation を返す:`,
    `  //   model:     ${ns}:geo/${id}.geo.json   -> new ResourceLocation("${ns}","geo/${id}.geo.json")`,
    `  //   texture:   ${texturePath.replace('assets/' + ns + '/', ns + ':')}`,
    `  //   animation: ${ns}:animations/${id}.animation.json`,
    `  // AnimationController で "animation.${id}.idle" を再生。`,
    `  // ${isEntity ? 'GeoEntityRenderer' : 'GeoItemRenderer'} を登録。`,
    '',
    '※ Javaを書かずに済ませたい場合は GeckoJS / EntityJS (KubeJSアドオン) を検討。',
    '  ただし1.20.1対応はコミュニティ版でバージョン整合の確認が必要。',
    '',
    '詳細な想定挙動は BUILD_SPEC.md を参照（Claude Code等での実装用）。',
  ].join('\n');

  return { files, texturePath, readme, zipName: `${id}_geckolib.zip` };
}
