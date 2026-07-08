// Write automated validation results back to the Google Sheet's QA-tracking
// columns (Automatiion Validation Status, Open Issues). This is a SEPARATE
// spreadsheet from SHEET_CSV_URL (config.js) — the manual QA master file.
//
// Requires .secrets/sheet-sync-key.json — a Google service-account key
// shared as EDITOR on the target sheet (see README "Sheet sync"). Gitignored;
// never commit it.
//
// Rows are matched by URL (column A), not row position, so re-sorting the
// sheet doesn't break the sync.
//
// "Automatiion Validation Status" is a GLOBAL round counter for the whole
// report, not per-row: every row synced in the same full compare run gets
// the same "Nth Validation" label. The round only advances when results.json's
// `generatedAt` differs from the last one this script synced (tracked in
// SYNC_STATE_PATH) — re-running sync-sheet.js against the same compare run
// re-writes the same round and just refreshes Open Issues.
//
// Usage:
//   node src/sync-sheet.js                  # sync data/results.json → sheet
//   node src/sync-sheet.js --dry-run        # compute + print, no writes
//   node src/sync-sheet.js --limit=5        # only write the first N matches
//   node src/sync-sheet.js --source=data/results-news.json

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import {
  DIR,
  SYNC_SPREADSHEET_ID, SYNC_SHEET_GID, SYNC_KEY_PATH, SYNC_STATE_PATH,
  SYNC_STATUS_COL, SYNC_ISSUES_COL, SYNC_ISSUES_MAX, SYNC_BATCH_SIZE, SYNC_BATCH_DELAY,
} from '../config.js';
import { getAccessToken } from './google-auth.js';

function ordinal(n) {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  return `${n}${{ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'}`;
}

// Thai short labels for known check ids — covers all three scoring shapes
// this tool has produced (main WEIGHTS, the new-criteria pilot, WEIGHTS_NEWS).
const CHECK_LABELS_TH = {
  headings: 'หัวข้อไม่ตรง',
  links: 'ลิงก์ขาด',
  text: 'เนื้อหาไม่ครบ',
  meta: 'Meta ไม่ตรง',
  accordions: 'Accordion ไม่ครบ',
  headerFooter: 'เมนูบน/ล่างหาย',
  headerMenu: 'เมนูบนไม่ครบ',
  footerMenu: 'เมนูล่างไม่ครบ',
  components: 'Component ไม่ครบ',
  contentLength: 'เนื้อหาสั้น/ยาวผิดปกติ',
  missingText: 'เนื้อหาหาย',
  missingKeywords: 'คำสำคัญหาย',
  missingImage: 'รูปหาย',
  thaiBalance: 'ภาษาไทย/อังกฤษไม่สมดุล',
  title: 'หัวข้อข่าวไม่ตรง',
  publishDate: 'วันที่ไม่ตรง',
  content: 'เนื้อหาข่าวไม่ครบ',
  images: 'รูปข่าวหาย',
  breadcrumbShare: 'Breadcrumb/ปุ่มแชร์หาย',
  error: 'หน้า error (404/blocked)',
};

// aemIssues entries don't carry a check id, so match by known label text.
const AEM_ISSUE_LABELS_TH = [
  [/leaked.*content.*path/i, 'หลุด path ภายใน AEM'],
  [/missing login/i, 'ปุ่ม login หาย'],
  [/missing language switcher/i, 'ปุ่มเปลี่ยนภาษาหาย'],
  [/missing social icons/i, 'ไอคอน social หาย'],
  [/broken links/i, 'ลิงก์พัง'],
  [/thai\/english balance differs/i, 'ภาษาไทย/อังกฤษไม่สมดุล'],
  [/image distortion/i, 'รูปเพี้ยน/สัดส่วนผิด'],
  [/page load failed/i, 'โหลดหน้าไม่สำเร็จ'],
];

function thaiIssueLabel(item) {
  if (item.id && CHECK_LABELS_TH[item.id]) return CHECK_LABELS_TH[item.id];
  for (const [re, th] of AEM_ISSUE_LABELS_TH) if (re.test(item.label || '')) return th;
  return item.label || '';
}

// Concise Thai summary — failed checks (which carry an id) + AEM-specific
// issues, deduplicated, capped at SYNC_ISSUES_MAX.
function issuesSummary(p) {
  const items = [...(p.checks || []).filter(c => !c.passed), ...(p.aemIssues || [])];
  const uniq = [...new Set(items.map(thaiIssueLabel).filter(Boolean))];
  if (!uniq.length) return '';
  const shown = uniq.slice(0, SYNC_ISSUES_MAX);
  const suffix = uniq.length > SYNC_ISSUES_MAX ? ` +${uniq.length - SYNC_ISSUES_MAX} รายการ` : '';
  return shown.join(', ') + suffix;
}

