// Build the dashboard (overview) + per-page drill-down HTML reports.
// Screenshots are referenced by relative path (no base64 embedding) so the
// dashboard stays small and loads images lazily.
//
// Usage:
//   node src/build-dashboard.js                  # default: data/results.json → output/
//   node src/build-dashboard.js --source=X.json  # custom results file
//   node src/build-dashboard.js --prefix=news    # output to news-* files + news-pages/

import { readFile, writeFile, mkdir, copyFile, readdir, stat, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative, basename, isAbsolute } from 'node:path';
import {
  ROOT, DIR, CRITERIA_GROUPS, CRITERIA_GROUPS_V2, SHOW_SITE_CHROME_PANEL,
  DASHBOARD_PAGE_SIZES, DASHBOARD_PAGE_SIZE_DEFAULT,
} from '../config.js';
import { scoreMenu } from './scoring/checks-structure.js';
import { renderNav } from './nav.js';

// --criteria=v2 renders with the defect-aligned v2 groups (results-v2.json);
// default stays the live groups until promotion.
const GROUPS = process.argv.includes('--criteria=v2') ? CRITERIA_GROUPS_V2 : CRITERIA_GROUPS;

const PASS_THRESHOLD = 85;

// Resolve a stored screenshot path to an absolute filesystem path.
// results.json stores relative-to-ROOT paths (e.g. "data/screenshots/1/prod.jpg")
// so the file is portable across machines/checkouts. Older captures stored
// absolute paths, which we still accept (resolves only if it actually exists;
// a stale absolute path from a moved project returns null and the page renders
// without a screenshot instead of a broken image).
function resolveShot(stored) {
  if (!stored) return null;
  if (isAbsolute(stored)) return existsSync(stored) ? stored : null;
  const abs = join(ROOT, stored);
  return existsSync(abs) ? abs : null;
}

async function main() {
  // Parse CLI args for source results file and output prefix.
  const sourceArg = process.argv.find(a => a.startsWith('--source='));
  const prefixArg = process.argv.find(a => a.startsWith('--prefix='));
  const RESULTS_PATH = sourceArg ? sourceArg.split('=')[1] : `${DIR.data}/results.json`;
  const prefix = prefixArg ? prefixArg.split('=')[1] : '';
  const dashName = prefix ? `${prefix}-dashboard.html` : 'dashboard.html';
  const pagesDirName = prefix ? `${prefix}-pages` : 'pages';
  const shotsDirName = prefix ? `${prefix}-screenshots` : 'screenshots';
  const titleSuffix = prefix ? ` · ${prefix.toUpperCase()}` : '';
  const PAGES_DIR = join(DIR.output, pagesDirName);
  const OUT = DIR.output;

  if (!existsSync(RESULTS_PATH)) throw new Error(`Missing ${RESULTS_PATH}. Run 'npm run compare' first.`);
  const raw = JSON.parse(await readFile(RESULTS_PATH, 'utf8'));
  const pages = raw.pages.filter(Boolean);

  await mkdir(PAGES_DIR, { recursive: true });

  // Copy screenshots into output/ so the whole folder is self-contained for
  // static deployment (Vercel/Netlify).
  const outShots = join(OUT, shotsDirName);
  await mkdir(outShots, { recursive: true });
  for (const p of pages) {
    for (const side of ['prod', 'aem']) {
      const abs = resolveShot(p[side]?.screenshot);
      if (abs) {
        const idDir = join(outShots, p.id);
        await mkdir(idDir, { recursive: true });
        await copyFile(abs, join(idDir, basename(abs))).catch(() => {});
      }
    }
  }

  // Drop drill-downs and screenshot folders for ids no longer in the results
  // file. The build only ever wrote files, so pages removed from the URL list
  // lingered in output/ — and output/ IS the deployed site, so they stayed
  // reachable and were committed. Only orphans are removed; anything this run
  // regenerates is left alone.
  const liveIds = new Set(pages.map(p => String(p.id)));
  const prune = async (dir, isOrphan) => {
    if (!existsSync(dir)) return 0;
    const entries = await readdir(dir);
    let removed = 0;
    for (const name of entries) {
      if (!isOrphan(name)) continue;
      await rm(join(dir, name), { recursive: true, force: true });
      removed++;
    }
    return removed;
  };
  const stalePages = await prune(PAGES_DIR, (n) => n.endsWith('.html') && !liveIds.has(n.replace(/\.html$/, '')));
  const staleShots = await prune(outShots, (n) => !liveIds.has(n));
  if (stalePages || staleShots) {
    console.log(`🧹 removed ${stalePages} stale page(s), ${staleShots} stale screenshot folder(s)`);
  }

  // --- Aggregate stats ---
  const total = pages.length;
  const scored = pages.filter(p => p.parity != null);
  const avg = scored.length ? Math.round(scored.reduce((s, p) => s + p.parity, 0) / scored.length) : 0;
  const passed = scored.filter(p => p.parity >= PASS_THRESHOLD).length;
  const warned = scored.filter(p => p.parity >= 50 && p.parity < PASS_THRESHOLD).length;
  const failed = scored.filter(p => p.parity < 50).length;
  const lowContent = pages.filter(p => p.aem?.metrics?.lowContent).length;
  const buckets = { '90-100': 0, '75-89': 0, '50-74': 0, '0-49': 0 };
  scored.forEach(p => {
    if (p.parity >= 90) buckets['90-100']++;
    else if (p.parity >= 75) buckets['75-89']++;
    else if (p.parity >= 50) buckets['50-74']++;
    else buckets['0-49']++;
  });
  // Category breakdown
  const cats = {};
  pages.forEach(p => {
    const c = p.category || 'Uncategorized';
    if (!cats[c]) cats[c] = { count: 0, sum: 0, failed: 0 };
    cats[c].count++;
    if (p.parity != null) cats[c].sum += p.parity;
    if (p.parity != null && p.parity < PASS_THRESHOLD) cats[c].failed++;
  });

  // --- Build table rows (data for client-side filter/sort) ---
  const rowData = pages.map((p, i) => {
    const shortPath = (p.prodUrl || '').replace('https://www.bangkokbank.com', '') || '(no prod url)';
    const gapCount = (p.gaps?.length || 0) + (p.aemIssues?.length || 0);
    const loadErr = !p.aem?.ok;
    const lowContent = !!p.aem?.metrics?.lowContent;
    const errType = p.errorType || '';
    let status;
    if (errType === 'prod404') status = 'prod404';
    else if (errType === 'aem404') status = 'aem404';
    else if (errType === 'both404') status = 'both404';
    else if (errType === 'blocked') status = 'blocked';
    else status = p.parity >= PASS_THRESHOLD ? 'pass' : p.parity >= 50 ? 'warn' : 'fail';
    return {
      id: p.id,
      path: shortPath,
      category: p.category || '',
      subCategory: p.subCategory || '',
      sheetStatus: p.sheetStatus || '',
      parity: p.parity ?? 0,
      gaps: gapCount,
      status,
      loadError: loadErr,
      lowContent,
      failedGroups: GROUPS
        .filter(g => (p.checks || []).some(c => g.checks.includes(c.id) && !c.passed && !c.insufficient))
        .map(g => g.id),
    };
  });

  // --- Dashboard ---
  const dashHtml = renderDashboard({
    total, avg, passed, warned, failed, lowContent, buckets, cats: Object.entries(cats),
    rowData, generatedAt: raw.generatedAt, titleSuffix,
    pagesDirName, dashName, prefix,
    chrome: SHOW_SITE_CHROME_PANEL ? siteChromeReport(pages) : [],
  });
  await writeFile(`${OUT}/${dashName}`, dashHtml, 'utf8');

  // --- Per-page drill-down ---
  let built = 0;
  for (const p of pages) {
    const html = renderPage(p, pages.length, { pagesDirName, shotsDirName, dashName });
    await writeFile(`${PAGES_DIR}/${p.id}.html`, html, 'utf8');
    built++;
  }

  console.log(`✅ Dashboard → ${OUT}/${dashName}`);
  console.log(`   ${built} drill-down pages → ${PAGES_DIR}/`);
  console.log(`   Avg parity ${avg} · ${passed}/${total} passed`);
}

// ─── Dashboard HTML ────────────────────────────────────────────────────────
// Header/footer menus are site-wide chrome, so comparing them per page reports
// one mega-menu difference as N defects. Group pages by their chrome diff
// instead: normally every page collapses into a single entry, and a second
// entry means some section genuinely ships different chrome — which is the
// finding worth seeing, and is invisible when it is buried in 632 page rows.
function siteChromeReport(pages) {
  const groups = new Map();
  for (const p of pages) {
    // A blocked/404 capture has no chrome to compare — prod returning an
    // Access Denied page reads as "0 labels vs 80", a fake second variant.
    if (p.errorType) continue;
    const prod = p.prod?.metrics, aem = p.aem?.metrics;
    if (!prod?.headerMenus || !aem?.headerMenus) continue;
    const header = scoreMenu(prod.headerMenus, aem.headerMenus);
    const footer = scoreMenu(prod.footerMenus, aem.footerMenus);
    if (header.pass && footer.pass) continue;
    const key = JSON.stringify([header.diff.missing, header.diff.extra, footer.diff.missing, footer.diff.extra]);
    if (!groups.has(key)) groups.set(key, { header, footer, pages: [] });
    groups.get(key).pages.push(p.id);
  }
  return [...groups.values()].sort((a, b) => b.pages.length - a.pages.length);
}

