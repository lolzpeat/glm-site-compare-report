// Chunked "safe" capture runner — runs compare.js in small id-range chunks
// with a long pause between them so each chunk lands in a FRESH WAF rate
// window instead of piling onto the previous one.
//
// WHY: prod's Akamai WAF bans the IP after ~120-200 heavy page-loads within a
// ~15-20 min sliding window (see AGENTS.md gotchas, 2026-07-08/09). A full
// `--force --concurrency=4` run hits that ceiling mid-run and fills
// results.json with BLOCKED garbage. `--pacing` alone doesn't help because it
// slows requests but never clears the sliding window. Splitting into chunks +
// pausing long enough for the window to lapse DOES clear it. This script
// automates that loop and aborts when a chunk's block rate signals a live ban.
//
// Each chunk is its own compare.js process (fresh browser, isolated state),
// passing --ids= so compare.js re-scores cached pages and only re-captures
// the rest. Pages outside the chunk are preserved verbatim by compare.js's
// mergePreserved — so interrupting this script (Ctrl-C) never loses data.
//
// Usage:
//   npm run safe-run                           # full recapture, chunks of 50
//   npm run safe-run -- --news                 # news pipeline (concurrency 1, news urls/results)
//   npm run safe-run -- --chunk=30 --pause=15  # custom chunk size / pause minutes
//   npm run safe-run -- --start-id=300         # begin at a specific id
//   npm run safe-run -- --force                # pass --force through (re-capture cached pages too)
//   npm run safe-run -- --dry-run              # print the plan, run nothing

import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  DIR,
  SAFE_CHUNK_SIZE, SAFE_CHUNK_PAUSE_MS, SAFE_CHUNK_CONCURRENCY, SAFE_CHUNK_PACING_MS,
  SAFE_BLOCK_ABORT_RATIO,
} from '../config.js';

// ─── CLI ───────────────────────────────────────────────────────────────────
const arg = (name) => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1];
const flag = (name) => process.argv.includes(`--${name}`);
const newsMode = flag('news');
const dryRun = flag('dry-run');
const forceAll = flag('force');            // pass --force through to compare.js (re-capture even cached)
const chunkSize = parseInt(arg('chunk') || String(SAFE_CHUNK_SIZE), 10);
const pauseMin = parseInt(arg('pause') || String(SAFE_CHUNK_PAUSE_MS / 60000), 10);
const concurrency = parseInt(arg('concurrency') || String(newsMode ? 1 : SAFE_CHUNK_CONCURRENCY), 10);
const pacingMs = parseInt(arg('pacing') || String(SAFE_CHUNK_PACING_MS), 10);
const startId = parseInt(arg('start-id') || '1', 10);
const abortRatio = SAFE_BLOCK_ABORT_RATIO;

const URLS_PATH = arg('urls') || (newsMode ? `${DIR.data}/urls-news.csv` : `${DIR.data}/urls.csv`);
const RESULTS_PATH = arg('output') || arg('source') || (newsMode ? `${DIR.data}/results-news.json` : `${DIR.data}/results.json`);

// ─── Read the page count from urls.csv (same id semantics as compare.js) ───
// compare.js assigns id = position-in-file (1-indexed, after the header), so
// the line count == the highest id. We only need the count here, not the URLs.
async function countPages() {
  if (!existsSync(URLS_PATH)) throw new Error(`Missing ${URLS_PATH}. Run 'npm run fetch${newsMode ? ':news' : ''}' first.`);
  const text = await readFile(URLS_PATH, 'utf8');
  const lines = text.trim().split('\n');
  let n = 0;
  for (let i = 1; i < lines.length; i++) if (lines[i].trim()) n++;
  return n;
}

// ─── Chunk status from results.json ────────────────────────────────────────
// "done" = has real checks (NOT the single 'error' placeholder that blocked /
// failed-load pages get). compare.js gives blocked/failed pages a
// checks=[{id:'error',...}] stub, so we treat id==='error' as "not really done".
function chunkStatus(resultsPath, minId, maxId) {
  if (!existsSync(resultsPath)) return { done: 0, blocked: 0, total: maxId - minId + 1 };
  let raw;
  try { raw = JSON.parse(readFileSync(resultsPath, 'utf8')); }
  catch { return { done: 0, blocked: 0, total: maxId - minId + 1 }; }
  const inRange = (raw.pages || []).filter(p => {
    const id = parseInt(p.id, 10);
    return id >= minId && id <= maxId;
  });
  const hasRealChecks = (p) => Array.isArray(p.checks) && p.checks.length > 0 && p.checks.some(c => c.id !== 'error');
  const done = inRange.filter(hasRealChecks).length;
  const blocked = inRange.filter(p => p.errorType === 'blocked').length;
  return { done, blocked, total: maxId - minId + 1 };
}

// ─── Run one compare.js chunk as a child process (streamed output) ─────────
// compare.js exits 0 even when some pages blocked, so we read the block count
// from results.json afterwards (chunkStatus) rather than relying on exit code.
function runChunk(idsArg) {
  const comparePath = fileURLToPath(new URL('./compare.js', import.meta.url));
  const args = [comparePath, `--ids=${idsArg}`, `--concurrency=${concurrency}`];
  if (pacingMs > 0) args.push(`--pacing=${pacingMs}`);
  if (forceAll) args.push('--force');
  // compare.js defaults --urls/--output to data/urls.csv + data/results.json,
  // so for the main pipeline we don't need to pass them. News needs all three.
  if (newsMode) args.push('--news', `--urls=${URLS_PATH}`, `--output=${RESULTS_PATH}`, `--source=${RESULTS_PATH}`);
  const shown = args.filter(a => !a.startsWith('--urls=') && !a.startsWith('--output=') && !a.startsWith('--source=')).join(' ');
  console.log(`   ▶ node src/compare.js ${shown}`);
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { stdio: 'inherit' });
    child.on('close', (code) => resolve({ code }));
  });
}

