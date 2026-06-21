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

function animationFileName(id) { return id + '.animation.json'; }
