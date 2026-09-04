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
config plus GeoJSON/height-grid Reality Data files — no World-specific value
is hardcoded in `src/`.

## Data status

The Midori (2010-05-30) World currently ships with:

- **1 real, sourced point**: the Midori Station (緑駅) location, derived from
  a Wikidata coordinate reference (see `public/data/worlds/.../reality/poi.geojson`,
  `confidence: "B"`, `historical_status: "plausible"`).
- **SYNTHETIC / TEST DATA** for terrain (DEM), railway alignment, roads, and
  building footprints — placeholder geometry only, `confidence: "U"`,
  `source_ids: ["SYNTHETIC_TEST_DATA"]`. This sandboxed environment has no
  route to GSI/OSM GIS services, so real geometry could not be fetched; the
  synthetic data exists to prove the pipeline, not to represent history.

See the Reality Data files' `confidence` / `historical_status` / `source_ids`
fields (also visible live in Debug Mode) before treating any value as fact.
