// Build the meta inventory dashboard (overview) + per-page drill-down HTML.
//
// Reads data/meta-manual.json (produced by src/scrape-meta.js) and renders:
//   output/meta-dashboard.html  — coverage cards, per-field bars, filterable table
//   output/meta-pages/{id}.html — per-page 5-field detail (single-column, prod only)
//
// This is NOT a parity comparison — there's no scoring. It's an inventory of
// what meta each production page exposes, for SEO audit. Thai copy matches the
// other dashboards; code/comments are English (per project convention).
//
// Usage:
//   node src/build-meta-dashboard.js                # default: data/meta-manual.json
//   node src/build-meta-dashboard.js --source=X.json

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DIR } from '../config.js';

const RESULTS_PATH = process.argv.find(a => a.startsWith('--source='))?.split('=')[1] || `${DIR.data}/meta-manual.json`;
const OUT = DIR.output;
const PAGES_DIR = join(OUT, 'meta-pages');
const DASH_NAME = 'meta-dashboard.html';
const PAGES_DIR_NAME = 'meta-pages';

// The 5 user-requested fields, in display order. Bonus fields (canonical,
// publishDate, section) are shown in the detail page but not counted in coverage.
const META_FIELDS = [
  { key: 'title',       label: 'title',       th: 'title' },
  { key: 'description', label: 'description', th: 'description' },
  { key: 'ogTitle',     label: 'og:title',    th: 'og:title' },
  { key: 'ogImage',     label: 'og:image',    th: 'og:image' },
  { key: 'keywords',    label: 'keywords',    th: 'keywords' },
];

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function main() {
  if (!existsSync(RESULTS_PATH)) throw new Error(`Missing ${RESULTS_PATH}. Run 'npm run scrape:meta' first.`);
  const raw = JSON.parse(await readFile(RESULTS_PATH, 'utf8'));
  const pages = (raw.pages || []).filter(Boolean);

  await mkdir(PAGES_DIR, { recursive: true });

  // --- Coverage stats ---
  const total = pages.length;
  const scraped = pages.filter(p => p.meta);
  const blocked = pages.filter(p => p.errorType === 'blocked').length;
  const fieldCov = META_FIELDS.map(f => ({ ...f, count: scraped.filter(p => p.meta[f.key]).length }));
  const withAll = scraped.filter(p => META_FIELDS.every(f => p.meta[f.key])).length;
  const withNone = scraped.filter(p => !META_FIELDS.some(f => p.meta[f.key])).length;
  const partial = scraped.length - withAll - withNone;

  // --- Row data for the filterable table ---
  const rowData = pages.map(p => {
    const meta = p.meta || {};
    const cov = META_FIELDS.filter(f => meta[f.key]).length;
    return {
      id: p.id,
      path: (p.prodUrl || '').replace('https://www.bangkokbank.com', '') || '(no url)',
      category: p.category || '',
      subCategory: p.subCategory || '',
      sheetStatus: p.sheetStatus || '',
      coverage: p.meta ? cov : -1, // -1 = blocked/error, renders as a badge
      blocked: p.errorType === 'blocked',
      fields: META_FIELDS.map(f => ({ key: f.key, has: !!meta[f.key] })),
    };
  });

  const dashHtml = renderDashboard({
    total, scrapedCount: scraped.length, blocked, fieldCov, withAll, partial, withNone,
    rowData, generatedAt: raw.generatedAt,
  });
  await writeFile(`${OUT}/${DASH_NAME}`, dashHtml, 'utf8');

  let built = 0;
  for (const p of pages) {
    const html = renderPage(p, pages.length);
    await writeFile(`${PAGES_DIR}/${p.id}.html`, html, 'utf8');
    built++;
  }

  console.log(`✅ Meta dashboard → ${OUT}/${DASH_NAME}`);
  console.log(`   ${built} drill-down pages → ${PAGES_DIR}/`);
  console.log(`   ${scraped.length}/${total} scraped · ${blocked} blocked · meta-complete ${withAll}`);
}

