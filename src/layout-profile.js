// Build per-screenshot horizontal "ink mass" profiles for the visualLayout
// check. For each column: sum of |pixel − row median| down the column (flat
// background contributes ~0), binned to LAYOUT_PROFILE_BINS buckets and
// normalised to sum 1. Height-invariant by construction — a page that is
// merely longer produces the same profile shape.
//
// Cached in data/layout-profiles.json keyed by the STORED screenshot path
// (page ids collide across main/news/priority pipelines; paths are unique)
// with the source file mtime, so re-runs only recompute changed screenshots.
//
// Usage:
//   node src/layout-profile.js                      # all pages in results.json
//   node src/layout-profile.js --source=data/results.json --force
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import sharp from 'sharp';
import { ROOT, DIR, LAYOUT_PROFILE_BINS, LAYOUT_PROFILE_PATH } from '../config.js';

const arg = (name, dflt) => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1] || dflt;
const SOURCE = arg('source', join(DIR.data, 'results.json'));
const FORCE = process.argv.includes('--force');

// Mirror of build-dashboard's resolveShot: relative paths resolve via ROOT,
// legacy absolute paths pass through.
const resolveShot = (stored) => !stored ? null : (isAbsolute(stored) ? stored : join(ROOT, stored));

async function columnProfile(absPath) {
  const { data, info } = await sharp(absPath).greyscale().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const colMass = new Float64Array(width);
  for (let y = 0; y < height; y++) {
    const off = y * width;
    const sorted = Uint8Array.prototype.slice.call(data, off, off + width).sort();
    const median = sorted[width >> 1];
    for (let x = 0; x < width; x++) colMass[x] += Math.abs(data[off + x] - median);
  }
  const bins = new Array(LAYOUT_PROFILE_BINS).fill(0);
  for (let x = 0; x < width; x++) {
    bins[Math.min(LAYOUT_PROFILE_BINS - 1, Math.floor(x / width * LAYOUT_PROFILE_BINS))] += colMass[x];
  }
  const total = bins.reduce((a, b) => a + b, 0);
  return total > 0 ? bins.map(v => v / total) : bins;   // all-zero = blank page
}

async function main() {
  console.log(`🚀 layout profiles from ${SOURCE} (${LAYOUT_PROFILE_BINS} bins)`);
  const data = JSON.parse(await readFile(SOURCE, 'utf8'));
  const cache = !FORCE && existsSync(LAYOUT_PROFILE_PATH)
    ? JSON.parse(await readFile(LAYOUT_PROFILE_PATH, 'utf8'))
    : {};
  let done = 0, computed = 0, cached = 0, failed = 0;
  for (const p of data.pages) {
    for (const side of ['prod', 'aem']) {
      const stored = p[side]?.screenshot;
      const abs = resolveShot(stored);
      if (!stored || !abs || !existsSync(abs)) continue;   // no screenshot → no cache key
      const mtimeMs = statSync(abs).mtimeMs;
      if (cache[stored] && cache[stored].mtimeMs === mtimeMs) { cached++; continue; }
      try {
        cache[stored] = { mtimeMs, bins: await columnProfile(abs) };
        computed++;
      } catch (e) {
        console.log(`❌ page ${p.id} ${side}: ${e.message}`);
        cache[stored] = null;
        failed++;
      }
    }
    done++;
    if (done % 25 === 0) {
      await writeFile(LAYOUT_PROFILE_PATH, JSON.stringify(cache));
      console.log(`📸 ${done}/${data.pages.length} pages (${computed} computed · ${cached} cached · ${failed} failed)`);
    }
  }
  await writeFile(LAYOUT_PROFILE_PATH, JSON.stringify(cache));
  console.log(`✅ ${done} pages → ${LAYOUT_PROFILE_PATH} (${computed} computed · ${cached} cached · ${failed} failed)`);
}

main().catch(e => { console.error('❌', e); process.exit(1); });