function renderDashboard({ total, avg, passed, warned, failed, lowContent, buckets, cats, rowData, generatedAt, titleSuffix, pagesDirName, dashName, prefix, chrome = [] }) {
  const maxBucket = Math.max(1, ...Object.values(buckets));
  const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const catRows = cats.map(([name, c]) => {
    const avgC = c.count ? Math.round(c.sum / c.count) : 0;
    const pct = avgC >= PASS_THRESHOLD ? 'good' : avgC >= 50 ? 'mid' : 'bad';
    return `<tr><td>${esc(name)}</td><td>${c.count}</td><td class="parity-${pct}"><b>${avgC}</b></td><td>${c.failed}</td></tr>`;
  }).join('');

  return `<!DOCTYPE html><html lang="th"><head><meta charset="utf-8">
<title>BBL Migration Parity Dashboard</title>
<style>${DASHBOARD_CSS}</style></head><body>
${renderNav(prefix || 'priority')}
<div class="wrap">

<header>
  <h1>Bangkok Bank — AEM Migration Parity Dashboard${titleSuffix || ''}</h1>
  <p class="meta">เป้าหมาย: AEM ต้องเหมือน Production มากที่สุด · ${total} หน้า · ${new Date(generatedAt).toLocaleString('th-TH')}</p>
</header>

<section class="cards">
  <div class="card big"><div class="num">${avg}<span class="pct">%</span></div><div class="lbl">PARITY เฉลี่ย</div></div>
  <div class="card"><div class="num good">${passed}</div><div class="lbl">PASS (≥${PASS_THRESHOLD})</div></div>
  <div class="card"><div class="num mid">${warned}</div><div class="lbl">REVIEW (50–${PASS_THRESHOLD - 1})</div></div>
  <div class="card"><div class="num bad">${failed}</div><div class="lbl">FAIL (&lt;50)</div></div>
  <div class="card"><div class="num ${lowContent > 0 ? 'bad' : 'good'}">${lowContent}</div><div class="lbl">AEM LOW CONTENT</div></div>
  <div class="card"><div class="num">${total}</div><div class="lbl">TOTAL</div></div>
</section>
${lowContent > 0 ? `<div class="warn-banner">⚠ <b>${lowContent} หน้า</b> ฝั่ง AEM มีเนื้อหาน้อยผิดปกติ (text &lt; 200 chars) — อาจเป็น lazy-load ที่ยังไม่ render หรือ content หายจริง ควรตรวจด้วยสายตาใน drill-down</div>` : ''}

<section class="two-col">
  <div class="panel">
    <h2>Parity Distribution</h2>
    <div class="bars">
      ${Object.entries(buckets).map(([range, count]) => `
        <div class="bar-row">
          <span class="bar-lbl">${range}</span>
          <div class="bar-track"><div class="bar-fill" style="width:${(count / maxBucket * 100).toFixed(0)}%"></div></div>
          <span class="bar-val">${count}</span>
        </div>`).join('')}
    </div>
  </div>
  <div class="panel">
    <h2>By Category</h2>
    <table class="cat-table"><thead><tr><th>Category</th><th>Pages</th><th>Avg</th><th>&lt;${PASS_THRESHOLD}</th></tr></thead>
    <tbody>${catRows || '<tr><td colspan=4 class="muted">no data</td></tr>'}</tbody></table>
  </div>
</section>

${chrome.length ? `
<section class="panel">
  <h2>🧩 Site chrome — header / footer (ทั้งเว็บ, ไม่คิดคะแนนรายหน้า)</h2>
  <p class="muted" style="margin:4px 0 12px">เมนู header/footer เหมือนกันทุกหน้า จึงรายงานครั้งเดียวตรงนี้ แทนที่จะนับเป็น defect ซ้ำทุกหน้า — แก้ที่ template เดียวจบ</p>
  ${chrome.map(g => `
  <div class="chrome-group">
    <div class="chrome-head">พบบน <b>${g.pages.length}</b> หน้า <span class="muted">(id ${g.pages.slice(0, 12).join(', ')}${g.pages.length > 12 ? `, +${g.pages.length - 12} อื่นๆ` : ''})</span></div>
    ${['header', 'footer'].map(part => {
      const d = g[part].diff;
      if (!d.missing.length && !d.extra.length) return '';
      return `<div class="chrome-part">
        <div class="chrome-part-name">${part} <span class="muted">— prod ${d.prodCount} / AEM ${d.aemCount} labels</span></div>
        ${d.missing.length ? `<div class="chrome-row"><span class="chrome-tag bad">ขาดบน AEM (${d.missing.length})</span><span class="chip-list">${d.missing.map(l => `<span class="chip chip-missing">${esc(l)}</span>`).join('')}</span></div>` : ''}
        ${d.extra.length ? `<div class="chrome-row"><span class="chrome-tag warn">เกินมาบน AEM (${d.extra.length})</span><span class="chip-list">${d.extra.map(l => `<span class="chip chip-extra">${esc(l)}</span>`).join('')}</span></div>` : ''}
      </div>`;
    }).join('')}
  </div>`).join('')}
</section>` : ''}

<section class="panel">
  <div class="toolbar">
    <h2 style="margin:0">Page Detail</h2>
    <div class="filters">
      <input type="search" id="filter" placeholder="Filter path or category…" oninput="render()">
      <select id="categoryFilter" onchange="onCategoryChange()">
        <option value="">All categories</option>
      </select>
      <select id="subCategoryFilter" onchange="render()">
        <option value="">All sub-categories</option>
      </select>
      <select id="statusFilter" onchange="render()">
        <option value="">All statuses</option>
        <option value="prod404">Prod 404</option>
        <option value="aem404">AEM 404</option>
        <option value="both404">Both 404</option>
        <option value="blocked">Blocked</option>
        <option value="pass">Pass</option>
        <option value="warn">Review</option>
        <option value="fail">Fail</option>
      </select>
      <select id="sheetStatusFilter" onchange="render()" style="display:none">
        <option value="">All sheet statuses</option>
      </select>
      <select id="groupFilter" onchange="render()">
        <option value="">หมวดที่ fail: ทั้งหมด</option>
        <option value="template">Template</option>
        <option value="content">Content</option>
        <option value="structure">Structure</option>
      </select>
      <label class="cb"><input type="checkbox" id="gapsOnly" onchange="render()"> Gaps only</label>
    </div>
  </div>
  <table class="pages-table" id="pagesTable">
    <thead><tr>
      <th>#</th>
      <th class="sortable" data-sort="parity" onclick="sortBy('parity')">Parity ↕</th>
      <th class="sortable" data-sort="path" onclick="sortBy('path')">Page ↕</th>
      <th class="sortable" data-sort="category" onclick="sortBy('category')">Category ↕</th>
      <th class="sortable" data-sort="subCategory" onclick="sortBy('subCategory')">Sub-Category ↕</th>
      <th class="sortable" data-sort="gaps" onclick="sortBy('gaps')">Gaps ↕</th>
      <th>Status</th>
    </tr></thead>
    <tbody id="rowsBody"></tbody>
  </table>
  <div class="pagination-bar">
    <label class="page-size">
      แสดง
      <select id="pageSizeFilter" onchange="onPageSizeChange()">
        ${DASHBOARD_PAGE_SIZES.map(s => `<option value="${s}"${s === DASHBOARD_PAGE_SIZE_DEFAULT ? ' selected' : ''}>${s === 'all' ? 'ทั้งหมด' : s}</option>`).join('\n        ')}
      </select>
      แถว
    </label>
    <!-- renderPagination() replaces this element's innerHTML on every render,
         so the page-size control must stay OUTSIDE it. -->
    <div class="pagination" id="pagination"></div>
  </div>
</section>

<footer class="foot">Production = source of truth · AEM = target to fix · Click any row to drill down</footer>
</div>
<script>
const ROWS = ${JSON.stringify(rowData)};
// 'all' is stored as Infinity but never used in arithmetic — see effectivePageSize().
let pageSize = ${DASHBOARD_PAGE_SIZE_DEFAULT};

// Collapses 'all' to a real row count. Infinity must not reach the paging math:
// (currentPage - 1) * Infinity is 0 * Infinity = NaN on page 1, and
// slice(NaN, NaN) returns an empty array — i.e. "show all" would show nothing.
function effectivePageSize() {
  return pageSize === Infinity ? Math.max(filteredRows.length, 1) : pageSize;
}
let sortKey = 'id', sortDir = 1;
let currentPage = 1;
let filteredRows = [];

function onPageSizeChange() {
  const v = document.getElementById('pageSizeFilter').value;
  pageSize = v === 'all' ? Infinity : parseInt(v, 10);
  currentPage = 1;
  render();
}

function statusBadge(s) { return {
  pass:'<span class="badge pass">PASS</span>',
  warn:'<span class="badge warn">REVIEW</span>',
  fail:'<span class="badge fail">FAIL</span>',
  prod404:'<span class="badge prod404">PROD 404</span>',
  aem404:'<span class="badge aem404">AEM 404</span>',
  both404:'<span class="badge both404">BOTH 404</span>',
  blocked:'<span class="badge blocked">BLOCKED</span>',
}[s] || ''; }
function parityClass(p){ return p>=${PASS_THRESHOLD}?'good':p>=50?'mid':'bad'; }
function escapeHtml(s){ return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

// Populate category + sub-category dropdowns from data.
(function initDropdowns() {
  const cats = [...new Set(ROWS.map(r => r.category).filter(Boolean))].sort();
  const catSel = document.getElementById('categoryFilter');
  cats.forEach(c => { const o = document.createElement('option'); o.value = o.textContent = c; catSel.appendChild(o); });
  populateSubCats('');
  // Sheet QA status ("Done" / "Done (with Known issue)") exists only on the
  // priority dataset — the dropdown stays hidden on dashboards without it.
  const sheetStatuses = [...new Set(ROWS.map(r => r.sheetStatus).filter(Boolean))].sort();
  if (sheetStatuses.length) {
    const sel = document.getElementById('sheetStatusFilter');
    sheetStatuses.forEach(s => {
      const n = ROWS.filter(r => r.sheetStatus === s).length;
      const o = document.createElement('option');
      o.value = s; o.textContent = s + ' (' + n + ')';
      sel.appendChild(o);
    });
    sel.style.display = '';
  }
})();

function populateSubCats(cat) {
  const subSel = document.getElementById('subCategoryFilter');
  subSel.innerHTML = '<option value="">All sub-categories</option>';
  const subs = [...new Set(ROWS.filter(r => (!cat || r.category === cat)).map(r => r.subCategory).filter(Boolean))].sort();
  subs.forEach(s => { const o = document.createElement('option'); o.value = o.textContent = s; subSel.appendChild(o); });
}

function onCategoryChange() {
  populateSubCats(document.getElementById('categoryFilter').value);
  currentPage = 1;
  render();
}

function getFiltered() {
  const f = document.getElementById('filter').value.toLowerCase();
  const cf = document.getElementById('categoryFilter').value;
  const sf2 = document.getElementById('subCategoryFilter').value;
  const sf = document.getElementById('statusFilter').value;
  const shf = document.getElementById('sheetStatusFilter').value;
  const gf = document.getElementById('groupFilter').value;
  const go = document.getElementById('gapsOnly').checked;
  let rows = ROWS.filter(r =>
    (!f || r.path.toLowerCase().includes(f) || r.category.toLowerCase().includes(f) || r.subCategory.toLowerCase().includes(f)) &&
    (!cf || r.category === cf) &&
    (!sf2 || r.subCategory === sf2) &&
    (!sf || r.status === sf) &&
    (!shf || r.sheetStatus === shf) &&
    (!gf || (r.failedGroups && r.failedGroups.includes(gf))) &&
    (!go || r.gaps > 0)
  );
  rows.sort((a,b) => {
    let va = a[sortKey], vb = b[sortKey];
    if (sortKey === 'id') return (parseInt(va,10) - parseInt(vb,10)) * sortDir;
    if (typeof va === 'string') return va.localeCompare(vb) * sortDir;
    return (va - vb) * sortDir;
  });
  return rows;
}

function render() {
  filteredRows = getFiltered();
  const size = effectivePageSize();
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / size));
  if (currentPage > totalPages) currentPage = totalPages;
  const start = (currentPage - 1) * size;
  const pageRows = filteredRows.slice(start, start + size);

  document.getElementById('rowsBody').innerHTML = pageRows.map(function(r) {
    const rowNum = start + pageRows.indexOf(r) + 1;
    return '<tr class="row '+r.status+'" data-href="${pagesDirName}/'+r.id+'.html" style="cursor:pointer">' +
      '<td class="row-num">'+rowNum+'</td>' +
      '<td class="parity-'+parityClass(r.parity)+'"><b>'+r.parity+'</b></td>' +
      '<td class="path">'+escapeHtml(r.path)+(r.loadError?' <span class="err">⚠ load error</span>':'')+(r.lowContent?' <span class="err">⚠ low content</span>':'')+'</td>' +
      '<td>'+escapeHtml(r.category||'—')+'</td>' +
      '<td>'+escapeHtml(r.subCategory||'—')+'</td>' +
      '<td>'+(r.gaps>0?'<b class="gapn">'+r.gaps+'</b>':'<span class="muted">—</span>')+'</td>' +
      '<td>'+statusBadge(r.status)+'</td>' +
    '</tr>';
  }).join('') || '<tr><td colspan=7 class="muted">No matching pages</td></tr>';

  renderPagination(totalPages);
}

function renderPagination(totalPages) {
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

function goPage(n) {
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / effectivePageSize()));
  currentPage = Math.max(1, Math.min(n, totalPages));
  render();
  document.querySelector('.pages-table').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function sortBy(k){ if(sortKey===k) sortDir*=-1; else { sortKey=k; sortDir=(k==='parity'||k==='gaps')?-1:1; } render(); }

document.getElementById('rowsBody').addEventListener('click', function(e) {
  var tr = e.target.closest('tr[data-href]');
  if (tr) window.location.href = tr.getAttribute('data-href');
});
render();
</script>
</body></html>`;

}

