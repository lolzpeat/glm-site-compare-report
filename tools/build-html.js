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
  const bodyHtml = marked.parse(markdown);
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
