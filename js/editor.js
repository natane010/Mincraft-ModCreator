/* editor.js
 * Three.js による3Dボクセルエディタ本体。
 * シーン管理・カメラ操作(OrbitControls)・ボクセルの追加/削除/塗装を担当。
 * 形状データは VoxelData が保持し、ここでは描画とユーザー操作だけを行う。
 */
class VoxelEditor {
  constructor(container, data) {
    this.container = container;
    this.data = data;
    this.mode = 'add';            // 'add' | 'remove' | 'paint' | 'locator'
    this.color = '#3a8ee6';
    this.meshes = new Map();      // "x,y,z" -> THREE.Mesh
    this.onChange = null;         // ボクセル数変更時のコールバック
    this.onHistory = null;        // 履歴変化時(undo数, redo数)のコールバック

    this.mirror = { x: false, y: false, z: false }; // 対称編集
    this.muzzle = null;           // 銃口ロケーター {x,y,z}（小数可）
    this._muzzleMarker = null;
    this.history = { undo: [], redo: [], limit: 80 };

    this.dragDraw = false;        // 連続描画(左ドラッグで描く)
    this._drawing = false;        // ストローク中フラグ
    this._lastDrawKey = null;     // 直近に描いたセル(連打防止)
    this._suppressHistory = false;// ストローク中は履歴を1回だけ積む
    this._strokeDirty = false;

    this.selection = null;        // 領域選択 {min:[x,y,z], max:[x,y,z]}
    this._selAnchor = null;       // 2クリック選択の1点目
    this._selBox = null;          // 選択ハイライトmesh
    this.clipboard = null;        // [[dx,dy,dz,color], ...]（min基準の相対）
    this.onSelection = null;      // 選択変化コールバック

    this.reference = null;        // 下絵 {mesh, tex, plane, url, opacity}

    this._initScene();
    this._initLights();
    this._initHelpers();
    this._initPicking();
    this._animate = this._animate.bind(this);
    this._animate();

    window.addEventListener('resize', () => this._onResize());
  }

