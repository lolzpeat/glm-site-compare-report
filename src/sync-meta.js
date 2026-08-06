// Copy sheet metadata (category / subCategory / sheetStatus) from a urls CSV
// into an existing results file. Metadata only — no browser, no network, no
// re-scoring. Every captured metric, parity, check and screenshot path is left
// byte-identical.
//
// Why this exists: compare.js already syncs these fields from the CSV, but only
// for pages it actually walks, and running it to backfill would try to capture
// the pages that were never captured (a WAF risk — see AGENTS.md). rescore.js
// never reads the CSV at all, so it has no metadata to sync. This fills the gap
// when the QA sheet gains columns after a capture has already happened.
//
// Usage:
//   node src/sync-meta.js --urls=data/urls-priority.csv --source=data/results-priority.json
//   node src/sync-meta.js --urls=… --source=… --dry-run
// Writing onto an existing file makes a timestamped backup first.
import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DIR } from '../config.js';

const arg = (name, dflt) => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1] || dflt;
const URLS = arg('urls', join(DIR.data, 'urls.csv'));
const SOURCE = arg('source', join(DIR.data, 'results.json'));
const DRY_RUN = process.argv.includes('--dry-run');

// Sheet cells that mean "no value" rather than a real label. The QA sheet uses
// "-" in Sub-Category for the ~40 pages that sit directly under a Category;
// passed through verbatim it becomes a dropdown entry named "-" that groups
// unrelated pages together.
const PLACEHOLDERS = new Set(['-', '–', '—', 'n/a', 'na', 'none']);

const clean = (raw) => {
  const v = String(raw ?? '').trim().replace(/\s+/g, ' ');
  return PLACEHOLDERS.has(v.toLowerCase()) ? '' : v;
};

// Mirrors parseCsvLine in compare.js. Duplicated rather than imported because
// compare.js pulls in puppeteer-core at module load, and this script must stay
// runnable while a capture run holds the browser.
function parseCsvLine(line) {
  const out = [];
  let field = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') inQ = false;
      else field += ch;
    } else {
      if (ch === '"') inQ = true;
      else if (ch === ',') { out.push(field); field = ''; }
      else field += ch;
    }
  }
  out.push(field);
  return out;
}

// id is the CSV row position, assigned exactly as compare.js's readPairs() does.
async function readCsv(path) {
  if (!existsSync(path)) throw new Error(`Missing ${path}. Run the matching fetch script first.`);
  const lines = (await readFile(path, 'utf8')).trim().split('\n');
  const header = parseCsvLine(lines[0]);
  const idx = {
    prod: header.indexOf('prodUrl'),
    cat: header.indexOf('category'),
    sub: header.indexOf('subCategory'),
    stat: header.indexOf('status'),
  };
  if (idx.prod < 0) throw new Error(`${path} has no prodUrl column`);
  const rows = new Map();
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const c = parseCsvLine(lines[i]);
    rows.set(String(rows.size + 1), {
      prodUrl: c[idx.prod],
      category: idx.cat >= 0 ? clean(c[idx.cat]) : '',
      subCategory: idx.sub >= 0 ? clean(c[idx.sub]) : '',
      sheetStatus: idx.stat >= 0 ? clean(c[idx.stat]) : '',
    });
  }
  return rows;
}

const tally = (values) => {
  const counts = {};
  for (const v of values) counts[v || '(none)'] = (counts[v || '(none)'] || 0) + 1;
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k} ${n}`)
    .join(' · ');
};

async function main() {
  console.log(`🚀 sync-meta ${URLS} → ${SOURCE}${DRY_RUN ? ' (dry run)' : ''}`);
  const rows = await readCsv(URLS);
  const data = JSON.parse(await readFile(SOURCE, 'utf8'));
  const pages = (data.pages || []).filter(Boolean);

  // ── id drift guard ────────────────────────────────────────────────────────
  // Pages are matched by id (CSV row position), the same key compare.js uses.
  // That key is only meaningful while the CSV keeps its row order: inserting or
  // removing a sheet row shifts every id below it, and a silent sync would then
  // attach one page's category to a different URL's scores — the failure
  // fetch-priority-urls.js documents from 2026-08-05. Verifying prodUrl turns
  // that silent corruption into a loud stop, and the stop is all-or-nothing
  // because a shifted CSV invalidates the ordering assumption for every row,
  // not just the ones that happen to differ.
  const drift = [];
  const orphans = [];
  for (const page of pages) {
    const row = rows.get(String(page.id));
    if (!row) { orphans.push(page.id); continue; }
    if (row.prodUrl !== page.prodUrl) drift.push({ id: page.id, results: page.prodUrl, csv: row.prodUrl });
  }
  if (drift.length) {
    console.error(`❌ id drift — ${drift.length} page(s) point at a different URL in the CSV. NOTHING written.`);
    for (const d of drift.slice(0, 10)) {
      console.error(`   id ${d.id}\n     results: ${d.results}\n     csv:     ${d.csv}`);
    }
    if (drift.length > 10) console.error(`   … and ${drift.length - 10} more`);
    console.error('   The CSV row order changed since capture. Re-capture the affected ids');
    console.error('   before syncing, or the scores will be attached to the wrong pages.');
    process.exit(1);
  }
  if (orphans.length) {
    console.log(`⚠️  ${orphans.length} captured page(s) no longer in the CSV (left untouched): ${orphans.slice(0, 10).join(', ')}${orphans.length > 10 ? ', …' : ''}`);
  }

  // ── patch ─────────────────────────────────────────────────────────────────
  let changed = 0;
  const nextPages = (data.pages || []).map(page => {
    if (!page) return page;
    const row = rows.get(String(page.id));
    if (!row) return page;
    const same = page.category === row.category
      && page.subCategory === row.subCategory
      && page.sheetStatus === row.sheetStatus;
    if (same) return page;
    changed++;
    return { ...page, category: row.category, subCategory: row.subCategory, sheetStatus: row.sheetStatus };
  });

  const uncaptured = rows.size - pages.length + orphans.length;
  console.log(`📊 category:    ${tally(nextPages.filter(Boolean).map(p => p.category))}`);
  console.log(`📊 subCategory: ${tally(nextPages.filter(Boolean).map(p => p.subCategory))}`);
  console.log(`📊 sheetStatus: ${tally(nextPages.filter(Boolean).map(p => p.sheetStatus))}`);

  if (DRY_RUN) {
    console.log(`✅ dry run · would update ${changed} page(s) · ${pages.length - changed} already current · ${uncaptured} CSV row(s) not yet captured`);
    return;
  }

  const backup = `${SOURCE}.backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  await copyFile(SOURCE, backup);
  console.log(`📦 backed up → ${backup}`);
  // generatedAt deliberately untouched: it identifies the capture run, and
  // sync-sheet.js keys its round counter off it (see AGENTS.md). Bumping it
  // here would make a metadata edit look like a fresh compare run.
  await writeFile(SOURCE, JSON.stringify({ ...data, pages: nextPages }, null, 1));
  console.log(`✅ ${changed} page(s) updated · ${pages.length - changed} already current · ${uncaptured} CSV row(s) not yet captured → ${SOURCE}`);
}

main().catch(e => { console.error('❌', e.message || e); process.exit(1); });