// ─── Dashboard (overview) HTML ──────────────────────────────────────────────
function renderDashboard({ total, scrapedCount, blocked, fieldCov, withAll, partial, withNone, rowData, generatedAt }) {
  const pct = (n) => total > 0 ? Math.round((n / total) * 100) : 0;
  const covBars = fieldCov.map(f => {
    const p = pct(f.count);
    const cls = p >= 85 ? 'good' : p >= 60 ? 'mid' : 'bad';
    return `<div class="cov-item">
      <div class="cov-lbl">${esc(f.label)} <span class="cov-num">${f.count}/${total} (${p}%)</span></div>
      <div class="cov-bar"><div class="cov-fill ${cls}" style="width:${p}%"></div></div>
    </div>`;
  }).join('');

  return `<!DOCTYPE html><html lang="th"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>BBL Production Meta Inventory</title>
<style>${DASHBOARD_CSS}</style></head><body>
<nav class="topnav">
  <a href="dashboard.html">📊 Dashboard หลัก</a>
  <a href="news-dashboard.html">📰 News & Media</a>
  <a href="meta-dashboard.html" class="active">🏷️ Meta Inventory</a>
  <a href="criteria.html">📋 เกณฑ์ตรวจจับ</a>
</nav>
<div class="wrap">

<header>
  <h1>Bangkok Bank — Production Meta Inventory</h1>
  <p class="meta">Scrape title / description / og:title / og:image / keywords จาก Production (www.bangkokbank.com) · ไม่ใช่การตรวจเทียบ parity · ${total} หน้า · ${generatedAt ? new Date(generatedAt).toLocaleString('th-TH') : '—'}</p>
</header>

<section class="cards">
  <div class="card big"><div class="num">${total}</div><div class="lbl">TOTAL PAGES</div></div>
  <div class="card"><div class="num good">${withAll}</div><div class="lbl">META ครบ 5/5</div></div>
  <div class="card"><div class="num mid">${partial}</div><div class="lbl">META ขาดบางฟิลด์</div></div>
  <div class="card"><div class="num bad">${withNone}</div><div class="lbl">META ขาดทั้งหมด</div></div>
  <div class="card"><div class="num ${blocked > 0 ? 'bad' : 'good'}">${blocked}</div><div class="lbl">BLOCKED (WAF)</div></div>
</section>

<section class="panel">
  <h2>Coverage ต่อฟิลด์</h2>
  <div class="cov-grid">${covBars}</div>
</section>

<section class="panel">
  <div class="toolbar">
    <h2 style="margin:0">Page Detail</h2>
    <div class="filters">
      <input type="search" id="filter" placeholder="Filter path or category…" oninput="render()">
      <select id="categoryFilter" onchange="onCategoryChange()">
        <option value="">All categories</option>
      </select>
      <select id="statusFilter" onchange="render()">
        <option value="">All statuses</option>
        <option value="blocked">Blocked</option>
        <option value="complete">Meta ครบ 5/5</option>
        <option value="partial">META ขาดบางฟิลด์</option>
        <option value="none">META ขาดทั้งหมด</option>
      </select>
      <label class="cb"><input type="checkbox" id="missingOnly" onchange="render()"> ขาด meta เท่านั้น</label>
    </div>
  </div>
  <table class="pages-table" id="pagesTable">
    <thead><tr>
      <th>#</th>
      <th class="sortable" data-sort="coverage" onclick="sortBy('coverage')">Meta ↕</th>
      <th class="sortable" data-sort="path" onclick="sortBy('path')">Page ↕</th>
      <th class="sortable" data-sort="category" onclick="sortBy('category')">Category ↕</th>
      <th class="sortable" data-sort="subCategory" onclick="sortBy('subCategory')">Sub-Category ↕</th>
      <th>Fields</th>
      <th>Sheet Status</th>
    </tr></thead>
    <tbody id="rowsBody"></tbody>
  </table>
  <div class="pagination" id="pagination"></div>
</section>

<footer class="foot">Production meta inventory · ไม่มีการให้คะแนน parity (เป็นการ scrape ล้วนๆ ไม่ใช่การตรวจเทียบ) · Click any row to drill down</footer>
</div>
<script>
const ROWS = ${JSON.stringify(rowData)};
const PAGE_SIZE = 25;
let sortKey = 'id', sortDir = 1;
let currentPage = 1;
let filteredRows = [];

function escapeHtml(s){ return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function covBadge(c, blocked){
  if (blocked) return '<span class="badge blocked">BLOCKED</span>';
  if (c < 0) return '<span class="badge err">ERROR</span>';
  const cls = c === 5 ? 'pass' : c === 0 ? 'fail' : 'warn';
  return '<span class="badge '+cls+'">'+c+'/5</span>';
}
function fieldDots(fields){
  return fields.map(f => '<span class="fdot '+(f.has?'on':'off')+'" title="'+f.key+'">'+(f.has?'●':'○')+'</span>').join('');
}

(function initDropdowns(){
  const cats = [...new Set(ROWS.map(r => r.category).filter(Boolean))].sort();
  const sel = document.getElementById('categoryFilter');
  cats.forEach(c => { const o = document.createElement('option'); o.value = o.textContent = c; sel.appendChild(o); });
})();

function getFiltered(){
  const f = document.getElementById('filter').value.toLowerCase();
  const cf = document.getElementById('categoryFilter').value;
  const sf = document.getElementById('statusFilter').value;
  const mo = document.getElementById('missingOnly').checked;
  let rows = ROWS.filter(r =>
    (!f || r.path.toLowerCase().includes(f) || r.category.toLowerCase().includes(f) || r.subCategory.toLowerCase().includes(f)) &&
    (!cf || r.category === cf) &&
    (!sf || (sf==='blocked' && r.blocked) || (sf==='complete' && r.coverage===5) || (sf==='partial' && r.coverage>0 && r.coverage<5) || (sf==='none' && r.coverage===0)) &&
    (!mo || (r.coverage>=0 && r.coverage<5))
  );
  rows.sort((a,b) => {
    let va = a[sortKey], vb = b[sortKey];
    if (sortKey === 'id' || sortKey === 'coverage') return (parseInt(va,10) - parseInt(vb,10)) * sortDir;
    if (typeof va === 'string') return va.localeCompare(vb) * sortDir;
    return (va - vb) * sortDir;
  });
  return rows;
}

function render(){
  filteredRows = getFiltered();
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = totalPages;
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageRows = filteredRows.slice(start, start + PAGE_SIZE);

  document.getElementById('rowsBody').innerHTML = pageRows.map(function(r){
    const rowNum = start + pageRows.indexOf(r) + 1;
    return '<tr class="row '+(r.blocked?'blocked':r.coverage===5?'complete':'')+'" data-href="${PAGES_DIR_NAME}/'+r.id+'.html" style="cursor:pointer">' +
      '<td class="row-num">'+rowNum+'</td>' +
      '<td>'+covBadge(r.coverage, r.blocked)+'</td>' +
      '<td class="path">'+escapeHtml(r.path)+'</td>' +
      '<td>'+escapeHtml(r.category||'—')+'</td>' +
      '<td>'+escapeHtml(r.subCategory||'—')+'</td>' +
      '<td class="fdots-cell">'+fieldDots(r.fields)+'</td>' +
      '<td>'+(r.sheetStatus?'<span class="sheetstatus">'+escapeHtml(r.sheetStatus)+'</span>':'<span class="muted">—</span>')+'</td>' +
    '</tr>';
  }).join('') || '<tr><td colspan=7 class="muted">No matching pages</td></tr>';

  renderPagination(totalPages);
}

function renderPagination(totalPages){
  const p = document.getElementById('pagination');
  if (totalPages <= 1) { p.innerHTML = '<span class="page-info">'+filteredRows.length+' page(s)</span>'; return; }
  let html = '<span class="page-info">'+filteredRows.length+' pages · page '+currentPage+'/'+totalPages+'</span> ';
  html += '<button class="page-btn" onclick="goPage(1)" '+(currentPage===1?'disabled':'')+'>⟪</button> ';
  html += '<button class="page-btn" onclick="goPage('+(currentPage-1)+')" '+(currentPage===1?'disabled':'')+'>‹</button> ';
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || Math.abs(i - currentPage) <= 1) {
      html += '<button class="page-btn'+(i===currentPage?' active':'')+'" onclick="goPage('+i+')">'+i+'</button> ';
    } else if (i === 2 || i === totalPages - 1) {
      html += '<span class="page-ellipsis">…</span> ';
    }
  }
  html += '<button class="page-btn" onclick="goPage('+(currentPage+1)+')" '+(currentPage===totalPages?'disabled':'')+'>›</button> ';
  html += '<button class="page-btn" onclick="goPage('+totalPages+')" '+(currentPage===totalPages?'disabled':'')+'>⟫</button>';
  p.innerHTML = html;
}

function goPage(n){
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  currentPage = Math.max(1, Math.min(n, totalPages));
  render();
  document.querySelector('.pages-table').scrollIntoView({ behavior:'smooth', block:'start' });
}
function onCategoryChange(){ currentPage = 1; render(); }
function sortBy(k){ if(sortKey===k) sortDir*=-1; else { sortKey=k; sortDir=(k==='coverage')?-1:1; } render(); }

document.getElementById('rowsBody').addEventListener('click', function(e){
  var tr = e.target.closest('tr[data-href]');
  if (tr) window.location.href = tr.getAttribute('data-href');
});
render();
</script>
</body></html>`;
}

