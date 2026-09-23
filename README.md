# BlockMade

LEGO風のブロックで設計したモデルを、3Dで確認できるインタラクティブなビューアです。完成形、組み立て手順、パーツ一覧、構造チェックを見られます。サーバーもAPIキーも不要で、ブラウザだけで動きます。

最初のサンプルは **小さな時計塔**（63ブロック・17 Step・14段）です。

## 起動方法

`index.html` をブラウザで開きます。Three.js は jsDelivr から読み込みます。

## ファイル構成

| ファイル | 内容 |
| --- | --- |
| `blockmade.html` | アプリ本体（Artifact用のページ本文）。`MODEL_DATA` とUI/3Dのコードを含みます |
| `index.html` | 単体で開けるスタンドアロン版。`node tools/build-standalone.mjs` で生成します |
| `tools/build-standalone.mjs` | `blockmade.html` を完全なHTML文書で包み、`index.html` を生成します |

## モデルの差し替え

`blockmade.html` 内の `<script id="model-data">` にある `MODEL_DATA` だけを書き換えれば、UIには手を入れずに別の作品（宇宙船・家・ロボット…）に差し替えられます。アプリの「JSONを読み込む」から同じ形式のJSONを読み込むこともできます。

```js
{ id: "block_001", type: "2x8", width: 2, depth: 8, height: 1,
  x: 0, y: 0, z: 0, rotation: 0, color: "dark-gray", step: 1 }
```

- 座標の単位はスタッドです。X = 左右、Y = 高さ（ブロックの段数）、Z = 前後（+Z が正面）。
- `x, y, z` はブロックの最小角を表します。
- `rotation` が 0 のときは width が X 方向、depth が Z 方向です。90 のときは入れ替わります。
- `height` はブロックの段数です（1 = 通常ブロック、2 = 1×2×2 など）。
- 任意の `print: { pattern: "clock", face: "+z" }` を付けると、指定した面に時計の文字盤が描かれます。
- `colors` で色を、`steps` で各 Step のタイトルと説明を定義します。

## 構造チェックのルール

- **Connected**: スタッドでつながるブロックが、すべて1つの構造体にまとまっているか。
- **Supported**: すべてのブロックが、接続をたどって地面（y = 0）まで届くか。
- **No collisions**: 同じ空間を複数のブロックが占有していないか。
- **Build order valid**: 各 Step で追加するブロックが、その時点で地面か配置済みのブロックに取り付けられ、上下の既存ブロックに挟まれていないか。

上下に接していて、スタッドが1つ以上重なる2つのブロックを「接続」とみなします。横に並んでいるだけでは接続になりません。
