// The single definition of the top navigation, shared by build-dashboard.js
// (index + drill-down pages) and build-docs.js. It used to be three hand-kept
// copies, which is how they drift.
//
// "Dashboard หลัก" (dashboard.html, the 632-page main run) was removed
// 2026-08-05: the criteria changed underneath it, so its numbers are scored on
// rules that no longer exist. output/dashboard.html is left on disk rather
// than deleted — it is simply no longer reachable from the nav.

const ITEMS = [
  { id: 'priority', href: 'priority-dashboard.html', label: '⭐ Priority BBL Thai Manual Pages' },
  { id: 'news', href: 'news-dashboard.html', label: '📰 News & Media' },
  { id: 'criteria', href: 'criteria.html', label: '📋 เกณฑ์ตรวจจับ' },
];

// `active` is an item id; `base` prefixes hrefs ('../' from a drill-down page).
export function renderNav(active = '', base = '') {
  const links = ITEMS.map(i =>
    `  <a href="${base}${i.href}"${i.id === active ? ' class="active"' : ''}>${i.label}</a>`
  ).join('\n');
  return `<nav class="topnav">\n${links}\n</nav>`;
}