// ─── Per-page drill-down HTML ───────────────────────────────────────────────
function renderPage(p, total) {
  const meta = p.meta || {};
  const blocked = p.errorType === 'blocked';
  const path = (p.prodUrl || '').replace('https://www.bangkokbank.com', '') || 'Page';
  const cov = META_FIELDS.filter(f => meta[f.key]).length;

  const fieldRow = (label, val, type) => {
    if (!val) return `<div class="frow miss"><span class="flbl">${label}</span><span class="fval muted">— ไม่มี</span></div>`;
    let body;
    if (type === 'image') body = `<a href="${esc(val)}" target="_blank">${esc(val)}</a>${val.match(/\.(jpg|jpeg|png|gif|webp)/i) ? `<br><img src="${esc(val)}" class="og-preview" loading="lazy" onerror="this.style.display='none'">` : ''}`;
    else if (type === 'keywords') body = val.split(',').map(k => `<span class="kw">${esc(k.trim())}</span>`).join('');
    else body = esc(val);
    return `<div class="frow ok"><span class="flbl">${label}</span><span class="fval">${body}</span></div>`;
  };

  const mainFields = META_FIELDS.map(f => {
    const type = f.key === 'ogImage' ? 'image' : f.key === 'keywords' ? 'keywords' : 'text';
    return fieldRow(f.label, meta[f.key], type);
  }).join('');

  // Bonus fields (not in the 5, but free from the same query) — shown collapsed.
  const bonusFields = [
    ['canonical', meta.canonical, 'text'],
    ['publishDate', meta.publishDate, 'text'],
    ['article:section', meta.section, 'text'],
  ].map(([l, v, t]) => fieldRow(l, v, t)).join('');
  const bonusBlock = bonusFields ? `<details class="bonus"><summary>ฟิลด์เสริม (canonical / publishDate / section)</summary><div class="bonus-body">${bonusFields}</div></details>` : '';

  return `<!DOCTYPE html><html lang="th"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Meta #${esc(p.id)} — ${esc(path)}</title>
<style>${PAGE_CSS}</style></head><body>
<nav class="topnav">
  <a href="../dashboard.html">📊 Dashboard หลัก</a>
  <a href="../news-dashboard.html">📰 News & Media</a>
  <a href="../meta-dashboard.html" class="active">🏷️ Meta Inventory</a>
  <a href="../criteria.html">📋 เกณฑ์ตรวจจับ</a>
</nav>
<div class="wrap">
<a href="../${DASH_NAME}" class="back">← Back to meta dashboard</a>
<header>
  <h1>${esc(path)}</h1>
  <p class="meta">${esc(p.category || '—')} ${p.subCategory ? '· ' + esc(p.subCategory) : ''} · Page ${esc(p.id)} of ${total}${p.sheetStatus ? ' · sheet: ' + esc(p.sheetStatus) : ''}</p>
</header>

<section class="score-row">
  <div class="score ${blocked ? 'parity-bad' : cov === 5 ? 'parity-good' : cov === 0 ? 'parity-bad' : 'parity-mid'}">
    <span class="big">${blocked ? '🛑' : cov}</span><span class="pct">${blocked ? '' : '/5'}</span>
    <div class="lbl">${blocked ? 'BLOCKED' : 'META FIELDS'}</div>
  </div>
  <div class="urls">
    <div><b class="tag src">PRODUCTION</b> <a href="${esc(p.prodUrl)}" target="_blank">${esc(p.prodUrl)}</a></div>
    ${blocked ? `<div class="err">⚠ โดน WAF block — ลอง re-run หรือเช็ค rate limit</div>` : ''}
    ${p.error && !blocked ? `<div class="err">⚠ ${esc(p.error)}</div>` : ''}
  </div>
</section>

<section class="panel">
  <h2>Meta Tags <span class="muted" style="font-weight:400;font-size:12px">— จาก Production (ต้นฉบับ)</span></h2>
  ${mainFields}
  ${bonusBlock}
</section>

<footer class="foot"><a href="../${DASH_NAME}">← Back to meta dashboard</a></footer>
</div>
</body></html>`;
}