// ─── Drill-down page HTML ──────────────────────────────────────────────────
function renderPage(p, total, opts = {}) {
  const { pagesDirName = 'pages', shotsDirName = 'screenshots', dashName = 'dashboard.html' } = opts;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const prod = p.prod?.metrics;
  const aem = p.aem?.metrics;
  const hasMetrics = prod && aem;

  // Screenshot src relative to output/pages/{id}.html → ../screenshots/{id}/prod.jpg.
  // Screenshots are copied into output/screenshots/{id}/ (see main()), so the
  // src is just the basename under that dir. resolveShot handles both the
  // current relative-to-ROOT paths and any legacy absolute paths.
  // Must mirror main()'s copy destination exactly: join(outShots, p.id, basename).
  // Deriving it from relative(DIR.screenshots, abs) instead only agreed while
  // every capture wrote to data/screenshots/<id>/. With --shots-dir=<subdir>
  // that relative path gains the subdir ("priority/1/prod.jpg"), producing
  // ../priority-screenshots/priority/1/prod.jpg — a directory that never
  // exists, so every image on the priority dashboard silently 404'd.
  const toRelShot = (stored) => {
    const abs = resolveShot(stored);
    if (!abs) return null;
    return `../${shotsDirName}/${p.id}/${basename(abs)}`;
  };
  const prodShot = toRelShot(p.prod?.screenshot);
  const aemShot = toRelShot(p.aem?.screenshot);

  // Metric diff rows
  // Every row must use the SAME basis its check scores on, or the table
  // contradicts the score. Whole-page numbers did exactly that: page 9 read
  // "Text length 72581 / 7763 ✗" — as if AEM had lost 89% of the content —
  // while contentLength scored 100%, because in MAIN content the two sides are
  // 4141 vs 4130. The gap is chrome plus prod's hidden inline modals.
  const mainScoped = typeof prod.mainTextLength === 'number' && typeof aem.mainTextLength === 'number';
  const imgTotal = (m) => (m.mainImages || []).length + (m.mainBgImages || []).length;
  const bgScoped = Array.isArray(prod.mainBgImages) && Array.isArray(aem.mainBgImages);
  const compScoped = !!(prod.mainComponentCounts && aem.mainComponentCounts);
  const acc = (m) => (compScoped ? m.mainComponentCounts : m.componentCounts || {}).accordion ?? 0;

  const chk = (id) => (p.checks || []).find(c => c.id === id);
  const diffRows = hasMetrics ? [
    metricRowFor('Headings', prod.headingCount, aem.headingCount, chk('headings')),
    metricRowFor('Links', prod.linkCount, aem.linkCount, chk('links')),
    mainScoped
      ? metricRowFor('Text length (เนื้อหาหลัก)', prod.mainTextLength, aem.mainTextLength, chk('contentLength'))
      : metricRowFor('Text length (ทั้งหน้า — capture เก่า)', prod.textLength, aem.textLength, chk('contentLength')),
    metricRowFor(`Images (เนื้อหาหลัก${bgScoped ? ', รวม CSS background' : ', <img> เท่านั้น'})`,
      imgTotal(prod), imgTotal(aem), chk('missingImage')),
    metricRowFor(`Accordions${compScoped ? ' (เนื้อหาหลัก)' : ''}`, acc(prod), acc(aem), chk('template')),
    // Page height was dropped: no check owns it, two renderings are never the
    // same pixel height, and layout is already scored by visualLayout.
    metricRow('Empty accordions', prod.emptyAccordions, aem.emptyAccordions, 0, aem.emptyAccordions, true),
  ].join('') : '';

  // Render each parity check as a row (shared by grouped + fallback rendering).
  const renderCheckRow = (c) => {
    const diffHtml = renderDiffDetails(c, esc);
    const insufficient = !!c.insufficient;
    const statusIcon = insufficient ? '–' : c.passed ? '✓' : '✗';
    const statusCls = insufficient ? 'ins' : c.passed ? 'ok' : 'bad';
    return `
    <details class="check-block ${c.passed ? 'passed' : 'failed'}">
      <summary class="check-row">
        <span class="check-status ${statusCls}">${statusIcon}</span>
        <span class="check-label">${esc(c.label)}${insufficient ? '<span class="ins-tag">insufficient</span>' : ''}</span>
        <span class="check-detail">${esc(c.detail)}</span>
        ${diffHtml ? '<span class="expand-hint">▾</span>' : ''}
      </summary>
      ${diffHtml}
    </details>`;
  };

  // Group checks into GROUPS (Template/Content/Structure, or the v2 defect-
  // aligned groups). Checks whose id matches no group (news-mode checks,
  // error placeholder) fall into an "Other" fallback section so those pages
  // still render.
  const checks = p.checks || [];
  const groupedIds = new Set(GROUPS.flatMap(g => g.checks));
  const subScore = (groupChecks) => {
    let earned = 0, possible = 0;
    for (const c of groupChecks) {
      if (c.insufficient) continue;
      possible += c.weight;
      earned += c.weight * (c.passed ? 1 : (c.partial || 0));
    }
    const pct = possible > 0 ? Math.round((earned / possible) * 100) : 0;
    return { earned, possible, pct };
  };

  const groupBlocks = GROUPS
    .map(g => {
      const gc = checks.filter(c => g.checks.includes(c.id));
      if (!gc.length) return null; // skip empty groups
      const { earned, possible, pct } = subScore(gc);
      return `<div class="group-block">
        <div class="group-head ${g.id}">
          <span>${esc(g.label)}</span>
          <span class="group-pct">${(earned * 100).toFixed(0)}/${(possible * 100).toFixed(0)} · ${pct}%</span>
        </div>
        <div class="checks-list">${gc.map(renderCheckRow).join('')}</div>
      </div>`;
    })
    .filter(Boolean)
    .join('');

  // Fallback: checks whose id is in no group (news checks, 'error' placeholder).
  const otherChecks = checks.filter(c => !groupedIds.has(c.id));
  const otherBlock = otherChecks.length
    ? `<div class="group-block">
        <div class="group-head other"><span>Other checks</span><span class="group-pct">${otherChecks.filter(c => c.passed).length}/${otherChecks.length} passed</span></div>
        <div class="checks-list">${otherChecks.map(renderCheckRow).join('')}</div>
      </div>`
    : '';

  const gapItems = [...(p.gaps || []), ...(p.aemIssues || [])].map(g => {
    const sev = g.severity || (g.weight >= 0.15 ? 'critical' : g.weight >= 0.1 ? 'high' : 'medium');
    return `<li class="gap ${sev}"><span class="sev">${sev}</span> <b>${esc(g.label)}</b> ${esc(g.detail || '')}</li>`;
  }).join('');

  // Broken links list (HTTP errors from AEM link check).
  const brokenLinkRows = (p.brokenLinks || []).map(bl =>
    `<tr><td class="bad">${bl.status}</td><td class="lhref-cell">${esc(bl.url)}</td></tr>`
  ).join('');
  const brokenLinksSection = brokenLinkRows ? `
<section class="panel"><h2>Broken Links on AEM (${(p.brokenLinks||[]).length})</h2>
<table class="links-table"><thead><tr><th>Status</th><th>URL</th></tr></thead><tbody>${brokenLinkRows}</tbody></table></section>` : '';

  const parityClass = p.parity >= PASS_THRESHOLD ? 'good' : p.parity >= 50 ? 'mid' : 'bad';

  return `<!DOCTYPE html><html lang="th"><head><meta charset="utf-8">
<title>Page ${p.id} — ${esc((p.prodUrl || '').split('/').pop())}</title>
<style>${PAGE_CSS}</style></head><body>
${renderNav('', '../')}
<div class="wrap">
<a href="../${dashName}" class="back">← Back to dashboard</a>
<header>
  <h1>${esc((p.prodUrl || '').replace('https://www.bangkokbank.com', '') || 'Page')}</h1>
  <p class="meta">${esc(p.category)} ${p.subCategory ? '· ' + esc(p.subCategory) : ''} · Page ${p.id} of ${total}</p>
</header>

<section class="score-row">
  <div class="score parity-${parityClass}"><span class="big">${p.parity ?? '—'}</span><span class="pct">%</span><div class="lbl">PARITY</div></div>
  <div class="urls">
    <div><b class="tag src">PRODUCTION</b> <a href="${esc(p.prodUrl)}" target="_blank">${esc(p.prodUrl)}</a></div>
    <div><b class="tag tgt">AEM</b> <a href="${esc(p.aemUrl)}" target="_blank">${esc(p.aemUrl)}</a></div>
    ${!p.aem?.ok ? '<div class="err">⚠ AEM page failed to load: ' + esc(p.aem?.error) + '</div>' : ''}
  </div>
</section>

<section class="panel sxs-panel"><h2>Visual Comparison (full-page screenshot) <span class="muted" style="font-weight:400;font-size:12px">— เลื่อนรูปข้างนึง อีกข้างเลื่อนตาม</span></h2>
<div class="sxs sync-scroll">
  <figure>
    <figcaption class="pcap">PRODUCTION (ต้นฉบับ)</figcaption>
    <div class="shot-pane">${prodShot ? `<img src="${prodShot}" loading="lazy" alt="production">` : '<div class="noimg">no screenshot</div>'}</div>
  </figure>
  <figure>
    <figcaption class="acap">AEM (ต้องแก้ให้เหมือนซ้าย)</figcaption>
    <div class="shot-pane">${aemShot ? `<img src="${aemShot}" loading="lazy" alt="aem">` : '<div class="noimg">no screenshot</div>'}</div>
  </figure>
</div></section>

${gapItems ? `
<section class="panel"><h2>Gaps — สิ่งที่ต้องแก้ใน AEM ให้เหมือน Production</h2>
<ul class="gap-list">${gapItems}</ul></section>` : ''}

${hasMetrics && !p.newsMode ? `
<section class="panel"><h2>Metric Comparison</h2>
<table class="diff"><thead><tr><th>Metric</th><th>Production (ต้นฉบับ)</th><th>AEM (ต้องแก้)</th><th>Status</th></tr></thead>
<tbody>${diffRows}</tbody></table></section>` : ''}

${(groupBlocks || otherBlock) ? `
<section class="panel"><h2>Parity Checks <span class="muted" style="font-weight:400;font-size:12px">— คลิกแต่ละแถวเพื่อดูสิ่งที่ขาดไป</span></h2>
<div class="groups">${groupBlocks}${otherBlock}</div></section>` : ''}

${brokenLinksSection}

<footer class="foot"><a href="../${dashName}">← Back to dashboard</a></footer>
</div>
<script>
// Synced scroll: scrolling one screenshot pane scrolls the other proportionally.
(function(){
  var panes = document.querySelectorAll('.sync-scroll .shot-pane');
  if (panes.length < 2) return;
  var a = panes[0], b = panes[1], lock = false;
  var sync = function(src, dst){ return function(){
    if (lock) return; lock = true;
    var sr = src.scrollHeight - src.clientHeight || 1;
    dst.scrollTop = src.scrollTop / sr * (dst.scrollHeight - dst.clientHeight || 0);
    requestAnimationFrame(function(){ lock = false; });
  }; };
  a.addEventListener('scroll', sync(a,b));
  b.addEventListener('scroll', sync(b,a));
})();
</script>
</body></html>`;
}