function quoteSheetName(name) {
  return /[\s'!]/.test(name) ? `'${name.replace(/'/g, "''")}'` : name;
}

async function sheetsFetch(token, path, opts = {}) {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SYNC_SPREADSHEET_ID}${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, ...(opts.headers || {}) },
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Sheets API ${path} failed: ${res.status} ${JSON.stringify(json)}`);
  return json;
}

async function main() {
  const sourceArg = process.argv.find(a => a.startsWith('--source='))?.split('=')[1];
  const RESULTS_PATH = sourceArg || `${DIR.data}/results.json`;
  const limit = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] || '0', 10);
  const dryRun = process.argv.includes('--dry-run');

  if (!existsSync(RESULTS_PATH)) throw new Error(`Missing ${RESULTS_PATH}. Run 'npm run compare' first.`);
  if (!existsSync(SYNC_KEY_PATH)) throw new Error(`Missing service-account key at ${SYNC_KEY_PATH}. See README "Sheet sync".`);

  const raw = JSON.parse(await readFile(RESULTS_PATH, 'utf8'));
  const pages = (raw.pages || []).filter(Boolean);
  const generatedAt = raw.generatedAt || null;

  let syncState = {};
  if (existsSync(SYNC_STATE_PATH)) {
    try { syncState = JSON.parse(await readFile(SYNC_STATE_PATH, 'utf8')); } catch { /* ignore corrupt state file */ }
  }
  const prior = syncState[RESULTS_PATH]; // { generatedAt, round } | undefined
  const isNewRun = !prior || prior.generatedAt !== generatedAt;
  const round = isNewRun ? (prior?.round || 0) + 1 : prior.round;
  const statusLabel = `${ordinal(round)} Validation`;
  console.log(isNewRun
    ? `🆕 New compare run (generatedAt ${generatedAt}) — round ${round} (${statusLabel}) will be written to every synced row.`
    : `↩️  Same compare run as last sync — staying at round ${round} (${statusLabel}); Open Issues still refreshes.`);

  console.log('🔑 Authenticating with service account...');
  const token = await getAccessToken(SYNC_KEY_PATH, 'https://www.googleapis.com/auth/spreadsheets');

  console.log(`📄 Resolving sheet name for gid=${SYNC_SHEET_GID}...`);
  const meta = await sheetsFetch(token, '?fields=sheets.properties');
  const sheetProps = meta.sheets.map(s => s.properties).find(p => p.sheetId === SYNC_SHEET_GID);
  if (!sheetProps) throw new Error(`No sheet with gid=${SYNC_SHEET_GID} found in spreadsheet ${SYNC_SPREADSHEET_ID}`);
  const quotedSheet = quoteSheetName(sheetProps.title);

  console.log(`📥 Reading URL column from "${sheetProps.title}"...`);
  const colRange = `${quotedSheet}!A1:A${sheetProps.gridProperties.rowCount}`;
  const colData = await sheetsFetch(token, `/values/${encodeURIComponent(colRange)}`);
  const urlToRow = new Map();
  (colData.values || []).forEach((row, i) => {
    const url = (row[0] || '').trim();
    if (url && url.startsWith('http')) urlToRow.set(url, i + 1); // 1-indexed row
  });
  console.log(`   Found ${urlToRow.size} URL row(s) in sheet`);

  // Match results to sheet rows by URL (not position) and compute values.
  const updates = [];
  const notFound = [];
  for (const p of pages) {
    const row = urlToRow.get((p.prodUrl || '').trim());
    if (!row) { notFound.push(p.prodUrl); continue; }
    updates.push({ id: p.id, prodUrl: p.prodUrl, row, status: statusLabel, issues: issuesSummary(p) });
  }
  const limited = limit > 0 ? updates.slice(0, limit) : updates;

  console.log(`🧮 Computed ${updates.length} update(s)${notFound.length ? ` · ${notFound.length} page(s) not found in sheet (skipped)` : ''}`);

  if (dryRun) {
    console.log('\n--dry-run: no writes performed. Sample:');
    limited.slice(0, 10).forEach(u => console.log(`   row ${u.row} · ${u.status} · ${u.issues || '(ไม่มีปัญหา)'} · ${u.prodUrl}`));
    if (notFound.length) console.log(`\n⚠️  Not found in sheet (first 10): ${notFound.slice(0, 10).join(', ')}`);
    return;
  }

  console.log(`✍️  Writing ${limited.length} row(s) to ${SYNC_STATUS_COL}:${SYNC_ISSUES_COL}...`);
  for (let i = 0; i < limited.length; i += SYNC_BATCH_SIZE) {
    const chunk = limited.slice(i, i + SYNC_BATCH_SIZE);
    const data = chunk.map(u => ({
      range: `${quotedSheet}!${SYNC_STATUS_COL}${u.row}:${SYNC_ISSUES_COL}${u.row}`,
      values: [[u.status, u.issues]],
    }));
    await sheetsFetch(token, '/values:batchUpdate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ valueInputOption: 'RAW', data }),
    });
    console.log(`   chunk ${Math.floor(i / SYNC_BATCH_SIZE) + 1}: ${chunk.length} row(s) updated`);
    if (i + SYNC_BATCH_SIZE < limited.length) await new Promise(r => setTimeout(r, SYNC_BATCH_DELAY));
  }

  syncState[RESULTS_PATH] = { generatedAt, round };
  await writeFile(SYNC_STATE_PATH, JSON.stringify(syncState, null, 2), 'utf8');

  console.log(`✅ Synced ${limited.length} row(s) to sheet · round ${round} (${statusLabel}).`);
  if (notFound.length) console.log(`⚠️  ${notFound.length} page(s) from results.json had no matching URL in the sheet.`);
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
