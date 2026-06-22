/* editor.js
 * Three.js による3Dボクセルエディタ本体。
 * シーン管理・カメラ操作(OrbitControls)・ボクセルの追加/削除/塗装を担当。
 * 形状データは VoxelData が保持し、ここでは描画とユーザー操作だけを行う。
 */
class VoxelEditor {
  constructor(container, data) {
    this.container = container;
    this.data = data;
    this.mode = 'add';            // 'add' | 'remove' | 'paint' | 'face' | 'locator'
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

    this.bones = [{ name: 'root', pivot: [0, 0, 0], parent: '' }]; // ボーン定義
    this.boneMap = new Map();     // "x,y,z" -> boneName（未登録は root 扱い）
    this._bonePivots = null;      // ピボットマーカー group

    // ボーン回転プレビュー（pivot周りのX/Y/Z回転を3Dビューに即時反映。出力データには一切影響しない）
    // アニメ3DプレビューのボーンGroup階層(_buildAnimGroups/anim.groups)をそのまま再利用する。
    this.bonePreview = new Map();   // name -> [rx,ry,rz]（度）。プレビュー専用・snapshot/履歴/保存に含めない
    this._bonePreviewActive = false;

    // アニメ3Dプレビュー再生ステート（snapshot/履歴/プロジェクトには含めない＝後方互換）
    this.anim = {
      playing: false,   // 再生中フラグ
      time: 0,          // 現在の再生位置（秒）
      length: 0,        // 選択アニメの長さ（秒）
      loop: false,      // ループ再生
      json: null,       // buildAnimationJson の出力そのまま
      name: null,       // 再生対象アニメのフルキー 'animation.<id>.<name>'
      bones: null,      // 選択アニメの bones マップ（参照用）
      groups: null,     // Map(boneName -> THREE.Group)
      rootGroup: null,  // scene 直下に置くルートGroup
      _last: 0,         // 直近フレーム時刻(ms)
    };
    this.onAnimFrame = null;      // (time,length)=>{} 毎フレーム通知

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
    if (this.anim.playing || this.anim.rootGroup) return; // 再生/ポーズ中は編集禁止
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
    if (this.anim.playing || this.anim.rootGroup) return; // 再生/ポーズ中は編集禁止
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

    if (this.mode === 'face') { this._paintFace(hit); return; }

    if (this.mode === 'fill') {
      if (hit.object === this.basePlane) return;
      const u = hit.object.userData;
      this.bucketFill(u.x, u.y, u.z);
      return;
    }

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
      if (mesh) this._setMeshBodyColor(mesh, this.color);
    }
    this._changed();
  }

  /* ---------- 面色ペイント（第1版・面単位の単色・ミラー非対応） ---------- */
  /** 法線(round)から面名を返す。north=-Z, south=+Z, east=+X, west=-X, up=+Y, down=-Y */
  _faceNameFromNormal(n) {
    const x = Math.round(n.x), y = Math.round(n.y), z = Math.round(n.z);
    const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
    if (ax >= ay && ax >= az && ax) return x > 0 ? 'east' : 'west';
    if (ay >= ax && ay >= az && ay) return y > 0 ? 'up' : 'down';
    if (az) return z > 0 ? 'south' : 'north';
    return null;
  }

  /** クリックした面に現在色を塗る（単発クリックのみ・ミラー非対応） */
  _paintFace(hit) {
    if (!hit || hit.object === this.basePlane || !hit.face) return;
    const u = hit.object.userData;
    const face = this._faceNameFromNormal(hit.face.normal);
    if (!face) return;
    if (this.data.getFace(u.x, u.y, u.z, face) === this.color) return; // 同色なら無視
    this._pushHistory();
    this.data.setFace(u.x, u.y, u.z, face, this.color);
    const mesh = this.meshes.get(this.data.key(u.x, u.y, u.z));
    if (mesh) this._applyFaceColorsToMesh(mesh);
    this._changed();
  }

  /** BoxGeometry の group(6面)順 [+X,-X,+Y,-Y,+Z,-Z] に対応する面名 */
  _materialFor(x, y, z, color) {
    const faces = this.data.facesOf(x, y, z);
    if (!Object.keys(faces).length) {
      // 面色なし＝従来どおり単一マテリアル（後方互換・GPU負荷も従来同等）
      return new THREE.MeshLambertMaterial({ color });
    }
    // group 順: +X(east), -X(west), +Y(up), -Y(down), +Z(south), -Z(north)
    const order = ['east', 'west', 'up', 'down', 'south', 'north'];
    return order.map((f) =>
      new THREE.MeshLambertMaterial({ color: faces[f] !== undefined ? faces[f] : color }));
  }

  /** 既存マテリアルを破棄して面色対応マテリアルへ差し替え（geometryは共有のまま） */
  _applyFaceColorsToMesh(mesh) {
    const u = mesh.userData;
    const body = this.data.get(u.x, u.y, u.z);
    this._disposeMeshMaterial(mesh);
    mesh.material = this._materialFor(u.x, u.y, u.z, body);
  }

  /** メッシュ本体色を変更（面色ありなら再構築、単一なら従来の color.set） */
  _setMeshBodyColor(mesh, color) {
    if (Array.isArray(mesh.material)) {
      // 面色ありメッシュ: 面色を保ちつつ本体色（面色未指定面）を更新
      this._applyFaceColorsToMesh(mesh);
    } else {
      mesh.material.color.set(color);
    }
  }

  /** マテリアルのみ破棄（配列対応）。edges 等の子は残す */
  _disposeMeshMaterial(mesh) {
    if (Array.isArray(mesh.material)) mesh.material.forEach((m) => m.dispose());
    else mesh.material.dispose();
  }

  /* ---------- 塗りつぶし（バケツ / 範囲） ---------- */
  /** クリックしたボクセルと連結する同色領域を現在色で塗る（6近傍）。塗った数を返す */
  bucketFill(x, y, z) {
    const from = this.data.get(x, y, z);
    if (from === undefined || from === this.color) return 0;
    const seen = new Set([this.data.key(x, y, z)]);
    const stack = [[x, y, z]];
    const region = [];
    const NB = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    while (stack.length) {
      const [cx, cy, cz] = stack.pop();
      region.push([cx, cy, cz]);
      for (const [dx, dy, dz] of NB) {
        const nx = cx + dx, ny = cy + dy, nz = cz + dz, k = this.data.key(nx, ny, nz);
        if (seen.has(k)) continue;
        if (this.data.get(nx, ny, nz) === from) { seen.add(k); stack.push([nx, ny, nz]); }
      }
    }
    this._pushHistory();
    for (const [px, py, pz] of region) {
      this.data.set(px, py, pz, this.color);
      const m = this.meshes.get(this.data.key(px, py, pz));
      if (m) this._setMeshBodyColor(m, this.color);
    }
    this._changed();
    return region.length;
  }

  /** 選択範囲内の空セルを現在色で埋める（中身を直方体に充填）。追加数を返す */
  fillSelection() {
    if (!this.selection) return 0;
    const { min, max } = this.selection;
    const targets = [];
    for (let x = min[0]; x <= max[0]; x++)
      for (let y = min[1]; y <= max[1]; y++)
        for (let z = min[2]; z <= max[2]; z++)
          if (this.data.inBounds(x, y, z) && !this.data.has(x, y, z)) targets.push([x, y, z]);
    if (!targets.length) return 0;
    this._pushHistory();
    for (const [x, y, z] of targets) this._addRaw(x, y, z, this.color);
    this._changed();
    return targets.length;
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
    // 面色があれば6マテリアル配列、無ければ従来の単一マテリアル
    const mat = this._materialFor(x, y, z, color);
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
    this._disposeMeshMaterial(mesh);
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

  /* ---------- ボーン（関節）分割 ---------- */
  getBoneOf(x, y, z) { return this.boneMap.get(this.data.key(x, y, z)) || 'root'; }

  /** ボーン追加。名前重複/空は false */
  addBone(name, pivot, parent) {
    if (this._bonePreviewActive) this.clearBonePreview();
    name = String(name || '').trim();
    if (!name || this.bones.some((b) => b.name === name)) return false;
    this._pushHistory();
    this.bones.push({ name, pivot: pivot ? pivot.slice() : [0, 0, 0], parent: parent || '' });
    this._renderBonePivots();
    return true;
  }

  /** ボーン削除（root不可）。所属ボクセル/子ボーンは root へ戻す */
  removeBone(name) {
    if (name === 'root') return false;
    if (this._bonePreviewActive) this.clearBonePreview();
    const i = this.bones.findIndex((b) => b.name === name);
    if (i < 0) return false;
    this._pushHistory();
    this.bones.splice(i, 1);
    for (const [k, v] of [...this.boneMap]) if (v === name) this.boneMap.delete(k);
    for (const b of this.bones) if (b.parent === name) b.parent = '';
    this._renderBonePivots();
    return true;
  }

  /** 選択範囲内のボクセルを指定ボーンへ割り当てる。割り当て数を返す */
  assignSelectionToBone(name) {
    if (this._bonePreviewActive) this.clearBonePreview();
    if (!this.selection || !this.bones.some((b) => b.name === name)) return 0;
    const vox = this._voxelsInSelection();
    if (!vox.length) return 0;
    this._pushHistory();
    for (const [x, y, z] of vox) {
      const k = this.data.key(x, y, z);
      if (name === 'root') this.boneMap.delete(k); else this.boneMap.set(k, name);
    }
    return vox.length;
  }

  resetBones() {
    if (this._bonePreviewActive) this.clearBonePreview();
    this.bones = [{ name: 'root', pivot: [0, 0, 0], parent: '' }];
    this.boneMap.clear();
    this._renderBonePivots();
  }

  /** 保存データから面色を復元（loadData 後に呼ぶ。該当メッシュを面別マテリアル化） */
  setFaceColors(entries) {
    this.data.faceColors.clear();
    if (entries && entries.length) {
      for (const [x, y, z, face, color] of entries) this.data.setFace(x, y, z, face, color);
    }
    // 面色が付いた voxel のメッシュを再構築
    const touched = new Set();
    for (const [x, y, z] of this.data.faceEntries()) touched.add(this.data.key(x, y, z));
    for (const k of touched) {
      const mesh = this.meshes.get(k);
      if (mesh) this._applyFaceColorsToMesh(mesh);
    }
  }

  /** 保存データからボーン構成を復元 */
  setBones(bones, boneMapEntries) {
    if (this._bonePreviewActive) this.clearBonePreview();
    this.bones = (bones && bones.length)
      ? bones.map((b) => ({ name: b.name, pivot: (b.pivot || [0, 0, 0]).slice(), parent: b.parent || '' }))
      : [{ name: 'root', pivot: [0, 0, 0], parent: '' }];
    this.boneMap = new Map(boneMapEntries || []);
    this._renderBonePivots();
  }

  _renderBonePivots() {
    if (this._bonePivots) {
      this.scene.remove(this._bonePivots);
      this._bonePivots.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      this._bonePivots = null;
    }
    const nonRoot = this.bones.filter((b) => b.name !== 'root');
    if (!nonRoot.length) return;
    const grp = new THREE.Group();
    for (const b of nonRoot) {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(0.35, 10, 10),
        new THREE.MeshBasicMaterial({ color: 0x1ab5b5 })
      );
      m.position.set(b.pivot[0], b.pivot[1], b.pivot[2]);
      const ring = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(0.9, 0.9, 0.9)),
        new THREE.LineBasicMaterial({ color: 0x6ff0f0 })
      );
      ring.position.copy(m.position);
      grp.add(m); grp.add(ring);
    }
    this.scene.add(grp);
    this._bonePivots = grp;
  }

  /* ---------- ボーン回転プレビュー（出力データ不変・表示専用） ---------- */
  /** プレビュー有効中か（main.js のUI同期用） */
  isBonePreviewActive() { return this._bonePreviewActive; }

  /**
   * プレビューモード開始。アニメ3Dプレビューと同じボーンGroup階層を構築し、
   * 各ボクセルMeshを所属ボーンのGroupへ親子付け替えする。
   * 既にアニメ再生/ポーズ中なら何もしない（排他）。
   */
  enterBonePreview() {
    if (this._bonePreviewActive) return true;
    if (this.anim.playing || this.anim.rootGroup) return false; // アニメ再生/ポーズと排他
    this._buildAnimGroups();   // anim.groups / anim.rootGroup を流用
    this._bonePreviewActive = true;
    this._applyBonePreview();
    return true;
  }

  /**
   * 非rootボーンの回転（度）をプレビュー反映。未構築なら自動でプレビュー開始。
   * root は回転対象外（指定されても無視）。
   */
  setBonePreviewRotation(name, rot) {
    if (!name || name === 'root') return false;
    if (!this.bones.some((b) => b.name === name)) return false;
    if (!this._bonePreviewActive) {
      if (!this.enterBonePreview()) return false;
    }
    const r = [Number(rot[0]) || 0, Number(rot[1]) || 0, Number(rot[2]) || 0];
    if (r[0] === 0 && r[1] === 0 && r[2] === 0) this.bonePreview.delete(name);
    else this.bonePreview.set(name, r);
    this._applyBonePreview();
    return true;
  }

  /** 指定ボーンの現在のプレビュー回転（度）を返す（未設定は[0,0,0]） */
  getBonePreviewRotation(name) {
    const r = this.bonePreview.get(name);
    return r ? r.slice() : [0, 0, 0];
  }

  /** プレビュー終了。Mesh を scene 直下の元配置へ戻し、回転状態を破棄 */
  clearBonePreview() {
    if (!this._bonePreviewActive) { this.bonePreview.clear(); return; }
    this._bonePreviewActive = false;
    this.bonePreview.clear();
    // アニメ用のGroupを流用しているので teardown で元配置へ復帰
    this._teardownAnimGroups();
  }

  /** bonePreview の回転（度）を各ボーンGroupに適用（位置=basePos のまま、回転だけ差し替え） */
  _applyBonePreview() {
    if (!this.anim.groups) return;
    const DEG = Math.PI / 180;
    for (const [name, g] of this.anim.groups) {
      const base = g.userData.basePos || [0, 0, 0];
      g.position.set(base[0], base[1], base[2]);
      const r = (name !== 'root') ? this.bonePreview.get(name) : null;
      if (r) g.rotation.set(r[0] * DEG, r[1] * DEG, r[2] * DEG);
      else g.rotation.set(0, 0, 0);
    }
  }

  /* ---------- 履歴(Undo/Redo) ---------- */
  /** 現在の状態を直列化（履歴・保存共用） */
  snapshot() {
    return {
      sx: this.data.sx, sy: this.data.sy, sz: this.data.sz,
      voxels: this.data.entries(),
      muzzle: this.muzzle ? { ...this.muzzle } : null,
      bones: this.bones.map((b) => ({ name: b.name, pivot: b.pivot.slice(), parent: b.parent })),
      boneMap: [...this.boneMap.entries()],
      faceColors: this.data.faceEntries(), // [[x,y,z,face,color], ...]（空配列なら従来と差分なし）
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
    // 面色を復元（voxel存在チェックは setFace 内で実施）。_loadDataRaw が面別マテリアルで描画
    if (s.faceColors) for (const [x, y, z, face, color] of s.faceColors) d.setFace(x, y, z, face, color);
    this._loadDataRaw(d, frame);
    this.setMuzzle(s.muzzle || null, true);
    if (s.bones) this.setBones(s.bones, s.boneMap);
  }

  undo() {
    this._ensureStopped();
    if (!this.history.undo.length) return;
    this.history.redo.push(this.snapshot());
    this._applySnapshot(this.history.undo.pop(), false);
    this._historyChanged();
    this._changed();
  }

  redo() {
    this._ensureStopped();
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
  setMode(mode) {
    // 編集系/ピッキング系へ切り替えるときは回転プレビューを自動解除（編集とは排他）
    if (this._bonePreviewActive) this.clearBonePreview();
    this.mode = mode;
  }
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

  /** 選択範囲内ボクセルを指定軸(x/y/z)についてグリッド全体の中心で反転コピー。配置数を返す */
  mirrorCopySelection(axis) {
    if (!this.selection) return 0;
    const vox = this._voxelsInSelection();
    if (!vox.length) return 0;
    const { sx, sy, sz } = this.data;
    // 反転式は _mirrorCoords と同一（グリッド全体の中心基準: s-1-coord）
    const mir = (x, y, z) => {
      if (axis === 'x') return [sx - 1 - x, y, z];
      if (axis === 'y') return [x, sy - 1 - y, z];
      return [x, y, sz - 1 - z]; // 'z'
    };
    // 配置対象を先に算出（グリッド外=範囲外は無視）
    const targets = [];
    for (const [x, y, z, c] of vox) {
      const [mx, my, mz] = mir(x, y, z);
      if (this.data.inBounds(mx, my, mz)) targets.push([mx, my, mz, c]);
    }
    if (!targets.length) return 0;
    this._pushHistory();
    let n = 0;
    for (const [mx, my, mz, c] of targets) { if (this._addRaw(mx, my, mz, c)) n++; }
    this._changed();
    return n;
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
    this._ensureStopped();
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
    this._ensureStopped();
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
    this._ensureStopped();
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

  /* ---------- アニメ3Dプレビュー ---------- */
  /** 静的: トラック {'<秒>':[x,y,z]} を時刻tで線形補間。track無しは null。範囲外はクランプ */
  static sampleChannel(track, t) {
    if (!track) return null;
    const keys = Object.keys(track).map(Number).sort((a, b) => a - b);
    if (!keys.length) return null;
    if (t <= keys[0]) return track[VoxelEditor._keyStr(track, keys[0])].slice();
    const lastK = keys[keys.length - 1];
    if (t >= lastK) return track[VoxelEditor._keyStr(track, lastK)].slice();
    // t を挟む2キーを探す
    for (let i = 0; i < keys.length - 1; i++) {
      const k0 = keys[i], k1 = keys[i + 1];
      if (t >= k0 && t <= k1) {
        const v0 = track[VoxelEditor._keyStr(track, k0)];
        const v1 = track[VoxelEditor._keyStr(track, k1)];
        const span = (k1 - k0) || 1;
        const f = (t - k0) / span;
        return [
          v0[0] + (v1[0] - v0[0]) * f,
          v0[1] + (v1[1] - v0[1]) * f,
          v0[2] + (v1[2] - v0[2]) * f,
        ];
      }
    }
    return track[VoxelEditor._keyStr(track, lastK)].slice();
  }

  /** Number化したキーから元の文字列キーを引き当てる（'0.10' 等の表記揺れ対策） */
  static _keyStr(track, num) {
    for (const k of Object.keys(track)) if (Number(k) === num) return k;
    return String(num);
  }

  /** ボーン名→pivot 配列を引く（未定義は[0,0,0]） */
  _pivotOf(name) {
    const b = this.bones.find((x) => x.name === name);
    return b ? b.pivot : [0, 0, 0];
  }

  /** ボーンの親を辿って親pivotを得る（root/親なしは[0,0,0]） */
  _parentPivotOf(name) {
    const b = this.bones.find((x) => x.name === name);
    if (!b || !b.parent) return [0, 0, 0];
    return this._pivotOf(b.parent);
  }

  /**
   * ボーン階層を THREE.Group で構築し、各ボクセルメッシュを所属Groupへ親子付け替え。
   * 子Groupの position は (自pivot - 親pivot) でローカル化（階層の二重加算回避）。
   */
  _buildAnimGroups() {
    const groups = new Map();
    // まず全ボーンのGroupを作る
    for (const b of this.bones) {
      const g = new THREE.Group();
      g.rotation.order = 'ZYX'; // Bedrock流 Z→Y→X
      groups.set(b.name, g);
    }
    // 親子付け（root or 親なしは rootGroup 配下）
    const rootGroup = groups.get('root') || new THREE.Group();
    for (const b of this.bones) {
      if (b.name === 'root') continue;
      const g = groups.get(b.name);
      const parentName = (b.parent && groups.has(b.parent)) ? b.parent : 'root';
      const parentG = groups.get(parentName);
      const pp = this._pivotOf(parentName);
      // 子は (自pivot - 親pivot) を基準位置に
      g.userData.basePos = [b.pivot[0] - pp[0], b.pivot[1] - pp[1], b.pivot[2] - pp[2]];
      g.position.set(g.userData.basePos[0], g.userData.basePos[1], g.userData.basePos[2]);
      parentG.add(g);
    }
    // root のローカル基準は pivot そのもの（通常[0,0,0]）
    rootGroup.userData.basePos = this._pivotOf('root').slice();
    rootGroup.position.set(rootGroup.userData.basePos[0], rootGroup.userData.basePos[1], rootGroup.userData.basePos[2]);
    this.scene.add(rootGroup);

    // 各ボクセルメッシュを所属ボーンのGroupへ。mesh.position はそのボーンpivot相対へ変換
    for (const [k, mesh] of this.meshes) {
      const u = mesh.userData;
      const name = this.getBoneOf(u.x, u.y, u.z);
      const g = groups.get(name) || rootGroup;
      const piv = this._pivotOf(g === rootGroup ? 'root' : name);
      this.scene.remove(mesh);
      g.add(mesh);
      mesh.position.set((u.x + 0.5) - piv[0], (u.y + 0.5) - piv[1], (u.z + 0.5) - piv[2]);
    }

    this.anim.groups = groups;
    this.anim.rootGroup = rootGroup;
  }

  /** ボーンGroupを破棄し、全メッシュを scene 直下の元配置へ戻す */
  _teardownAnimGroups() {
    if (!this.anim.rootGroup) return;
    for (const mesh of this.meshes.values()) {
      const u = mesh.userData;
      if (mesh.parent) mesh.parent.remove(mesh);
      this.scene.add(mesh);
      mesh.position.set(u.x + 0.5, u.y + 0.5, u.z + 0.5);
    }
    // group群を破棄
    this.scene.remove(this.anim.rootGroup);
    if (this.anim.groups) {
      for (const g of this.anim.groups.values()) {
        // ジオメトリは mesh 由来なので破棄しない（移し替えただけ）
        if (g.parent) g.parent.remove(g);
      }
    }
    this.anim.groups = null;
    this.anim.rootGroup = null;
  }

  /** 選択アニメの bones を走査し、各 Group の position/rotation を時刻tで適用 */
  _applyAnimAt(time) {
    if (!this.anim.groups || !this.anim.bones) return;
    const DEG = Math.PI / 180;
    for (const [name, g] of this.anim.groups) {
      const base = g.userData.basePos || [0, 0, 0];
      const track = this.anim.bones[name];
      let dpos = null, drot = null;
      if (track) {
        dpos = VoxelEditor.sampleChannel(track.position, time);
        drot = VoxelEditor.sampleChannel(track.rotation, time);
      }
      // 位置: ベース + 補間移動（モデル単位=ボクセル単位そのまま）
      const px = base[0] + (dpos ? dpos[0] : 0);
      const py = base[1] + (dpos ? dpos[1] : 0);
      const pz = base[2] + (dpos ? dpos[2] : 0);
      g.position.set(px, py, pz);
      // 回転: 度→ラジアン（ZYX順は order で適用）
      if (drot) g.rotation.set(drot[0] * DEG, drot[1] * DEG, drot[2] * DEG);
      else g.rotation.set(0, 0, 0);
    }
  }

  /** 指定アニメ(フルキー)を内部ロードしてGroupを構築（再生/スクラブ共通の準備） */
  _loadAnim(json, fullKey, loop) {
    this._ensureStopped();
    if (!json || !json.animations || !json.animations[fullKey]) return false;
    const entry = json.animations[fullKey];
    this.anim.json = json;
    this.anim.name = fullKey;
    this.anim.bones = entry.bones || {};
    this.anim.length = Number(entry.animation_length) || 0;
    this.anim.loop = !!loop;
    this.anim.time = 0;
    this._buildAnimGroups();
    this._applyAnimAt(0);
    return true;
  }

  /** アニメ再生開始 */
  playAnimation(json, fullKey, loop) {
    if (!this._loadAnim(json, fullKey, loop)) return false;
    this.anim.playing = true;
    this.anim._last = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    if (this.onAnimFrame) this.onAnimFrame(this.anim.time, this.anim.length);
    return true;
  }

  /** 再生停止（メッシュを元配置へ復帰） */
  stopAnimation() {
    if (!this.anim.playing && !this.anim.rootGroup) return;
    this.anim.playing = false;
    this._teardownAnimGroups();
    this.anim.bones = null;
    this.anim.name = null;
    this.anim.time = 0;
    if (this.onAnimFrame) this.onAnimFrame(0, this.anim.length);
  }

  /** 内部安全停止：再生もポーズ表示もボーン回転プレビューも解除（破壊的操作前に呼ぶ） */
  _ensureStopped() {
    if (!this.anim.playing && !this.anim.rootGroup) return;
    this.anim.playing = false;
    // ボーン回転プレビューは anim.groups を流用しているため、ここで一括解除する
    this._bonePreviewActive = false;
    this.bonePreview.clear();
    this._teardownAnimGroups();
    this.anim.bones = null;
    this.anim.name = null;
    this.anim.time = 0;
  }

  setAnimLoop(on) { this.anim.loop = !!on; }

  /**
   * スクラブ：再生中でなくても、選択中アニメをポーズ表示する。
   * json/fullKey 未指定時は既にロード済みなら time だけ更新。
   */
  scrubAnimation(time, json, fullKey, loop) {
    if (json && fullKey) {
      // 別アニメ or 未ロードなら読み込み直す
      if (!this.anim.rootGroup || this.anim.name !== fullKey) {
        if (!this._loadAnim(json, fullKey, loop)) return;
      } else if (loop != null) {
        this.anim.loop = !!loop;
      }
    }
    if (!this.anim.rootGroup) return;
    const len = this.anim.length || 0;
    const t = len > 0 ? Math.max(0, Math.min(len, time)) : 0;
    this.anim.playing = false; // スクラブ中はポーズ
    this.anim.time = t;
    this._applyAnimAt(t);
    if (this.onAnimFrame) this.onAnimFrame(t, len);
  }

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
    this._tickAnim();
    this.renderer.render(this.scene, this.camera);
  }

  /** 再生中なら経過時間を進め、補間適用＆通知。終端は loop=剰余 / 非loop=停止 */
  _tickAnim() {
    if (!this.anim.playing) return;
    const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    const dt = Math.max(0, (now - this.anim._last) / 1000);
    this.anim._last = now;
    const len = this.anim.length || 0;
    let t = this.anim.time + dt;
    if (len <= 0) {
      t = 0;
    } else if (t >= len) {
      if (this.anim.loop) {
        t = t % len;
      } else {
        t = len;
        this.anim.playing = false; // 終端で停止状態へ（Groupは表示維持）
      }
    }
    this.anim.time = t;
    this._applyAnimAt(t);
    if (this.onAnimFrame) this.onAnimFrame(t, len);
  }
}
