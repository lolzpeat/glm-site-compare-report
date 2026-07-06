// Build the dashboard (overview) + per-page drill-down HTML reports.
// Screenshots are referenced by relative path (no base64 embedding) so the
// dashboard stays small and loads images lazily.
//
// Usage:
//   node src/build-dashboard.js                  # default: data/results.json → output/
//   node src/build-dashboard.js --source=X.json  # custom results file
//   node src/build-dashboard.js --prefix=news    # output to news-* files + news-pages/

import { readFile, writeFile, mkdir, copyFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative, basename } from 'node:path';
import { DIR } from '../config.js';

const PASS_THRESHOLD = 85;

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
      const abs = p[side]?.screenshot;
      if (abs && existsSync(abs)) {
        const idDir = join(outShots, p.id);
        await mkdir(idDir, { recursive: true });
        await copyFile(abs, join(idDir, basename(abs))).catch(() => {});
      }
    }
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
      parity: p.parity ?? 0,
      gaps: gapCount,
      status,
      loadError: loadErr,
      lowContent,
    };
  });

  // --- Dashboard ---
  const dashHtml = renderDashboard({
    total, avg, passed, warned, failed, lowContent, buckets, cats: Object.entries(cats),
    rowData, generatedAt: raw.generatedAt, titleSuffix,
    pagesDirName, dashName, prefix,
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
function renderDashboard({ total, avg, passed, warned, failed, lowContent, buckets, cats, rowData, generatedAt, titleSuffix, pagesDirName, dashName, prefix }) {
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
<nav class="topnav">
  <a href="dashboard.html" class="${!prefix ? 'active' : ''}">📊 Dashboard หลัก</a>
  <a href="news-dashboard.html" class="${prefix === 'news' ? 'active' : ''}">📰 News & Media</a>
  <a href="criteria.html">📋 เกณฑ์ตรวจจับ</a>
</nav>
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
  <div class="pagination" id="pagination"></div>
</section>

<footer class="foot">Production = source of truth · AEM = target to fix · Click any row to drill down</footer>
</div>
<script>
const ROWS = ${JSON.stringify(rowData)};
const PAGE_SIZE = 25;
let sortKey = 'id', sortDir = 1;
let currentPage = 1;
let filteredRows = [];

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
  const go = document.getElementById('gapsOnly').checked;
  let rows = ROWS.filter(r =>
    (!f || r.path.toLowerCase().includes(f) || r.category.toLowerCase().includes(f) || r.subCategory.toLowerCase().includes(f)) &&
    (!cf || r.category === cf) &&
    (!sf2 || r.subCategory === sf2) &&
    (!sf || r.status === sf) &&
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
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = totalPages;
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageRows = filteredRows.slice(start, start + PAGE_SIZE);

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
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
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

  // Screenshot paths relative to output/pages/{id}.html → ../screenshots/{id}/prod.jpg
  // Screenshots are copied into output/ so the whole folder is self-contained
  // and deployable to static hosts (Vercel, Netlify, GitHub Pages).
  const toRelShot = (absPath) => {
    if (!absPath) return null;
    const rel = relative(DIR.screenshots, absPath); // e.g. "1/prod.jpg"
    return `../${shotsDirName}/${rel}`;
  };
  const prodShot = toRelShot(p.prod?.screenshot);
  const aemShot = toRelShot(p.aem?.screenshot);

  // Metric diff rows
  const diffRows = hasMetrics ? [
    metricRow('Headings', prod.headingCount, aem.headingCount),
    metricRow('Links', prod.linkCount, aem.linkCount),
    metricRow('Text length', `${prod.textLength}`, `${aem.textLength}`, prod.textLength, aem.textLength),
    metricRow('Images', prod.imageCount, aem.imageCount),
    metricRow('Accordions', prod.accordionCount, aem.accordionCount),
    metricRow('Empty accordions', prod.emptyAccordions, aem.emptyAccordions, 0, aem.emptyAccordions, true),
    metricRow('Header links', prod.headerLinkCount, aem.headerLinkCount),
    metricRow('Footer links', prod.footerLinkCount, aem.footerLinkCount),
    metricRow('Page height (px)', prod.pageHeight, aem.pageHeight),
  ].join('') : '';

  // Render each parity check with an expandable diff section showing what's missing.
  const checkBlocks = (p.checks || []).map((c, idx) => {
    const diffHtml = renderDiffDetails(c.diff, esc);
    return `
    <details class="check-block ${c.passed ? 'passed' : 'failed'}">
      <summary>
        <span class="check-status ${c.passed ? 'ok' : 'bad'}">${c.passed ? '✓' : '✗'}</span>
        <span class="check-label">${esc(c.label)}</span>
        <span class="check-weight">${Math.round(c.weight * 100)}%</span>
        <span class="check-detail">${esc(c.detail)}</span>
        ${diffHtml ? '<span class="expand-hint">▾</span>' : ''}
      </summary>
      ${diffHtml}
    </details>`;
  }).join('');

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

  // Image distortion/ratio issues — with preview thumbnails + dimensions.
  const imageIssueRows = (p.imageIssues || []).map(ii => {
    // Show thumbnail previews for ratio/distortion issues (not page-wide missing).
    const hasPreview = ii.prodSrc || ii.aemSrc;
    const preview = hasPreview ? `
      <div class="img-preview-grid">
        ${ii.prodSrc ? `<div class="img-preview-cell"><div class="img-preview-label">PROD ${esc(ii.prodRendered||'')}</div><img src="${esc(ii.prodSrc)}" loading="lazy" class="img-thumb" onerror="this.style.display='none'"></div>` : ''}
        ${ii.aemSrc ? `<div class="img-preview-cell"><div class="img-preview-label">AEM ${esc(ii.aemRendered||'')}</div><img src="${esc(ii.aemSrc)}" loading="lazy" class="img-thumb" onerror="this.style.display='none'"></div>` : ''}
      </div>` : '';
    return `<li class="img-issue">
      <div class="img-issue-head">
        <span class="sev sev-${ii.kind}">${esc(ii.kind)}</span>
        <b>${esc(ii.label)}</b>
        <span class="muted">${esc(ii.detail)}</span>
      </div>
      ${preview}
    </li>`;
  }).join('');
  const imageIssuesSection = imageIssueRows ? `
<section class="panel"><h2>Image Distortion / Ratio Issues (${(p.imageIssues||[]).length})</h2>
<ul class="img-issue-list">${imageIssueRows}</ul></section>` : '';

  const parityClass = p.parity >= PASS_THRESHOLD ? 'good' : p.parity >= 50 ? 'mid' : 'bad';

  return `<!DOCTYPE html><html lang="th"><head><meta charset="utf-8">
<title>Page ${p.id} — ${esc((p.prodUrl || '').split('/').pop())}</title>
<style>${PAGE_CSS}</style></head><body>
<nav class="topnav">
  <a href="../dashboard.html">📊 Dashboard หลัก</a>
  <a href="../news-dashboard.html">📰 News & Media</a>
  <a href="../criteria.html">📋 เกณฑ์ตรวจจับ</a>
</nav>
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

${checkBlocks ? `
<section class="panel"><h2>Parity Checks <span class="muted" style="font-weight:400;font-size:12px">— คลิกแต่ละแถวเพื่อดูสิ่งที่ขาดไป</span></h2>
<div class="checks-list">${checkBlocks}</div></section>` : ''}

${brokenLinksSection}
${imageIssuesSection}

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

// Render the "what's missing" detail for a check's diff object.
// Returns HTML string (empty if no diff or nothing to show).
function renderDiffDetails(diff, esc) {
  if (!diff) return '';

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

/* Image issue cards with preview */
.img-issue-list { list-style:none; }
.img-issue { background:#f8f9fb; border:1px solid #e8eaed; border-radius:8px; padding:12px 14px; margin:10px 0; }
.img-issue-head { display:flex; align-items:center; gap:8px; flex-wrap:wrap; font-size:13px; }
.img-issue-head .muted { font-size:12px; }
.sev-ratio { background:#ea580c; } .sev-distortion { background:#dc2626; } .sev-missing { background:#6366f1; }
.img-preview-grid { display:flex; gap:12px; margin-top:10px; }
.img-preview-cell { flex:1; }
.img-preview-label { font-size:10px; font-weight:700; color:#666; margin-bottom:4px; text-transform:uppercase; }
.img-thumb { max-width:200px; max-height:120px; border:1px solid #ddd; border-radius:4px; display:block; }
.noimg { padding:40px; text-align:center; color:#aaa; border:1px solid #ddd; border-top:none; }
@media print { .sxs{break-inside:avoid;} }
`;

main().catch(e => { console.error('❌', e); process.exit(1); });