function metricRow(label, prodVal, aemVal, prodNum, aemNum, lowerIsBetter) {
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let ok;
  if (prodNum != null && aemNum != null) {
    if (lowerIsBetter) ok = aemNum <= prodNum;
    else ok = Math.abs(aemNum - prodNum) <= Math.max(2, prodNum * 0.35);
  } else {
    ok = String(prodVal) === String(aemVal);
  }
  return `<tr><td>${esc(label)}</td><td>${esc(prodVal)}</td><td>${esc(aemVal)}</td><td class="${ok ? 'ok' : 'bad'}">${ok ? '✓' : '✗'}</td></tr>`;
}

// Status taken from the CHECK that owns this metric, never re-derived here.
// metricRow's own ±35% rule silently disagreed with the checks: images scored
// "AEM has ≥80% of prod" (more is fine) while the row demanded symmetry, so a
// complete page showed 2 vs 25 ✗ next to a passing missingImage check.
// `–` marks a metric whose check was excluded from scoring for lack of data.
function metricRowFor(label, prodVal, aemVal, check) {
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const mark = !check ? { cls: 'muted', sym: '·' }
    : check.insufficient ? { cls: 'muted', sym: '–' }
    : check.passed ? { cls: 'ok', sym: '✓' } : { cls: 'bad', sym: '✗' };
  return `<tr><td>${esc(label)}</td><td>${esc(prodVal)}</td><td>${esc(aemVal)}</td><td class="${mark.cls}">${mark.sym}</td></tr>`;
}

