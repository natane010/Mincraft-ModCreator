/* exporters/kubeJs.js
 * メタ＋ボクセルモデルから KubeJS(1.20.1 / 2001.x系) のファイル一式を生成する。
 * 「壊れない有効なスクリプト」を最優先し、版で揺れる部分(武器ダメージ等)は
 * 値をコメントで残す。モブドロップは LootJS 必須なのでコメント雛形で出す。
 *
 * 返り値: { files:[{path,text}], texturePath }
 */

function _pretty(id) {
  return id.replace(/[_\-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// 3×3グリッド -> {rows:[...], key:{A:'id'}} （空の縁を自動トリム）
function _gridToRecipe(grid) {
  const g = grid.map(s => (s || '').trim());
  let rmin = 3, rmax = -1, cmin = 3, cmax = -1;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    if (g[r * 3 + c]) { rmin = Math.min(rmin, r); rmax = Math.max(rmax, r); cmin = Math.min(cmin, c); cmax = Math.max(cmax, c); }
  }
  if (rmax < 0) return null;
  const map = {}, key = {}, letters = 'ABCDEFGHI';
  let li = 0;
  const rows = [];
  for (let r = rmin; r <= rmax; r++) {
    let row = '';
    for (let c = cmin; c <= cmax; c++) {
      const ing = g[r * 3 + c];
      if (!ing) { row += ' '; }
      else { if (!map[ing]) { map[ing] = letters[li++]; key[map[ing]] = ing; } row += map[ing]; }
    }
    rows.push(row);
  }
  return { rows, key };
}

function _startupScript(meta, ns, id, name, isBlock) {
  const L = [];
  L.push("// 自動生成: Natane's Voxel & Data Forge");
  L.push('// 詳細仕様・想定挙動は BUILD_SPEC.md を参照');
  if (meta.intent) L.push('// 想定挙動: ' + meta.intent);
  L.push('');
  if (isBlock) {
    L.push("StartupEvents.registry('block', event => {");
    L.push(`  event.create('${ns}:${id}')`);
    L.push(`    .displayName('${name}')`);
    L.push("    .soundType('stone')");
    L.push('    .hardness(1.5)        // ブロック硬さ(要調整)');
    L.push('    .resistance(6.0)      // 爆破耐性(要調整)');
    L.push('    .requiresTool(true)');
    L.push("    .renderType('cutout') // 凹凸ボクセル用。完全な立方体なら 'solid' に");
    L.push('    .opaque(false)');
    L.push('    .fullBlock(false)');
    L.push('  // 既定で自分自身をドロップ。別アイテムを落とすなら .setLootTableJson(...) を使用');
    L.push('})');
  } else {
    const isWeapon = meta.type === 'weapon';
    L.push("StartupEvents.registry('item', event => {");
    if (isWeapon) {
      L.push(`  event.create('${ns}:${id}', 'sword')`);
      L.push(`    .displayName('${name}')`);
      L.push("    .tier('iron')         // wood|stone|iron|gold|diamond|netherite");
      if (meta.stats.attack) L.push(`    // .attackDamageBaseline(${meta.stats.attack})  // ※KubeJSビルドによりメソッド名が異なる場合あり`);
      if (meta.stats.attackSpeed) L.push(`    // .speedBaseline(${meta.stats.attackSpeed})    // ※同上(speed/speedBaseline)`);
    } else {
      L.push(`  event.create('${ns}:${id}')`);
      L.push(`    .displayName('${name}')`);
      const stack = (meta.type === 'gun' || meta.type === 'tool' || meta.stats.durability) ? 1 : 64;
      L.push(`    .maxStackSize(${stack})`);
      if (meta.stats.durability) L.push(`    .maxDamage(${meta.stats.durability})`);
    }
    if (meta.abilities.length) L.push(`    .tooltip('能力: ${meta.abilities.join(' / ')}')`);
    L.push('})');
  }
  L.push('');
  return L.join('\n');
}

function _recipeScript(meta, ns, id) {
  if (!['crafting', 'both'].includes(meta.acquisition.method)) return null;
  const rec = _gridToRecipe(meta.acquisition.crafting.grid);
  if (!rec) return null;
  const count = meta.acquisition.crafting.count || 1;
  const out = count > 1 ? `Item.of('${ns}:${id}', ${count})` : `'${ns}:${id}'`;
  const keyStr = Object.entries(rec.key).map(([k, v]) => `${k}: '${v}'`).join(', ');
  const rows = rec.rows.map(r => `    '${r}'`).join(',\n');
  return [
    "// 自動生成: クラフトレシピ",
    'ServerEvents.recipes(event => {',
    `  event.shaped(${out}, [`,
    rows,
    `  ], { ${keyStr} })`,
    '})',
    '',
  ].join('\n');
}

function _lootScript(meta, ns, id) {
  if (!meta.acquisition.dropNote) return null;
  return [
    '// ドロップ設定 — ★LootJS アドオンが必要★（未導入ならこのファイルを削除）',
    '// 入手メモ: ' + meta.acquisition.dropNote,
    '// LootJS.modifiers(event => {',
    `//   event.addEntityLootModifier('minecraft:zombie').addLoot('${ns}:${id}')`,
    '// })',
    '',
  ].join('\n');
}

function buildKubeJsFiles(meta, ctx, model) {
  const ns = ctx.namespace, id = ctx.itemId;
  const name = meta.displayName || _pretty(id);
  const isBlock = meta.type === 'block';
  const files = [];

  files.push({ path: `kubejs/startup_scripts/${id}.js`, text: _startupScript(meta, ns, id, name, isBlock) });

  const recipe = _recipeScript(meta, ns, id);
  if (recipe) files.push({ path: `kubejs/server_scripts/${id}_recipe.js`, text: recipe });

  const loot = _lootScript(meta, ns, id);
  if (loot) files.push({ path: `kubejs/server_scripts/${id}_loot.js`, text: loot });

  const langKey = (isBlock ? 'block' : 'item') + `.${ns}.${id}`;
  files.push({
    path: `kubejs/assets/${ns}/lang/en_us.json`,
    text: JSON.stringify({ [langKey]: name }, null, 2),
  });

  const modelText = JSON.stringify(model, null, 2);
  if (isBlock) {
    files.push({ path: `kubejs/assets/${ns}/models/block/${id}.json`, text: modelText });
    files.push({
      path: `kubejs/assets/${ns}/blockstates/${id}.json`,
      text: JSON.stringify({ variants: { '': { model: `${ns}:block/${id}` } } }, null, 2),
    });
    files.push({
      path: `kubejs/assets/${ns}/models/item/${id}.json`,
      text: JSON.stringify({ parent: `${ns}:block/${id}` }, null, 2),
    });
  } else {
    files.push({ path: `kubejs/assets/${ns}/models/item/${id}.json`, text: modelText });
  }

  return { files, texturePath: `kubejs/assets/${ns}/textures/item/${id}.png` };
}
