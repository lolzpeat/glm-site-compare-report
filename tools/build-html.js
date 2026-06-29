// build-html.js — Convert all .md files to a static HTML site.
// Usage: node tools/build-html.js
// Output: site/ folder, open site/index.html in a browser.

const fs = require('fs');
const path = require('path');
const { marked } = require('marked');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'site');

// --- Configure marked ---
marked.setOptions({
  gfm: true,           // GitHub-flavored markdown (tables, task lists)
  breaks: false,
  headerIds: true,
  mangle: false,
});

// --- Post-process: make checkboxes interactive + convert table [ ]/[x] ---
// marked renders GFM task lists as <input disabled="" type="checkbox">.
// We want them clickable + persisted in localStorage, so strip "disabled".
// Table cells contain literal "[ ]" / "[x]" text — convert to real checkboxes.
function makeCheckboxesInteractive(html, slug) {
  let out = html;

  // 1. Task list items: enable disabled checkboxes and tag the <li>.
  out = out.replace(
    /<li><input disabled="" type="checkbox">/g,
    '<li class="task-list-item"><input type="checkbox" class="track">'
  );
  out = out.replace(
    /<li><input disabled="" type="checkbox" checked="">/g,
    '<li class="task-list-item"><input type="checkbox" class="track" checked>'
  );

  // 2. Table cells: "[ ]" or "[x]" → real checkbox bound to a tracking id.
  // Counter increments per matched cell, so every checkbox is unique.
  let tableCounter = 0;
  out = out.replace(/<table>([\s\S]*?)<\/table>/g, (match, tableContent) => {
    if (!/\[ \]|\[x\]/.test(tableContent)) return match; // no checkbox in this table
    const newTable = tableContent.replace(/<td>(\s*\[( |x)\]\s*)<\/td>/g, (m, _full, mark) => {
      const checked = mark === 'x' ? ' checked' : '';
      const id = `${slug}-tbl-${tableCounter++}`;
      return `<td><input type="checkbox" class="track" data-id="${id}"${checked}></td>`;
    });
    return `<table>${newTable}</table>`;
  });

  return out;
}

// --- Source files to build, in sidebar order ---
const SOURCES = [
  { md: 'README.md',                title: 'Home' },
  { md: 'PROGRESS.md',              title: 'Progress' },
  { md: 'docs/weeks/week-1.md',     title: 'Week 1 · The full picture' },
  { md: 'docs/weeks/week-2.md',     title: 'Week 2 · Request & URL' },
  { md: 'docs/weeks/week-3.md',     title: 'Week 3 · Response & JSON' },
  { md: 'docs/weeks/week-4.md',     title: 'Week 4 · Async JS' },
  { md: 'docs/weeks/week-5.md',     title: 'Week 5 · Error handling' },
  { md: 'docs/weeks/week-6.md',     title: 'Week 6 · Build your API' },
  { md: 'docs/weeks/week-7.md',     title: 'Week 7 · POST & data' },
  { md: 'docs/weeks/week-8.md',     title: 'Week 8 · Capstone' },
];

// --- Read shared CSS ---
const cssPath = path.join(__dirname, 'style.css');
const cssInline = fs.existsSync(cssPath) ? fs.readFileSync(cssPath, 'utf8') : '';

// --- Helpers ---
function toSlug(mdPath) {
  // README.md -> index, others -> folder-less slug
  if (mdPath === 'README.md') return 'index';
  return path.basename(mdPath, '.md');
}

function buildNavItem(src, currentSlug) {
  const slug = toSlug(src.md);
  const active = slug === currentSlug ? ' class="active"' : '';
  return `    <a href="${slug}.html"${active}>${src.title}</a>`;
}

function buildSidebar(currentSlug) {
  const items = SOURCES.map(s => buildNavItem(s, currentSlug)).join('\n');
  return `<nav class="sidebar">
  <div class="brand">🚀 Learning API</div>
${items}
</nav>`;
}

function buildPage(src) {
  const slug = toSlug(src.md);
  const fullPath = path.join(ROOT, src.md);

  if (!fs.existsSync(fullPath)) {
    console.warn(`⚠️  Skipped (missing): ${src.md}`);
    return null;
  }

  const markdown = fs.readFileSync(fullPath, 'utf8');
  let bodyHtml = marked.parse(markdown);
  bodyHtml = makeCheckboxesInteractive(bodyHtml, slug);
  const sidebar = buildSidebar(slug);

  // Top "prev/next" navigation
  const idx = SOURCES.findIndex(s => s.md === src.md);
  const prev = idx > 0 ? SOURCES[idx - 1] : null;
  const next = idx < SOURCES.length - 1 ? SOURCES[idx + 1] : null;
  const footerNav = `
<nav class="pagenav">
  ${prev ? `<a href="${toSlug(prev.md)}.html">← ${prev.title}</a>` : '<span></span>'}
  ${next ? `<a href="${toSlug(next.md)}.html">${next.title} →</a>` : '<span></span>'}
</nav>`;

  return `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${src.title} · Learning API</title>
  <style>${cssInline}</style>
</head>
<body>
  ${sidebar}
  <main class="content">
    <article>
      ${bodyHtml}
    </article>
    ${footerNav}
  </main>
  <script>
  (function () {
    // Persist checkbox state in localStorage. Keyed per-page (slug) so
    // each page's checkboxes are independent. Task-list items use their
    // DOM order; table checkboxes use data-id (slug-tbl-N).
    var slug = ${JSON.stringify(slug)};
    var store;
    try { store = JSON.parse(localStorage.getItem('track:' + slug) || '{}'); }
    catch (e) { store = {}; }
    var listIdx = 0;

    document.querySelectorAll('input.track').forEach(function (cb) {
      var key = cb.dataset.id || ('li-' + (listIdx++));

      // 1. Restore saved state (overrides initial markdown state).
      if (key in store) cb.checked = !!store[key];

      // 2. Save on click.
      cb.addEventListener('change', function () {
        store[key] = cb.checked;
        localStorage.setItem('track:' + slug, JSON.stringify(store));
      });
    });
  })();
  </script>
</body>
</html>`;
}

// --- Main ---
console.log('🔨 Building site...');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

let count = 0;
for (const src of SOURCES) {
  const html = buildPage(src);
  if (!html) continue;

  const slug = toSlug(src.md);
  const outPath = path.join(OUT, `${slug}.html`);
  fs.writeFileSync(outPath, html);
  console.log(`  ✓ ${src.md} → site/${slug}.html`);
  count++;
}

console.log(`\n✅ Done: ${count} pages written to site/`);
console.log(`   Open: ${path.join(OUT, 'index.html')}`);
