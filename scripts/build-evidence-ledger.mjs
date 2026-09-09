#!/usr/bin/env node
/**
 * 証拠台帳 — 何が事実で、何が推定で、何が記憶か。
 *
 * London Charter が言うのは「再構築の成果物には、それがどう作られたかが
 * 付随しなければならない」ということ。このプロジェクトは出典と確度を
 * 地物ごとに持っているが、**一覧して眺める形**を持っていなかった。
 *
 * これは手書きの文書ではなく、reality/ から生成する。手書きだと必ずデータと
 * 乖離する。乖離した台帳は、無い台帳より悪い。
 *
 *   node scripts/build-evidence-ledger.mjs
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORLD = join(ROOT, 'public/data/worlds/JP_HOKKAIDO_KIYOSATO_MIDORI_20100530');

/** evidence_type から FACT / INFERENCE / MEMORY へ。 */
const KIND = {
  public_gis: 'FACT', official_record: 'FACT', contemporary_photo: 'FACT',
  contemporary_record: 'FACT', satellite_imagery: 'FACT',
  encyclopedia: 'INFERENCE', secondary_photo: 'INFERENCE', inference: 'INFERENCE',
  user_survey: 'MEMORY',
};

const read = (p) => JSON.parse(readFileSync(p, 'utf8'));

function main() {
  const dir = join(WORLD, 'reality');
  const sources = read(join(WORLD, 'evidence/sources.json')).sources;
  const sourceById = new Map(sources.map((s) => [s.id, s]));
  const memory = read(join(WORLD, 'evidence/memory_atlas.json'));

  const rows = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.geojson'))) {
    const layer = file.replace('.geojson', '');
    for (const f of read(join(dir, file)).features) {
      const p = f.properties;
      const et = p.evidence_type ?? 'unknown';
      rows.push({
        id: p.id,
        layer,
        name: p.name ?? null,
        kind: KIND[et] ?? 'UNKNOWN',
        evidence_type: et,
        confidence: p.confidence ?? 'U',
        position_status: p.position_status ?? null,
        outside_world: p.outside_world === true,
        geometry: f.geometry.type,
        // 部分ごとの確度を持っているものは、そこが最も情報量が多い
        detail: p.detail_confidence ? Object.keys(p.detail_confidence) : [],
        sources: (p.source_ids ?? []).map((id) => {
          const s = sourceById.get(id);
          return { id, provider: s?.provider ?? null, data_date: s?.data_date ?? null };
        }),
      });
    }
  }

  const tally = (key) => rows.reduce((a, r) => { a[r[key]] = (a[r[key]] ?? 0) + 1; return a; }, {});
  const ledger = {
    note: 'scripts/build-evidence-ledger.mjs が reality/ から生成する。手で編集しない — '
      + '編集すべきは地物そのものの evidence_type / confidence / detail_confidence。',
    generated_at: new Date().toISOString().slice(0, 10),
    totals: {
      features: rows.length,
      by_kind: tally('kind'),
      by_confidence: tally('confidence'),
      with_detail_confidence: rows.filter((r) => r.detail.length > 0).length,
      outside_world: rows.filter((r) => r.outside_world).length,
      memory_entries: memory.entries.length,
      memory_open: memory.entries.filter((e) => e.status === 'OPEN').length,
    },
    /* 形を持ちながら根拠が推定でしかないもの。この数がこの World の精度の天井。 */
    standing_on_inference: rows
      .filter((r) => r.kind === 'INFERENCE' && r.evidence_type === 'inference')
      .map((r) => ({ id: r.id, layer: r.layer, name: r.name })),
    features: rows,
  };
  writeFileSync(join(WORLD, 'evidence/ledger.json'), `${JSON.stringify(ledger, null, 2)}\n`);

  console.log('=== 証拠台帳 ===');
  console.log(`地物 ${ledger.totals.features} 件`);
  for (const [k, v] of Object.entries(ledger.totals.by_kind)) {
    console.log(`  ${k.padEnd(10)} ${String(v).padStart(4)}  ${'█'.repeat(Math.round(v / 4))}`);
  }
  console.log(`確度: ${JSON.stringify(ledger.totals.by_confidence)}`);
  console.log(`部分ごとの確度を持つもの ${ledger.totals.with_detail_confidence} 件`);
  console.log(`World の外として記録 ${ledger.totals.outside_world} 件`);
  console.log(`記憶 ${ledger.totals.memory_entries} 件（未解決 ${ledger.totals.memory_open} 件）`);
  console.log(`推定の上に立つ形 ${ledger.standing_on_inference.length} 件 — この World の精度の天井`);
  console.log('→ evidence/ledger.json');
}

main();
