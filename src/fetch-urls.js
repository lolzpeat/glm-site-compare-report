// Download the page-list CSV from Google Sheets and write a clean urls.csv.
//
// The sheet has a title row (1), a blank row (2), then headers (3):
//   A=URL (production)  B=Migrated Prod URL (AEM)  D=Category  E=Sub-Category
// We emit one row per page pair: prodUrl, aemUrl, category, subCategory.

import { writeFile } from 'node:fs/promises';
import { DIR } from '../config.js';

// Minimal CSV field parser: handles quoted fields with embedded commas/newlines.
function parseCsv(text) {
  const rows = [];
  let field = '';
  let row = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }   // escaped quote
        else inQuotes = false;
      } else field += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (ch === '\r') { /* skip */ }
      else field += ch;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function csvEscape(value) {
  if (value == null) return '';
  const v = String(value);
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

async function main() {
  const limit = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] || '0', 10);
  const gidArg = process.argv.find(a => a.startsWith('--gid='))?.split('=')[1];
  const outputArg = process.argv.find(a => a.startsWith('--output='))?.split('=')[1];

  // Build sheet URL — default gid or custom (for News & Media tab).
  const gid = gidArg || '1796448275';
  const sheetUrl = `https://docs.google.com/spreadsheets/d/1iwZ4lj3RfLM1aCGSeGUqbCoI-R8PWuzE/export?format=csv&gid=${gid}`;
  const OUT = outputArg || `${DIR.data}/urls${gidArg ? '-' + gidArg : ''}.csv`;

  console.log(`⬇️  Fetching sheet (gid=${gid}): ${sheetUrl}`);
  const res = await fetch(sheetUrl, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Sheet fetch failed: HTTP ${res.status}`);
  const text = await res.text();
  const rows = parseCsv(text);

  // Find the header row — col A might be "URL" (main) or "Article URL" (news).
  let headerIdx = rows.findIndex(r => r[0] && (r[0].trim() === 'URL' || r[0].trim() === 'Article URL'));
  if (headerIdx < 0) throw new Error('Could not find header row (col A === "URL" or "Article URL")');
  const header = rows[headerIdx];
  console.log(`   Header row ${headerIdx + 1}: [${header.slice(0, 6).map((h,i)=>`${'ABCDE'[i]}=${h}`).join(', ')}]`);

  const col = (name) => header.findIndex(h => h && h.trim() === name);
  // Main sheet: URL / Migrated Prod URL. News sheet: Article URL / AEM Path.
  const iUrl = col('URL') >= 0 ? col('URL') : col('Article URL');
  const iMig = col('Migrated Prod URL') >= 0 ? col('Migrated Prod URL') : col('AEM Path');
  // Category/Sub-Category: prefer header name, but fall back to column position
  // (D=3, E=4) — the sheet sometimes has data in column D without a header label.
  const iCat = col('Category') >= 0 ? col('Category') : 3;
  const iSub = col('Sub-Category') >= 0 ? col('Sub-Category') : 4;

  const pairs = [];
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    const prodUrl = (row[iUrl] || '').trim();
    const aemUrl = (row[iMig] || '').trim();
    if (!prodUrl || !prodUrl.startsWith('http')) continue;       // skip blanks/notes
    pairs.push({
      prodUrl,
      aemUrl: aemUrl || '',
      category: (row[iCat] || '').trim(),
      subCategory: (row[iSub] || '').trim(),
    });
  }

  const limited = limit > 0 ? pairs.slice(0, limit) : pairs;
  const csv = [
    'prodUrl,aemUrl,category,subCategory',
    ...limited.map(p => [csvEscape(p.prodUrl), csvEscape(p.aemUrl), csvEscape(p.category), csvEscape(p.subCategory)].join(',')),
  ].join('\n');

  await writeFile(OUT, csv, 'utf8');
  console.log(`✅ Wrote ${limited.length} URL pair(s) → ${OUT}` + (limit > 0 ? ` (limited from ${pairs.length})` : ` (of ${pairs.length} total)`));
}

main().catch(e => { console.error('❌', e); process.exit(1); });
