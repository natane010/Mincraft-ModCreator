/* main.js — UIとエディタ/エクスポーターの配線 */
(function () {
  const DEFAULT_PALETTE = [
    '#e6e6e6', '#9aa0a6', '#5a6378', '#2b3140',
    '#3a8ee6', '#2ecc71', '#e74c3c', '#f1c40f',
    '#e67e22', '#9b59b6', '#1ab5b5', '#7f5539',
  ];

  // KubeJS 出力の導入手順（単体/一括どちらでも同じ文面を使う）
  const KUBEJS_README = [
    'KubeJS 出力 — 導入方法',
    '',
    '1. このZIP内の "kubejs" フォルダを、Minecraftインスタンスのルート',
    '   (.minecraft または各インスタンスフォルダ) に配置してください。',
    '   既に kubejs フォルダがある場合は中身をマージします。',
    '2. 必要Mod: KubeJS (1.20.1 / 2001.x系)。ドロップ設定を使う場合は LootJS も。',
    '3. ゲーム内で /reload (サーバースクリプト) または再起動 (登録) で反映。',
    '',
    'BUILD_SPEC.md / *.spec.json は Mod実装の参照用です(ゲームには不要)。',
  ].join('\n');

  let editor;
  let currentColor = DEFAULT_PALETTE[4];
  const queue = []; // 一括出力キュー: [{snapshot, meta, ids, target}]

  function $(id) { return document.getElementById(id); }

  function init() {
    const data = new VoxelData(16, 16, 16);
    editor = new VoxelEditor($('canvas-container'), data);
    editor.setColor(currentColor);
    editor.onChange = (n) => { $('voxel-count').textContent = n; };
    editor.onHistory = (u, r) => {
      $('btn-undo').disabled = u === 0;
      $('btn-redo').disabled = r === 0;
    };

    buildPalette();
    buildTemplateMenu();
    buildMetaForm();
    bindModeButtons();
    bindControls();
    bindEditingExtras();
    bindProjectIO();
    bindQueue();
    $('voxel-count').textContent = '0';
  }

  /* ---- メタデータ＆メモ フォーム ---- */
  const ABILITIES = ['炎属性', '毒付与', 'ノックバック', '範囲爆発', '吸収', '加速', '透明化', '発光'];

  function buildMetaForm() {
    // 特殊能力チェックボックス
    const al = $('ability-list');
    ABILITIES.forEach((a, i) => {
      const id = 'ab-' + i;
      const wrap = document.createElement('label');
      wrap.className = 'ability';
      wrap.innerHTML = `<input type="checkbox" id="${id}" value="${a}"> ${a}`;
      al.appendChild(wrap);
    });
    // クラフト3×3グリッド
    const cg = $('craft-grid');
    for (let i = 0; i < 9; i++) {
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.id = 'craft-' + i;
      inp.placeholder = '—';
      inp.title = 'アイテムID (例: minecraft:iron_ingot)';
      cg.appendChild(inp);
    }
  }

  function collectMeta() {
    const num = (id) => parseFloat($(id).value) || 0;
    const grid = [];
    for (let i = 0; i < 9; i++) grid.push($('craft-' + i).value);
    const abilities = ABILITIES.filter((_, i) => $('ab-' + i).checked);
    return {
      type: $('meta-type').value,
      displayName: $('meta-name').value.trim(),
      intent: $('meta-intent').value.trim(),
      stats: {
        attack: num('st-attack'), attackSpeed: num('st-attackspeed'),
        durability: num('st-durability'), range: num('st-range'),
        magazine: num('st-magazine'), reloadTime: num('st-reload'),
      },
      abilities,
      acquisition: {
        method: $('acq-method').value,
        crafting: { grid, count: parseInt($('craft-count').value, 10) || 1 },
        dropNote: $('drop-note').value.trim(),
        note: $('free-note').value.trim(),
      },
    };
  }

  /** meta オブジェクトをフォームに反映（プロジェクト読込用） */
  function applyMeta(meta) {
    if (!meta) return;
    const set = (id, v) => { const el = $(id); if (el != null && v != null) el.value = v; };
    set('meta-type', meta.type);
    set('meta-name', meta.displayName);
    set('meta-intent', meta.intent);
    const s = meta.stats || {};
    set('st-attack', s.attack); set('st-attackspeed', s.attackSpeed);
    set('st-durability', s.durability); set('st-range', s.range);
    set('st-magazine', s.magazine); set('st-reload', s.reloadTime);
    const abs = meta.abilities || [];
    ABILITIES.forEach((a, i) => { const el = $('ab-' + i); if (el) el.checked = abs.indexOf(a) !== -1; });
    const acq = meta.acquisition || {};
    set('acq-method', acq.method);
    const grid = (acq.crafting && acq.crafting.grid) || [];
    for (let i = 0; i < 9; i++) { const el = $('craft-' + i); if (el) el.value = grid[i] || ''; }
    set('craft-count', (acq.crafting && acq.crafting.count) || 1);
    set('drop-note', acq.dropNote);
    set('free-note', acq.note);
  }

  /* ---- ID/出力設定 ---- */
  function getIds() {
    return {
      namespace: $('namespace').value,
      itemId: $('item-id').value,
      packFormat: $('pack-format').value,
      target: $('export-target').value,
    };
  }

  function setIds(ids) {
    if (!ids) return;
    if (ids.namespace) $('namespace').value = ids.namespace;
    if (ids.itemId) $('item-id').value = ids.itemId;
    if (ids.packFormat) $('pack-format').value = ids.packFormat;
    if (ids.target) $('export-target').value = ids.target;
  }

  /* ---- テンプレート ---- */
  function buildTemplateMenu() {
    const sel = $('template-select');
    const cats = {};
    TEMPLATES.forEach((t) => { (cats[t.category] = cats[t.category] || []).push(t); });
    for (const cat of Object.keys(cats)) {
      const og = document.createElement('optgroup');
      og.label = cat;
      cats[cat].forEach((t) => {
        const o = document.createElement('option');
        o.value = t.id;
        o.textContent = `${t.name}（${t.sx}×${t.sy}×${t.sz}）`;
        og.appendChild(o);
      });
      sel.appendChild(og);
    }
    $('btn-load-template').addEventListener('click', loadTemplate);
  }

  function loadTemplate() {
    const id = $('template-select').value;
    const t = TEMPLATES.find((x) => x.id === id);
    if (!t) return;
    if (editor.data.count() > 0 &&
        !confirm(`「${t.name}」を読み込むと現在の内容は置き換えられます。よろしいですか？`)) return;
    editor.loadData(t.build());
    $('grid-x').value = t.sx;
    $('grid-y').value = t.sy;
    $('grid-z').value = t.sz;
  }

  /* ---- パレット ---- */
  function buildPalette() {
    const wrap = $('palette');
    DEFAULT_PALETTE.forEach((c) => {
      const sw = document.createElement('button');
      sw.className = 'swatch';
      sw.style.background = c;
      sw.title = c;
      sw.addEventListener('click', () => selectColor(c, sw));
      wrap.appendChild(sw);
      if (c === currentColor) sw.classList.add('active');
    });
  }

  function selectColor(c, swatch) {
    currentColor = c;
    editor.setColor(c);
    $('color-picker').value = c;
    document.querySelectorAll('.swatch.active').forEach(s => s.classList.remove('active'));
    if (swatch) swatch.classList.add('active');
  }

  /* ---- モード切替 ---- */
  function bindModeButtons() {
    document.querySelectorAll('.mode-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        editor.setMode(btn.dataset.mode);
      });
    });
  }

  /* ---- その他コントロール ---- */
  function bindControls() {
    $('color-picker').addEventListener('input', (e) => {
      selectColor(e.target.value, null);
    });

    $('btn-clear').addEventListener('click', () => {
      if (confirm('すべてのボクセルを消去しますか？')) editor.clearAll();
    });

    $('btn-resize').addEventListener('click', () => {
      const sx = clampSize($('grid-x').value);
      const sy = clampSize($('grid-y').value);
      const sz = clampSize($('grid-z').value);
      $('grid-x').value = sx; $('grid-y').value = sy; $('grid-z').value = sz;
      editor.resize(sx, sy, sz);
    });

    $('btn-export').addEventListener('click', onExport);
  }

  /* ---- 編集系の追加機能（Undo/Redo・ミラー・ロケーター） ---- */
  function bindEditingExtras() {
    $('btn-undo').addEventListener('click', () => editor.undo());
    $('btn-redo').addEventListener('click', () => editor.redo());

    ['x', 'y', 'z'].forEach((ax) => {
      $('mirror-' + ax).addEventListener('change', (e) => editor.setMirror(ax, e.target.checked));
    });

    $('btn-clear-muzzle').addEventListener('click', () => {
      if (!editor.muzzle) return;
      editor._pushHistory();
      editor.setMuzzle(null);
    });

    // キーボードショートカット（テキスト入力中は無効）
    document.addEventListener('keydown', (e) => {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      const k = e.key.toLowerCase();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.shiftKey && k === 'z') { e.preventDefault(); editor.undo(); }
      else if ((mod && k === 'y') || (mod && e.shiftKey && k === 'z')) { e.preventDefault(); editor.redo(); }
    });
  }

  /* ---- プロジェクト 保存/読込/取り込み ---- */
  function bindProjectIO() {
    $('btn-save-project').addEventListener('click', () => {
      const state = { snapshot: editor.snapshot(), meta: collectMeta(), ids: getIds() };
      const name = sanitizeId(getIds().itemId) || 'project';
      downloadProject(serializeProject(state), name);
    });

    $('btn-load-project').addEventListener('click', () => $('file-project').click());

    $('file-project').addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = ''; // 同じファイルを連続で選べるように
      if (!file) return;
      try {
        const obj = await readProjectFile(file);
        const p = deserializeProject(obj);
        editor.loadData(p.data);
        editor.setMuzzle(p.muzzle, true);
        applyMeta(p.meta);
        setIds(p.ids);
        $('grid-x').value = p.grid.sx;
        $('grid-y').value = p.grid.sy;
        $('grid-z').value = p.grid.sz;
        $('export-info').textContent = '読み込み完了' +
          (p.dropped ? `（範囲外の ${p.dropped} 件を除外）` : '');
      } catch (err) {
        alert('読み込みに失敗しました: ' + err.message);
      }
    });
  }

  /* ---- 一括出力キュー ---- */
  function bindQueue() {
    $('btn-queue-add').addEventListener('click', () => {
      const ids = getIds();
      const v = validateExport({ ids, data: editor.data, meta: collectMeta(), target: ids.target });
      renderValidation(v);
      if (v.errors.length) return;
      queue.push({ snapshot: editor.snapshot(), meta: collectMeta(), ids, target: ids.target });
      renderQueue();
    });

    $('btn-export-batch').addEventListener('click', onExportBatch);
  }

  function renderQueue() {
    const ul = $('queue-list');
    ul.innerHTML = '';
    queue.forEach((q, i) => {
      const li = document.createElement('li');
      const label = `${q.ids.namespace || '?'}:${q.ids.itemId || '?'} — ${q.target}`;
      const span = document.createElement('span');
      span.textContent = `${i + 1}. ${label}`;
      const del = document.createElement('button');
      del.className = 'tiny';
      del.textContent = '✕';
      del.title = 'キューから削除';
      del.addEventListener('click', () => { queue.splice(i, 1); renderQueue(); });
      li.appendChild(span);
      li.appendChild(del);
      ul.appendChild(li);
    });
    $('btn-export-batch').disabled = queue.length === 0;
  }

  async function onExportBatch() {
    if (!queue.length) return;
    const bundles = queue.map((q) => buildExportBundle({
      data: dataFromSnapshot(q.snapshot),
      meta: q.meta,
      ids: q.ids,
      target: q.target,
      muzzle: q.snapshot.muzzle,
    }));
    await exportBundleSet(bundles, 'natane_forge_batch.zip');
    $('export-info').textContent = `一括出力完了: ${bundles.length} アイテム / natane_forge_batch.zip`;
  }

  function dataFromSnapshot(s) {
    const d = new VoxelData(s.sx, s.sy, s.sz);
    for (const [x, y, z, color] of s.voxels) d.set(x, y, z, color);
    return d;
  }

  /* ---- バリデーション表示 ---- */
  function renderValidation(v) {
    const box = $('validation');
    box.innerHTML = '';
    const add = (cls, prefix, msg) => {
      const d = document.createElement('div');
      d.className = cls;
      d.textContent = prefix + msg;
      box.appendChild(d);
    };
    v.errors.forEach((m) => add('v-error', '✖ ', m));
    v.warnings.forEach((m) => add('v-warn', '⚠ ', m));
  }

  function clampSize(v) {
    let n = parseInt(v, 10);
    if (isNaN(n)) n = 16;
    return Math.max(1, Math.min(64, n));
  }

  /* ---- 出力 ---- */
  /** 1プロジェクト分の全ファイルを構築（単体・一括で共通利用） */
  function buildExportBundle(proj) {
    const { data, meta, target } = proj;
    const namespace = sanitizeId(proj.ids.namespace) || 'natane_forge';
    const itemId = sanitizeId(proj.ids.itemId) || 'custom_item';
    const packFormat = parseInt(proj.ids.packFormat, 10) || 34;
    const ns = { namespace, itemId };
    const muzzle = proj.muzzle || null;

    const { model, canvas, boxCount } = buildItemModel(data, { namespace, itemId });
    const ctx = {
      namespace, itemId,
      modelPath: `assets/${namespace}/models/item/${itemId}.json`,
      texturePath: `assets/${namespace}/textures/item/${itemId}.png`,
      textureSize: canvas.width,
      boxCount, voxelCount: data.count(),
      grid: { sx: data.sx, sy: data.sy, sz: data.sz },
      muzzle,
    };
    const specJson = buildSpecObject(meta, ctx);
    const specMarkdown = buildSpecMarkdown(meta, ctx);

    let files = [], pngEntries = [], readme = null, label = '';

    if (target === 'kubejs') {
      const r = buildKubeJsFiles(meta, ns, model);
      files = r.files;
      pngEntries = [{ path: r.texturePath, canvas }];
      readme = KUBEJS_README;
      label = `KubeJS（${r.files.length}ファイル）`;
    } else if (target === 'cmd') {
      const r = buildCmdPack(meta, ns, model, packFormat);
      files = r.files; pngEntries = [{ path: r.texturePath, canvas }]; readme = r.readme;
      label = 'CustomModelData / Mod不要';
    } else if (target === 'tacz') {
      const geo = buildBedrockGeo(data, { identifier: 'geometry.' + itemId, muzzle });
      const r = buildTaczPack(meta, ns, geo.geo);
      files = r.files;
      pngEntries = [{ path: r.uvPath, canvas: geo.canvas }, { path: r.slotPath, canvas: geo.canvas }];
      readme = r.readme;
      label = `TaCZガンパック（cube ${geo.boxCount}）`;
    } else if (target === 'geckolib') {
      const geo = buildBedrockGeo(data, { identifier: 'geometry.' + itemId, muzzle });
      const r = buildGeckolibPack(meta, ns, geo.geo);
      files = r.files; pngEntries = [{ path: r.texturePath, canvas: geo.canvas }]; readme = r.readme;
      label = 'GeckoLibアセット＋Java雛形';
    } else if (target === 'patchouli') {
      const r = buildPatchouliBook(meta, ns);
      files = r.files; readme = r.readme;
      label = 'Patchouli図鑑';
    } else { // resourcepack
      files = [
        { path: 'pack.mcmeta', text: JSON.stringify({
          pack: { pack_format: packFormat, description: itemId + ' — Natane Voxel & Data Forge' },
        }, null, 2) },
        { path: ctx.modelPath, text: JSON.stringify(model, null, 2) },
      ];
      pngEntries = [{ path: ctx.texturePath, canvas }];
      label = `リソースパック（要素 ${boxCount} / ${canvas.width}px）`;
    }

    const zipName = itemId + '_' + target + '.zip';
    return { namespace, itemId, target, files, pngEntries, readme, specJson, specMarkdown, label, zipName, canvas };
  }

  async function onExport() {
    const ids = getIds();
    const meta = collectMeta();

    // 出力前バリデーション（errors があれば中止）
    const v = validateExport({ ids, data: editor.data, meta, target: ids.target });
    renderValidation(v);
    if (v.errors.length) {
      $('export-info').textContent = '出力を中止しました（上のエラーを修正してください）。';
      return;
    }

    const bundle = buildExportBundle({
      data: editor.data, meta, ids, target: ids.target, muzzle: editor.muzzle,
    });

    await exportFileSet({
      zipName: bundle.zipName,
      files: bundle.files,
      pngEntries: bundle.pngEntries,
      spec: { itemId: bundle.itemId, data: bundle.specJson },
      specMarkdown: bundle.specMarkdown,
      readme: bundle.readme,
    });

    $('export-info').textContent = `出力完了: ${bundle.zipName}（${bundle.label}）/ 仕様書同梱`;
  }

  /** Minecraftのリソース名規則: 半角英数 . _ - / のみ・小文字 */
  function sanitizeId(s) {
    return (s || '').trim().toLowerCase().replace(/[^a-z0-9._\-/]/g, '_');
  }

  window.addEventListener('DOMContentLoaded', init);
})();
