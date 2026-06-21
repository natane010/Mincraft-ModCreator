/* exporters/customModelData.js
 * メタ＋アイテムモデル から「バニラ CustomModelData」リソースパックを生成する。
 * Mod不要。既存バニラアイテムにモデルを上書き表示し、/give のNBTで切替。
 *
 * 返り値: { files:[{path,text}], texturePath, readme, zipName }
 */
// 種別 -> 被せる土台アイテムと、その素のモデル定義
const _CMD_BASE = {
  weapon: { item: 'minecraft:diamond_sword', parent: 'minecraft:item/handheld', layer0: 'minecraft:item/diamond_sword' },
  tool: { item: 'minecraft:diamond_pickaxe', parent: 'minecraft:item/handheld', layer0: 'minecraft:item/diamond_pickaxe' },
  gun: { item: 'minecraft:carrot_on_a_stick', parent: 'minecraft:item/handheld', layer0: 'minecraft:item/carrot_on_a_stick' },
  armor: { item: 'minecraft:leather_helmet', parent: 'minecraft:item/generated', layer0: 'minecraft:item/leather_helmet' },
  item: { item: 'minecraft:stick', parent: 'minecraft:item/handheld', layer0: 'minecraft:item/stick' },
  material: { item: 'minecraft:paper', parent: 'minecraft:item/generated', layer0: 'minecraft:item/paper' },
};

function buildCmdPack(meta, ctx, model, packFormat) {
  const ns = ctx.namespace, id = ctx.itemId;
  const cmd = 1;
  const base = _CMD_BASE[meta.type] || _CMD_BASE.item;
  const baseName = base.item.split(':')[1];
  const files = [];

  files.push({ path: 'pack.mcmeta', text: JSON.stringify({
    pack: { pack_format: packFormat || 15, description: `${meta.displayName || id} — Natane Voxel & Data Forge (CustomModelData)` },
  }, null, 2) });

  // 土台アイテムのモデルを上書き（素のモデル＋override）
  files.push({ path: `assets/minecraft/models/item/${baseName}.json`, text: JSON.stringify({
    parent: base.parent,
    textures: { layer0: base.layer0 },
    overrides: [
      { predicate: { custom_model_data: cmd }, model: `${ns}:item/${id}` },
    ],
  }, null, 2) });

  // 自作モデル
  files.push({ path: `assets/${ns}/models/item/${id}.json`, text: JSON.stringify(model, null, 2) });

  const readme = [
    'CustomModelData リソースパック — Mod不要 (1.20.1)',
    '',
    '1. このZIPをリソースパックとして導入（resourcepacks/ に置いて有効化）。',
    '2. 下記コマンドで、自作モデルが適用された土台アイテムを入手:',
    '',
    `   /give @p ${base.item}{CustomModelData:${cmd}} 1`,
    '',
    `   ※土台は「${base.item}」。挙動は土台アイテムのまま（見た目だけ差し替え）。`,
    '   別の土台に変えたい場合は assets/minecraft/models/item/' + baseName + '.json の',
    '   override と /give のアイテムを合わせて変更してください。',
    '',
    '実際の独自挙動が必要な場合は KubeJS 出力 か Mod実装(BUILD_SPEC.md参照)を使用。',
  ].join('\n');

  return { files, texturePath: `assets/${ns}/textures/item/${id}.png`, readme, zipName: `${id}_resourcepack_cmd.zip` };
}
