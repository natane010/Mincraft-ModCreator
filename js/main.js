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
  const customAnims = []; // 手動キーフレームのカスタムアニメ: [{name,length,loop,bone,keyframes}]

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
    editor.onSelection = updateSelectionUI;

    buildPalette();
    buildTemplateMenu();
    buildMetaForm();
    bindModeButtons();
    bindControls();
    bindEditingExtras();
    bindSelection();
    bindReference();
    bindCustomAnims();
    bindAnimPreview();
    bindBones();
    bindBonePreview();
    bindProjectIO();
    bindQueue();
    bindSidebarResizer();
    $('voxel-count').textContent = '0';
  }

  /* ---- メタデータ＆メモ フォーム ---- */
  const ABILITIES = ['炎属性', '毒付与', 'ノックバック', '範囲爆発', '吸収', '加速', '透明化', '発光'];

  // ステータス項目の定義（id と表示用ラベル）
  const STAT_DEFS = [
    { key: 'attack', id: 'st-attack', label: '攻撃力' },
    { key: 'attackSpeed', id: 'st-attackspeed', label: '攻撃速度' },
    { key: 'durability', id: 'st-durability', label: '耐久値' },
    { key: 'range', id: 'st-range', label: '射程' },
    { key: 'magazine', id: 'st-magazine', label: '装弾数' },
    { key: 'reloadTime', id: 'st-reload', label: 'リロード時間' },
    { key: 'defense', id: 'st-defense', label: '防御力' },
    { key: 'toughness', id: 'st-toughness', label: '防具強度' },
    { key: 'health', id: 'st-health', label: '体力' },
    { key: 'moveSpeed', id: 'st-movespeed', label: '移動速度' },
  ];

  // 種別ごとに「入力可能なステータス項目」「特殊能力を出すか」を可変にする
  const TYPE_CONFIG = {
    item:     { stats: [], abilities: true },
    weapon:   { stats: ['attack', 'attackSpeed', 'durability', 'range'], abilities: true },
    tool:     { stats: ['attackSpeed', 'durability'], abilities: true },
    armor:    { stats: ['durability', 'defense', 'toughness'], abilities: true },
    gun:      { stats: ['attack', 'range', 'magazine', 'reloadTime', 'durability'], abilities: true },
    block:    { stats: ['durability'], abilities: false },
    mob:      { stats: ['attack', 'health', 'moveSpeed'], abilities: true },
    material: { stats: [], abilities: false },
  };

  function typeConfig(type) { return TYPE_CONFIG[type] || TYPE_CONFIG.item; }

  /** 種別に応じてステータス欄/特殊能力欄の表示を切り替える */
  function applyTypeFields(type) {
    const cfg = typeConfig(type);
    const show = new Set(cfg.stats);
    STAT_DEFS.forEach((s) => {
      const lab = document.querySelector(`[data-stat="${s.key}"]`);
      if (lab) lab.style.display = show.has(s.key) ? '' : 'none';
    });
    $('combat-stats').style.display = cfg.stats.length ? '' : 'none';
    $('abilities-sub').style.display = cfg.abilities ? '' : 'none';
  }

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
    // 種別変更でステータス/特殊能力欄を可変表示
    $('meta-type').addEventListener('change', () => applyTypeFields($('meta-type').value));
    applyTypeFields($('meta-type').value);
  }

  function collectMeta() {
    const num = (id) => parseFloat($(id).value) || 0;
    const grid = [];
    for (let i = 0; i < 9; i++) grid.push($('craft-' + i).value);
    const type = $('meta-type').value;
    const cfg = typeConfig(type);
    const abilities = cfg.abilities ? ABILITIES.filter((_, i) => $('ab-' + i).checked) : [];
    const stats = {};
    STAT_DEFS.forEach((s) => { stats[s.key] = num(s.id); });
    return {
      type,
      displayName: $('meta-name').value.trim(),
      intent: $('meta-intent').value.trim(),
      stats,
      statFields: cfg.stats.slice(),
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
    STAT_DEFS.forEach((d) => set(d.id, s[d.key]));
    const abs = meta.abilities || [];
    ABILITIES.forEach((a, i) => { const el = $('ab-' + i); if (el) el.checked = abs.indexOf(a) !== -1; });
    applyTypeFields(meta.type || 'item');
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
      scale: parseFloat($('output-scale').value) || 1,
    };
  }

  function setIds(ids) {
    if (!ids) return;
    if (ids.namespace) $('namespace').value = ids.namespace;
    if (ids.itemId) $('item-id').value = ids.itemId;
    if (ids.packFormat) $('pack-format').value = ids.packFormat;
    if (ids.target) $('export-target').value = ids.target;
    if (ids.scale) $('output-scale').value = ids.scale;
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
    editor.resetBones();
    refreshBoneUI();
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
        const wasPreview = editor.isBonePreviewActive && editor.isBonePreviewActive();
        editor.setMode(btn.dataset.mode); // editor 側でプレビューを自動解除
        if (wasPreview) resetBonePreviewUI(); // スライダー表示を 0 へ同期
      });
    });
  }

  /* ---- サイドバー幅のドラッグ調整 ---- */
  function bindSidebarResizer() {
    const sidebar = $('sidebar');
    const handle = $('sidebar-resizer');
    const MIN = 200, MAX = 620;
    // 保存済み幅を復元
    const saved = parseInt(localStorage.getItem('vf-sidebar-w'), 10);
    if (saved && saved >= MIN && saved <= MAX) {
      sidebar.style.flexBasis = saved + 'px';
      sidebar.style.width = saved + 'px';
    }
    let dragging = false;
    const onMove = (e) => {
      if (!dragging) return;
      const w = Math.max(MIN, Math.min(MAX, e.clientX - sidebar.getBoundingClientRect().left));
      sidebar.style.flexBasis = w + 'px';
      sidebar.style.width = w + 'px';
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      handle.classList.remove('dragging');
      document.body.classList.remove('resizing-sidebar');
      localStorage.setItem('vf-sidebar-w', parseInt(sidebar.style.width, 10) || 270);
      window.dispatchEvent(new Event('resize')); // 3Dキャンバスを追従させる
    };
    handle.addEventListener('pointerdown', (e) => {
      dragging = true;
      handle.classList.add('dragging');
      document.body.classList.add('resizing-sidebar');
      e.preventDefault();
    });
    // ダブルクリックで既定幅(270px)に戻す
    handle.addEventListener('dblclick', () => {
      sidebar.style.flexBasis = '270px';
      sidebar.style.width = '270px';
      localStorage.setItem('vf-sidebar-w', 270);
      window.dispatchEvent(new Event('resize'));
    });
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
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

    $('drag-draw').addEventListener('change', (e) => editor.setDragDraw(e.target.checked));
    $('face-pixel').addEventListener('change', (e) => editor.setFacePixelMode(e.target.checked));

    // キーボードショートカット（テキスト入力中は無効）
    document.addEventListener('keydown', (e) => {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      const k = e.key.toLowerCase();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.shiftKey && k === 'z') { e.preventDefault(); editor.undo(); return; }
      if ((mod && k === 'y') || (mod && e.shiftKey && k === 'z')) { e.preventDefault(); editor.redo(); return; }

      // 選択範囲の移動（矢印キー / PageUp・Down）
      if (editor.mode === 'select' && editor.selection) {
        const mv = {
          ArrowLeft: [-1, 0, 0], ArrowRight: [1, 0, 0],
          ArrowUp: [0, 1, 0], ArrowDown: [0, -1, 0],
          PageUp: [0, 0, -1], PageDown: [0, 0, 1],
        }[e.key];
        if (mv) { e.preventDefault(); editor.moveSelection(mv[0], mv[1], mv[2]); }
      }
    });
  }

  /* ---- 領域選択 ---- */
  function bindSelection() {
    $('btn-sel-copy').addEventListener('click', () => {
      const n = editor.copySelection();
      updateSelectionUI(editor.selection);
      $('export-info').textContent = `${n} ボクセルをコピーしました`;
    });
    $('btn-sel-cut').addEventListener('click', () => {
      const n = editor.cutSelection();
      updateSelectionUI(editor.selection);
      $('export-info').textContent = `${n} ボクセルをカットしました`;
    });
    $('btn-sel-paste').addEventListener('click', () => {
      const n = editor.pasteClipboard();
      $('export-info').textContent = `${n} ボクセルを貼り付けました`;
    });
    $('btn-sel-delete').addEventListener('click', () => editor.deleteSelection());
    $('btn-sel-clear').addEventListener('click', () => editor.clearSelection());
    $('btn-sel-fill').addEventListener('click', () => {
      const n = editor.fillSelection();
      $('export-info').textContent = `${n} ボクセルを塗りつぶしました`;
    });
    [['btn-sel-mirror-x', 'x'], ['btn-sel-mirror-y', 'y'], ['btn-sel-mirror-z', 'z']].forEach(([id, ax]) => {
      $(id).addEventListener('click', () => {
        const n = editor.mirrorCopySelection(ax);
        $('export-info').textContent = `${ax.toUpperCase()}対称に ${n} ボクセルをコピーしました`;
      });
    });

    document.querySelectorAll('.movepad [data-mv]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const [dx, dy, dz] = btn.dataset.mv.split(',').map(Number);
        editor.moveSelection(dx, dy, dz);
      });
    });
    updateSelectionUI(null);
  }

  function updateSelectionUI(sel) {
    const has = !!sel;
    const hasClip = !!(editor.clipboard && editor.clipboard.length);
    ['btn-sel-copy', 'btn-sel-cut', 'btn-sel-delete', 'btn-sel-clear', 'btn-sel-fill', 'btn-sel-mirror-x', 'btn-sel-mirror-y', 'btn-sel-mirror-z'].forEach((id) => { $(id).disabled = !has; });
    $('btn-sel-paste').disabled = !hasClip;
    const ba = $('btn-bone-assign'); if (ba) ba.disabled = !has;
    document.querySelectorAll('.movepad [data-mv]').forEach((b) => { b.disabled = !has; });
    if (has) {
      const w = sel.max[0] - sel.min[0] + 1, h = sel.max[1] - sel.min[1] + 1, d = sel.max[2] - sel.min[2] + 1;
      $('selection-info').textContent = `選択中: ${w}×${h}×${d}` + (hasClip ? `（クリップボード ${editor.clipboard.length}）` : '');
    } else {
      $('selection-info').textContent = '選択モードで2点をクリックして範囲を指定' + (hasClip ? `（クリップボード ${editor.clipboard.length}）` : '');
    }
  }

  /* ---- 下絵リファレンス ---- */
  function bindReference() {
    $('btn-ref-load').addEventListener('click', () => $('file-ref').click());

    $('file-ref').addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        editor.setReference(reader.result, {
          plane: $('ref-plane').value,
          opacity: (parseInt($('ref-opacity').value, 10) || 50) / 100,
        });
        $('btn-ref-clear').disabled = false;
      };
      reader.readAsDataURL(file);
    });

    $('ref-plane').addEventListener('change', () => {
      if (editor.reference) {
        editor.setReference(editor.reference.url, {
          plane: $('ref-plane').value,
          opacity: (parseInt($('ref-opacity').value, 10) || 50) / 100,
        });
      }
    });

    $('ref-opacity').addEventListener('input', (e) => {
      const pct = parseInt(e.target.value, 10) || 0;
      $('ref-op-val').textContent = pct + '%';
      editor.setReferenceOpacity(pct / 100);
    });

    $('btn-ref-clear').addEventListener('click', () => {
      editor.clearReference();
      $('btn-ref-clear').disabled = true;
    });
  }

  /* ---- アニメーション選択 ---- */
  function collectAnimSelections() {
    const keys = ['idle', 'fire', 'reload', 'draw'];
    const sel = [];
    keys.forEach((k) => {
      if ($('anim-' + k).checked) {
        sel.push({ key: k, length: parseFloat($('anim-' + k + '-len').value) || undefined });
      }
    });
    return sel;
  }

  /* ---- カスタムアニメ（手動キーフレーム） ---- */
  let _editingIndex = null; // 編集中の committed カスタムアニメ index（新規は null）
  let _draftTime = 0;       // 下書きプレビューの現在時刻

  function bindCustomAnims() {
    addKfRow();
    $('btn-canim-addkf').addEventListener('click', () => { addKfRow(); onTableChanged(); });
    $('btn-canim-commit').addEventListener('click', commitCustomAnim);
    // 表/メタの編集を下書きプレビューへ即時反映（双方向同期）
    $('canim-kf-body').addEventListener('input', onTableChanged);
    ['canim-name', 'canim-length', 'canim-loop', 'canim-bone'].forEach((id) => {
      const el = $(id);
      if (el) el.addEventListener('change', onTableChanged);
    });
    renderCustomAnimList();
  }

  function addKfRow(kf) {
    kf = kf || {};
    const pos = kf.pos || [0, 0, 0], rot = kf.rot || [0, 0, 0];
    const tr = document.createElement('tr');
    tr.innerHTML =
      `<td><input type="number" class="kf-t" step="0.05" min="0" value="${kf.t != null ? kf.t : 0}"></td>` +
      `<td class="kf-vec">` +
        `<input type="number" class="kf-px" step="0.5" value="${pos[0]}">` +
        `<input type="number" class="kf-py" step="0.5" value="${pos[1]}">` +
        `<input type="number" class="kf-pz" step="0.5" value="${pos[2]}"></td>` +
      `<td class="kf-vec">` +
        `<input type="number" class="kf-rx" step="5" value="${rot[0]}">` +
        `<input type="number" class="kf-ry" step="5" value="${rot[1]}">` +
        `<input type="number" class="kf-rz" step="5" value="${rot[2]}"></td>` +
      `<td class="kf-ctl">` +
        `<button class="tiny kf-jump" title="この時刻を3Dプレビュー">▶</button>` +
        `<button class="tiny kf-del" title="この行を削除">✕</button></td>`;
    tr.querySelector('.kf-del').addEventListener('click', () => { tr.remove(); onTableChanged(); });
    tr.querySelector('.kf-jump').addEventListener('click', () => jumpToKf(tr));
    $('canim-kf-body').appendChild(tr);
  }

  function readKfRows() {
    const v = (tr, cls) => parseFloat(tr.querySelector('.' + cls).value) || 0;
    return [...$('canim-kf-body').querySelectorAll('tr')].map((tr) => ({
      t: v(tr, 'kf-t'),
      pos: [v(tr, 'kf-px'), v(tr, 'kf-py'), v(tr, 'kf-pz')],
      rot: [v(tr, 'kf-rx'), v(tr, 'kf-ry'), v(tr, 'kf-rz')],
    }));
  }

  function commitCustomAnim() {
    const name = sanitizeId($('canim-name').value);
    const kfs = readKfRows();
    if (!name) { alert('アニメ名を入力してください'); return; }
    if (!kfs.length) { alert('キーフレームを1つ以上追加してください'); return; }
    const entry = {
      name,
      length: parseFloat($('canim-length').value) || 0,
      loop: $('canim-loop').checked,
      bone: $('canim-bone').value || 'root',
      keyframes: kfs,
    };
    if (_editingIndex != null && customAnims[_editingIndex]) customAnims[_editingIndex] = entry;
    else customAnims.push(entry);
    _editingIndex = null;
    $('btn-canim-commit').textContent = 'このアニメを追加';
    renderCustomAnimList();
    $('canim-name').value = '';
    $('canim-kf-body').innerHTML = '';
    addKfRow();
    onTableChanged();
  }

  /** committed カスタムアニメを表へ読み戻して再編集（プレビュー→表 / 往復編集） */
  function editCustomAnim(i) {
    const a = customAnims[i];
    if (!a) return;
    $('canim-name').value = a.name || '';
    $('canim-length').value = a.length || 0;
    $('canim-loop').checked = !!a.loop;
    if ([...$('canim-bone').options].some((o) => o.value === a.bone)) $('canim-bone').value = a.bone;
    $('canim-kf-body').innerHTML = '';
    (a.keyframes || []).forEach((kf) => addKfRow(kf));
    if (!a.keyframes || !a.keyframes.length) addKfRow();
    _editingIndex = i;
    $('btn-canim-commit').textContent = '更新';
    onTableChanged();
  }

  function renderCustomAnimList() {
    const ul = $('canim-list');
    ul.innerHTML = '';
    customAnims.forEach((a, i) => {
      const li = document.createElement('li');
      const span = document.createElement('span');
      span.textContent = `${i + 1}. ${a.name}（${a.keyframes.length}kf / ${a.bone}${a.loop ? ' / loop' : ''}）`;
      const ed = document.createElement('button');
      ed.className = 'tiny'; ed.textContent = '編集'; ed.title = '表に読み戻して再編集';
      ed.addEventListener('click', () => editCustomAnim(i));
      const del = document.createElement('button');
      del.className = 'tiny'; del.textContent = '✕'; del.title = '削除';
      del.addEventListener('click', () => {
        customAnims.splice(i, 1);
        if (_editingIndex === i) { _editingIndex = null; $('btn-canim-commit').textContent = 'このアニメを追加'; }
        renderCustomAnimList();
      });
      li.appendChild(span); li.appendChild(ed); li.appendChild(del);
      ul.appendChild(li);
    });
    buildPreviewAnimList();
  }

  function applyCustomAnims(list) {
    customAnims.length = 0;
    (list || []).forEach((a) => customAnims.push(a));
    _editingIndex = null;
    $('btn-canim-commit').textContent = 'このアニメを追加';
    renderCustomAnimList();
    buildPreviewAnimList();
  }

  /* ---- 下書き(編集中の表)を3Dプレビューへ橋渡し（双方向同期） ---- */
  /** 表の現在内容を1つのカスタムアニメ entry に。空(全0)なら null */
  function draftEntry() {
    const kfs = readKfRows();
    if (!kfs.length) return null;
    return {
      name: '__draft',
      length: parseFloat($('canim-length').value) || 0,
      loop: $('canim-loop').checked,
      bone: $('canim-bone').value || 'root',
      keyframes: kfs,
    };
  }

  /** プレビュー用 animation JSON（プリセット＋committed＋編集中の下書き） */
  function previewAnimJson() {
    const d = draftEntry();
    const list = d ? customAnims.concat([d]) : customAnims;
    return buildAnimationJson(getIds().itemId, collectAnimSelections(), list);
  }

  function isDraftSelected() {
    const v = $('anim-preview-select') ? $('anim-preview-select').value : '';
    return v.slice(-8) === '.__draft';
  }

  /** 表が変わったら選択肢を更新。下書きを表示中なら現在時刻で再ポーズ */
  function onTableChanged() {
    buildPreviewAnimList();
    if (isDraftSelected()) applyDraftScrub(_draftTime);
  }

  function applyDraftScrub(t) {
    const sel = $('anim-preview-select');
    const key = sel ? sel.value : '';
    if (!key) return;
    _draftTime = t;
    editor.stopAnimation();
    editor.scrubAnimation(t, previewAnimJson(), key, $('anim-preview-loop').checked);
    updatePlayButtons(false);
  }

  /** プレビュー selに下書きオプションを確実に選択させる */
  function selectDraftInPreview() {
    buildPreviewAnimList();
    const sel = $('anim-preview-select');
    const opt = [...sel.options].find((o) => o.value.slice(-8) === '.__draft');
    if (opt) sel.value = opt.value;
    return !!opt;
  }

  /** キーフレーム行の▶: その時刻を下書きプレビュー */
  function jumpToKf(tr) {
    const t = parseFloat(tr.querySelector('.kf-t').value) || 0;
    if (!selectDraftInPreview()) return; // 全0など下書きが空なら何もしない
    applyDraftScrub(t);
    highlightKfRow(tr);
  }

  function highlightKfRow(tr) {
    [...$('canim-kf-body').querySelectorAll('tr')].forEach((r) => r.classList.toggle('kf-active', r === tr));
  }

  /** 再生/スクラブ時刻に最も近いキーフレーム行をハイライト（プレビュー→表） */
  function highlightNearestKf(time) {
    const rows = [...$('canim-kf-body').querySelectorAll('tr')];
    let best = null, bestD = Infinity;
    rows.forEach((r) => {
      const t = parseFloat(r.querySelector('.kf-t').value) || 0;
      const d = Math.abs(t - time);
      if (d < bestD) { bestD = d; best = r; }
    });
    rows.forEach((r) => r.classList.toggle('kf-active', r === best));
  }

  /* ---- アニメ3Dプレビュー ---- */
  let _scrubDragging = false; // スクラブのユーザードラッグ中（自動更新の上書きを抑制）

  function bindAnimPreview() {
    buildPreviewAnimList();

    // プリセットのON/OFF・長さ変更で選択肢を最新化
    ['idle', 'fire', 'reload', 'draw'].forEach((k) => {
      const cb = $('anim-' + k);
      if (cb) cb.addEventListener('change', buildPreviewAnimList);
      const len = $('anim-' + k + '-len');
      if (len) len.addEventListener('input', buildPreviewAnimList);
    });

    // 再生対象を変えたら、その場でポーズ表示（先頭フレーム）へ
    $('anim-preview-select').addEventListener('change', () => {
      editor.stopAnimation();
      const key = $('anim-preview-select').value;
      if (!key) return;
      _draftTime = 0;
      editor.scrubAnimation(0, previewAnimJson(), key, $('anim-preview-loop').checked);
    });

    $('btn-anim-play').addEventListener('click', () => {
      const key = $('anim-preview-select').value;
      if (!key) return;
      editor.playAnimation(previewAnimJson(), key, $('anim-preview-loop').checked);
      updatePlayButtons(true);
    });

    $('btn-anim-stop').addEventListener('click', () => {
      editor.stopAnimation();
      updatePlayButtons(false);
    });

    $('anim-preview-loop').addEventListener('change', () => {
      editor.setAnimLoop($('anim-preview-loop').checked);
    });

    // スクラブ: 0..1000 を 0..length に正規化。ドラッグ中フラグで自動更新を抑制
    const scrub = $('anim-scrub');
    scrub.addEventListener('input', () => {
      _scrubDragging = true;
      const key = $('anim-preview-select').value;
      if (!key) return;
      const json = previewAnimJson();
      const entry = json && json.animations && json.animations[key];
      const len = entry ? (Number(entry.animation_length) || 0) : 0;
      const t = len * (parseFloat(scrub.value) / 1000);
      if (isDraftSelected()) _draftTime = t;
      editor.scrubAnimation(t, json, key, $('anim-preview-loop').checked);
      updatePlayButtons(false);
    });
    scrub.addEventListener('change', () => { _scrubDragging = false; });
    scrub.addEventListener('pointerup', () => { _scrubDragging = false; });

    // 毎フレーム通知でラベル/スライダー/ボタンを同期
    editor.onAnimFrame = (time, length) => {
      $('anim-time-val').textContent = (time || 0).toFixed(2) + 's';
      $('anim-len-val').textContent = (length || 0).toFixed(2) + 's';
      if (!_scrubDragging) {
        const v = (length > 0) ? Math.round((time / length) * 1000) : 0;
        $('anim-scrub').value = v;
      }
      // 下書きプレビュー中は、現在時刻に最も近いキーフレーム行をハイライト（プレビュー→表）
      if (isDraftSelected()) { _draftTime = time; highlightNearestKf(time); }
      // 非ループで終端に達したら（playing=falseに落ちる）停止ボタン表示へ
      if (!editor.anim.playing) updatePlayButtons(false);
    };
  }

  function updatePlayButtons(playing) {
    $('btn-anim-play').disabled = playing || !$('anim-preview-select').value;
    $('btn-anim-stop').disabled = !playing;
  }

  /** プリセット＋カスタムから選択肢を再構築。アニメ無しなら無効化 */
  function buildPreviewAnimList() {
    const sel = $('anim-preview-select');
    if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = '';
    const json = previewAnimJson();
    const keys = json && json.animations ? Object.keys(json.animations) : [];
    if (!keys.length) {
      const o = document.createElement('option');
      o.value = '';
      o.textContent = '（選択中のアニメなし）';
      sel.appendChild(o);
      $('btn-anim-play').disabled = true;
      $('btn-anim-stop').disabled = !(editor && editor.anim && editor.anim.playing);
      return;
    }
    keys.forEach((k) => {
      const o = document.createElement('option');
      o.value = k;
      const name = k.split('.').slice(2).join('.'); // 末尾名（animation.<id>.<name> の <name>）
      o.textContent = (name === '__draft') ? '▼ 編集中の下書き' : name;
      sel.appendChild(o);
    });
    // 以前の選択を維持できれば維持
    if (keys.indexOf(prev) >= 0) sel.value = prev;
    $('btn-anim-play').disabled = !!(editor && editor.anim && editor.anim.playing);
  }

  /* ---- ボーン（関節）分割 ---- */
  function bindBones() {
    $('btn-bone-add').addEventListener('click', () => {
      const name = sanitizeId($('bone-name').value);
      if (!name) { alert('ボーン名を入力してください'); return; }
      const pivot = [
        parseFloat($('bone-pivot-x').value) || 0,
        parseFloat($('bone-pivot-y').value) || 0,
        parseFloat($('bone-pivot-z').value) || 0,
      ];
      if (!editor.addBone(name, pivot, $('bone-parent').value || '')) {
        alert('追加できません（名前が重複しているか空です）'); return;
      }
      $('bone-name').value = '';
      refreshBoneUI();
    });
    $('btn-bone-assign').addEventListener('click', () => {
      const target = $('bone-assign-target').value || 'root';
      const n = editor.assignSelectionToBone(target);
      $('export-info').textContent = n ? `${n} ボクセルを「${target}」ボーンに割り当てました` : '選択範囲がありません';
    });
    refreshBoneUI();
  }

  function refreshBoneUI() {
    const ul = $('bone-list');
    ul.innerHTML = '';
    editor.bones.forEach((b) => {
      const li = document.createElement('li');
      const span = document.createElement('span');
      span.textContent = b.name === 'root'
        ? 'root（既定・未割当はここ）'
        : `${b.name}  pivot[${b.pivot.join(', ')}]${b.parent ? ` ← ${b.parent}` : ''}`;
      li.appendChild(span);
      if (b.name !== 'root') {
        const del = document.createElement('button');
        del.className = 'tiny'; del.textContent = '✕'; del.title = '削除（rootへ戻す）';
        del.addEventListener('click', () => {
          editor.clearBonePreview();   // 対象ボーンが消える可能性があるので解除
          editor.removeBone(b.name);
          refreshBoneUI();
        });
        li.appendChild(del);
      }
      ul.appendChild(li);
    });
    fillBoneSelect($('bone-parent'), true);
    fillBoneSelect($('bone-assign-target'), false);
    fillBoneSelect($('canim-bone'), false);
    refreshBonePreviewUI();
  }

  function fillBoneSelect(sel, withEmpty) {
    if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = '';
    if (withEmpty) {
      const o = document.createElement('option');
      o.value = ''; o.textContent = '（親なし）';
      sel.appendChild(o);
    }
    editor.bones.forEach((b) => {
      const o = document.createElement('option');
      o.value = b.name; o.textContent = b.name;
      sel.appendChild(o);
    });
    if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
  }

  /* ---- ボーン回転プレビュー（pivot周りのX/Y/Z回転を3Dビューに即時反映） ---- */
  const PREV_AXES = ['rx', 'ry', 'rz'];

  function bindBonePreview() {
    // 対象ボーン切替: そのボーンの現在のプレビュー回転をスライダーへ反映
    $('bone-prev-target').addEventListener('change', () => {
      syncBonePrevSliders();
    });
    // 各軸スライダー: 角度表示更新 + エディタへ反映
    PREV_AXES.forEach((ax) => {
      $('bone-prev-' + ax).addEventListener('input', () => {
        applyBonePrevFromSliders();
      });
    });
    // リセット: 当該ボーンの回転を 0 に戻す
    $('btn-bone-prev-reset').addEventListener('click', () => {
      PREV_AXES.forEach((ax) => { $('bone-prev-' + ax).value = 0; });
      applyBonePrevFromSliders();
    });
    refreshBonePreviewUI();
  }

  /** 非rootボーンを bone-prev-target に充填。root のみのときはUIを無効化 */
  function refreshBonePreviewUI() {
    const sel = $('bone-prev-target');
    if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = '';
    const nonRoot = editor.bones.filter((b) => b.name !== 'root');
    nonRoot.forEach((b) => {
      const o = document.createElement('option');
      o.value = b.name; o.textContent = b.name;
      sel.appendChild(o);
    });
    const enabled = nonRoot.length > 0;
    sel.disabled = !enabled;
    $('btn-bone-prev-reset').disabled = !enabled;
    PREV_AXES.forEach((ax) => { $('bone-prev-' + ax).disabled = !enabled; });
    if (enabled && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
    syncBonePrevSliders();
  }

  /** 選択中ボーンの現在プレビュー回転（度）をスライダー＆ラベルへ反映 */
  function syncBonePrevSliders() {
    const name = $('bone-prev-target').value;
    const r = (name && editor.getBonePreviewRotation) ? editor.getBonePreviewRotation(name) : [0, 0, 0];
    PREV_AXES.forEach((ax, i) => {
      $('bone-prev-' + ax).value = r[i];
      $('bone-prev-' + ax + '-val').textContent = Math.round(r[i]) + '°';
    });
  }

  /** スライダー値（度）を読み取り、ラベル更新＋エディタへプレビュー反映 */
  function applyBonePrevFromSliders() {
    const name = $('bone-prev-target').value;
    const rot = PREV_AXES.map((ax) => {
      const v = parseFloat($('bone-prev-' + ax).value) || 0;
      $('bone-prev-' + ax + '-val').textContent = Math.round(v) + '°';
      return v;
    });
    if (name) editor.setBonePreviewRotation(name, rot);
  }

  /** プレビュー解除＋スライダーを0へ同期（編集モード切替/読込時にUI整合用） */
  function resetBonePreviewUI() {
    if (editor && editor.clearBonePreview) editor.clearBonePreview();
    PREV_AXES.forEach((ax) => {
      const el = $('bone-prev-' + ax);
      if (el) el.value = 0;
      const lbl = $('bone-prev-' + ax + '-val');
      if (lbl) lbl.textContent = '0°';
    });
  }

  /* ---- プロジェクト 保存/読込/取り込み ---- */
  function bindProjectIO() {
    $('btn-save-project').addEventListener('click', () => {
      const state = { snapshot: editor.snapshot(), meta: collectMeta(), ids: getIds(), customAnims };
      const name = sanitizeId(getIds().itemId) || 'project';
      downloadProject(serializeProject(state), name);
    });

    $('btn-load-project').addEventListener('click', () => $('file-project').click());

    $('file-project').addEventListener('change', async (e) => {
      const files = e.target.files ? [...e.target.files] : [];
      e.target.value = ''; // 同じファイルを連続で選べるように
      if (!files.length) return;
      // モデルJSON＋（任意で）テクスチャPNGを同時選択できる
      const imgFile = files.find((f) => /\.(png|jpe?g|gif|webp)$/i.test(f.name) || (f.type || '').indexOf('image/') === 0);
      const jsonFile = files.find((f) => f !== imgFile);
      if (!jsonFile) { alert('モデル/プロジェクトのJSONファイルが選択されていません。'); return; }
      try {
        const obj = await readProjectFile(jsonFile);
        const fmt = detectImportFormat(obj);
        if (fmt === 'project') {
          const p = deserializeProject(obj);
          editor.loadData(p.data);
          editor.setFaceColors(p.faceColors); // 面色復元（loadData 後）
          editor.setFacePixels(p.facePixels); // 面ピクセル復元（loadData 後）
          editor.setMuzzle(p.muzzle, true);
          editor.setBones(p.bones, p.boneMap);
          applyMeta(p.meta);
          setIds(p.ids);
          syncGridInputs(p.grid);
          applyCustomAnims(p.customAnims);
          refreshBoneUI();
          $('export-info').textContent = '読み込み完了' +
            (p.dropped ? `（範囲外の ${p.dropped} 件を除外）` : '');
        } else if (fmt === 'java-model' || fmt === 'bedrock-geo') {
          // テクスチャがあれば色を復元するサンプラーを用意
          let sampler = null, texNote = '';
          if (imgFile) {
            try { sampler = await loadImageSampler(await fileToDataUrl(imgFile)); }
            catch (err) { sampler = null; texNote = ' ※テクスチャ読込失敗: ' + err.message; }
          }
          const subdiv = parseInt($('import-subdiv').value, 10) || 1;
          const r = fmt === 'java-model'
            ? voxelizeJavaModel(obj, { sampler, subdiv })
            : voxelizeBedrockGeo(obj, { sampler, subdiv });
          editor.loadData(r.data);
          editor.resetBones();
          refreshBoneUI();
          syncGridInputs(r.grid);
          // 細分化した分、出力スケールを 1/subdiv にして実寸を保つ
          if (subdiv > 1) $('output-scale').value = +(1 / subdiv).toFixed(4);
          $('export-info').textContent = r.info +
            (r.dropped ? `（範囲外の ${r.dropped} 件を除外）` : '') +
            (subdiv > 1 ? ` / 細分化×${subdiv}（出力スケール=${+(1 / subdiv).toFixed(4)}）` : '') +
            (r.colored ? '' : ' ※色は仮(要塗り直し／テクスチャPNGを一緒に選ぶと色を復元)') + texNote;
        } else {
          alert('対応していないファイルです。\n.vdf.json / Java model.json(elements) / Bedrock .geo.json に対応しています。');
        }
      } catch (err) {
        alert('読み込みに失敗しました: ' + err.message);
      }
    });
  }

  /* File -> dataURL */
  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('ファイル読み込み失敗'));
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(file);
    });
  }

  /** テクスチャ画像から、正規化UV矩形の平均色を返すサンプラーを作る */
  function loadImageSampler(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onerror = () => reject(new Error('画像を読み込めません'));
      img.onload = () => {
        const cv = document.createElement('canvas');
        cv.width = img.width; cv.height = img.height;
        const cx = cv.getContext('2d');
        cx.drawImage(img, 0, 0);
        let id;
        try { id = cx.getImageData(0, 0, cv.width, cv.height); }
        catch (err) { reject(new Error('ピクセル取得に失敗: ' + err.message)); return; }
        resolve(makeSampler(id.data, cv.width, cv.height));
      };
      img.src = dataUrl;
    });
  }

  function makeSampler(d, W, H) {
    return (u0, v0, u1, v1) => {
      let x0 = Math.floor(u0 * W), x1 = Math.ceil(u1 * W);
      let y0 = Math.floor(v0 * H), y1 = Math.ceil(v1 * H);
      x0 = Math.max(0, Math.min(W - 1, x0)); x1 = Math.max(x0 + 1, Math.min(W, x1));
      y0 = Math.max(0, Math.min(H - 1, y0)); y1 = Math.max(y0 + 1, Math.min(H, y1));
      let r = 0, g = 0, b = 0, n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * W + x) * 4;
          if (d[i + 3] < 8) continue; // ほぼ透明は無視
          r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
        }
      }
      if (!n) return null;
      const hx = (v) => Math.round(v / n).toString(16).padStart(2, '0');
      return '#' + hx(r) + hx(g) + hx(b);
    };
  }

  /* ---- 一括出力キュー ---- */
  function bindQueue() {
    $('btn-queue-add').addEventListener('click', () => {
      const ids = getIds();
      const v = validateExport({ ids, data: editor.data, meta: collectMeta(), target: ids.target });
      renderValidation(v);
      if (v.errors.length) return;
      queue.push({ snapshot: editor.snapshot(), meta: collectMeta(), ids, target: ids.target, anims: collectAnimSelections(), customAnims: customAnims.map((a) => a) });
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
      animSelections: q.anims || [],
      customAnims: q.customAnims || [],
      bones: q.snapshot.bones,
      boneOf: boneOfFromSnapshot(q.snapshot),
    }));
    await exportBundleSet(bundles, 'natane_forge_batch.zip');
    $('export-info').textContent = `一括出力完了: ${bundles.length} アイテム / natane_forge_batch.zip`;
  }

  function dataFromSnapshot(s) {
    const d = new VoxelData(s.sx, s.sy, s.sz);
    for (const [x, y, z, color] of s.voxels) d.set(x, y, z, color);
    // 面色を反映（各エクスポータが面別UVを出せるよう一括出力でも必須）
    (s.faceColors || []).forEach(([x, y, z, face, color]) => d.setFace(x, y, z, face, color));
    // 面ピクセルを反映（一括出力でもアトラスへ伝わる）
    (s.facePixels || []).forEach(([x, y, z, face, arr]) => {
      if (Array.isArray(arr)) for (let i = 0; i < arr.length; i++) if (arr[i]) d.setFacePixel(x, y, z, face, i, arr[i]);
    });
    return d;
  }

  /** スナップショットの boneMap から boneOf(x,y,z) を作る */
  function boneOfFromSnapshot(s) {
    const map = new Map(s.boneMap || []);
    return (x, y, z) => map.get(x + ',' + y + ',' + z) || 'root';
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

  function syncGridInputs(grid) {
    $('grid-x').value = grid.sx;
    $('grid-y').value = grid.sy;
    $('grid-z').value = grid.sz;
  }

  function clampSize(v) {
    let n = parseInt(v, 10);
    if (isNaN(n)) n = 16;
    return Math.max(1, Math.min(128, n));
  }

  /* ---- 出力 ---- */
  /** 1プロジェクト分の全ファイルを構築（単体・一括で共通利用） */
  function buildExportBundle(proj) {
    const { data, meta, target } = proj;
    const namespace = sanitizeId(proj.ids.namespace) || 'natane_forge';
    const itemId = sanitizeId(proj.ids.itemId) || 'custom_item';
    const packFormat = parseInt(proj.ids.packFormat, 10) || 34;
    const scale = parseFloat(proj.ids.scale) || 1;
    const ns = { namespace, itemId };
    const muzzle = proj.muzzle || null;

    const animSel = proj.animSelections || [];
    const customAnims = proj.customAnims || [];
    const animJson = buildAnimationJson(itemId, animSel, customAnims);
    const animNames = animSel.map((s) => s.key).concat(
      customAnims.filter((a) => a && a.keyframes && a.keyframes.length).map((a) => a.name || 'custom'));

    const { model, canvas, boxCount } = buildItemModel(data, { namespace, itemId, scale });
    const ctx = {
      namespace, itemId,
      modelPath: `assets/${namespace}/models/item/${itemId}.json`,
      texturePath: `assets/${namespace}/textures/item/${itemId}.png`,
      textureSize: canvas.width,
      boxCount, voxelCount: data.count(),
      grid: { sx: data.sx, sy: data.sy, sz: data.sz },
      scale,
      muzzle,
      bones: (proj.bones && proj.bones.length > 1) ? proj.bones : null,
      animations: animNames,
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
      const geo = buildBedrockGeo(data, { identifier: 'geometry.' + itemId, muzzle, bones: proj.bones, boneOf: proj.boneOf, unitScale: scale });
      const r = buildTaczPack(meta, ns, geo.geo);
      files = r.files;
      pngEntries = [{ path: r.uvPath, canvas: geo.canvas }, { path: r.slotPath, canvas: geo.canvas }];
      readme = r.readme;
      label = `TaCZガンパック（cube ${geo.boxCount}）`;
    } else if (target === 'geckolib') {
      const geo = buildBedrockGeo(data, { identifier: 'geometry.' + itemId, muzzle, bones: proj.bones, boneOf: proj.boneOf, unitScale: scale });
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

    // アニメーション同梱（TaCZ/GeckoLib のみ。GeckoLibは雛形を上書き）
    if (animJson) {
      const animText = JSON.stringify(animJson, null, 2);
      if (target === 'geckolib') {
        replaceOrAddFile(files, `assets/${namespace}/animations/${itemId}.animation.json`, animText);
      } else if (target === 'tacz') {
        replaceOrAddFile(files, `${namespace}/animations/${itemId}.animation.json`, animText);
        label += ` ＋アニメ${animSel.length}`;
      }
    }

    const zipName = itemId + '_' + target + '.zip';
    return { namespace, itemId, target, files, pngEntries, readme, specJson, specMarkdown, label, zipName, canvas };
  }

  function replaceOrAddFile(files, path, text) {
    const i = files.findIndex((f) => f.path === path);
    if (i >= 0) files[i] = { path, text }; else files.push({ path, text });
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
      animSelections: collectAnimSelections(), customAnims,
      bones: editor.bones, boneOf: (x, y, z) => editor.getBoneOf(x, y, z),
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
