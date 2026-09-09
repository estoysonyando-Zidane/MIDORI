# scripts/ — この World を組み立てるもの

`src/` は World を**描く**。`scripts/` は World を**作る**。両者は
`public/data/worlds/<world_id>/` と `public/assets/` を介してしか
つながっていない。

22 本あって順番に依存がある。**その順番はここにしか書いていない。**

---

## ★ 先に読むこと — 単独で走らせると壊れるもの

`import-gsi-town.mjs` は `BLDG_GSI_*` / `BLDG_OSM_*` / `ROAD_GSI_*` を
**全部消してから入れ直す**。緑の湯・緑郵便局・斜里警察署緑駐在所の同定は
そのあとの 5・6 が付け直しているので、

> **`import-gsi-town.mjs` を単独で走らせると、3件の同定が黙って消える。**

これは実際に一度やらかしている（緑の湯が 22 m 離れた 131 m² の小屋に
付いていた。正しくは 590 m² の外形）。**第2段は 1→7 を通しで走らせること。**

---

## 第0段 — 素材の取得（ネットワークが要る。滅多に走らせない）

| script | 出力 | 備考 |
|---|---|---|
| `fetch-gsi-basemap.mjs` | `scripts/data/gsi_midori.json` | 地理院ベクトルタイル z=16 を ±2 タイル |
| 〃 `GSI_OUT=… GSI_RADIUS_TILES=5` | `scripts/data/gsi_midori_wide.json` | ±5 タイル。水はこちらを読む |
| `fetch-gsi-orthophoto.mjs` | `public/assets/textures/midori_orthophoto.{jpg,json}` | タイルを `.cache/gsi-photo/` に残す |
| `fetch-far-terrain.mjs` | `public/assets/terrain/midori_far_{dem.bin,photo.jpg,terrain.json}` | **オルソの後**。色をオルソに合わせるため |

`scripts/data/*.json` と `.cache/gsi-photo/` は**取得済みの生データを凍結
したもの**で、リポジトリに入っている。国土地理院に再び当たらなくても
派生物を作り直せるようにしてある。キャッシュではなく出典の写し。

## 第1段 — 派生アセット

| script | 入力 | 出力 |
|---|---|---|
| `derive-canopy-mask.mjs` | オルソ写真 | `public/assets/textures/midori_canopy.json` |

## 第2段 — 町の取り込み（★破壊的。1→7 を通しで）

| # | script | 消すもの | 入れるもの |
|---|---|---|---|
| 1 | `import-gsi-town.mjs` | `BLDG_GSI_*` `BLDG_OSM_*` `ROAD_GSI_*` | 建築物・道路（電子国土基本図） |
| 2 | `import-osm-town.mjs` | `BLDG_OSM_*` `SURF_OSM_*` `BLDG_SYNTH_*` | 学校の敷地・駅前広場の面（OSM） |
| 3 | `import-school.mjs` | `SURF_SCHOOL_YARD` | 校庭 |
| 4 | `import-station-square.mjs` | `STR_MIDORI_STAGE` と舞台に重なる `BLDG_GSI_*` | 舞台・広場・イベント |
| 5 | `import-gsi-labels.mjs` | `LOC_GSI_*` と前回付けた名前 | 注記を外形に対応づける |
| 6 | `identify-midorinoyu.mjs` | — | 緑の湯の同定を正しい外形へ（**5 の後でなければ意味がない**） |
| 7 | `import-rivers.mjs` | `water.geojson` 全部 | 水涯線・水域（wide があればそちら） |

## 第3段 — 構内と配置物

| # | script | 出力 |
|---|---|---|
| 8 | `rebuild-station-yard.mjs` | 駅舎・ホーム・構内踏切・2番線・広場（第2段の後） |
| 9 | `place-signals.mjs` | 常置信号機 6 機（8 の寸法に追従） |
| 10 | `place-stabled-railcar.mjs` | 2番線の留置車（8 の寸法に追従） |
| 11 | `place-taiko.mjs` | クマゲラ太鼓（4 が置いた舞台に追従） |
| 12 | `place-distant-landmarks.mjs` | World の外の3点（座標のみ） |

## 第4段 — 検査

```
npm run validate      # データの整合（出典・confidence・境界）
npm run build
npm run check:joins   # 建てた実体とデータの突き合わせ（要 vite preview）
node scripts/measure-budget.mjs   # 描画の見積り（任意、要 vite preview）
```

`check:joins` と `measure-budget` は動いている World を読むので、先に
`npx vite preview --host 127.0.0.1 --port 4174 --strictPort` を上げておくこと。

## 汎用ツール（World に依存しない）

| script | 用途 |
|---|---|
| `import-geojson.mjs` | 任意の GeoJSON を Reality Data の形に整える |
| `convert-dem-asc.mjs` | ESRI ASCII Grid → `reality/dem.json` |
| `dump-world.mjs` | 動いている World から置かれた実体を吸い出す |
| `check-joins.mjs` | その吸い出しを検査する |
| `validate-reality-data.mjs` | Reality Data の検査 |
| `measure-budget.mjs` | 描画コスト・転送量の測定 |
| `lib/mvt.mjs` | ベクトルタイル(MVT)のデコーダ |

## Blender

```
blender --background --python scripts/blender/build_station.py
blender --background --python scripts/blender/build_kiha54.py
blender --background --python scripts/blender/build_kiha40.py
```

`--render` を付けると `build/*_qa/` に確認用の画をレンダリングする。
出力は `public/assets/models/*.glb`。
