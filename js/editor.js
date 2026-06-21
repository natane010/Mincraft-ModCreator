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

  /* ---------- ピッキング(クリック判定) ---------- */
  _initPicking() {
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    const el = this.renderer.domElement;
    let down = null;

    el.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
    el.addEventListener('pointerup', (e) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (moved > 5) return; // ドラッグ(カメラ操作)はクリック扱いしない
      this._handleClick(e);
    });
  }

  _handleClick(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);

    const targets = [...this.meshes.values(), this.basePlane];
    const hits = this.raycaster.intersectObjects(targets, false);
    if (!hits.length) return;
    const hit = hits[0];

    if (this.mode === 'locator') {
      // 銃口/発射点を 0.5 刻みで設置（面の少し外側＝法線方向に寄せる）
      const p = hit.point.clone();
      if (hit.face) p.addScaledVector(hit.face.normal, 0.001);
      const r = (v) => Math.round(v * 2) / 2;
      this._pushHistory();
      this.setMuzzle({ x: r(p.x), y: r(p.y), z: r(p.z) });
      return;
    }

    if (hit.object === this.basePlane) {
      // 空の床をクリック -> その升目の y=0 に配置
      if (this.mode !== 'add') return;
      const x = Math.floor(hit.point.x);
      const z = Math.floor(hit.point.z);
      this._place(x, 0, z);
      return;
    }

    const { x, y, z } = hit.object.userData;
    if (this.mode === 'remove') {
      this._erase(x, y, z);
    } else if (this.mode === 'paint') {
      this._paint(x, y, z);
    } else { // add: 当たった面の法線方向の隣へ
      const n = hit.face.normal;
      this._place(x + Math.round(n.x), y + Math.round(n.y), z + Math.round(n.z));
    }
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
    this._pushHistory();
    for (const [px, py, pz] of targets) {
      this.data.set(px, py, pz, this.color);
      this._addMesh(px, py, pz, this.color);
    }
    this._changed();
  }

  _erase(x, y, z) {
    const targets = this._mirrorCoords(x, y, z).filter(([px, py, pz]) => this.data.has(px, py, pz));
    if (!targets.length) return;
    this._pushHistory();
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
    this._pushHistory();
    for (const [px, py, pz] of targets) {
      this.data.set(px, py, pz, this.color);
      const mesh = this.meshes.get(this.data.key(px, py, pz));
      if (mesh) mesh.material.color.set(this.color);
    }
    this._changed();
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
    this.data.resize(sx, sy, sz);
    // データに合わせてメッシュを作り直す
    for (const mesh of this.meshes.values()) this._disposeMesh(mesh);
    this.meshes.clear();
    for (const [x, y, z, color] of this.data.entries()) this._addMesh(x, y, z, color);
    this._rebuildHelpers();
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
