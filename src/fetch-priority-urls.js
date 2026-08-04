// Fetch the "Priority BBL Thai Manual Pages" tab (PRIVATE QA master sheet —
// service-account read, not the public CSV export) and emit
// data/urls-priority.csv in the same format as fetch-urls.js.
// Column map (frozen 2-row header, data from row 3):
//   A=prod URL  B=Create Prod URL (NEW AEM URL)  D=Category  E=Sub-Category  F=Status
// Usage: node src/fetch-priority-urls.js
import { writeFile } from 'node:fs/promises';
import {
  SYNC_SPREADSHEET_ID, SYNC_KEY_PATH,
  PRIORITY_SHEET_TAB_NAME, PRIORITY_STATUS_FILTER, PRIORITY_URLS_PATH,
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

  const statusOk = (s) => PRIORITY_STATUS_FILTER.some(f => f.toLowerCase() === String(s || '').trim().toLowerCase());
  const statusCounts = {};
  const pairs = [];
  let skippedNoAem = 0;
  for (const row of rows) {
    const prodUrl = (row[0] || '').trim();
    const aemUrl = (row[1] || '').trim();
    const status = (row[5] || '').trim();
    if (!prodUrl.startsWith('http')) continue;               // blank/notes rows
    statusCounts[status || '(empty)'] = (statusCounts[status || '(empty)'] || 0) + 1;
    if (!statusOk(status)) continue;
    if (!aemUrl.startsWith('http')) {
      skippedNoAem++;
      console.log(`⚠️ skip (no Create Prod URL): ${prodUrl}`);
      continue;
    }
    pairs.push({ prodUrl, aemUrl, category: (row[3] || '').trim(), subCategory: (row[4] || '').trim() });
  }
  console.log('📊 status counts:', JSON.stringify(statusCounts));

  const csv = [
    'prodUrl,aemUrl,category,subCategory',
    ...pairs.map(p => [csvEscape(p.prodUrl), csvEscape(p.aemUrl), csvEscape(p.category), csvEscape(p.subCategory)].join(',')),
  ].join('\n');
  await writeFile(PRIORITY_URLS_PATH, csv, 'utf8');
  console.log(`✅ Wrote ${pairs.length} URL pair(s) → ${PRIORITY_URLS_PATH}` +
    (skippedNoAem ? ` (${skippedNoAem} matching row(s) skipped — no AEM URL)` : ''));
}

main().catch(e => { console.error('❌', e); process.exit(1); });