// Render the "what's missing" detail for a check's diff object.
// Accepts either a check object `{id, diff, ...}` (preferred) or a bare diff
// (legacy callers). Returns HTML string (empty if no diff or nothing to show).
function renderDiffDetails(check, esc) {
  const diff = check && check.diff !== undefined ? check.diff : check;
  const id = (check && check.id) || '';
  if (!diff) return '';

  // ─── Main-mode (WEIGHTS_MAIN) check renderers, keyed by check id. ──────────
  // These match the diff shapes emitted by compare.js scoreParity().
  // Shape-based branches below still handle news-mode + legacy diffs.
  switch (id) {
    case 'contentLength':
      // diff = { ratio, prodSample, aemSample }
      return `<div class="diff-body">
        <div class="diff-section">
          <div class="diff-title">เทียบเนื้อหา (text sample · ratio ${diff.ratio}%)</div>
          <div class="outline-grid">
            <div class="outline-col">
              <div class="outline-head src">PRODUCTION (ต้นฉบับ)</div>
              <div class="text-sample">${esc(diff.prodSample || '(empty)')}</div>
            </div>
            <div class="outline-col">
              <div class="outline-head tgt">AEM (migrate)</div>
              <div class="text-sample">${esc(diff.aemSample || '(empty)')}</div>
            </div>
          </div>
        </div>
      </div>`;

    case 'missingText':
      // diff = { missingTextBlocks, prodBlockCount }
      if (!diff.missingTextBlocks || !diff.missingTextBlocks.length) {
        return `<div class="diff-body"><div class="diff-section"><div class="diff-title ok">ไม่มี text block ขาด ✓ (${diff.prodBlockCount || 0} blocks)</div></div></div>`;
      }
      return `<div class="diff-body">
        <div class="diff-section">
          <div class="diff-title bad">Text blocks ที่ขาดใน AEM (${diff.missingCount ?? diff.missingTextBlocks.length}/${diff.prodBlockCount || 0})</div>
          <div class="chip-list">${diff.missingTextBlocks.map(t => `<span class="chip chip-missing">${esc(String(t).slice(0, 80))}</span>`).join('')}</div>
          ${(diff.missingCount ?? 0) > diff.missingTextBlocks.length ? `<div class="diff-title">แสดง ${diff.missingTextBlocks.length} รายการแรกจากทั้งหมด ${diff.missingCount}</div>` : ''}
        </div>
      </div>`;

    case 'missingKeywords':
      // diff = { missingKeywords, sharedCount }
      return `<div class="diff-body">
        <div class="diff-section">
          <div class="diff-title">${diff.sharedCount ?? 0} shared <b class="ok">✓</b> · ${diff.missingKeywords?.length || 0} missing <b class="bad">✗</b></div>
          ${diff.missingKeywords?.length ? `<div class="chip-list">${diff.missingKeywords.map(k => `<span class="chip chip-missing">${esc(k)}</span>`).join('')}</div>` : '<div class="diff-title ok">ครบทุกคำสำคัญ ✓</div>'}
        </div>
      </div>`;

    case 'brokenImage':
      // diff = { broken: [{src, alt}], candidateCount }
      if (!diff.broken?.length) return `<div class="diff-body"><div class="diff-section"><div class="diff-title ok">รูปทั้งหมดโหลดได้ ✓ (${diff.candidateCount ?? 0} รูป)</div></div></div>`;
      return `<div class="diff-body"><div class="diff-section">
        <div class="diff-title bad">รูปบน AEM ที่โหลดไม่ขึ้น (${diff.broken.length}/${diff.candidateCount ?? 0})</div>
        <div class="chip-list">${diff.broken.map(b => `<span class="chip chip-missing" title="${esc(b.alt || '')}">${esc(b.src.split('/').pop() || b.src)}</span>`).join('')}</div>
      </div></div>`;

    case 'contentOrder':
      // diff = { sharedCount, inOrder, outOfOrder }
      return `<div class="diff-body"><div class="diff-section">
        <div class="diff-title">${diff.inOrder ?? 0}/${diff.sharedCount ?? 0} block ตามลำดับ prod</div>
        ${diff.outOfOrder?.length ? `<div class="diff-title bad">Block ที่ย้ายตำแหน่ง (${diff.outOfOrder.length})</div>
        <div class="chip-list">${diff.outOfOrder.map(t => `<span class="chip chip-missing">${esc(String(t).slice(0, 80))}</span>`).join('')}</div>` : ''}
      </div></div>`;

    case 'visualLayout': {
      // diff = { match, prodBins, aemBins } — sparkline of the two column profiles
      const spark = (bins, color) => {
        if (!bins?.length) return '';
        const w = 280, h = 44, max = Math.max(...bins, 1e-9);
        const pts = bins.map((v, i) => {
          const px = bins.length > 1 ? (i / (bins.length - 1) * w) : w / 2;
          return `${px.toFixed(1)},${(h - v / max * h).toFixed(1)}`;
        }).join(' ');
        return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="display:block"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5"/></svg>`;
      };
      return `<div class="diff-body"><div class="diff-section">
        <div class="diff-title">การกระจายเนื้อหาแนวนอน — ตรงกัน ${diff.match ?? 0}%</div>
        <div class="outline-grid">
          <div class="outline-col"><div class="outline-head src">PRODUCTION</div>${spark(diff.prodBins, '#2563eb')}</div>
          <div class="outline-col"><div class="outline-head tgt">AEM</div>${spark(diff.aemBins, '#d97706')}</div>
        </div>
      </div></div>`;
    }

    case 'missingDownloadLink':
      // diff = { missing, prodCount, aemCount, prodLinks }
      if (!diff.missing?.length) return `<div class="diff-body"><div class="diff-section"><div class="diff-title ok">ไฟล์ดาวน์โหลดครบ ✓ (${diff.prodCount ?? 0} ไฟล์)</div></div></div>`;
      return `<div class="diff-body"><div class="diff-section">
        <div class="diff-title bad">ไฟล์ดาวน์โหลดที่หายจาก AEM (${diff.missing.length}/${diff.prodCount ?? 0})</div>
        <div class="chip-list">${diff.missing.map(n => `<span class="chip chip-missing">${esc(n)}</span>`).join('')}</div>
        ${diff.prodLinks?.length ? `<div class="diff-title">ลิงก์บน prod:</div><ul>${diff.prodLinks.map(l => `<li>${esc(l.text)} — <code>${esc(l.href)}</code></li>`).join('')}</ul>` : ''}
      </div></div>`;

    case 'deadDownloadLink':
      // diff = { dead: [{url, status}], checkedCount, totalCount }
      if (!diff.dead?.length) return `<div class="diff-body"><div class="diff-section"><div class="diff-title ok">ลิงก์ดาวน์โหลดทำงานทั้งหมด ✓ (${diff.checkedCount ?? 0} ลิงก์)</div></div></div>`;
      return `<div class="diff-body"><div class="diff-section">
        <div class="diff-title bad">ลิงก์ดาวน์โหลดที่ตาย (${diff.dead.length}/${diff.checkedCount ?? 0})</div>
        <ul>${diff.dead.map(d => `<li><code>${esc(d.url)}</code> → HTTP ${esc(d.status)}</li>`).join('')}</ul>
      </div></div>`;

    case 'template': {
      // diff = { components }. Header/footer moved to the site-level chrome
      // panel on the dashboard — they are identical on every page, so showing
      // them here repeated one finding once per page.
      const comp = diff.components?.perType
        ? `<div class="diff-section"><div class="diff-title">Components</div>
           <table class="mini">${diff.components.perType.map(t => `<tr><td>${esc(t.type)}</td><td>${t.aem}/${t.prod}</td><td class="${t.ok ? 'ok' : 'bad'}">${t.ok ? '✓' : '✗'}</td></tr>`).join('')}</table></div>`
        : '';
      return `<div class="diff-body">${comp}<div class="diff-section"><div class="diff-title muted">header/footer เทียบระดับเว็บ — ดูที่ Site chrome บนหน้า dashboard</div></div></div>`;
    }

    case 'links':
      // diff = { matchedCount }  (new main-mode shape)
      return `<div class="diff-body"><div class="diff-section">
        <div class="diff-title">${diff.matchedCount ?? 0} prod link-text <b class="ok">✓ พบใน AEM</b></div>
      </div></div>`;

    case 'headerMenu':
    case 'footerMenu':
      // diff = { prodCount, aemCount, missing, extra }
      return `<div class="diff-body">
        ${diff.missing?.length ? `<div class="diff-section"><div class="diff-title bad">Missing labels (${diff.missing.length})</div><div class="chip-list">${diff.missing.map(l => `<span class="chip chip-missing">${esc(l)}</span>`).join('')}</div></div>` : ''}
        ${diff.extra?.length ? `<div class="diff-section"><div class="diff-title ok">Extra in AEM (${diff.extra.length})</div><div class="chip-list">${diff.extra.map(l => `<span class="chip chip-extra">${esc(l)}</span>`).join('')}</div></div>` : ''}
        ${(!diff.missing?.length && !diff.extra?.length) ? `<div class="diff-section"><div class="diff-title ok">labels ตรงทั้งหมด ✓ (${diff.prodCount}/${diff.prodCount})</div></div>` : ''}
      </div>`;

    case 'components': {
      // diff = { perType:[{type,prod,aem,ratio,ok}], advisory:[{type,prod,aem}],
      //          emptyAccordions, otherComponents:{prodOnly,aemOnly,both} | [] (legacy) }
      const oc = diff.otherComponents || {};
      const ocLegacy = Array.isArray(oc); // results captured before the per-side split
      const ocChips = (list, cls) => (list || []).map(c => `<span class="chip ${cls}">${esc(c)}</span>`).join(' ');
      const ocHtml = ocLegacy
        ? (oc.length ? `<div class="diff-section"><div class="diff-title">Other components: ${ocChips(oc, '')}</div></div>` : '')
        : ((oc.prodOnly?.length || oc.aemOnly?.length || oc.both?.length) ? `<div class="diff-section">
            <div class="diff-title">Other components (advisory)</div>
            ${oc.prodOnly?.length ? `<div>หายใน AEM: ${ocChips(oc.prodOnly, 'chip-missing')}</div>` : ''}
            ${oc.aemOnly?.length ? `<div>AEM มีเพิ่ม: ${ocChips(oc.aemOnly, 'chip-extra')}</div>` : ''}
            ${oc.both?.length ? `<div>มีทั้งคู่: ${ocChips(oc.both, '')}</div>` : ''}
          </div>` : '');
      return `<div class="diff-body">
        ${diff.perType?.length ? `<div class="diff-section"><table class="meta-diff"><thead><tr><th>Type</th><th>Prod</th><th>AEM</th><th>Status</th></tr></thead><tbody>${diff.perType.map(t => `<tr><td><code>${esc(t.type)}</code></td><td>${t.prod}</td><td class="${t.ok ? 'ok' : 'bad'}">${t.aem}${t.type === 'accordion' && diff.emptyAccordions ? ` (${diff.emptyAccordions} ว่าง)` : ''}</td><td class="${t.ok ? 'ok' : 'bad'}">${t.ok ? '✓' : '✗'}</td></tr>`).join('')}</tbody></table></div>` : ''}
        ${diff.advisory?.length ? `<div class="diff-section"><div class="diff-title">Advisory: ${diff.advisory.map(t => `${esc(t.type)} ${t.aem}/${t.prod}`).join(' · ')}</div></div>` : ''}
        ${ocHtml}
      </div>`;
    }

    case 'missingImage':
      // v2 diff = { prodCount, aemCount } (count only; alt split into imageAlt)
      return `<div class="diff-body"><div class="diff-section">
        <div class="diff-title">AEM ${diff.aemCount ?? '?'} / Production ${diff.prodCount ?? '?'} รูป</div>
        ${diff.altMatchPct !== undefined ? `<div class="diff-title">alt match ${diff.altMatchPct}% (legacy)</div>` : ''}
      </div></div>`;

    case 'thaiBalance':
      // diff = { prod, aem, delta }
      return `<div class="diff-body"><div class="diff-section">
        <div class="diff-title">prod ${Math.round((diff.prod || 0) * 100)}% Thai vs aem ${Math.round((diff.aem || 0) * 100)}% Thai · delta ${Math.round((diff.delta || 0) * 100)}%</div>
      </div></div>`;
  }

  // Headings diff: list missing headings + extra ones.
  // Headings diff: side-by-side outline tree (prod left, aem right).
  if (diff.prodOutline && Array.isArray(diff.prodOutline)) {
    const renderOutline = (outline) => {
      if (!outline.length) return '<div class="outline-empty">— ไม่มี heading —</div>';
      return outline.map(h => {
        const indent = (h.level || 1) - 1;
        const tagCls = `htag htag-${h.tag || 'H?'}`;
        const matchCls = h.matched ? 'hrow-matched' : 'hrow-missing';
        const icon = h.matched ? '✓' : '✗';
        return `<div class="hrow ${matchCls}" style="margin-left:${indent * 20}px">
          <span class="${tagCls}">${esc(h.tag || '?')}</span>
          <span class="hicon">${icon}</span>
          <span class="htext">${esc(h.text)}</span>
        </div>`;
      }).join('');
    };
    const prodCount = diff.prodOutline.length;
    const aemCount = diff.aemOutline.length;
    const matched = diff.prodOutline.filter(h => h.matched).length;
    return `<div class="diff-body">
      <div class="diff-section">
        <div class="diff-title">เทียบ heading outline ทั้งสองฝั่ง — <b class="ok">${matched} ✓</b> / <b class="bad">${prodCount - matched} ✗ ขาด</b> (จาก ${prodCount} ใน Production)</div>
        <div class="outline-grid">
          <div class="outline-col">
            <div class="outline-head src">PRODUCTION (ต้นฉบับ) · ${prodCount} headings</div>
            <div class="outline-body">${renderOutline(diff.prodOutline)}</div>
          </div>
          <div class="outline-col">
            <div class="outline-head tgt">AEM (migrate) · ${aemCount} headings</div>
            <div class="outline-body">${renderOutline(diff.aemOutline)}</div>
          </div>
        </div>
        <div class="outline-legend">
          <span class="hrow hrow-matched" style="display:inline-flex;margin-right:12px"><span class="hicon">✓</span> มีในทั้งคู่</span>
          <span class="hrow hrow-missing" style="display:inline-flex"><span class="hicon">✗</span> มีฝั่งเดียว (อีกฝั่งขาด)</span>
        </div>
      </div>
    </div>`;
  }

  // Meta diff: table of prod vs aem values.
  if (diff.details && Array.isArray(diff.details)) {
    const rows = diff.details.map(m => `
      <tr>
        <td><code>${esc(m.key)}</code></td>
        <td class="${m.match ? 'ok' : (m.prod ? 'bad' : 'muted')}">${esc(m.prod || '—')}</td>
        <td class="${m.match ? 'ok' : (m.aem ? 'bad' : 'muted')}">${esc(m.aem || '—')}</td>
        <td class="${m.match ? 'ok' : 'bad'}">${m.match ? '✓' : (m.prod ? '✗ ต่างกัน' : '—')}</td>
      </tr>`).join('');
    return `<div class="diff-body"><table class="meta-diff"><thead><tr><th>Meta</th><th>Production</th><th>AEM</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  // Accordions diff.
  if (diff.emptyAccordions && Array.isArray(diff.emptyAccordions)) {
    if (!diff.emptyAccordions.length && diff.prodCount === diff.aemCount) return '';
    const emptyHtml = diff.emptyAccordions.length ? `
      <div class="diff-section">
        <div class="diff-title bad">Accordion ว่างเปล่าใน AEM (${diff.emptyAccordions.length}/${diff.aemCount})</div>
        <div class="chip-list">${diff.emptyAccordions.map(t => `<span class="chip chip-empty">${esc(t)}</span>`).join('')}</div>
      </div>` : `<div class="diff-section"><div class="diff-title ok">Accordion ทั้งหมดมีเนื้อหา ✓</div></div>`;
    const countNote = diff.prodCount !== diff.aemCount ? `<div class="diff-section"><div class="diff-title">จำนวนต่างกัน: Production ${diff.prodCount} / AEM ${diff.aemCount}</div></div>` : '';
    return `<div class="diff-body">${emptyHtml}${countNote}</div>`;
  }

  // Header/footer diff (object with prod/aem counts).
  if (diff.header && diff.footer) {
    const rows = [
      { label: 'Header links', ...diff.header },
      { label: 'Footer links', ...diff.footer },
    ].map(r => `<tr><td>${esc(r.label)}</td><td>${r.prod}</td><td class="${r.aem > 0 ? 'ok' : 'bad'}">${r.aem}</td><td class="${r.aem > 0 ? 'ok' : 'bad'}">${r.aem > 0 ? '✓' : '✗ หาย'}</td></tr>`).join('');
    return `<div class="diff-body"><table class="meta-diff"><thead><tr><th>ส่วน</th><th>Production</th><th>AEM</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  // Links diff: side-by-side link lists with match status.
  if (diff.prodLinks && Array.isArray(diff.prodLinks)) {
    const renderLinkList = (links) => {
      if (!links.length) return '<div class="outline-empty">— ไม่มี link —</div>';
      return links.map(l => {
        const matchCls = l.matched ? 'lrow-matched' : 'lrow-missing';
        const icon = l.matched ? '✓' : '✗';
        return `<div class="lrow ${matchCls}">
          <span class="hicon">${icon}</span>
          <span class="ltext">${esc(l.text || '(no text)')}</span>
          <a class="lhref" href="${esc(l.href || '#')}" target="_blank" title="${esc(l.href)}">${esc((l.href || '').slice(0, 40))}</a>
        </div>`;
      }).join('');
    };
    const prodMatched = diff.prodLinks.filter(l => l.matched).length;
    return `<div class="diff-body">
      <div class="diff-section">
        <div class="diff-title">เทียบ links — <b class="ok">${prodMatched} ✓</b> / <b class="bad">${diff.prodLinks.length - prodMatched} ✗ ขาด</b> (จาก ${diff.prodLinks.length} ใน Production)</div>
        <div class="outline-grid">
          <div class="outline-col">
            <div class="outline-head src">PRODUCTION · ${diff.prodLinks.length} links</div>
            <div class="outline-body">${renderLinkList(diff.prodLinks)}</div>
          </div>
          <div class="outline-col">
            <div class="outline-head tgt">AEM · ${diff.aemLinks.length} links</div>
            <div class="outline-body">${renderLinkList(diff.aemLinks)}</div>
          </div>
        </div>
        <div class="outline-legend">
          <span class="lrow lrow-matched" style="display:inline-flex;margin-right:12px"><span class="hicon">✓</span> มีในทั้งคู่</span>
          <span class="lrow lrow-missing" style="display:inline-flex"><span class="hicon">✗</span> มีฝั่งเดียว</span>
        </div>
      </div>
    </div>`;
  }

  // Content diff: side-by-side text sample + keyword comparison (generic mode).
  if (diff.prodSample !== undefined && diff.prodKeywords) {
    const renderKeywords = (kws, side) => kws.map(k => {
      const other = side === 'prod' ? k.aemCount : k.prodCount;
      const present = other > 0;
      const cls = present ? 'kw-shared' : 'kw-missing';
      const otherLabel = side === 'prod' ? `AEM:${other}` : `Prod:${other}`;
      return `<span class="kw ${cls}" title="${otherLabel}">${esc(k.w)} <em>${k.c}</em></span>`;
    }).join('');
    return `<div class="diff-body">
      <div class="diff-section">
        <div class="diff-title">เทียบเนื้อหา (text sample)</div>
        <div class="outline-grid">
          <div class="outline-col">
            <div class="outline-head src">PRODUCTION (ต้นฉบับ)</div>
            <div class="text-sample">${esc(diff.prodSample || '(empty)')}</div>
          </div>
          <div class="outline-col">
            <div class="outline-head tgt">AEM (migrate)</div>
            <div class="text-sample">${esc(diff.aemSample || '(empty)')}</div>
          </div>
        </div>
      </div>
      <div class="diff-section">
        <div class="diff-title">คำสำคัญ (top keywords) — <b class="ok">${diff.keywordsSharedCount} ✓ ตรง</b> / <b class="bad">${diff.keywordsMissingCount} ✗ ขาดใน AEM</b></div>
        <div class="outline-grid">
          <div class="outline-col">
            <div class="outline-head src">PRODUCTION keywords</div>
            <div class="kw-body">${renderKeywords(diff.prodKeywords, 'prod')}</div>
          </div>
          <div class="outline-col">
            <div class="outline-head tgt">AEM keywords</div>
            <div class="kw-body">${renderKeywords(diff.aemKeywords, 'aem')}</div>
          </div>
        </div>
        <div class="outline-legend">
          <span class="kw kw-shared" style="margin-right:12px">เขียว = มีในทั้งคู่</span>
          <span class="kw kw-missing">แดง = มีฝั่งเดียว</span>
        </div>
      </div>
    </div>`;
  }

  // ─── News-specific diff branches ──────────────────────────────────────────

  // News title diff.
  if (diff.prodTitle !== undefined) {
    return `<div class="diff-body"><div class="outline-grid">
      <div class="outline-col"><div class="outline-head src">PRODUCTION</div><div class="text-sample">${esc(diff.prodTitle || '(none)')}</div></div>
      <div class="outline-col"><div class="outline-head tgt">AEM</div><div class="text-sample">${esc(diff.aemTitle || '(none)')}</div></div>
    </div></div>`;
  }

  // News content diff (text sample + missing blocks).
  if (diff.prodSample !== undefined && diff.missingTextBlocks) {
    const missingHtml = diff.missingTextBlocks.length ? `
      <div class="diff-section"><div class="diff-title bad">Text blocks ที่ขาดใน AEM (${diff.missingTextBlocks.length})</div>
      <div class="chip-list">${diff.missingTextBlocks.map(t => `<span class="chip chip-missing">${esc(t.slice(0,80))}</span>`).join('')}</div></div>` : '';
    return `<div class="diff-body">
      <div class="diff-section"><div class="diff-title">เนื้อหา (ratio ${diff.ratio}%)</div>
      <div class="outline-grid">
        <div class="outline-col"><div class="outline-head src">PRODUCTION</div><div class="text-sample">${esc(diff.prodSample || '(empty)')}</div></div>
        <div class="outline-col"><div class="outline-head tgt">AEM</div><div class="text-sample">${esc(diff.aemSample || '(empty)')}</div></div>
      </div></div>${missingHtml}
    </div>`;
  }

  // News images diff.
  if (diff.prodCount !== undefined && diff.altMatchPct !== undefined) {
    return `<div class="diff-body"><div class="diff-section">
      <div class="diff-title">รูปประกอบ — prod ${diff.prodCount} / aem ${diff.aemCount} (alt match ${diff.altMatchPct}%)</div>
    </div></div>`;
  }

  // News breadcrumb + share diff.
  if (diff.prodBreadcrumb !== undefined) {
    const bcProd = diff.prodBreadcrumb;
    const bcAem = diff.aemBreadcrumb;
    const shareProd = diff.prodShare || {};
    const shareAem = diff.aemShare || {};
    const missingShare = diff.missingShare || [];
    return `<div class="diff-body">
      <div class="diff-section"><div class="diff-title">Breadcrumb</div>
        <div class="outline-grid">
          <div class="outline-col"><div class="outline-head src">PROD ${bcProd.hasBreadcrumb?'✓':'✗'}</div><div class="text-sample">${esc((bcProd.items||[]).join(' › ') || '(none)')}</div></div>
          <div class="outline-col"><div class="outline-head tgt">AEM ${bcAem.hasBreadcrumb?'✓':'✗'}</div><div class="text-sample">${esc((bcAem.items||[]).join(' › ') || '(none)')}</div></div>
        </div>
      </div>
      <div class="diff-section"><div class="diff-title">ปุ่มแชร์ — prod ${shareProd.count||0} / aem ${shareAem.count||0}${missingShare.length ? ` · <span class="bad">missing: ${missingShare.join(', ')}</span>` : ''}</div></div>
    </div>`;
  }

  return '';
}

// ─── Shared CSS ────────────────────────────────────────────────────────────
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
.tag.src { background:#1a2b5c; } .tag.tgt { background:#8a5a00; }
.bad { color:#c00; font-weight:700; }
.ok { color:#1a6b3c; font-weight:700; }

/* Parity check expandable blocks */
.checks-list { display:flex; flex-direction:column; gap:6px; }
.check-block { border:1px solid #e0e0e0; border-radius:8px; overflow:hidden; }
.check-block.failed { border-color:#f5c2c2; background:#fffafa; }
.check-block.passed { border-color:#c3e6cb; background:#f8fff9; }
.check-block summary { cursor:pointer; padding:10px 14px; display:flex; align-items:center; gap:10px; font-size:13px; list-style:none; }
.check-block summary::-webkit-details-marker { display:none; }
.check-status { font-weight:700; width:18px; text-align:center; }
.check-status.ok { color:#1a6b3c; } .check-status.bad { color:#c00; }
.check-label { font-weight:600; min-width:130px; }
.check-weight { background:#1a2b5c; color:#fff; font-size:10px; padding:1px 6px; border-radius:3px; }
.check-detail { color:#666; font-size:12px; flex:1; }
.expand-hint { color:#1a2b5c; font-size:11px; font-weight:600; white-space:nowrap; }
.diff-body { padding:0 14px 12px; border-top:1px solid #f0f0f0; }
.diff-section { padding:8px 0; }
.diff-title { font-size:12px; font-weight:600; margin-bottom:6px; }
.diff-title.bad { color:#c00; } .diff-title.ok { color:#1a6b3c; }
.chip-list { display:flex; flex-wrap:wrap; gap:5px; }
.chip { font-size:11px; padding:3px 8px; border-radius:4px; background:#f0f1f3; color:#555; max-width:340px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.chip-missing { background:#fde8e8; color:#c00; }
.chip-extra { background:#e6f4ea; color:#1a6b3c; }
.chip-empty { background:#fff4e0; color:#8a5a00; }

/* Heading outline side-by-side */
.outline-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
.outline-col { border:1px solid #e0e0e0; border-radius:6px; overflow:hidden; }
.outline-head { padding:7px 10px; font-size:11px; font-weight:700; color:#fff; }
.outline-head.src { background:#1a2b5c; } .outline-head.tgt { background:#8a5a00; }
.outline-body { padding:6px 4px; max-height:500px; overflow-y:auto; }
.outline-empty { padding:16px; color:#aaa; text-align:center; font-size:12px; }
.hrow { display:flex; align-items:center; gap:5px; padding:2px 6px; font-size:12px; border-radius:3px; }
.hrow-matched { background:transparent; }
.hrow-missing { background:#fde8e8; }
.htag { font-size:9px; font-weight:700; padding:1px 4px; border-radius:2px; min-width:22px; text-align:center; color:#fff; }
.htag-H1 { background:#1a2b5c; } .htag-H2 { background:#2d4a8a; } .htag-H3 { background:#5b7bb5; } .htag-H4 { background:#8aa0c8; color:#1a2b5c; }
.hicon { font-weight:700; width:14px; text-align:center; }
.hrow-matched .hicon { color:#1a6b3c; } .hrow-missing .hicon { color:#c00; }
.htext { flex:1; word-break:break-word; }
.outline-legend { margin-top:8px; font-size:11px; color:#666; }

/* Link rows */
.lrow { display:flex; align-items:center; gap:5px; padding:2px 6px; font-size:12px; border-radius:3px; }
.lrow-matched { background:transparent; }
.lrow-missing { background:#fde8e8; }
.ltext { flex:1; word-break:break-word; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.lhref { font-size:10px; color:#5b7bb5; font-family:monospace; text-decoration:none; max-width:140px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.lhref:hover { text-decoration:underline; }

/* Content text sample + keywords */
.text-sample { padding:10px; font-size:11px; line-height:1.5; white-space:pre-wrap; word-break:break-word; background:#fafbfc; max-height:250px; overflow-y:auto; color:#444; }
.kw-body { padding:8px; max-height:250px; overflow-y:auto; }
.kw { display:inline-block; font-size:11px; padding:2px 7px; border-radius:3px; margin:2px; }
.kw em { font-style:normal; font-weight:700; font-size:10px; opacity:.7; }
.kw-shared { background:#e6f4ea; color:#1a6b3c; }
.kw-missing { background:#fde8e8; color:#c00; }
.meta-diff { width:100%; border-collapse:collapse; font-size:12px; margin-top:4px; }
.meta-diff th, .meta-diff td { padding:5px 8px; border:1px solid #eee; text-align:left; vertical-align:top; }
.meta-diff th { background:#f7f8fa; color:#888; font-size:10px; text-transform:uppercase; }
.meta-diff code { font-size:11px; }
`;

const DASHBOARD_CSS = SHARED + `
/* Site-level header/footer chrome report */
.chrome-group { border:1px solid #e8eaed; border-radius:8px; padding:12px 14px; margin:10px 0; background:#fafbfc; }
.chrome-head { font-size:13px; margin-bottom:8px; }
.chrome-part { margin:8px 0; }
.chrome-part-name { font-size:12px; font-weight:700; text-transform:uppercase; color:#444; margin-bottom:5px; }
.chrome-row { display:flex; align-items:flex-start; gap:8px; margin:4px 0; }
.chrome-tag { font-size:11px; font-weight:700; padding:3px 8px; border-radius:4px; white-space:nowrap; }
.chrome-tag.bad { background:#fde8e8; color:#c00; }
.chrome-tag.warn { background:#fff4e0; color:#8a5a00; }
.cards { display:flex; gap:12px; margin:16px 0; }
.card { flex:1; background:#fff; border-radius:10px; padding:16px; text-align:center; box-shadow:0 1px 4px rgba(0,0,0,.06); }
.card .num { font-size:28px; font-weight:800; color:#1a2b5c; }
.card .num.good { color:#1a6b3c; } .card .num.mid { color:#b8860b; } .card .num.bad { color:#c00; }
.card .num .pct { font-size:14px; }
.card.big .num { font-size:42px; }
.card .lbl { font-size:11px; color:#888; margin-top:2px; }
.warn-banner { background:#fff3cd; border:1px solid #ffe69c; border-radius:8px; padding:12px 16px; margin:12px 0; font-size:13px; color:#664d03; }
.two-col { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
.bars { display:flex; flex-direction:column; gap:8px; }
.bar-row { display:flex; align-items:center; gap:10px; font-size:13px; }
.bar-lbl { width:55px; text-align:right; color:#666; }
.bar-track { flex:1; background:#eee; border-radius:4px; height:22px; overflow:hidden; }
.bar-fill { background:#1a2b5c; height:100%; border-radius:4px; transition:width .4s; }
.bar-val { width:30px; font-weight:700; }
.cat-table { width:100%; border-collapse:collapse; font-size:13px; }
.cat-table th, .cat-table td { padding:6px 8px; border-bottom:1px solid #eee; text-align:left; }
.cat-table th { color:#888; font-weight:600; font-size:11px; text-transform:uppercase; }
.toolbar { display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; gap:12px; flex-wrap:wrap; }
.filters { display:flex; gap:8px; align-items:center; font-size:13px; }
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
.gapn { color:#c00; }
.badge { padding:2px 7px; border-radius:4px; font-size:10px; font-weight:700; color:#fff; }
.badge.pass { background:#16a34a; } .badge.warn { background:#ca8a04; } .badge.fail { background:#dc2626; }
.badge.prod404 { background:#6366f1; } .badge.aem404 { background:#ea580c; } .badge.both404 { background:#1f2937; }
.badge.blocked { background:#7c3aed; }
.row-num { color:#aaa; font-size:11px; text-align:center; width:32px; }
/* The bar owns the divider + spacing so the page-size control and the pager
   share one rule instead of stacking two borders. */
.pagination-bar { display:flex; align-items:center; gap:12px; margin-top:12px; padding-top:10px; border-top:1px solid #eee; flex-wrap:wrap; }
.page-size { display:flex; align-items:center; gap:6px; font-size:12px; color:#888; white-space:nowrap; }
.page-size select { padding:4px 8px; border:1px solid #ddd; border-radius:4px; font-size:12px; color:#333; cursor:pointer; }
/* flex:1 lets the pager centre itself in the space left over, so it stays put
   as the page-size label changes width. */
.pagination { display:flex; align-items:center; gap:4px; justify-content:center; flex:1; flex-wrap:wrap; }
.page-info { font-size:12px; color:#888; margin-right:8px; }
.page-btn { padding:4px 9px; border:1px solid #ddd; border-radius:4px; background:#fff; cursor:pointer; font-size:12px; min-width:30px; }
.page-btn:hover:not(:disabled) { background:#1a2b5c; color:#fff; border-color:#1a2b5c; }
.page-btn.active { background:#1a2b5c; color:#fff; border-color:#1a2b5c; font-weight:700; }
.page-btn:disabled { opacity:.4; cursor:default; }
.page-ellipsis { color:#aaa; padding:0 2px; }
`;

const PAGE_CSS = SHARED + `
/* Grouped check sections (Template / Content / Structure + Other fallback) */
.groups { display:flex; flex-direction:column; gap:10px; }
.group-block { border:1px solid #e0e0e0; border-radius:8px; margin-bottom:0; overflow:hidden; }
.group-head { padding:8px 12px; font-size:13px; font-weight:700; display:flex; justify-content:space-between; align-items:center; }
.group-head.template { background:#eef2ff; color:#1a2b5c; }
.group-head.content { background:#f0f7e6; color:#1a6b3c; }
.group-head.structure { background:#fdf0e6; color:#8a5a00; }
.group-head.other { background:#f0f1f3; color:#555; }
/* v2 (defect-aligned) group ids. Note: v2's own "structure" group shares the
   id (and thus the rule above) with the old CRITERIA_GROUPS "structure" —
   intentionally not redeclared here to avoid a cascade override that would
   change the live default dashboard's colors. */
.group-head.missing-content { background:#eef2ff; color:#1a2b5c; }
.group-head.missing-assets { background:#f0f7e6; color:#1a6b3c; }
.group-head.alignment { background:#fff7e0; color:#7a5200; }
.group-head.downloads { background:#fdf0e6; color:#8a5a00; }
table.mini td { padding:2px 8px; font-size:12px; }
.group-pct { font-size:12px; opacity:.8; font-weight:600; }
.group-block .checks-list { padding:4px; }
.group-block .check-block { margin:2px; border:none; border-radius:4px; }
.group-block .check-block summary.check-row { padding:7px 12px; gap:10px; font-size:12px; }
.group-block .check-status.ins { color:#aaa; }
.ins-tag { background:#eee; color:#888; font-size:9px; padding:1px 5px; border-radius:3px; margin-left:6px; text-transform:uppercase; font-weight:700; }
.back { display:inline-block; font-size:12px; color:#1a2b5c; text-decoration:none; margin-bottom:8px; }
.score-row { display:flex; gap:18px; align-items:center; background:#fff; border-radius:10px; padding:16px 20px; margin:14px 0; box-shadow:0 1px 4px rgba(0,0,0,.06); }
.score { text-align:center; min-width:90px; }
.score .big { font-size:42px; font-weight:800; } .score .pct { font-size:18px; }
.score .lbl { font-size:11px; color:#888; }
.urls { flex:1; font-size:12px; word-break:break-all; }
.urls a { color:#1a2b5c; }
.diff, .checks { width:100%; border-collapse:collapse; font-size:13px; }
.diff th, .diff td, .checks th, .checks td { padding:7px 10px; border:1px solid #eee; text-align:left; }
.diff th, .checks th { background:#f7f8fa; font-size:11px; text-transform:uppercase; color:#888; }
.gap-list { list-style:none; }
.gap-list li { padding:8px 0; border-bottom:1px solid #f0f0f0; font-size:13px; }
.gap-list .sev { display:inline-block; padding:1px 6px; border-radius:3px; font-size:10px; font-weight:700; color:#fff; margin-right:6px; }
.gap.critical .sev { background:#c00; } .gap.high .sev { background:#d97706; } .gap.medium .sev { background:#f0ad4e; }
.sxs { display:flex; gap:14px; }
.sxs figure { flex:1; display:flex; flex-direction:column; }
.sxs figcaption { font-size:12px; font-weight:700; color:#fff; padding:7px 10px; }
.pcap { background:#1a2b5c; } .acap { background:#8a5a00; }
.sxs img { width:100%; border:1px solid #ddd; border-top:none; display:block; }
/* Synced-scroll panes — fixed height, internal scroll. */
.shot-pane { max-height:600px; overflow-y:auto; border:1px solid #ddd; border-top:none; }
.shot-pane img { border:none; }
.links-table { width:100%; border-collapse:collapse; font-size:12px; }
.links-table th, .links-table td { padding:5px 8px; border:1px solid #eee; text-align:left; }
.links-table th { background:#f7f8fa; color:#888; font-size:10px; text-transform:uppercase; }
.lhref-cell { font-family:monospace; font-size:11px; word-break:break-all; }

.noimg { padding:40px; text-align:center; color:#aaa; border:1px solid #ddd; border-top:none; }
@media print { .sxs{break-inside:avoid;} }
`;

main().catch(e => { console.error('❌', e); process.exit(1); });
