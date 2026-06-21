/* main.js — UIとエディタ/エクスポーターの配線 */
(function () {
  const DEFAULT_PALETTE = [
    '#e6e6e6', '#9aa0a6', '#5a6378', '#2b3140',
    '#3a8ee6', '#2ecc71', '#e74c3c', '#f1c40f',
    '#e67e22', '#9b59b6', '#1ab5b5', '#7f5539',
  ];

  let editor;
  let currentColor = DEFAULT_PALETTE[4];

  function $(id) { return document.getElementById(id); }

  function init() {
    const data = new VoxelData(16, 16, 16);
    editor = new VoxelEditor($('canvas-container'), data);
    editor.setColor(currentColor);
    editor.onChange = (n) => { $('voxel-count').textContent = n; };

    buildPalette();
    buildTemplateMenu();
    buildMetaForm();
    bindModeButtons();
    bindControls();
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

  function clampSize(v) {
    let n = parseInt(v, 10);
    if (isNaN(n)) n = 16;
    return Math.max(1, Math.min(64, n));
  }

  /* ---- 出力 ---- */
  async function onExport() {
    if (editor.data.count() === 0) {
      alert('ボクセルがありません。まず形を作ってください。');
      return;
    }
    const namespace = sanitizeId($('namespace').value) || 'natane_forge';
    const itemId = sanitizeId($('item-id').value) || 'custom_item';
    const packFormat = parseInt($('pack-format').value, 10) || 34;

    const { model, canvas, boxCount } = buildItemModel(editor.data, { namespace, itemId });

    // Mod実装用の仕様書を生成
    const meta = collectMeta();
    const ctx = {
      namespace, itemId,
      modelPath: `assets/${namespace}/models/item/${itemId}.json`,
      texturePath: `assets/${namespace}/textures/item/${itemId}.png`,
      textureSize: canvas.width,
      boxCount, voxelCount: editor.data.count(),
      grid: { sx: editor.data.sx, sy: editor.data.sy, sz: editor.data.sz },
    };
    const spec = buildSpecObject(meta, ctx);
    const specMarkdown = buildSpecMarkdown(meta, ctx);

    const target = $('export-target').value;
    const ns = { namespace, itemId };
    const specArg = { itemId, data: spec };
    let info;

    if (target === 'kubejs') {
      const { files, texturePath } = buildKubeJsFiles(meta, ns, model);
      await exportKubeJs({ itemId, canvas, kubeFiles: files, texturePath, spec, specMarkdown });
      info = `${itemId}_kubejs.zip （KubeJS ${files.length}ファイル）`;
    } else if (target === 'cmd') {
      const r = buildCmdPack(meta, ns, model, packFormat);
      await exportFileSet({ zipName: r.zipName, files: r.files, pngEntries: [{ path: r.texturePath, canvas }], spec: specArg, specMarkdown, readme: r.readme });
      info = `${r.zipName} （CustomModelData / Mod不要）`;
    } else if (target === 'tacz') {
      const geo = buildBedrockGeo(editor.data, { identifier: 'geometry.' + itemId });
      const r = buildTaczPack(meta, ns, geo.geo);
      await exportFileSet({ zipName: r.zipName, files: r.files, pngEntries: [{ path: r.uvPath, canvas: geo.canvas }, { path: r.slotPath, canvas: geo.canvas }], spec: specArg, specMarkdown, readme: r.readme });
      info = `${r.zipName} （TaCZガンパック / cube ${geo.boxCount}）`;
    } else if (target === 'geckolib') {
      const geo = buildBedrockGeo(editor.data, { identifier: 'geometry.' + itemId });
      const r = buildGeckolibPack(meta, ns, geo.geo);
      await exportFileSet({ zipName: r.zipName, files: r.files, pngEntries: [{ path: r.texturePath, canvas: geo.canvas }], spec: specArg, specMarkdown, readme: r.readme });
      info = `${r.zipName} （GeckoLibアセット＋Java雛形）`;
    } else if (target === 'patchouli') {
      const r = buildPatchouliBook(meta, ns);
      await exportFileSet({ zipName: r.zipName, files: r.files, pngEntries: [], spec: specArg, specMarkdown, readme: r.readme });
      info = `${r.zipName} （Patchouli図鑑）`;
    } else {
      await exportResourcePack({ namespace, itemId, model, canvas, packFormat, spec, specMarkdown });
      info = `${itemId}.zip （要素 ${boxCount} 個 / ${canvas.width}px）`;
    }
    $('export-info').textContent = `出力完了: ${info} / 仕様書同梱`;
  }

  /** Minecraftのリソース名規則: 半角英数 . _ - / のみ・小文字 */
  function sanitizeId(s) {
    return (s || '').trim().toLowerCase().replace(/[^a-z0-9._\-/]/g, '_');
  }

  window.addEventListener('DOMContentLoaded', init);
})();
