// Fetch the "Priority BBL Thai Manual Pages" tab (PRIVATE QA master sheet —
// service-account read, not the public CSV export) and emit
// data/urls-priority.csv in the same format as fetch-urls.js.
// Column map (frozen 2-row header, data from row 3):
//   A=prod URL  B=Create Prod URL (NEW AEM URL)  D=Category  E=Sub-Category  F=Status
// Usage: node src/fetch-priority-urls.js
import { writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import {
  SYNC_SPREADSHEET_ID, SYNC_KEY_PATH,
  PRIORITY_SHEET_TAB_NAME, PRIORITY_STATUS_FILTER, PRIORITY_URLS_PATH,
  PRIORITY_CONDITIONAL_STATUS, PRIORITY_CONDITIONAL_LIMIT,
} from '../config.js';
import { getAccessToken } from './google-auth.js';

function csvEscape(value) {
  if (value == null) return '';
  const v = String(value);
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

async function main() {
  console.log(`⬇️  Fetching "${PRIORITY_SHEET_TAB_NAME}" via service account`);
  const token = await getAccessToken(SYNC_KEY_PATH, 'https://www.googleapis.com/auth/spreadsheets.readonly');
  const range = encodeURIComponent(`'${PRIORITY_SHEET_TAB_NAME}'!A3:F`);
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SYNC_SPREADSHEET_ID}/values/${range}`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`Sheets API HTTP ${res.status}: ${await res.text()}`);
  const rows = (await res.json()).values || [];

  const matches = (list, s) => list.some(f => f.toLowerCase() === String(s || '').trim().toLowerCase());
  const statusCounts = {};
  // Kept in two buckets, not one list, so every "Done" row keeps the CSV
  // position — and therefore the page id — it already has. See
  // PRIORITY_CONDITIONAL_STATUS in config.js.
  const done = [];
  const conditional = [];
  let skippedNoAem = 0;
  let conditionalAvailable = 0;
  for (const row of rows) {
    const prodUrl = (row[0] || '').trim();
    const aemUrl = (row[1] || '').trim();
    const status = (row[5] || '').trim();
    if (!prodUrl.startsWith('http')) continue;               // blank/notes rows
    statusCounts[status || '(empty)'] = (statusCounts[status || '(empty)'] || 0) + 1;
    const isDone = matches(PRIORITY_STATUS_FILTER, status);
    const isConditional = matches(PRIORITY_CONDITIONAL_STATUS, status);
    if (!isDone && !isConditional) continue;
    if (!aemUrl.startsWith('http')) {
      skippedNoAem++;
      console.log(`⚠️ skip (no Create Prod URL): ${prodUrl}`);
      continue;
    }
    const pair = { prodUrl, aemUrl, category: (row[3] || '').trim(), subCategory: (row[4] || '').trim(), status };
    if (isDone) { done.push(pair); continue; }
    conditionalAvailable++;
    if (conditional.length < PRIORITY_CONDITIONAL_LIMIT) conditional.push(pair);
  }
  console.log('📊 status counts:', JSON.stringify(statusCounts));

  // ── id stability ──────────────────────────────────────────────────────────
  // compare.js derives each page id from its CSV row position, and
  // results-priority.json is keyed by that id. The sheet is edited between
  // fetches — a single row inserted near the top shifts every id below it, and
  // the next rescore silently attaches existing scores to different URLs. This
  // is not hypothetical: on 2026-08-05 a new "Web-Forms" row moved ids 9-15,
  // so About-Us's captured score would have become Web-Forms'.
  //
  // So the sheet decides membership, and the existing CSV decides ORDER: rows
  // already known keep their position, genuinely new rows are appended.
  const fresh = [...done, ...conditional];
  const bySrc = new Map(fresh.map(p => [p.prodUrl, p]));
  let previousOrder = [];
  if (existsSync(PRIORITY_URLS_PATH)) {
    const prev = (await readFile(PRIORITY_URLS_PATH, 'utf8')).trim().split('\n').slice(1);
    previousOrder = prev.map(line => (line.split(',')[0] || '').replace(/^"|"$/g, '').trim()).filter(Boolean);
  }
  const kept = previousOrder.filter(u => bySrc.has(u));
  const dropped = previousOrder.filter(u => !bySrc.has(u));
  const added = fresh.filter(p => !previousOrder.includes(p.prodUrl));
  const pairs = [...kept.map(u => bySrc.get(u)), ...added];

  if (previousOrder.length) {
    console.log(`🔒 id order preserved: ${kept.length} existing row(s) kept in place, ${added.length} appended as id ${kept.length + 1}-${pairs.length}`);
  }
  if (dropped.length) {
    console.log(`\n🛑 ${dropped.length} row(s) previously in the CSV no longer match the status filter:`);
    dropped.forEach(u => console.log(`     ${u}`));
    console.log('   They have been removed, which SHIFTS every id after them. Any captured');
    console.log('   result below the first removed row is now attached to the wrong URL —');
    console.log(`   re-capture from scratch (--force, no --ids) before trusting the scores.\n`);
  }
  console.log(`   ${done.length} "${PRIORITY_STATUS_FILTER.join('/')}"` +
    ` + ${conditional.length} of ${conditionalAvailable} "${PRIORITY_CONDITIONAL_STATUS.join('/')}" (cap ${PRIORITY_CONDITIONAL_LIMIT})`);

  const csv = [
    'prodUrl,aemUrl,category,subCategory,status',
    ...pairs.map(p => [csvEscape(p.prodUrl), csvEscape(p.aemUrl), csvEscape(p.category), csvEscape(p.subCategory), csvEscape(p.status)].join(',')),
  ].join('\n');
  await writeFile(PRIORITY_URLS_PATH, csv, 'utf8');
  console.log(`✅ Wrote ${pairs.length} URL pair(s) → ${PRIORITY_URLS_PATH}` +
    (skippedNoAem ? ` (${skippedNoAem} matching row(s) skipped — no AEM URL)` : ''));
}

main().catch(e => { console.error('❌', e); process.exit(1); });