  /* ---------- 初期化 ---------- */
  _initScene() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1b1f2a);

    this.camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 1000);
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(w, h);
    this.container.appendChild(this.renderer.domElement);

    this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;

    this._frameCamera();
  }

  _initLights() {
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.65));
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(1, 2, 1.5);
    this.scene.add(dir);
    const dir2 = new THREE.DirectionalLight(0xffffff, 0.3);
    dir2.position.set(-1, -0.5, -1);
    this.scene.add(dir2);
  }

  _initHelpers() {
    this.helperGroup = new THREE.Group();
    this.scene.add(this.helperGroup);
    this._rebuildHelpers();
  }

  /** グリッド/床/枠線をデータサイズに合わせて作り直す */
  _rebuildHelpers() {
    while (this.helperGroup.children.length) {
      this.helperGroup.remove(this.helperGroup.children[0]);
    }
    const { sx, sy, sz } = this.data;

    // 床グリッド（XZ平面 y=0）
    const maxXZ = Math.max(sx, sz);
    const grid = new THREE.GridHelper(maxXZ, maxXZ, 0x444c5e, 0x2b3140);
    grid.position.set(sx / 2, 0, sz / 2);
    this.helperGroup.add(grid);

    // バウンディングボックス（編集可能範囲）
    const box = new THREE.BoxGeometry(sx, sy, sz);
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(box),
      new THREE.LineBasicMaterial({ color: 0x5a6378 })
    );
    edges.position.set(sx / 2, sy / 2, sz / 2);
    this.helperGroup.add(edges);

    // 配置用の不可視床（y=0でのピッキング）
    const planeGeo = new THREE.PlaneGeometry(sx, sz);
    this.basePlane = new THREE.Mesh(
      planeGeo,
      new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide })
    );
    this.basePlane.rotation.x = -Math.PI / 2;
    this.basePlane.position.set(sx / 2, 0, sz / 2);
    this.helperGroup.add(this.basePlane);
  }

  _frameCamera() {
    const { sx, sy, sz } = this.data;
    const cx = sx / 2, cy = sy / 2, cz = sz / 2;
    const r = Math.max(sx, sy, sz);
    this.camera.position.set(cx + r, cy + r * 0.9, cz + r * 1.4);
    this.controls.target.set(cx, cy, cz);
    this.controls.update();
  }

  /* ---------- ピッキング(クリック/ドラッグ判定) ---------- */
  _initPicking() {
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    const el = this.renderer.domElement;
    let down = null;

    el.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY, button: e.button };
      // 連続描画: 左ボタン＋編集モードでストローク開始
      if (this.dragDraw && e.button === 0 && this._isEditMode()) {
        const hit = this._pick(e);
        if (hit) {
          this._drawing = true;
          this._lastDrawKey = null;
          this.controls.enabled = false;
          this.beginStroke();
          this._drawAtHit(hit);
        }
      }
    });

    el.addEventListener('pointermove', (e) => {
      if (!this._drawing) return;
      const hit = this._pick(e);
      if (hit) this._drawAtHit(hit);
    });

    const endDraw = () => {
      if (!this._drawing) return;
      this._drawing = false;
      this.endStroke();
      this.controls.enabled = true;
    };

    el.addEventListener('pointerup', (e) => {
      if (this._drawing) { endDraw(); down = null; return; }
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      const btn = down.button;
      down = null;
      if (moved > 5) return;   // ドラッグ＝カメラ操作はクリック扱いしない
      if (btn !== 0) return;   // 左クリックのみ編集
      this._handleClick(e);
    });
    el.addEventListener('pointerleave', endDraw);
  }

  _isEditMode() { return this.mode === 'add' || this.mode === 'remove' || this.mode === 'paint'; }

  /** イベント座標から最前面のヒットを返す（無ければ null） */
  _pick(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const targets = [...this.meshes.values(), this.basePlane];
    const hits = this.raycaster.intersectObjects(targets, false);
    return hits.length ? hits[0] : null;
  }

  /** ヒット位置に現在の編集モードを適用（連続描画・単発クリック共用） */
  _drawAtHit(hit) {
    if (!hit) return;
    if (this.mode === 'add') {
      let x, y, z;
      if (hit.object === this.basePlane) {
        x = Math.floor(hit.point.x); y = 0; z = Math.floor(hit.point.z);
      } else {
        const n = hit.face.normal, u = hit.object.userData;
        x = u.x + Math.round(n.x); y = u.y + Math.round(n.y); z = u.z + Math.round(n.z);
      }
      const key = x + ',' + y + ',' + z;
      if (key === this._lastDrawKey) return;
      this._lastDrawKey = key;
      this._place(x, y, z);
    } else if (this.mode === 'remove' || this.mode === 'paint') {
      if (hit.object === this.basePlane) return;
      const u = hit.object.userData;
      const key = u.x + ',' + u.y + ',' + u.z;
      if (key === this._lastDrawKey) return;
      this._lastDrawKey = key;
      if (this.mode === 'remove') this._erase(u.x, u.y, u.z); else this._paint(u.x, u.y, u.z);
    }
  }

  _handleClick(e) {
    const hit = this._pick(e);
    if (!hit) return;

    if (this.mode === 'locator') {
      // 銃口/発射点を 0.5 刻みで設置（面の少し外側＝法線方向に寄せる）
      const p = hit.point.clone();
      if (hit.face) p.addScaledVector(hit.face.normal, 0.001);
      const r = (v) => Math.round(v * 2) / 2;
      this._pushHistory();
      this.setMuzzle({ x: r(p.x), y: r(p.y), z: r(p.z) });
      return;
    }

    if (this.mode === 'select') { this._handleSelectClick(hit); return; }

    // 編集モード（単発クリック）
    this._lastDrawKey = null;
    this._drawAtHit(hit);
  }

  /* ---------- 編集操作 ---------- */
  /** 有効なミラー軸を考慮した対象座標の一覧（重複なし） */
  _mirrorCoords(x, y, z) {
    const { sx, sy, sz } = this.data;
    const xs = this.mirror.x ? [x, sx - 1 - x] : [x];
    const ys = this.mirror.y ? [y, sy - 1 - y] : [y];
    const zs = this.mirror.z ? [z, sz - 1 - z] : [z];
    const out = new Map();
    for (const X of xs) for (const Y of ys) for (const Z of zs) {
      out.set(X + ',' + Y + ',' + Z, [X, Y, Z]);
    }
    return [...out.values()];
  }

  _place(x, y, z) {
    const targets = this._mirrorCoords(x, y, z)
      .filter(([px, py, pz]) => this.data.inBounds(px, py, pz) && !this.data.has(px, py, pz));
    if (!targets.length) return;
    this._maybePush();
    for (const [px, py, pz] of targets) {
      this.data.set(px, py, pz, this.color);
      this._addMesh(px, py, pz, this.color);
    }
    this._changed();
  }

  _erase(x, y, z) {
    const targets = this._mirrorCoords(x, y, z).filter(([px, py, pz]) => this.data.has(px, py, pz));
    if (!targets.length) return;
    this._maybePush();
    for (const [px, py, pz] of targets) {
      this.data.remove(px, py, pz);
      const k = this.data.key(px, py, pz);
      const mesh = this.meshes.get(k);
      if (mesh) { this._disposeMesh(mesh); this.meshes.delete(k); }
    }
    this._changed();
  }

  _paint(x, y, z) {
    const targets = this._mirrorCoords(x, y, z)
      .filter(([px, py, pz]) => this.data.has(px, py, pz) && this.data.get(px, py, pz) !== this.color);
    if (!targets.length) return;
    this._maybePush();
    for (const [px, py, pz] of targets) {
      this.data.set(px, py, pz, this.color);
      const mesh = this.meshes.get(this.data.key(px, py, pz));
      if (mesh) mesh.material.color.set(this.color);
    }
    this._changed();
  }

  /* ---------- 履歴のストローク制御 ---------- */
  beginStroke() { this._suppressHistory = true; this._strokeDirty = false; }
  endStroke() { this._suppressHistory = false; }
  /** 通常は毎回履歴を積むが、ストローク中は最初の1回だけ積む */
  _maybePush() {
    if (this._suppressHistory) {
      if (!this._strokeDirty) { this._pushHistory(); this._strokeDirty = true; }
    } else {
      this._pushHistory();
    }
  }

  /* ---------- 履歴を積まない素のボクセル操作（選択操作用） ---------- */
  _rm(x, y, z) {
    if (!this.data.has(x, y, z)) return;
    this.data.remove(x, y, z);
    const k = this.data.key(x, y, z);
    const m = this.meshes.get(k);
    if (m) { this._disposeMesh(m); this.meshes.delete(k); }
  }

  _addRaw(x, y, z, color) {
    if (!this.data.inBounds(x, y, z)) return false;
    if (this.data.has(x, y, z)) this._rm(x, y, z);
    this.data.set(x, y, z, color);
    this._addMesh(x, y, z, color);
    return true;
  }

  _addMesh(x, y, z, color) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshLambertMaterial({ color });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x + 0.5, y + 0.5, z + 0.5);
    mesh.userData = { x, y, z };
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.18 })
    );
    mesh.add(edges);
    this.scene.add(mesh);
    this.meshes.set(this.data.key(x, y, z), mesh);
  }

  _disposeMesh(mesh) {
    this.scene.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
  }

  /* ---------- ロケーター（銃口/発射点） ---------- */
  setMuzzle(pt, silent) {
    this.muzzle = pt ? { x: pt.x, y: pt.y, z: pt.z } : null;
    this._renderMuzzle();
    if (!silent) this._changed();
  }

  _renderMuzzle() {
    if (this._muzzleMarker) {
      this.scene.remove(this._muzzleMarker);
      this._muzzleMarker.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      this._muzzleMarker = null;
    }
    if (!this.muzzle) return;
    const grp = new THREE.Group();
    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xff3b3b })
    );
    grp.add(ball);
    // 視認用の十字線
    const len = 1.2;
    const axes = [[len, 0, 0], [0, len, 0], [0, 0, len]];
    for (const [ax, ay, az] of axes) {
      const g = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-ax, -ay, -az), new THREE.Vector3(ax, ay, az),
      ]);
      grp.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xff8c8c })));
    }
    grp.position.set(this.muzzle.x, this.muzzle.y, this.muzzle.z);
    this.scene.add(grp);
    this._muzzleMarker = grp;
  }

  /* ---------- 履歴(Undo/Redo) ---------- */
  /** 現在の状態を直列化（履歴・保存共用） */
  snapshot() {
    return {
      sx: this.data.sx, sy: this.data.sy, sz: this.data.sz,
      voxels: this.data.entries(),
      muzzle: this.muzzle ? { ...this.muzzle } : null,
    };
  }

  _pushHistory() {
    this.history.undo.push(this.snapshot());
    if (this.history.undo.length > this.history.limit) this.history.undo.shift();
    this.history.redo.length = 0;
    this._historyChanged();
  }

  /** スナップショットを復元（履歴は積まない）。frame=falseでカメラ維持 */
  _applySnapshot(s, frame) {
    const d = new VoxelData(s.sx, s.sy, s.sz);
    for (const [x, y, z, color] of s.voxels) d.set(x, y, z, color);
    this._loadDataRaw(d, frame);
    this.setMuzzle(s.muzzle || null, true);
  }

  undo() {
    if (!this.history.undo.length) return;
    this.history.redo.push(this.snapshot());
    this._applySnapshot(this.history.undo.pop(), false);
    this._historyChanged();
    this._changed();
  }

  redo() {
    if (!this.history.redo.length) return;
    this.history.undo.push(this.snapshot());
    this._applySnapshot(this.history.redo.pop(), false);
    this._historyChanged();
    this._changed();
  }

  _historyChanged() {
    if (this.onHistory) this.onHistory(this.history.undo.length, this.history.redo.length);
  }

  /* ---------- 公開API ---------- */
  setMode(mode) { this.mode = mode; }
  setColor(color) { this.color = color; }
  setMirror(axis, on) { this.mirror[axis] = !!on; }

  /** 連続描画ON/OFF。ONのとき左ドラッグ=描画／右ドラッグ=回転に切替 */
  setDragDraw(on) {
    this.dragDraw = !!on;
    if (on) {
      this.controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    } else {
      this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    }
  }

  /* ---------- 領域選択 / コピー・ペースト・移動 ---------- */
  _handleSelectClick(hit) {
    let cell;
    if (hit.object === this.basePlane) cell = [Math.floor(hit.point.x), 0, Math.floor(hit.point.z)];
    else { const u = hit.object.userData; cell = [u.x, u.y, u.z]; }
    if (!this._selAnchor) {
      this._selAnchor = cell;
      this._setSelection(cell, cell);
    } else {
      this._setSelection(this._selAnchor, cell);
      this._selAnchor = null;
    }
  }

  _setSelection(a, b) {
    this.selection = {
      min: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])],
      max: [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])],
    };
    this._renderSelection();
    if (this.onSelection) this.onSelection(this.selection);
  }

  clearSelection() {
    this.selection = null;
    this._selAnchor = null;
    this._renderSelection();
    if (this.onSelection) this.onSelection(null);
  }

  _renderSelection() {
    if (this._selBox) {
      this.scene.remove(this._selBox);
      this._selBox.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      this._selBox = null;
    }
    if (!this.selection) return;
    const { min, max } = this.selection;
    const w = max[0] - min[0] + 1, h = max[1] - min[1] + 1, d = max[2] - min[2] + 1;
    const geo = new THREE.BoxGeometry(w, h, d);
    const grp = new THREE.Group();
    grp.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial(
      { color: 0x3a8ee6, transparent: true, opacity: 0.12, depthWrite: false })));
    grp.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color: 0x6db4ff })));
    grp.position.set(min[0] + w / 2, min[1] + h / 2, min[2] + d / 2);
    this.scene.add(grp);
    this._selBox = grp;
  }

  /** 選択範囲内に存在するボクセル [[x,y,z,color], ...] */
  _voxelsInSelection() {
    if (!this.selection) return [];
    const { min, max } = this.selection;
    const out = [];
    for (const [x, y, z, c] of this.data.entries()) {
      if (x >= min[0] && x <= max[0] && y >= min[1] && y <= max[1] && z >= min[2] && z <= max[2]) {
        out.push([x, y, z, c]);
      }
    }
    return out;
  }

  /** 選択範囲をクリップボードへ（min基準の相対座標で保持）。コピー数を返す */
  copySelection() {
    if (!this.selection) return 0;
    const { min } = this.selection;
    this.clipboard = this._voxelsInSelection().map(([x, y, z, c]) => [x - min[0], y - min[1], z - min[2], c]);
    return this.clipboard.length;
  }

  deleteSelection() {
    const vox = this._voxelsInSelection();
    if (!vox.length) return 0;
    this._pushHistory();
    for (const [x, y, z] of vox) this._rm(x, y, z);
    this._changed();
    return vox.length;
  }

  cutSelection() {
    const n = this.copySelection();
    if (n) this.deleteSelection();
    return n;
  }

  /** 選択範囲の中身を移動（グリッド外に出る場合は中止して false） */
  moveSelection(dx, dy, dz) {
    if (!this.selection) return false;
    const { min, max } = this.selection;
    const { sx, sy, sz } = this.data;
    if (min[0] + dx < 0 || min[1] + dy < 0 || min[2] + dz < 0 ||
        max[0] + dx >= sx || max[1] + dy >= sy || max[2] + dz >= sz) return false;
    const vox = this._voxelsInSelection();
    this._pushHistory();
    for (const [x, y, z] of vox) this._rm(x, y, z);
    for (const [x, y, z, c] of vox) this._addRaw(x + dx, y + dy, z + dz, c);
    this._setSelection([min[0] + dx, min[1] + dy, min[2] + dz], [max[0] + dx, max[1] + dy, max[2] + dz]);
    this._changed();
    return true;
  }

  /** クリップボードを貼り付け（選択範囲のmin、無ければ原点を基準）。配置数を返す */
  pasteClipboard() {
    if (!this.clipboard || !this.clipboard.length) return 0;
    const base = this.selection ? this.selection.min : [0, 0, 0];
    this._pushHistory();
    let mx = 0, my = 0, mz = 0, n = 0;
    for (const [dx, dy, dz, c] of this.clipboard) {
      if (this._addRaw(base[0] + dx, base[1] + dy, base[2] + dz, c)) n++;
      if (dx > mx) mx = dx; if (dy > my) my = dy; if (dz > mz) mz = dz;
    }
    this._setSelection(base, [base[0] + mx, base[1] + my, base[2] + mz]);
    this._changed();
    return n;
  }

  /* ---------- 下絵リファレンス ---------- */
  /** plane: 'front'(XY,z=0) | 'side'(ZY,x=0) | 'top'(XZ,y=0) */
  setReference(url, opts) {
    this.clearReference();
    const opacity = (opts && opts.opacity != null) ? opts.opacity : 0.5;
    const plane = (opts && opts.plane) || 'front';
    const tex = new THREE.TextureLoader().load(url);
    tex.minFilter = THREE.LinearFilter;
    const mat = new THREE.MeshBasicMaterial(
      { map: tex, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false });
    const { sx, sy, sz } = this.data;
    let mesh;
    if (plane === 'side') {
      mesh = new THREE.Mesh(new THREE.PlaneGeometry(sz, sy), mat);
      mesh.rotation.y = Math.PI / 2;
      mesh.position.set(0, sy / 2, sz / 2);
    } else if (plane === 'top') {
      mesh = new THREE.Mesh(new THREE.PlaneGeometry(sx, sz), mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(sx / 2, 0, sz / 2);
    } else {
      mesh = new THREE.Mesh(new THREE.PlaneGeometry(sx, sy), mat);
      mesh.position.set(sx / 2, sy / 2, 0);
    }
    this.scene.add(mesh);
    this.reference = { mesh, tex, plane, url, opacity };
  }

  setReferenceOpacity(o) { if (this.reference) { this.reference.opacity = o; this.reference.mesh.material.opacity = o; } }

  clearReference() {
    if (!this.reference) return;
    this.scene.remove(this.reference.mesh);
    this.reference.mesh.geometry.dispose();
    this.reference.mesh.material.dispose();
    if (this.reference.tex) this.reference.tex.dispose();
    this.reference = null;
  }

  clearAll() {
    if (this.data.count() === 0 && !this.muzzle) return;
    this._pushHistory();
    for (const mesh of this.meshes.values()) this._disposeMesh(mesh);
    this.meshes.clear();
    this.data.clear();
    this.setMuzzle(null, true);
    this._changed();
  }

  /** VoxelData を描画し直す内部処理（履歴を積まない） */
  _loadDataRaw(voxelData, frame) {
    for (const mesh of this.meshes.values()) this._disposeMesh(mesh);
    this.meshes.clear();
    this.data = voxelData;
    for (const [x, y, z, color] of voxelData.entries()) this._addMesh(x, y, z, color);
    this.clearSelection();
    this._rebuildHelpers();
    if (frame !== false) this._frameCamera();
    this._changed();
  }

  /** テンプレート/取り込み等の VoxelData をまるごと読み込み（履歴に積む） */
  loadData(voxelData) {
    this._pushHistory();
    this._loadDataRaw(voxelData, true);
  }

  /** グリッドサイズ変更（範囲外ボクセルは破棄して再描画） */
  resize(sx, sy, sz) {
    if (sx === this.data.sx && sy === this.data.sy && sz === this.data.sz) return;
    this._pushHistory();
    const ref = this.reference ? { url: this.reference.url, plane: this.reference.plane, opacity: this.reference.opacity } : null;
    this.data.resize(sx, sy, sz);
    // データに合わせてメッシュを作り直す
    for (const mesh of this.meshes.values()) this._disposeMesh(mesh);
    this.meshes.clear();
    for (const [x, y, z, color] of this.data.entries()) this._addMesh(x, y, z, color);
    this.clearSelection();
    this._rebuildHelpers();
    if (ref) this.setReference(ref.url, ref); // 新サイズに合わせて下絵を貼り直す
    this._frameCamera();
    this._changed();
  }

  _changed() { if (this.onChange) this.onChange(this.data.count()); }

  /* ---------- ループ ---------- */
  _onResize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  _animate() {
    requestAnimationFrame(this._animate);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
