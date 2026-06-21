/* exporters/animation.js
 * Bedrock アニメーション(.animation.json, format_version 1.8.0)を簡易生成。
 * GeckoLib / TaCZ がそのまま読める形式。対象ボーンは bedrockGeo と揃えて 'root'。
 *
 * キーフレーム編集UIは重いので、よく使う動きをプリセット化し「種類＋長さ(秒)」だけ
 * 指定して出力する方式にしている。発射方向は -Z（モデル前方）を想定。
 *
 *  ANIM_PRESETS            : 選択肢の定義（キー・ラベル・既定長・ループ）
 *  buildAnimations(id, sel): sel=[{key,length}] -> アニメJSONオブジェクト
 *  animationFileName(id)   : '<id>.animation.json'
 */

const ANIM_BONE = 'root';

// 各プリセット: build(L) は bones[root] に入れる {position?, rotation?} を返す
const ANIM_PRESETS = {
  idle: {
    label: 'idle（上下に揺れる・ループ）', defaultLength: 2.0, loop: true,
    build: (L) => ({
      position: { '0.0': [0, 0, 0], [(L / 2).toFixed(2)]: [0, 0.4, 0], [L.toFixed(2)]: [0, 0, 0] },
    }),
  },
  fire: {
    label: 'fire（発射の反動）', defaultLength: 0.2, loop: false,
    build: (L) => ({
      position: { '0.0': [0, 0, 0], '0.05': [0, 0, -1.5], [L.toFixed(2)]: [0, 0, 0] },
      rotation: { '0.0': [0, 0, 0], '0.05': [-8, 0, 0], [L.toFixed(2)]: [0, 0, 0] },
    }),
  },
  reload: {
    label: 'reload（傾けて戻す）', defaultLength: 1.5, loop: false,
    build: (L) => ({
      rotation: {
        '0.0': [0, 0, 0],
        [(L * 0.3).toFixed(2)]: [-35, 10, 0],
        [(L * 0.7).toFixed(2)]: [-35, 10, 0],
        [L.toFixed(2)]: [0, 0, 0],
      },
    }),
  },
  draw: {
    label: 'draw（取り出し）', defaultLength: 0.5, loop: false,
    build: (L) => ({
      position: { '0.0': [0, -10, 0], [L.toFixed(2)]: [0, 0, 0] },
      rotation: { '0.0': [40, 0, 0], [L.toFixed(2)]: [0, 0, 0] },
    }),
  },
};

/** sel: [{key, length}] -> Bedrock animation JSON。何も選ばれなければ null */
function buildAnimations(id, sel) {
  const chosen = (sel || []).filter((s) => ANIM_PRESETS[s.key]);
  if (!chosen.length) return null;

  const animations = {};
  for (const s of chosen) {
    const preset = ANIM_PRESETS[s.key];
    const L = (s.length && s.length > 0) ? s.length : preset.defaultLength;
    const entry = { animation_length: Number(L.toFixed(2)) };
    if (preset.loop) entry.loop = true;
    entry.bones = { [ANIM_BONE]: preset.build(L) };
    animations['animation.' + id + '.' + s.key] = entry;
  }
  return { format_version: '1.8.0', animations };
}

/* ---------- 手動キーフレーム（カスタムアニメ） ---------- */
function _vec3(v) { v = v || [0, 0, 0]; return [Number(v[0]) || 0, Number(v[1]) || 0, Number(v[2]) || 0]; }
function _nonzero(v) { return !!(v && (Number(v[0]) || Number(v[1]) || Number(v[2]))); }
function _animName(s) { return (String(s || '').toLowerCase().replace(/[^a-z0-9_]/g, '_')) || 'custom'; }

/**
 * customAnims: [{ name, length, loop, bone, keyframes:[{t, pos:[x,y,z], rot:[x,y,z]}] }]
 * -> Bedrock animations マップ（buildAnimations の結果とマージ可能）。無ければ null。
 * pos/rot は、そのボーンで一度でも非0が使われた channel のみ全keyframeに出力する
 * （0へ戻すキーフレームも保持して綺麗に補間させるため）。
 */
function buildCustomAnimations(id, customAnims) {
  const list = (customAnims || []).filter((a) => a && a.keyframes && a.keyframes.length);
  if (!list.length) return null;

  const animations = {};
  for (const a of list) {
    const byBone = {};
    for (const kf of a.keyframes) {
      const bone = kf.bone || a.bone || ANIM_BONE;
      (byBone[bone] = byBone[bone] || []).push(kf);
    }
    const bones = {};
    let maxT = 0;
    for (const bone of Object.keys(byBone)) {
      const kfs = byBone[bone].slice().sort((p, q) => (Number(p.t) || 0) - (Number(q.t) || 0));
      const usePos = kfs.some((kf) => _nonzero(kf.pos));
      const useRot = kfs.some((kf) => _nonzero(kf.rot));
      if (!usePos && !useRot) continue;
      const b = {};
      if (usePos) b.position = {};
      if (useRot) b.rotation = {};
      for (const kf of kfs) {
        const t = Math.max(0, Number(kf.t) || 0);
        maxT = Math.max(maxT, t);
        const ts = t.toFixed(2);
        if (usePos) b.position[ts] = _vec3(kf.pos);
        if (useRot) b.rotation[ts] = _vec3(kf.rot);
      }
      bones[bone] = b;
    }
    if (!Object.keys(bones).length) continue;
    const L = (a.length && a.length > 0) ? a.length : maxT;
    const entry = { animation_length: Number((L || 0).toFixed(2)) };
    if (a.loop) entry.loop = true;
    entry.bones = bones;
    animations['animation.' + id + '.' + _animName(a.name)] = entry;
  }
  return Object.keys(animations).length ? animations : null;
}

/** プリセット選択＋カスタムを1つの .animation.json にまとめる。両方空なら null */
function buildAnimationJson(id, presetSel, customAnims) {
  const preset = buildAnimations(id, presetSel);
  const custom = buildCustomAnimations(id, customAnims);
  if (!preset && !custom) return null;
  const animations = Object.assign({}, preset ? preset.animations : {}, custom || {});
  return { format_version: '1.8.0', animations };
}

function animationFileName(id) { return id + '.animation.json'; }