// ─── CSS ────────────────────────────────────────────────────────────────────
// Mirrors the look of build-dashboard.js (same nav, card, table, badge styles)
// so the meta dashboard reads as part of the same family. Self-contained here
// rather than shared, matching how each builder owns its own CSS constant.
const SHARED = `
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family:-apple-system,"Segoe UI","Sukhumvit Set",Roboto,sans-serif; color:#1a1a1a; background:#f4f5f7; line-height:1.5; }
.topnav { display:flex; gap:4px; background:#1a2b5c; padding:0 40px; position:sticky; top:0; z-index:100; box-shadow:0 2px 8px rgba(0,0,0,.15); }
.topnav a { color:rgba(255,255,255,.7); text-decoration:none; padding:12px 18px; font-size:14px; font-weight:500; border-bottom:3px solid transparent; transition:all .15s; }
.topnav a:hover { color:#fff; background:rgba(255,255,255,.1); }
.topnav a.active { color:#fff; border-bottom-color:#4dabf7; font-weight:600; }
.wrap { max-width:1200px; margin:0 auto; padding:32px 40px; }
h1 { font-size:22px; color:#1a2b5c; }
h2 { font-size:16px; color:#1a2b5c; margin-bottom:12px; }
.meta { color:#777; font-size:12px; margin-top:3px; }
.panel { background:#fff; border-radius:10px; padding:18px 20px; margin:14px 0; box-shadow:0 1px 4px rgba(0,0,0,.06); }
.foot { margin-top:30px; padding-top:14px; border-top:1px solid #e0e0e0; color:#999; font-size:11px; text-align:center; }
.muted { color:#aaa; }
.err { color:#c00; font-weight:600; }
.parity-good { color:#1a6b3c; } .parity-mid { color:#b8860b; } .parity-bad { color:#c00; }
.tag { padding:2px 7px; border-radius:4px; font-size:10px; font-weight:700; color:#fff; margin-right:5px; }
.tag.src { background:#1a2b5c; }
.bad { color:#c00; font-weight:700; }
.ok { color:#1a6b3c; font-weight:700; }
`;

