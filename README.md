# MIDORI

**Reality-to-World Engine** — a minimal World Generator that turns real-world
geographic data (place × date) into an explorable 3D World.

This is not a train simulator and not a "Midori Station game". It is a
pipeline: `Reality Data -> Terrain / Road / Railway / Building Generators ->
Three.js Rendering -> First Person Player`, built so that changing a
`world.json` (place and date) produces a different World without touching
engine code.

First Target World: **2010-05-30, Kiyosato, Midori, Hokkaido (JP)**
(`JP_HOKKAIDO_KIYOSATO_MIDORI_20100530`).

## Run

```
npm install
npm run dev      # dev server
npm run build    # production build (dist/)
npm run typecheck
```

Open the dev server URL, click to lock the pointer, then WASD to walk and
mouse to look. Press **F1** to toggle Debug Mode (grid, axes, world origin,
bounds, POI markers, and per-feature source/confidence readout).

## Architecture

```
src/
├── core/         World, WorldConfig, lat/lon <-> local-meters Coordinates
├── reality/      RealityData model: Confidence, Source, historical_status
├── loaders/      GeoJSONLoader, DEMLoader, WorldLoader (raw -> normalized)
├── generators/   TerrainGenerator, RoadGenerator, RailwayGenerator,
│                 BuildingGenerator (normalized data -> Three.js meshes)
├── rendering/    SceneManager, Camera, Lighting
├── player/       PlayerController (WASD + mouse look + gravity)
├── debug/        DebugMode (F1)
└── main.ts       wiring
```

World data lives under `public/data/worlds/<world_id>/` as a `world.json`
config plus `reality/` (GeoJSON/height-grid Reality Data) and `evidence/`
(source provenance, reconstruction reasoning, acquisition manifest, audit —
Directive 02) — no World-specific value is hardcoded in `src/`.

`scripts/` holds CLI tooling for bringing in real data: `validate-reality-data.mjs`,
`import-geojson.mjs`, `convert-dem-asc.mjs` (see "Data status" below).

## Data status: PARTIALLY_ACQUIRED

The sandboxed environment's network policy was later opened to Full access,
and real data was fetched from official sources:

- **Station** (`confidence: A`) — MLIT KSJ N02 railway dataset, byte-identical
  between the 2008 and 2011 editions (bracketing 2010-05-30).
- **Railway** near the station (`confidence: A`) — same MLIT KSJ N02 source,
  same 2008/2011 bracket. Replaces the Directive 01 synthetic line.
- **Terrain** (`confidence: B`) — real GSI DEM10B elevation grid (10m
  nationwide baseline; no finer DEM5A/5B/5C/1A LiDAR coverage exists for this
  rural tile). Replaces the Directive 01 flat ~130m synthetic guess with real
  99.5m-298.3m relief.
- **Roads** (`confidence: B`, `historical_status: current-only`) — real MLIT
  KSJ N13 road centerlines (2024 edition — the only vintage available; no
  2010-adjacent edition exists for this dataset). Real current shape,
  explicitly not asserted as 2010 fact.
- **緑の湯 facility** (`confidence: B`) — real address + a documented 1999
  opening date from the town's official site; geometry is a rough
  walking-distance estimate only (no published coordinate).
- **みどりのフェスティバル event** (`confidence: B`) — independently
  corroborated as a real, 21-year-old (by 2010) recurring town event via the
  town's own history page, but *not* the confidence `A` shown in Directive
  02's own example: no source dated specifically to 2010-05-30 was found.
- **Buildings and 4 of 6 named §20 facilities** (緑町小学校, 緑センター,
  緑郵便局, 緑スキー場) are still unavailable — `fgd.gsi.go.jp` (基盤地図情報)
  and `mapps.gsi.go.jp` (aerial photo viewer) remained unreachable even under
  Full network access. Buildings remain unchanged Directive 01
  `SYNTHETIC_TEST_DATA`; no coordinates were invented for the 4 facilities.

Full picture:
- `public/data/worlds/<world_id>/evidence/acquisition_manifest.json` — what's
  needed, which host was tried, why it failed, and what to run once you have
  the file.
- `evidence/sources.json` — every source consulted or identified, including
  the ones that failed to load.
- `evidence/reconstruction.json` — why each Reality Data item has the
  confidence/status it has.
- `evidence/reality_audit.json` — confirmed / reconstructed / unknown, by
  category.

All are also visible live in **Debug Mode (F1)**, per-feature.

### Bringing in real data

```
node scripts/import-geojson.mjs <input.geojson> <out.geojson> --id-prefix ROAD \
  --confidence B --historical-status unknown --source-ids SRC_GSI_FGD_MENU
node scripts/convert-dem-asc.mjs <input.asc> <out dem.json> --confidence B \
  --source-ids SRC_GSI_DEM10B --terrain-evidence-date 2023
npm run validate   # scripts/validate-reality-data.mjs
```

GSI's native DEM5 format (JPGIS2.0/GML) isn't parsed here — convert it to
ESRI ASCII Grid (`.asc`) with QGIS/gdal first; see the manifest for why.
Frozen copies of the Directive 01 synthetic fixtures live at
`test/fixtures/synthetic/<world_id>/` for parser/validator testing.