// Compute chunks as [minId, maxId] inclusive ranges starting at startId.
function buildChunks(totalPages, size, fromId) {
  const chunks = [];
  for (let start = fromId; start <= totalPages; start += size) {
    chunks.push([start, Math.min(start + size - 1, totalPages)]);
  }
  return chunks;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ─── Main loop ─────────────────────────────────────────────────────────────
async function main() {
  const totalPages = await countPages();
  const chunks = buildChunks(totalPages, chunkSize, startId);

  const modeLabel = newsMode ? 'NEWS' : 'MAIN';
  console.log(`🛡️  Safe chunked run [${modeLabel}]`);
  console.log(`   ${totalPages} pages · ${chunks.length} chunk(s) of ~${chunkSize} · concurrency ${concurrency}${pacingMs ? ` · pacing ${pacingMs}ms` : ''}`);
  console.log(`   pause ${pauseMin} min between chunks · abort if a chunk is ≥${Math.round(abortRatio * 100)}% BLOCKED`);
  console.log(`   results → ${RESULTS_PATH}${forceAll ? ' · --force re-captures cached pages' : ' · resume (skip pages already with real checks)'}`);
  if (dryRun) console.log(`   ⏩ --dry-run: printing the plan only, nothing will run`);

  const beforeAll = chunkStatus(RESULTS_PATH, 1, totalPages);
  console.log(`   currently: ${beforeAll.done}/${totalPages} pages have real checks · ${beforeAll.blocked} blocked\n`);

  if (dryRun) {
    chunks.forEach(([a, b], i) => {
      const st = chunkStatus(RESULTS_PATH, a, b);
      const done = st.done > 0 ? ` · ${st.done}/${st.total} already done` : '';
      const blk = st.blocked > 0 ? ` · ${st.blocked} blocked` : '';
      console.log(`   chunk ${String(i + 1).padStart(2)}/${chunks.length}: ids ${a}-${b}${done}${blk}`);
    });
    return;
  }

  let completed = 0;
  let aborted = false;
  for (let i = 0; i < chunks.length; i++) {
    const [minId, maxId] = chunks[i];
    const rangeStr = minId === maxId ? `${minId}` : `${minId}-${maxId}`;
    const before = chunkStatus(RESULTS_PATH, minId, maxId);

    // Resume: skip a chunk entirely if every page already has real checks
    // (nothing to re-capture unless --force). Re-running safe-run.js after an
    // interrupt is then a no-op for completed chunks.
    if (!forceAll && before.done >= before.total) {
      console.log(`📦 chunk ${i + 1}/${chunks.length} (ids ${rangeStr}): ${before.done}/${before.total} already done — skipping`);
      completed++;
      continue;
    }

    console.log(`\n── chunk ${i + 1}/${chunks.length} · ids ${rangeStr} ────────────────────────────`);
    const skipNote = before.done > 0 ? ` (${before.done}/${before.total} already done — compare re-scores those from cache)` : '';
    console.log(`   capturing${skipNote}`);
    await runChunk(rangeStr);

    const after = chunkStatus(RESULTS_PATH, minId, maxId);
    const captured = Math.max(0, after.done - before.done);
    console.log(`   ✅ chunk ${i + 1}/${chunks.length} done: +${captured} new real checks · ${after.done}/${after.total} in range · ${after.blocked} blocked`);

    // Ban detection: if this chunk's results are dominated by BLOCKED, the IP
    // is banned and continuing would only produce more garbage. Stop and let
    // the human decide (wait, change IP, or retry later). This is the
    // "don't over-trust a small sample" guardrail from AGENTS.md — a few
    // stray blocks are fine; a chunk that's mostly blocked is not.
    const blockRate = after.total > 0 ? after.blocked / after.total : 0;
    if (after.blocked > 0 && blockRate >= abortRatio) {
      console.error(`\n🛑 ABORTED: chunk ${i + 1} was ${Math.round(blockRate * 100)}% BLOCKED (${after.blocked}/${after.total}).`);
      console.error(`   The IP looks banned — continuing would fill results.json with garbage.`);
      console.error(`   Options: wait ~20-30 min and re-run (resume skips done chunks), switch network/IP, or retry this chunk later.`);
      console.error(`   Progress so far is saved. Next: npm run safe-run (resumes here).`);
      aborted = true;
      break;
    }

    completed++;
    // Pause between chunks (not after the last) to let the rate window lapse.
    if (i < chunks.length - 1) {
      console.log(`\n😴 Pausing ${pauseMin} min to let the WAF rate window clear before chunk ${i + 2}...`);
      console.log(`   (Ctrl-C now is safe — re-run resumes from the next incomplete chunk)`);
      await sleep(pauseMin * 60000);
    }
  }

  const afterAll = chunkStatus(RESULTS_PATH, 1, totalPages);
  console.log(`\n${'═'.repeat(60)}`);
  console.log(aborted ? `🛑 Stopped early after ${completed} chunk(s) — possible IP ban.` : `✅ Finished all ${chunks.length} chunk(s).`);
  console.log(`   pages with real checks: ${beforeAll.done} → ${afterAll.done}/${totalPages}`);
  console.log(`   blocked:                ${beforeAll.blocked} → ${afterAll.blocked}`);
  console.log(`   Next: npm run dashboard`);
  console.log(`${'═'.repeat(60)}`);
}

main().catch(e => { console.error('❌', e); process.exit(1); });
