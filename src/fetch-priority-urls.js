// Fetch the "Priority BBL Thai Manual Pages" tab (PRIVATE QA master sheet —
// service-account read, not the public CSV export) and emit
// data/urls-priority.csv in the same format as fetch-urls.js.
// Column map (frozen 2-row header, data from row 3):
//   A=prod URL  B=Create Prod URL (NEW AEM URL)  D=Category  E=Sub-Category  F=Status
// Usage: node src/fetch-priority-urls.js [--prune]
import { writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import {
  SYNC_SPREADSHEET_ID, SYNC_KEY_PATH,
  PRIORITY_SHEET_TAB_NAME, PRIORITY_STATUS_FILTER, PRIORITY_URLS_PATH,
  PRIORITY_CONDITIONAL_STATUS, PRIORITY_CONDITIONAL_LIMIT,
} from '../config.js';
import { getAccessToken } from './google-auth.js';

// Opt in to the destructive behaviour: let rows that left the sheet's scope
// fall out of the CSV, renumbering everything below them. Only correct when the
// captured results are being thrown away too.
const PRUNE = process.argv.includes('--prune');

function csvEscape(value) {
  if (value == null) return '';
  const v = String(value);
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

// Mirrors parseCsvLine in compare.js — the previous CSV has to be read back
// field-by-field, not just for its first column, so retained rows can keep the
// aemUrl their results were captured against.
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
  // Every sheet row by prod URL, in scope or not. Retained rows (below) use it
  // to refresh their Category/Sub-Category/Status, so a row that is held in the
  // CSV for id stability still shows its real current status on the dashboard.
  const sheetBySrc = new Map();
  let skippedNoAem = 0;
  let conditionalAvailable = 0;
  for (const row of rows) {
    const prodUrl = (row[0] || '').trim();
    const aemUrl = (row[1] || '').trim();
    const status = (row[5] || '').trim();
    if (!prodUrl.startsWith('http')) continue;               // blank/notes rows
    statusCounts[status || '(empty)'] = (statusCounts[status || '(empty)'] || 0) + 1;
    const pair = { prodUrl, aemUrl, category: (row[3] || '').trim(), subCategory: (row[4] || '').trim(), status };
    sheetBySrc.set(prodUrl, pair);
    const isDone = matches(PRIORITY_STATUS_FILTER, status);
    const isConditional = matches(PRIORITY_CONDITIONAL_STATUS, status);
    if (!isDone && !isConditional) continue;
    if (!aemUrl.startsWith('http')) {
      skippedNoAem++;
      console.log(`⚠️ skip (no Create Prod URL): ${prodUrl}`);
      continue;
    }
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
  // So the sheet decides what gets ADDED, and the existing CSV decides ORDER
  // and MEMBERSHIP: a row that is already in the CSV is never removed by a
  // fetch, because removing it renumbers every row below it just as surely as
  // an insert does. Two ways a row silently leaves scope, both seen 2026-08-07:
  // its Status moves to a value config does not list ("Done with Condition" on
  // /Wealth, already captured as id 8), or QA clears its Create Prod URL (id 41
  // CC_Promotion_M, cleared after we recorded it as aem404). Either one used to
  // drop the row and shift everything after it. Now such rows are RETAINED in
  // place, keeping the aemUrl their results were captured against, with their
  // sheet metadata refreshed so the dashboard still shows the real status.
  // `--prune` opts back into dropping them, for when the results are being
  // discarded anyway.
  const fresh = [...done, ...conditional];
  const bySrc = new Map(fresh.map(p => [p.prodUrl, p]));
  let previousRows = [];
  if (existsSync(PRIORITY_URLS_PATH)) {
    const prev = (await readFile(PRIORITY_URLS_PATH, 'utf8')).trim().split('\n');
    const header = parseCsvLine(prev[0]);
    const idx = {
      prod: header.indexOf('prodUrl'), aem: header.indexOf('aemUrl'),
      cat: header.indexOf('category'), sub: header.indexOf('subCategory'),
      stat: header.indexOf('status'),
    };
    previousRows = prev.slice(1).filter(l => l.trim()).map(line => {
      const c = parseCsvLine(line);
      return {
        prodUrl: (c[idx.prod] || '').trim(),
        aemUrl: (c[idx.aem] || '').trim(),
        category: idx.cat >= 0 ? (c[idx.cat] || '').trim() : '',
        subCategory: idx.sub >= 0 ? (c[idx.sub] || '').trim() : '',
        status: idx.stat >= 0 ? (c[idx.stat] || '').trim() : '',
      };
    }).filter(r => r.prodUrl);
  }
  const previousOrder = previousRows.map(r => r.prodUrl);

  // Reason a previously-known row is no longer in the fresh in-scope set —
  // reported so a human can act on it rather than just seeing a count.
  const retentionReason = (row) => {
    const sheet = sheetBySrc.get(row.prodUrl);
    if (!sheet) return 'row deleted from the sheet';
    if (!sheet.aemUrl.startsWith('http')) return 'Create Prod URL cleared on the sheet';
    const inScope = matches(PRIORITY_STATUS_FILTER, sheet.status) || matches(PRIORITY_CONDITIONAL_STATUS, sheet.status);
    if (!inScope) return `status is now "${sheet.status}"`;
    return `beyond PRIORITY_CONDITIONAL_LIMIT (${PRIORITY_CONDITIONAL_LIMIT})`;
  };

  const retained = previousRows.filter(r => !bySrc.has(r.prodUrl));
  const added = fresh.filter(p => !previousOrder.includes(p.prodUrl));
  const previousResolved = previousRows.map(r => {
    if (bySrc.has(r.prodUrl)) return bySrc.get(r.prodUrl);
    if (PRUNE) return null;
    // Retained: hold the position and the captured aemUrl, but take fresh
    // Category/Sub-Category/Status from the sheet when the row still exists.
    const sheet = sheetBySrc.get(r.prodUrl);
    return sheet
      ? { ...r, category: sheet.category, subCategory: sheet.subCategory, status: sheet.status }
      : r;
  }).filter(Boolean);
  const pairs = [...previousResolved, ...added];

  if (previousOrder.length) {
    console.log(`🔒 id order preserved: ${previousResolved.length} existing row(s) kept in place` +
      (added.length ? `, ${added.length} appended as id ${previousResolved.length + 1}-${pairs.length}` : ', 0 appended'));
  }
  if (retained.length && !PRUNE) {
    console.log(`\n📌 ${retained.length} row(s) left the sheet's scope but are RETAINED to keep ids stable:`);
    retained.forEach(r => console.log(`     id ${previousOrder.indexOf(r.prodUrl) + 1} — ${retentionReason(r)}\n        ${r.prodUrl}`));
    console.log('   Their captured results stay valid. To drop them for real, re-run with');
    console.log('   --prune AND re-capture from scratch (--force, no --ids) afterwards.\n');
  }
  if (retained.length && PRUNE) {
    console.log(`\n🛑 --prune: ${retained.length} row(s) REMOVED from the CSV:`);
    retained.forEach(r => console.log(`     id ${previousOrder.indexOf(r.prodUrl) + 1} — ${retentionReason(r)}\n        ${r.prodUrl}`));
    console.log('   This SHIFTS every id after the first one. Every captured result below it');
    console.log('   is now attached to the wrong URL — re-capture from scratch (--force, no');
    console.log('   --ids) before trusting any score.\n');
  }
  console.log(`   ${done.length} "${PRIORITY_STATUS_FILTER.join('/')}"` +
    ` + ${conditional.length} of ${conditionalAvailable} "${PRIORITY_CONDITIONAL_STATUS.join('/')}" (cap ${PRIORITY_CONDITIONAL_LIMIT})`);

  const csv = [
    'prodUrl,aemUrl,category,subCategory,status',
    ...pairs.map(p => [csvEscape(p.prodUrl), csvEscape(p.aemUrl), csvEscape(p.category), csvEscape(p.subCategory), csvEscape(p.status)].join(',')),
  ].join('\n');
  // Terminating newline: without it, appending a row by hand (`>>`) lands on
  // the same line as the last row and corrupts it.
  await writeFile(PRIORITY_URLS_PATH, `${csv}\n`, 'utf8');
  console.log(`✅ Wrote ${pairs.length} URL pair(s) → ${PRIORITY_URLS_PATH}` +
    (skippedNoAem ? ` (${skippedNoAem} matching row(s) skipped — no AEM URL)` : ''));
}

main().catch(e => { console.error('❌', e); process.exit(1); });
