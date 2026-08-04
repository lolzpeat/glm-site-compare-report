// Re-score a results file with the v2 criteria from CACHED metrics — no
// page re-capture, no network. Pages with an errorType, news-mode pages,
// and pages without both metric objects are preserved byte-identical.
//
// Usage:
//   node src/rescore.js                                  # results.json → results-v2.json
//   node src/rescore.js --source=X.json --out=Y.json
//   node src/rescore.js --ids=1-50                       # re-score subset, preserve rest
// Writing --out onto an existing file makes a timestamped backup first.
import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DIR, LAYOUT_PROFILE_PATH, LINK_STATUS_PATH, PASS_THRESHOLD } from '../config.js';
import { scoreMain } from './scoring/score-main.js';

const arg = (name, dflt) => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1] || dflt;
const SOURCE = arg('source', join(DIR.data, 'results.json'));
const OUT = arg('out', join(DIR.data, 'results-v2.json'));
const IDS = (() => {
  const spec = arg('ids', '');
  if (!spec) return null;
  const set = new Set();
  for (const part of spec.split(',')) {
    const [a, b] = part.split('-').map(Number);
    if (b) { for (let i = a; i <= b; i++) set.add(String(i)); } else set.add(String(a));
  }
  return set;
})();

const histogram = (pages) => {
  const h = {};
  for (const p of pages) {
    const k = p.errorType ? p.errorType : `${Math.floor((p.parity ?? 0) / 10) * 10}s`;
    h[k] = (h[k] || 0) + 1;
  }
  return h;
};

async function main() {
  console.log(`🚀 rescore ${SOURCE} → ${OUT}`);
  const data = JSON.parse(await readFile(SOURCE, 'utf8'));
  const layout = existsSync(LAYOUT_PROFILE_PATH) ? JSON.parse(await readFile(LAYOUT_PROFILE_PATH, 'utf8')) : {};
  const linkStatus = existsSync(LINK_STATUS_PATH) ? JSON.parse(await readFile(LINK_STATUS_PATH, 'utf8')) : null;
  if (!Object.keys(layout).length) console.log('⚠️ no layout profiles — visualLayout will be insufficient (run: npm run layout-profile)');
  if (!linkStatus) console.log('⚠️ no link statuses — deadDownloadLink will be insufficient (run: npm run check-downloads)');

  let rescored = 0, preserved = 0;
  const failCounts = {};
  const pages = data.pages.map(p => {
    const skip = (IDS && !IDS.has(String(p.id))) || p.errorType || p.newsMode || !p.prod?.metrics || !p.aem?.metrics;
    if (skip) { preserved++; return p; }
    const sc = scoreMain(p.prod.metrics, p.aem.metrics, {
      // layout cache is keyed by stored screenshot path (unique across pipelines)
      layout: { prod: layout[p.prod?.screenshot]?.bins ?? null, aem: layout[p.aem?.screenshot]?.bins ?? null },
      linkStatus,
    });
    for (const c of sc.checks) if (!c.passed && !c.insufficient) failCounts[c.id] = (failCounts[c.id] || 0) + 1;
    rescored++;
    return { ...p, ...sc };
  });

  const out = { ...data, pages };
  if (existsSync(OUT)) {
    const backup = `${OUT}.backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    await copyFile(OUT, backup);
    console.log(`📦 backed up existing ${OUT} → ${backup}`);
  }
  await writeFile(OUT, JSON.stringify(out, null, 1));

  const oldScored = data.pages.filter(p => !p.errorType);
  const newScored = pages.filter(p => !p.errorType);
  console.log(`✅ ${rescored} rescored · ${preserved} preserved verbatim → ${OUT}`);
  console.log('📊 old histogram:', histogram(oldScored));
  console.log('📊 new histogram:', histogram(newScored));
  console.log(`📊 PASS (≥${PASS_THRESHOLD}): old ${oldScored.filter(p => p.parity >= PASS_THRESHOLD).length} → new ${newScored.filter(p => p.parity >= PASS_THRESHOLD).length}`);
  console.log('📊 fail counts by check:', Object.fromEntries(Object.entries(failCounts).sort((a, b) => b[1] - a[1])));
}

main().catch(e => { console.error('❌', e); process.exit(1); });
