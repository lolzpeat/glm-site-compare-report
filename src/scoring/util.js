// Shared pure helpers for the scoring modules. isDynamicBlock/filenameOf/
// normCompare are ported from compare.js (whose copies are removed at
// promotion) so the check modules can be tested without loading puppeteer.
import { DOWNLOAD_EXTENSIONS, ASSET_ROOT_PREFIXES } from '../../config.js';
import { W } from './weights.js';

const THAI_MONTHS =
  /(ม\.?ค\.?|ก\.?พ\.?|มี\.?ค\.?|เม\.?ย\.?|พ\.?ค\.?|มิ\.?ย\.?|ก\.?ค\.?|ส\.?ค\.?|ก\.?ย\.?|ต\.?ค\.?|พ\.?ย\.?|ธ\.?ค\.?|มกราคม|กุมภาพันธ์|มีนาคม|เมษายน|พฤษภาคม|มิถุนายน|กรกฎาคม|สิงหาคม|กันยายน|ตุลาคม|พฤศจิกายน|ธันวาคม)\s*\d{2,4}/;

// Filter out text blocks that are mostly digits or Thai month+year — these are
// dynamic content (dates, rates, counters) that change between captures and
// would generate false "missing text" issues.
export function isDynamicBlock(s) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  const digits = (t.match(/\d/g) || []).length;
  const nonSpace = t.replace(/\s/g, '').length || 1;
  if (digits / nonSpace > 0.4) return true;
  return THAI_MONTHS.test(t);
}

// Lowercased basename of a URL — used to match assets across sites where the
// full src differs but the filename is the same.
export function filenameOf(url) {
  try {
    const name = new URL(url).pathname.split('/').pop() || '';
    return decodeURIComponent(name).toLowerCase();
  } catch {
    return String(url || '').toLowerCase();
  }
}

export function normCompare(a, b) {
  const n = (s) => (s || '').toLowerCase().replace(/[^a-z0-9\u0E00-\u0E7F]/gi, '').slice(0, 200);
  return n(a) === n(b);
}

// Asset path of a CMS URL, with the host and CMS-specific root removed, for
// comparing the same asset across the two sites:
//   prod  https://www.bangkokbank.com/-/media/feature/.../2.jpg
//   AEM   https://main--…aem.live/content/dam/feature/.../2.jpg
//   both  → /feature/page-content/bbl-corporate/banners/1200x630/aec-connect/2.jpg
// AEM also rewrites `_` to `-` in asset names (bbl_th-share → bbl-th-share),
// so underscores are normalised too. Returns '' when there is no usable URL.
export function assetPath(url) {
  let path;
  try { path = new URL(url).pathname; } catch { return ''; }
  for (const re of ASSET_ROOT_PREFIXES) path = path.replace(re, '/');
  return path.toLowerCase().replace(/_/g, '-');
}

// Asset paths agree. Neither side having one counts as a match (nothing was
// dropped), but prod having one while AEM does not does NOT — that asymmetry
// is exactly the "missing asset" defect this check exists to catch.
export function matchAssetPath(a, b) {
  return assetPath(a) === assetPath(b);
}

// Standard check object. `weight` may come back undefined for ids not in W —
// score-main demotes those to advisory instead of scoring them.
export function makeCheck(id, label, passed, detail, partial, diff) {
  return { id, weight: W[id], label, passed: !!passed, detail, partial: partial ?? 0, diff: diff || null };
}

// A download link is an href whose URL *path* (query/fragment excluded)
// ends in one of DOWNLOAD_EXTENSIONS.
export function isDownloadHref(href) {
  let path;
  try { path = new URL(href).pathname.toLowerCase(); } catch { return false; }
  return DOWNLOAD_EXTENSIONS.some(ext => path.endsWith(ext));
}

// Normalised basename for cross-site download matching. AEM re-hosts assets
// under /content/dam/ with different paths and sometimes a -<hash> suffix,
// so full-URL comparison would report every file as missing.
export function downloadBasename(href) {
  return filenameOf(href).replace(/-[0-9a-f]{6,}(\.[a-z0-9]+)$/i, '$1');
}

// Longest strictly-increasing subsequence with membership flags. O(n²) DP —
// textBlocks are capped at 200 in extract.js, so n is small.
export function lis(indices) {
  const n = indices.length;
  if (!n) return { length: 0, keep: [] };
  const len = new Array(n).fill(1);
  const prev = new Array(n).fill(-1);
  let best = 0;
  for (let i = 1; i < n; i++) {
    for (let j = 0; j < i; j++) {
      if (indices[j] < indices[i] && len[j] + 1 > len[i]) { len[i] = len[j] + 1; prev[i] = j; }
    }
    if (len[i] > len[best]) best = i;
  }
  const keep = new Array(n).fill(false);
  for (let i = best; i !== -1; i = prev[i]) keep[i] = true;
  return { length: len[best], keep };
}

// Histogram intersection of two column profiles (re-normalised defensively).
// Returns null when either profile is missing or the shapes differ — the
// caller marks the check `insufficient` in that case, never failed.
export function profileMatch(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) return null;
  const sum = (v) => v.reduce((s, x) => s + x, 0);
  const sa = sum(a), sb = sum(b);
  if (sa <= 0 || sb <= 0) return 0;
  let m = 0;
  for (let i = 0; i < a.length; i++) m += Math.min(a[i] / sa, b[i] / sb);
  return m;
}