const DASHBOARD_CSS = SHARED + `
.cards { display:flex; gap:12px; margin:16px 0; flex-wrap:wrap; }
.card { flex:1; min-width:140px; background:#fff; border-radius:10px; padding:16px; text-align:center; box-shadow:0 1px 4px rgba(0,0,0,.06); }
.card .num { font-size:28px; font-weight:800; color:#1a2b5c; }
.card .num.good { color:#1a6b3c; } .card .num.mid { color:#b8860b; } .card .num.bad { color:#c00; }
.card.big .num { font-size:42px; }
.card .lbl { font-size:11px; color:#888; margin-top:2px; line-height:1.3; }
.cov-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:10px; }
.cov-item { background:#fafbfc; border:1px solid #eee; border-radius:8px; padding:12px 14px; }
.cov-bar { background:#eee; border-radius:4px; height:8px; margin-top:6px; overflow:hidden; }
.cov-fill { height:100%; border-radius:4px; }
.cov-fill.good { background:#1a6b3c; } .cov-fill.mid { background:#b8860b; } .cov-fill.bad { background:#c00; }
.cov-lbl { font-size:12px; font-weight:600; display:flex; justify-content:space-between; }
.cov-num { color:#888; font-weight:400; }
.toolbar { display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; gap:12px; flex-wrap:wrap; }
.filters { display:flex; gap:8px; align-items:center; font-size:13px; flex-wrap:wrap; }
.filters input[type=search] { padding:5px 9px; border:1px solid #ddd; border-radius:5px; width:200px; }
.filters select { padding:5px 9px; border:1px solid #ddd; border-radius:5px; }
.cb { font-size:12px; color:#666; }
.pages-table { width:100%; border-collapse:collapse; font-size:13px; }
.pages-table th { background:#1a2b5c; color:#fff; padding:8px 10px; text-align:left; font-weight:600; font-size:12px; }
.pages-table th.sortable { cursor:pointer; user-select:none; }
.pages-table th.sortable:hover { background:#243a7a; }
.pages-table td { padding:7px 10px; border-bottom:1px solid #eee; }
.pages-table tr.row { cursor:pointer; transition:background .1s; }
.pages-table tr.row:hover { background:#eef2ff; }
.pages-table td.path { font-family:monospace; font-size:11px; max-width:420px; word-break:break-all; }
.badge { padding:2px 7px; border-radius:4px; font-size:10px; font-weight:700; color:#fff; }
.badge.pass { background:#16a34a; } .badge.warn { background:#ca8a04; } .badge.fail { background:#dc2626; }
.badge.blocked { background:#7c3aed; } .badge.err { background:#6b7280; }
.row-num { color:#aaa; font-size:11px; text-align:center; width:32px; }
.fdots-cell { white-space:nowrap; }
.fdot { font-size:10px; letter-spacing:1px; }
.fdot.on { color:#1a6b3c; } .fdot.off { color:#ddd; }
.sheetstatus { font-size:10px; font-weight:600; padding:2px 7px; border-radius:4px; background:#eef2ff; color:#1a2b5c; white-space:nowrap; }
.pagination { display:flex; align-items:center; gap:4px; justify-content:center; margin-top:12px; padding-top:10px; border-top:1px solid #eee; flex-wrap:wrap; }
.page-info { font-size:12px; color:#888; margin-right:8px; }
.page-btn { padding:4px 9px; border:1px solid #ddd; border-radius:4px; background:#fff; cursor:pointer; font-size:12px; min-width:30px; }
.page-btn:hover:not(:disabled) { background:#1a2b5c; color:#fff; border-color:#1a2b5c; }
.page-btn.active { background:#1a2b5c; color:#fff; border-color:#1a2b5c; font-weight:700; }
.page-btn:disabled { opacity:.4; cursor:default; }
.page-ellipsis { color:#aaa; padding:0 2px; }
`;

