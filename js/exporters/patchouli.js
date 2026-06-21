/* exporters/patchouli.js
 * メタ＋入手メモ から Patchouli(1.20.1) のゲーム内ガイドブックを生成する。
 * 「入手方法メモ」を実際にゲーム内で読める解説本にするのが目的。
 *
 * 注意:
 *  - book.json は data/ 配下、カテゴリ/エントリは assets/.../en_us/ 配下（要分離）。
 *  - crafting ページは data/<ns>/recipes/ の実在レシピID を参照するため、
 *    バニラレシピJSONも併せて出力（result は1.20.1仕様の "item")。
 *
 * 返り値: { files:[{path,text}], readme, zipName }
 */
function _shapedRecipeJson(grid, resultId, count) {
  const g = grid.map(s => (s || '').trim());
  let rmin = 3, rmax = -1, cmin = 3, cmax = -1;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    if (g[r * 3 + c]) { rmin = Math.min(rmin, r); rmax = Math.max(rmax, r); cmin = Math.min(cmin, c); cmax = Math.max(cmax, c); }
  }
  if (rmax < 0) return null;
  const map = {}, key = {}, letters = 'ABCDEFGHI';
  let li = 0;
  const pattern = [];
  for (let r = rmin; r <= rmax; r++) {
    let row = '';
    for (let c = cmin; c <= cmax; c++) {
      const ing = g[r * 3 + c];
      if (!ing) { row += ' '; }
      else { if (!map[ing]) { map[ing] = letters[li++]; key[map[ing]] = { item: ing }; } row += map[ing]; }
    }
    pattern.push(row);
  }
  return { type: 'minecraft:crafting_shaped', pattern, key, result: { item: resultId, count: count || 1 } };
}

function buildPatchouliBook(meta, ctx) {
  const ns = ctx.namespace, id = ctx.itemId;
  const book = `${ns}_guide`;
  const name = meta.displayName || id;
  const files = [];
  const hasCraft = ['crafting', 'both'].includes(meta.acquisition.method);
  const recipe = hasCraft ? _shapedRecipeJson(meta.acquisition.crafting.grid, `${ns}:${id}`, meta.acquisition.crafting.count) : null;

  // book.json は data/ 配下、use_resource_pack: true 必須
  files.push({ path: `data/${ns}/patchouli_books/${book}/book.json`, text: JSON.stringify({
    name: `${name} 図鑑`,
    landing_text: `$(l)${name}$(/l) の作り方・入手方法をまとめた図鑑です。`,
    use_resource_pack: true,
    version: '1',
    creative_tab: 'search',
    index_icon: 'minecraft:book',
  }, null, 2) });

  // カテゴリ
  files.push({ path: `assets/${ns}/patchouli_books/${book}/en_us/categories/main.json`, text: JSON.stringify({
    name: 'コンテンツ',
    description: 'このパックで追加される要素一覧。',
    icon: 'minecraft:crafting_table',
    sortnum: 0,
  }, null, 2) });

  // エントリ（ページ）
  const pages = [];
  const desc = [];
  if (meta.intent) desc.push(meta.intent);
  desc.push(`種別: ${meta.type}`);
  if (meta.abilities.length) desc.push(`能力: ${meta.abilities.join(' / ')}`);
  pages.push({ type: 'patchouli:text', title: name, text: desc.join('$(br)') });

  const st = meta.stats;
  const statLines = [];
  if (st.attack) statLines.push(`攻撃力: ${st.attack}`);
  if (st.attackSpeed) statLines.push(`攻撃速度: ${st.attackSpeed}`);
  if (st.durability) statLines.push(`耐久: ${st.durability}`);
  if (st.range) statLines.push(`射程: ${st.range}`);
  if (st.magazine) statLines.push(`装弾数: ${st.magazine}`);
  if (st.reloadTime) statLines.push(`リロード: ${st.reloadTime}`);
  if (statLines.length) pages.push({ type: 'patchouli:text', title: 'ステータス', text: statLines.join('$(br)') });

  if (recipe) pages.push({ type: 'patchouli:crafting', recipe: `${ns}:${id}`, title: 'クラフト', text: 'クラフト手順。' });

  if (meta.acquisition.dropNote) pages.push({ type: 'patchouli:text', title: '入手・ドロップ', text: meta.acquisition.dropNote });
  if (meta.acquisition.note) pages.push({ type: 'patchouli:text', title: 'メモ', text: meta.acquisition.note });

  files.push({ path: `assets/${ns}/patchouli_books/${book}/en_us/entries/${id}.json`, text: JSON.stringify({
    name, category: `${ns}:main`, icon: 'minecraft:paper', pages, sortnum: 0, read_by_default: true,
  }, null, 2) });

  // crafting ページ参照用のバニラレシピ（item登録が前提）
  if (recipe) files.push({ path: `data/${ns}/recipes/${id}.json`, text: JSON.stringify(recipe, null, 2) });

  const readme = [
    'Patchouli ガイドブック — 導入方法',
    '',
    '1. 必要Mod: Patchouli (1.20.1)。',
    '2. このZIPの data/ と assets/ を、リソース/データパックとして読ませる',
    '   （Mod同梱なら mod の resources へ。単体なら Open Loader 等で読み込み）。',
    `3. 本を入手: /give @p patchouli:guide_book{"patchouli:book":"${ns}:${book}"}`,
    `   または /patchouli open ${ns}:${book}`,
    '',
    '★注意: クラフトページは data/' + ns + '/recipes/' + id + '.json の実在レシピを参照します。',
    `  対象アイテム ${ns}:${id} がゲームに登録されていないとレシピ表示はスキップされます`,
    '  （KubeJS出力等で同アイテムを登録すると表示されます）。',
  ].join('\n');

  return { files, readme, zipName: `${id}_patchouli.zip` };
}
