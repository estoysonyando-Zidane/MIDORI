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

## Data status: DATA_ACQUISITION_BLOCKED

This sandboxed environment cannot reach any GIS/authority host (GSI, MLIT,
OSM/Overpass, Wikipedia, Wikidata — all `EGRESS_BLOCKED` or DNS failure).
Directive 02 ("Reality Data Acquisition & Historical Reconstruction") is
therefore implemented in its **network-failure-protocol** state: the
acquisition pipeline, converters, and validator all exist and work, but real
GSI/MLIT geometry has not been fetched.

- **1 real, indirectly-sourced point**: Midori Station (緑駅), `confidence: B`.
- **1 low-confidence structural inference**: the station plaza POI, `confidence: C`.
- **1 operator-asserted event**: みどりのフェスティバル (2010-05-30), `confidence: B`
  — deliberately *not* the confidence `A` shown in Directive 02's own example,
  since this session could not independently corroborate it.
- **Everything else** (terrain, railway alignment, roads, building footprints,
  and 5 of 6 named §20 facilities) is either unchanged Directive 01
  `SYNTHETIC_TEST_DATA` or simply absent — no coordinates were invented for
  facilities with no available source.

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
  --source-ids SRC_GSI_DEM5_TILES --terrain-evidence-date 2023
npm run validate   # scripts/validate-reality-data.mjs
```

GSI's native DEM5 format (JPGIS2.0/GML) isn't parsed here — convert it to
ESRI ASCII Grid (`.asc`) with QGIS/gdal first; see the manifest for why.
Frozen copies of the Directive 01 synthetic fixtures live at
`test/fixtures/synthetic/<world_id>/` for parser/validator testing.