const PAGE_CSS = SHARED + `
.back { display:inline-block; font-size:12px; color:#1a2b5c; text-decoration:none; margin-bottom:8px; }
.score-row { display:flex; gap:18px; align-items:center; background:#fff; border-radius:10px; padding:16px 20px; margin:14px 0; box-shadow:0 1px 4px rgba(0,0,0,.06); }
.score { text-align:center; min-width:90px; }
.score .big { font-size:42px; font-weight:800; } .score .pct { font-size:18px; }
.score .lbl { font-size:11px; color:#888; }
.urls { flex:1; font-size:12px; word-break:break-all; }
.urls a { color:#1a2b5c; }
.frow { display:flex; gap:10px; padding:8px 0; border-bottom:1px solid #f6f6f6; font-size:13px; align-items:flex-start; }
.frow:last-child { border-bottom:none; }
.flbl { min-width:100px; font-weight:600; color:#666; flex-shrink:0; }
.fval { flex:1; word-break:break-word; }
.fval.muted { color:#ccc; font-style:italic; }
.frow.miss .flbl { color:#c00; }
.frow.miss .fval::before { content:'✗ '; color:#c00; }
.frow.ok .flbl { color:#1a6b3c; }
.frow.ok .fval::before { content:'✓ '; color:#1a6b3c; }
.kw { display:inline-block; background:#eef2ff; color:#1a2b5c; padding:2px 8px; border-radius:3px; margin:2px; font-size:11px; }
.og-preview { max-width:300px; max-height:180px; margin-top:6px; border:1px solid #ddd; border-radius:4px; }
.bonus { margin-top:14px; border:1px solid #eee; border-radius:6px; }
.bonus summary { cursor:pointer; padding:8px 12px; font-size:12px; color:#666; font-weight:600; list-style:none; }
.bonus summary::-webkit-details-marker { display:none; }
.bonus summary::before { content:'▸ '; }
.bonus[open] summary::before { content:'▾ '; }
.bonus-body { padding:4px 12px 8px; }
`;

main().catch(e => { console.error('❌', e); process.exit(1); });
