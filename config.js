// Central configuration for the BBL migration parity checker.
// Every script imports from here so thresholds/concurrency live in one place.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const ROOT = dirname(fileURLToPath(import.meta.url));
export const DIR = {
  data: join(ROOT, 'data'),
  screenshots: join(ROOT, 'data', 'screenshots'),
  output: join(ROOT, 'output'),
  pages: join(ROOT, 'output', 'pages'),
};

// Google Sheet export — column A (prod URL), B (AEM URL), D (Category), E (Sub-Category)
// gid=1796448275 is the tab with the full page list.
export const SHEET_CSV_URL =
  'https://docs.google.com/spreadsheets/d/1iwZ4lj3RfLM1aCGSeGUqbCoI-R8PWuzE/export?format=csv&gid=1796448275';

// Browser / capture
export const VIEWPORT = { width: 1440, height: 900 };
export const NAV_TIMEOUT = 25000;      // ms per page navigation (prod is slow to fully load)
export const NAV_WAIT_UNTIL = 'domcontentloaded'; // don't wait for idle network (tracking keeps it busy forever)
export const SETTLE_AFTER_LOAD = 800; // ms to let async content render after DOM is ready
export const LAZY_WAIT_TIMEOUT = 3500; // ms to wait for client-rendered text to appear (AEM)
export const LAYOUT_WAIT_TIMEOUT = 18000; // ms to wait for AEM client-render layout to settle (scrollHeight > viewport)
export const CONCURRENCY = 4;          // parallel URL-pair workers
export const SCREENSHOT_FULLPAGE = true;
export const SCREENSHOT_MAX_WIDTH = 800; // resize screenshots to this width (px) to save disk + speed up

// BBL AEM's anti-bot detection returns a blank page without a realistic
// User-Agent; every page sets these before navigating (see capturePage).
export const CAPTURE_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';
export const CAPTURE_ACCEPT_LANGUAGE = 'th-TH,th;q=0.9,en;q=0.8';

// AEM renders the global header/footer nav lazily, a few seconds after the
// body reaches full height. Extra wait window + poll interval for the
// header/footer-populated check in capturePage.
export const HEADER_FOOTER_WAIT_EXTRA = 4000; // ms added on top of SETTLE_AFTER_LOAD
export const HEADER_FOOTER_POLL = 250;        // ms between checks

// If extracted body text is shorter than this (chars), try scroll-stimulating
// lazy-loaded content (AEM client-side render can start near-empty).
export const MIN_TEXT_LEN = 200;
export const SCROLL_STIMULATE_STEPS = 4;
export const SCROLL_STIMULATE_DELAY = 300; // ms between scroll steps

// Parity score weights — must sum to 1.0
export const WEIGHTS = {
  headings: 0.25,
  links: 0.20,
  text: 0.15,
  meta: 0.15,
  accordions: 0.15,
  headerFooter: 0.10,
};

// Main-dashboard criteria (pilot): 11 checks in 3 groups, sums to 1.00.
// Replaces WEIGHTS for main-mode scoring. Weights/thresholds here can be tuned
// later without re-capturing pages (re-score from cached metrics is enough).
export const WEIGHTS_MAIN = {
  // Template parity (25%)
  headerMenu:      0.08,  // header label + count match
  footerMenu:      0.07,  // footer label + count match
  components:      0.10,  // accordion/table/form/video parity

  // Content parity (50%)
  contentLength:   0.14,  // text length within ±30%
  missingText:     0.14,  // prod text blocks present in AEM
  missingKeywords: 0.12,  // prod keywords present in AEM
  missingImage:    0.10,  // image count ≥80% + alt match >50%

  // Structure / SEO (25%)
  headings:        0.10,  // Jaccard > 0.6
  links:           0.08,  // link-text hit > 50%
  meta:            0.05,  // meta tags match (partial credit)
  thaiBalance:     0.02,  // Thai/Latin ratio delta
};

// Group definitions — used by both compare (sub-score calc) and dashboard
// (grouped rendering). `checks` lists the WEIGHTS_MAIN keys in display order.
export const CRITERIA_GROUPS = [
  { id: 'template',  label: 'Template',         weight: 0.25, checks: ['headerMenu', 'footerMenu', 'components'] },
  { id: 'content',   label: 'Content',          weight: 0.50, checks: ['contentLength', 'missingText', 'missingKeywords', 'missingImage'] },
  { id: 'structure', label: 'Structure / SEO',  weight: 0.25, checks: ['headings', 'links', 'meta', 'thaiBalance'] },
];

// News article weights — focused on 5 news-specific elements only.
// Ignores generic checks (accordions, mega menu, etc.) that don't apply to articles.
export const WEIGHTS_NEWS = {
  title: 0.25,         // หัวข้อข่าว (H1 + og:title) ต้องตรงกัน
  publishDate: 0.15,   // วันที่เผยแพร่ต้องตรง
  content: 0.30,       // เนื้อหาข่าวต้องใกล้เคียงกัน
  images: 0.15,        // รูปประกอบต้องมีจำนวนใกล้เคียง + alt text
  breadcrumbShare: 0.15, // breadcrumb + ปุ่มแชร์ (social) ต้องมีครบ
};

// Text-length is considered "matching" if AEM is within this fraction of prod.
export const TEXT_MATCH_TOLERANCE = 0.30;

// Parity score at/above which a page is flagged PASS in the dashboard.
export const PASS_THRESHOLD = 85;

// ─── Thai/Latin script ratio (language-regression signal) ──────────────────
// Flag when the Thai-character fraction differs by more than this between
// prod and AEM — catches "page rendered in wrong language" defects.
export const THAI_RATIO_DELTA = 0.10;

// ─── Image distortion ───────────────────────────────────────────────────────
// Flag when rendered aspect ratio differs by more than this fraction, or when
// AEM distorts an image (rendered ≠ natural) that prod rendered correctly.
export const IMAGE_RATIO_TOLERANCE = 0.02;

// ─── Broken link detection ──────────────────────────────────────────────────
// In-browser fetch of AEM links to check HTTP status. Only checks same-origin
// (AEM host) links to avoid CORS — caps to keep it fast.
export const MAX_LINK_CHECKS = 30;
export const LINK_CHECK_BATCH = 5;
export const LINK_CHECK_DELAY = 300; // ms between batches

// Where to find a Chrome binary. puppeteer-core does not download one.
// Prefer the Chrome for Testing that agent-browser/puppeteer cache already have.
export const CHROME_EXECUTABLE_PATH =
  process.env.PUPPETEER_EXECUTABLE_PATH ||
  '/Users/prapon.t/.cache/puppeteer/chrome/mac_arm-*/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
