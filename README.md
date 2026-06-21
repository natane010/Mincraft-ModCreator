# Natane's Voxel & Data Forge（MVP）

ブラウザ完結・インストール不要の、Minecraft Java 向けカスタムアイテム制作ツール。
3Dボクセルで形を作り、リソースパック互換の ZIP を出力する。

## 使い方
1. `index.html` をブラウザで開く（ダブルクリックでOK。ネット接続が必要＝CDN利用）。
2. **モード**（追加/削除/塗装）と**カラー**を選び、3D空間をクリックして形を作る。
   - 追加: 床や既存ボクセルの面をクリック
   - 視点: ドラッグで回転 / ホイールでズーム / 右ドラッグでパン
3. **グリッド**はX/Y/Zで可変（アイテムは16推奨、モブ等は大きめに）。
4. namespace / アイテムID / pack_format を設定し、**「📦 アセットを出力」**で ZIP をDL。

## 出力ZIPの中身
```
[アイテムID].zip
├── pack.mcmeta
└── assets/<namespace>/
     ├── models/item/<アイテムID>.json   … 同色ボクセルを結合した直方体要素＋UV
     └── textures/item/<アイテムID>.png   … 使用色パレットアトラス
```
※ ゲーム内で実際にアイテムとして登場させるには、別途 Mod（Forge/Fabric/NeoForge）で
　アイテム登録が必要（memo フェーズ4）。本ツールはモデル/テクスチャ資産を生成する。

## ファイル構成
| ファイル | 役割 |
|---|---|
| `index.html` / `css/style.css` | UI |
| `js/voxelData.js` | ボクセルデータ（可変グリッド・中立フォーマット） |
| `js/greedyMesh.js` | 同色隣接ボクセルを直方体に結合（要素数削減） |
| `js/texture.js` | パレットPNG生成＋UV計算 |
| `js/exporters/mcJavaItem.js` | ボクセル→Minecraftアイテムモデルへ変換 |
| `js/packZip.js` | リソースパック構造でZIP化・DL |
| `js/editor.js` | Three.js エディタ本体 |
| `js/main.js` | UI配線 |

## 今後の予定（未実装）
- 🎯 ロケーター（銃口等）システム
- 📊 メタデータフォーム（攻撃力・属性・レシピ・data出力）
- 🐉 モブ/エンティティ用エクスポーター（GeckoLib geo JSON）→ `js/exporters/` に追加
- 保存/読込（プロジェクトJSON）
