// HEAD-check every AEM download URL found in the results file and cache the
// HTTP status in data/link-status.json for the deadDownloadLink check.
//
// ⚠️ This hits BBL hosts — the same Akamai WAF that bans compare.js runs.
// Discipline (see AGENTS.md gotchas): dedupe by URL first, HEAD not GET
// (GET fallback only on 405/501, body cancelled), bounded concurrency,
// per-request pacing, and abort when the blocked ratio crosses
// SAFE_BLOCK_ABORT_RATIO — a mostly-blocked run means the IP is banned and
// continuing would only cache garbage.
//
// Usage:
//   node src/check-downloads.js                # all uncached AEM download URLs
//   node src/check-downloads.js --limit=10     # first N (connectivity test)
//   node src/check-downloads.js --force        # re-check cached URLs too
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  DIR, LINK_STATUS_PATH, LINK_HEAD_CONCURRENCY, LINK_HEAD_PACING_MS,
  LINK_HEAD_TIMEOUT, SAFE_BLOCK_ABORT_RATIO, CAPTURE_USER_AGENT,
} from '../config.js';
import { isDownloadHref } from './scoring/util.js';

const arg = (name, dflt) => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1] || dflt;
const SOURCE = arg('source', join(DIR.data, 'results.json'));
const LIMIT = parseInt(arg('limit', '0'), 10) || Infinity;
const FORCE = process.argv.includes('--force');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function headStatus(url) {
  const opts = { redirect: 'follow', headers: { 'user-agent': CAPTURE_USER_AGENT }, signal: AbortSignal.timeout(LINK_HEAD_TIMEOUT) };
  try {
    let res = await fetch(url, { ...opts, method: 'HEAD' });
    if (res.status === 405 || res.status === 501) {
      res = await fetch(url, { ...opts, method: 'GET' });
      try { await res.body?.cancel(); } catch { /* body already consumed */ }
    }
    return res.status;
  } catch {
    return 0;   // timeout / DNS / connection drop
  }
}

async function main() {
  const data = JSON.parse(await readFile(SOURCE, 'utf8'));
  const urls = new Set();
  for (const p of data.pages) {
    for (const l of (p.aem?.metrics?.links || [])) {
      if (isDownloadHref(l.href)) urls.add(l.href);
    }
  }
  const cache = existsSync(LINK_STATUS_PATH) ? JSON.parse(await readFile(LINK_STATUS_PATH, 'utf8')) : {};
  const queue = [...urls].filter(u => FORCE || cache[u] === undefined).slice(0, LIMIT);
  console.log(`🚀 ${urls.size} distinct AEM download URL(s), ${queue.length} to check (concurrency ${LINK_HEAD_CONCURRENCY}, pacing ${LINK_HEAD_PACING_MS}ms)`);

  let idx = 0, processed = 0, blocked = 0, aborted = false;
  const save = () => writeFile(LINK_STATUS_PATH, JSON.stringify(cache, null, 1));

  async function worker() {
    while (!aborted && idx < queue.length) {
      const url = queue[idx++];
      const status = await headStatus(url);
      cache[url] = { status, checkedAt: new Date().toISOString() };
      processed++;
      if (status === 403 || status === 0) blocked++;
      if (processed % 25 === 0) {
        await save();
        console.log(`📥 ${processed}/${queue.length} (${blocked} blocked/unreachable)`);
      }
      if (processed >= 20 && blocked / processed >= SAFE_BLOCK_ABORT_RATIO) {
        aborted = true;
        console.log(`❌ ABORT: ${blocked}/${processed} blocked — the WAF is refusing this IP. Wait/switch IP and re-run (cached URLs are kept).`);
      }
      await sleep(LINK_HEAD_PACING_MS);
    }
  }

  await Promise.all(Array.from({ length: LINK_HEAD_CONCURRENCY }, worker));
  await save();
  console.log(`${aborted ? '❌ aborted at' : '✅'} ${processed} checked → ${LINK_STATUS_PATH}`);
  if (aborted) process.exit(1);
}

main().catch(e => { console.error('❌', e); process.exit(1); });
