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
mouse to look.

| key | |
|---|---|
| **W A S D** / mouse | walk and look |
| **B** | road bike — 55 km/h terminal, momentum, gravity along the slope |
| **M** | overhead view |
| **F1** | Debug Mode: grid, axes, World origin, bounds, POI markers, and a per-feature source/confidence readout |

## Architecture

```
src/                                                        (about 6,400 lines)
├── core/         World, WorldConfig, lat/lon <-> local-metre Coordinates
├── reality/      RealityData model: Confidence, EvidenceType, Source
├── spatial/      SpatialIndex — the ONLY authority on where anything is
├── loaders/      GeoJSONLoader, DEMLoader, WorldLoader (raw -> normalized)
├── generators/   Terrain, FarTerrain, Road, Railway + TrackGeometry,
│                 Building, Town, Vegetation + CanopyMask, Water,
│                 StationTerrace, TrainController, StabledRailcar
├── rendering/    SceneManager, Camera, Lighting
├── player/       PlayerController (walk, bike, gravity), Collision
├── debug/        DebugMode (F1), WorldInspect (the permanent inspection
│                 surface the checks in scripts/ read the World through)
├── state/        Settings
└── main.ts       wiring
```

`WorldInspect` is worth knowing about: it ships rather than being added and
stripped around each measurement, because the cost of re-adding it is why
almost no check ever got written. `frames(n)` waits on rendered frames, not
wall clock; `groundY(x, z)` gives the terrain SURFACE by raycast rather than
the height function the generators sample — the two coming apart is this
project's recurring defect; `scene()` exists so a check can ask a question
nobody anticipated without a new method being shipped first.

World data lives under `public/data/worlds/<world_id>/` as a `world.json`
config plus `reality/` (GeoJSON/height-grid Reality Data) and `evidence/`
(source provenance, reconstruction reasoning, acquisition manifest, audit —
Directive 02) — no World-specific value is hardcoded in `src/`.

Nothing World-specific is hardcoded in `src/`.

## Data status: ACQUIRED

Every category the World draws now comes from a real source. Nothing in
`reality/` is `SYNTHETIC_TEST_DATA` any more — the frozen Directive 01
fixtures survive only under `test/fixtures/synthetic/`.

| | source | confidence |
|---|---|---|
| Station point | MLIT KSJ N02, byte-identical across the 2008 and 2011 editions | A |
| Railway | same | A |
| Terrain | GSI DEM10B (10 m mesh; no finer LiDAR exists for this tile) | B |
| Orthophoto | GSI seamless photography, ~2.4 m/px, undated composite | B |
| Roads | MLIT KSJ N13 (2024 edition — the only vintage) | B, current-only |
| Buildings (168) | GSI 電子国土基本図 建築物 ftCode 3101, via 地理院地図Vector | B |
| Water (91) | GSI 水涯線 5301 / 水域 5000 | B |
| Names | GSI 注記, snapped to the nearest footprint within 60 m | B |
| Far terrain | GSI elevation z=10 + seamless photography z=11, ±35 km | B |
| Station yard | reconstructed from the surveyed road terminus and 省令解釈基準 | C |

`evidence/sources.json` lists every source consulted, including the ones
that failed to load and the ones later found to have been misread. Each
feature carries `confidence`, `evidence_type`, `source_ids` and, where one
feature's parts are known to different standards, `detail_confidence`.

Two rules the data keeps and the validator enforces:

- **Nothing is promoted.** A reading that turns out wrong is corrected AND
  the old reading is left in the source's own record saying it was wrong.
- **Appearance is not inferred from function.** A post office does not get
  a post office's look because it is a post office.

### Bounds

`world.json` declares `bounds.radius_m: 2500`. The DEM and the orthophoto
actually reach ±2,413 m north–south and ±2,479 m east–west; 2,500 is the
round number that covers what is built. It read 2,000 until this was
inventoried, which is why 22 of the validator's 24 warnings were the same
mismatch repeated — a warning list nobody can read is the same as no
warning list.

Features that are deliberately outside the World declare
`outside_world: true` and are counted rather than warned about. That escape
hatch is bounded at 35 km, the far terrain's reach: past that the flag would
be covering a coordinate error.

## Checks

```
npm run validate      # Reality Data: sources, confidence, bounds, leaks
npm run build
npm run check:joins   # the solids BUILT FROM the data, against the data
node scripts/measure-budget.mjs    # draw calls, triangles, transfer
```

`check:joins` and `measure-budget` read a running World, so start
`npx vite preview --host 127.0.0.1 --port 4174 --strictPort` first.

`check:joins` is the one that catches what the data checks cannot: elements
repeated along a path lying the way they said they would, things not
stacking on each other, no two buildings claiming the same institution, a
signal head not hung where a train has to be, and a census — printed every
run — of everything standing on nothing but inference. That census is the
ceiling on how accurate this World can be.

## Building the World

`scripts/` holds 22 CLI tools with an order that matters, and running one of
them alone can silently undo work. **See `scripts/README.md`** for the
stages, what each one deletes before it writes, and the one importer that
must never be run on its own.

## Frozen fixtures

`test/fixtures/` holds the Directive 01 synthetic World and two raw-format
samples. There is no test runner: they are kept as a record of what the
pipeline was fed before real data arrived, and as input if a parser ever
needs one.
