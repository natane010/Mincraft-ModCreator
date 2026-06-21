/* validate.js
 * 出力前バリデーション（DOM非依存・純関数）。
 *
 * Minecraft の命名規則や、出力形式ごとの「これが無いとまともに動かない/混乱する」
 * 項目を事前に検査し、errors（出力を止める）/ warnings（出してよいが注意）に分ける。
 * これにより、壊れたパックを配ってから気づく事故を減らす。
 *
 *  validateExport({ ids, data, meta, target }) -> { errors:[...], warnings:[...] }
 *    ids   : { namespace, itemId, packFormat }
 *    data  : VoxelData
 *    meta  : collectMeta() の戻り（type, stats, abilities, acquisition ...）
 *    target: 出力形式 'resourcepack'|'cmd'|'kubejs'|'tacz'|'geckolib'|'patchouli'
 */

// Minecraftのリソース名として有効か（小文字英数 . _ - のみ。/ は名前空間部では不可）
const ID_RE = /^[a-z0-9._-]+$/;

function validateExport(opts) {
  const { ids, data, meta, target } = opts;
  const errors = [];
  const warnings = [];

  // --- 命名規則 ---
  if (!ids.namespace) {
    errors.push('namespace が空です。');
  } else if (!ID_RE.test(ids.namespace)) {
    errors.push(`namespace「${ids.namespace}」に使えない文字があります（小文字英数 . _ - のみ）。`);
  } else if (ids.namespace === 'minecraft') {
    warnings.push('namespace が "minecraft" です。自分用の固有名（例: natane_forge）を推奨します。');
  }
  if (!ids.itemId) {
    errors.push('アイテムID が空です。');
  } else if (!ID_RE.test(ids.itemId)) {
    errors.push(`アイテムID「${ids.itemId}」に使えない文字があります（小文字英数 . _ - のみ）。`);
  }

  // --- 形状 ---
  const voxelCount = data.count();
  if (voxelCount === 0 && target !== 'patchouli') {
    errors.push('ボクセルが1つもありません。まず形を作ってください。');
  }
  if (voxelCount > 4000) {
    warnings.push(`ボクセルが ${voxelCount} 個と多く、モデル要素が増えて描画が重くなる可能性があります。`);
  }
  const colorCount = data.colors().length;
  if (colorCount > 64) {
    warnings.push(`使用色が ${colorCount} 色あります。パレットテクスチャが大きくなります。`);
  }

  // --- pack_format ---
  if (target === 'resourcepack' || target === 'cmd') {
    const pf = parseInt(ids.packFormat, 10);
    if (!pf || pf < 1) warnings.push('pack_format が未設定です。対象バージョンに合わせてください（1.20.1→15）。');
  }

  // --- メタ ---
  if (meta) {
    if (!meta.displayName) warnings.push('表示名が空です。spec/図鑑では ID が代わりに使われます。');
    if (!meta.intent) warnings.push('「用途・想定挙動メモ」が空です。Mod実装時にAIが挙動を再現しにくくなります。');

    // 入手＝クラフトなのにレシピが空
    const grid = (meta.acquisition && meta.acquisition.crafting && meta.acquisition.crafting.grid) || [];
    const hasCraft = grid.some((c) => (c || '').trim());
    if ((meta.acquisition && (meta.acquisition.method === 'crafting' || meta.acquisition.method === 'both')) && !hasCraft) {
      warnings.push('入手手段が「クラフト」ですが、クラフト表が空です。');
    }
    if ((meta.acquisition && (meta.acquisition.method === 'drop' || meta.acquisition.method === 'both')) &&
        !(meta.acquisition.dropNote || '').trim()) {
      warnings.push('入手手段が「ドロップ」ですが、ドロップ元メモが空です。');
    }
  }

  // --- 形式ごとの固有チェック ---
  if (target === 'tacz') {
    if (!meta || meta.type !== 'gun') {
      warnings.push('TaCZ出力ですが、種別が「銃」ではありません。');
    }
    if (meta && (!meta.stats || !meta.stats.magazine)) {
      warnings.push('銃の装弾数(magazine)が0です。data JSONの ammo_amount を後で設定してください。');
    }
  }
  if (target === 'geckolib') {
    warnings.push('GeckoLibはエンティティ/アイテムの登録Javaコードが別途必要です（同梱READMEの雛形を参照）。');
  }
  if (target === 'kubejs' && meta && (meta.type === 'mob')) {
    warnings.push('モブはKubeJS単体では登録できません（EntityJS等が必要）。spec/GeckoLib出力の併用を検討してください。');
  }

  return { errors, warnings };
}
