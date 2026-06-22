/* spec.js
 * メタデータ＋入手メモから「Mod実装用の仕様書」を生成する（DOM非依存・純関数）。
 *
 * 目的: 後で Claude Code 等で実際のMod(Javaコード)を作るときに、
 *       生成された各リソースが「何で・どう動くべきか」をAI/人間が理解できるようにする。
 *
 *  - buildSpecObject : 機械可読の構造化スペック(JSON)
 *  - buildSpecMarkdown: 人間＋AIが読むマニフェスト(Markdown)
 *
 * meta = {
 *   type, displayName, intent,
 *   stats:{attack,attackSpeed,durability,range,magazine,reloadTime},
 *   abilities:[...labels],
 *   acquisition:{ method, crafting:{grid:[9], count}, dropNote, note }
 * }
 * ctx = { namespace, itemId, modelPath, texturePath, textureSize, boxCount, voxelCount, grid:{sx,sy,sz} }
 */

const SPEC_FORMAT = 'natane-forge-spec/1';

const STAT_LABELS = {
  attack: '攻撃力', attackSpeed: '攻撃速度', durability: '耐久値', range: '射程',
  magazine: '装弾数', reloadTime: 'リロード時間', defense: '防御力',
  toughness: '防具強度', health: '体力', moveSpeed: '移動速度',
};

/** 種別に応じた表示対象ステータスキー。statFields が配列なら（空でも）それを使う。
 *  未指定（古い spec）のときだけ既定6種にフォールバックする。 */
function _statFields(meta) {
  if (Array.isArray(meta.statFields)) return meta.statFields;
  return ['attack', 'attackSpeed', 'durability', 'range', 'magazine', 'reloadTime'];
}

function buildSpecObject(meta, ctx) {
  const craftGrid = (meta.acquisition.crafting.grid || []).map(s => (s || '').trim());
  const hasCraft = craftGrid.some(Boolean);
  return {
    format: SPEC_FORMAT,
    generatedBy: "Natane's Voxel & Data Forge",
    namespace: ctx.namespace,
    id: ctx.itemId,
    displayName: meta.displayName || ctx.itemId,
    type: meta.type,
    intent: meta.intent || '',
    stats: meta.stats,
    statFields: _statFields(meta),
    abilities: meta.abilities,
    acquisition: {
      method: meta.acquisition.method,
      crafting: hasCraft
        ? { shape: [craftGrid.slice(0, 3), craftGrid.slice(3, 6), craftGrid.slice(6, 9)], count: meta.acquisition.crafting.count }
        : null,
      dropNote: meta.acquisition.dropNote || '',
      note: meta.acquisition.note || '',
    },
    resources: {
      model: ctx.modelPath,
      texture: ctx.texturePath,
      textureSize: ctx.textureSize,
      unitScale: ctx.scale != null ? ctx.scale : 1,
    },
    geometry: {
      grid: ctx.grid,
      voxelCount: ctx.voxelCount,
      elementCount: ctx.boxCount,
      bones: (ctx.bones && ctx.bones.length)
        ? ctx.bones.map((b) => ({ name: b.name, pivot: b.pivot, parent: b.parent || null }))
        : null,
    },
    locators: ctx.muzzle ? { muzzle: [ctx.muzzle.x, ctx.muzzle.y, ctx.muzzle.z] } : null,
    animations: (ctx.animations && ctx.animations.length) ? ctx.animations : null,
  };
}

function buildSpecMarkdown(meta, ctx) {
  const s = meta.stats;
  const name = meta.displayName || ctx.itemId;
  const L = [];
  L.push(`# ${name}  (\`${ctx.namespace}:${ctx.itemId}\`)`);
  L.push('');
  L.push('> このファイルは Mod 実装の参照用です。生成された各リソースの役割・想定挙動をまとめています。');
  L.push('');
  L.push(`- **種別**: ${meta.type}`);
  if (meta.intent) L.push(`- **用途・想定挙動**: ${meta.intent}`);
  L.push('');

  const fields = _statFields(meta);
  if (fields.length) {
    L.push('## ステータス');
    L.push('| 項目 | 値 |');
    L.push('|---|---|');
    fields.forEach((k) => L.push(`| ${STAT_LABELS[k] || k} | ${s[k] || 0} |`));
    L.push('');
  }

  if (meta.abilities.length) {
    L.push('## 特殊能力');
    meta.abilities.forEach(a => L.push(`- ${a}`));
    L.push('');
  }

  L.push('## 入手方法');
  L.push(`- **手段**: ${meta.acquisition.method}`);
  const grid = (meta.acquisition.crafting.grid || []).map(x => (x || '').trim());
  if (grid.some(Boolean)) {
    L.push(`- **クラフト** (完成数 ${meta.acquisition.crafting.count}):`);
    L.push('```');
    for (let r = 0; r < 3; r++) {
      L.push(grid.slice(r * 3, r * 3 + 3).map(c => c || '.').join(' | '));
    }
    L.push('```');
  }
  if (meta.acquisition.dropNote) L.push(`- **ドロップ元**: ${meta.acquisition.dropNote}`);
  if (meta.acquisition.note) L.push(`- **メモ**: ${meta.acquisition.note}`);
  L.push('');

  L.push('## リソース');
  L.push(`- モデル: \`${ctx.modelPath}\``);
  L.push(`- テクスチャ: \`${ctx.texturePath}\` (${ctx.textureSize}×${ctx.textureSize}px)`);
  L.push(`- 形状: グリッド ${ctx.grid.sx}×${ctx.grid.sy}×${ctx.grid.sz} / ボクセル ${ctx.voxelCount} / モデル要素 ${ctx.boxCount}`);
  if (ctx.scale && ctx.scale !== 1) {
    L.push(`- 出力スケール: 1ボクセル=${ctx.scale} model単位（全体 ${(ctx.grid.sx * ctx.scale).toFixed(2)}×${(ctx.grid.sy * ctx.scale).toFixed(2)}×${(ctx.grid.sz * ctx.scale).toFixed(2)} 単位）`);
  }
  if (ctx.muzzle) {
    L.push(`- 銃口/発射点ロケーター \`muzzle\`: [${ctx.muzzle.x}, ${ctx.muzzle.y}, ${ctx.muzzle.z}]（モデル座標。発射原点・マズルフラッシュ位置に利用）`);
  }
  if (ctx.bones && ctx.bones.length) {
    L.push(`- ボーン(関節): ${ctx.bones.map((b) => b.name + (b.parent ? `(親:${b.parent})` : '')).join(', ')}`);
    ctx.bones.filter((b) => b.name !== 'root').forEach((b) => {
      L.push(`    - \`${b.name}\` pivot [${b.pivot.join(', ')}]${b.parent ? ` / 親 \`${b.parent}\`` : ''}`);
    });
  }
  if (ctx.animations && ctx.animations.length) {
    L.push(`- アニメーション: ${ctx.animations.join(', ')}（\`${ctx.itemId}.animation.json\` / 対象ボーンを駆動）`);
  }
  L.push('');

  L.push('## 実装メモ (For Mod dev / Claude Code)');
  L.push(`- このアイテムは namespace \`${ctx.namespace}\`、ID \`${ctx.itemId}\` で登録する想定。`);
  L.push('- 上記モデル/テクスチャをリソースパック側に配置し、コード側でアイテム登録・挙動を実装してください。');
  if (meta.intent) L.push(`- 想定挙動: ${meta.intent}`);
  L.push('');

  return L.join('\n');
}
