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
    bindModeButtons();
    bindControls();
    $('voxel-count').textContent = '0';
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
    await exportResourcePack({ namespace, itemId, model, canvas, packFormat });

    $('export-info').textContent =
      `出力完了: ${itemId}.zip （要素 ${boxCount} 個 / テクスチャ ${canvas.width}px）`;
  }

  /** Minecraftのリソース名規則: 半角英数 . _ - / のみ・小文字 */
  function sanitizeId(s) {
    return (s || '').trim().toLowerCase().replace(/[^a-z0-9._\-/]/g, '_');
  }

  window.addEventListener('DOMContentLoaded', init);
})();
