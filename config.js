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

// ─── Sheet write-back (src/sync-sheet.js) ──────────────────────────────────
// A separate spreadsheet (the manual QA master file) with tracking columns
// this tool writes into: F=Automatiion Validation Status, G=Open Issues.
// Requires a Google service-account key at SYNC_KEY_PATH, shared as EDITOR
// on this spreadsheet — see README "Sheet sync" section.
export const SYNC_SPREADSHEET_ID = '1K2t3E8tYkL7ff3IK8j3j09I6zMIc_mHnES1L3SVwl2w';
export const SYNC_SHEET_GID = 1196950349; // "TH Pages - Categorized" — the main 631-page list
export const SYNC_KEY_PATH = process.env.SHEET_SYNC_KEY_PATH || join(ROOT, '.secrets', 'sheet-sync-key.json');
export const SYNC_STATUS_COL = 'F';
export const SYNC_ISSUES_COL = 'G';
export const SYNC_ISSUES_MAX = 3;    // max distinct issue labels per cell (kept concise)
export const SYNC_BATCH_SIZE = 200;  // ranges per batchUpdate call
export const SYNC_BATCH_DELAY = 500; // ms between batchUpdate calls
// Tracks the results.json `generatedAt` last synced to the sheet, per source
// file, so re-running sync-sheet.js against the SAME compare run doesn't
// advance the validation round again — only a fresh `npm run compare` does.
export const SYNC_STATE_PATH = join(DIR.data, 'sync-state.json');

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
