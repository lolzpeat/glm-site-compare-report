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
// Hard ceiling on any single scroll/decode page.evaluate during lazy-load
// stimulation. evaluate() can hang indefinitely when the renderer is busy or
// navigating, and .catch() never fires for a promise that never settles — a
// search page once stalled a run for 26 minutes. Stimulation is best-effort,
// so a page that will not cooperate is simply extracted as-is.
export const STIMULATE_STEP_TIMEOUT = 5000; // ms ceiling per stimulation evaluate
export const LAYOUT_WAIT_TIMEOUT = 18000; // ms to wait for AEM client-render layout to settle (scrollHeight > viewport)

// HTTP statuses that mean "the server refused this attempt, try later" rather
// than "this page is genuinely different". Such a response still loads a real
// body, so without this the page scores as a 0%-parity failure instead of
// being flagged for re-capture. 404 is deliberately absent: it IS a finding.
export const RETRYABLE_HTTP_STATUS = [408, 429, 500, 502, 503, 504];

export const CONCURRENCY = 4;          // parallel URL-pair workers
export const REQUEST_PACING_MS = 0;    // ms delay after each page in a worker (0 = off, default).
                                        // prod's WAF burst-rate-limits even at --concurrency=1 (2026-07-09:
                                        // 2 requests through, then every subsequent one got ERR_HTTP2_PROTOCOL_ERROR).
                                        // Set via --pacing=N when retrying previously-blocked pages.
// ─── Safe chunked run (src/safe-run.js) ────────────────────────────────────
// Empirical ban threshold: the WAF (Akamai) starts blocking after ~120-200
// heavy page-loads within a ~15-20 min sliding window (see AGENTS.md gotchas,
// 2026-07-08/09 incidents — analysis in results-632.json.bak). The block is a
// rate-window ban that lifts on its own after ~15 min, so splitting a full
// recapture into small chunks with a long pause between them lets each chunk
// land in a FRESH rate window instead of piling onto the previous one. This
// is more reliable than --pacing alone, which only slows requests but never
// clears the window.
export const SAFE_CHUNK_SIZE = 50;       // pages per chunk (margin 4x under the ~200 ban threshold)
export const SAFE_CHUNK_PAUSE_MS = 20 * 60 * 1000; // pause between chunks — lets the rate window clear
export const SAFE_CHUNK_CONCURRENCY = 2; // workers per chunk (1-2 is safe; 4 is what gets IPs banned)
export const SAFE_CHUNK_PACING_MS = 0;   // per-page delay inside a chunk (0 = off; pacing didn't clear bans in tests)
// Abort the run if a chunk produces this fraction of BLOCKED results — a high
// block rate means the IP is banned (not a per-page issue) and continuing
// would just fill results.json with garbage. --force auto-runs bypass this.
export const SAFE_BLOCK_ABORT_RATIO = 0.5;

// ─── Meta inventory scrape (src/scrape-meta.js) ────────────────────────────
// Scrapes title/description/ogTitle/ogImage/keywords from the PRODUCTION URLs
// listed in the "BBL Thai Manual Pages" tab of the QA master sheet (private —
// read via the service-account key, not the public CSV export). Same Akamai
// WAF applies, so this mirrors the SAFE_* guards: small chunks + long pause so
// each chunk lands in a fresh rate window. Meta lives in <head> HTML from the
// first byte, so we don't need full render — request interception blocks
// image/font/css/media to cut per-page request volume well under compare.js.
export const MANUAL_SHEET_GID = 2064171466;   // tab "BBL Thai Manual Pages"
export const META_SHEET_TAB_NAME = 'BBL Thai Manual Pages';
export const META_CHUNK_SIZE = 50;            // pages per chunk (under the ~200 ban threshold)
export const META_CHUNK_PAUSE_MS = 20 * 60 * 1000; // pause between chunks — lets the rate window clear
export const META_CONCURRENCY = 1;            // 1 is the proven-safe value (same as news)
export const META_PACING_MS = 2000;           // per-page delay (meta is light, so pace up)
export const META_NAV_TIMEOUT = 20000;        // ms — shorter than NAV_TIMEOUT, no heavy render needed
// Block detection + abort reuse SAFE_BLOCK_ABORT_RATIO. Request types to drop
// (meta doesn't need any of them): images, fonts, stylesheets, media.
export const META_BLOCKED_RESOURCE_TYPES = ['image', 'font', 'stylesheet', 'media'];

// ─── Priority pipeline (tab "Priority BBL Thai Manual Pages") ──────────────
// Re-mapped URL list on the QA master sheet: col B "Create Prod URL" carries
// the NEW AEM URLs (main--site-prod--bangkok-bank.aem.live) replacing the old
// blocked AEM host. Only rows whose Status matches PRIORITY_STATUS_FILTER
// (trimmed, case-insensitive) are captured.
export const PRIORITY_SHEET_TAB_NAME = 'Priority BBL Thai Manual Pages';
export const PRIORITY_STATUS_FILTER = ['Done'];
export const PRIORITY_URLS_PATH = join(DIR.data, 'urls-priority.csv');

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

// ─── v2 criteria (defect-aligned) ──────────────────────────────────────────
// 5 groups named after QA's recurring defect categories. Lives beside the
// old WEIGHTS_MAIN until rescore output is reviewed; the promotion step
// replaces WEIGHTS_MAIN/CRITERIA_GROUPS with these values and deletes the
// _V2 names. See docs/superpowers/specs/2026-08-04-defect-aligned-criteria-design.md
export const WEIGHTS_MAIN_V2 = {
  // Missing content (30%)
  // `missingKeywords` is deliberately ABSENT: it failed on every scored page
  // (358/358 main, 15/15 priority), so it carried no discriminating signal.
  // checks-content.js still emits it; score-main demotes any check whose id is
  // missing here to an unscored advisory. Its 0.08 was split into the two
  // remaining content checks, keeping the group at 30%.
  contentLength:       0.13,
  missingText:         0.17,
  // Missing assets (25%)
  // `imageAlt` was removed entirely (not demoted) 2026-08-05: prod writes Thai
  // alt text and AEM writes English for the same asset, and prod's content
  // imagery is not exposed as <img> at all, so no comparison was possible.
  // Its 0.04 was split into the two remaining asset checks, keeping the group
  // at 25%. See src/scoring/checks-assets.js for the evidence.
  missingImage:        0.12,  // count only
  brokenImage:         0.13,  // tag renders but file never loads
  // Content alignment (20%)
  contentOrder:        0.10,  // LIS over shared text blocks
  visualLayout:        0.10,  // screenshot column-profile match
  // Download links (15%)
  missingDownloadLink: 0.09,
  deadDownloadLink:    0.06,
  // Structure & template (10%)
  headings:            0.04,
  links:               0.02,
  meta:                0.02,
  template:            0.02,  // header+footer+components merged
};

export const CRITERIA_GROUPS_V2 = [
  { id: 'missing-content', label: 'Missing content',      weight: 0.30, checks: ['contentLength', 'missingText'] },
  { id: 'missing-assets',  label: 'Missing assets',       weight: 0.25, checks: ['missingImage', 'brokenImage'] },
  { id: 'alignment',       label: 'Content alignment',    weight: 0.20, checks: ['contentOrder', 'visualLayout'] },
  { id: 'downloads',       label: 'Download links',       weight: 0.15, checks: ['missingDownloadLink', 'deadDownloadLink'] },
  { id: 'structure',       label: 'Structure & template', weight: 0.10, checks: ['headings', 'links', 'meta', 'template'] },
];

// Download-link checks: an href whose URL *path* ends in one of these.
export const DOWNLOAD_EXTENSIONS = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.zip'];

// contentOrder: pass threshold on LIS/shared ratio; below MIN_BLOCKS shared
// blocks the check is `insufficient` (LIS over a tiny sample is noise).
export const CONTENT_ORDER_PASS = 0.90;
export const CONTENT_ORDER_MIN_BLOCKS = 5;

// visualLayout: column-ink profiles binned to this many buckets; pass when
// histogram intersection ≥ LAYOUT_PROFILE_PASS. Thresholds get tuned during
// the hand-check calibration step.
export const LAYOUT_PROFILE_BINS = 64;
export const LAYOUT_PROFILE_PASS = 0.85;
export const LAYOUT_PROFILE_PATH = join(DIR.data, 'layout-profiles.json');

// check-downloads.js — HEAD requests against BBL hosts (WAF applies).
export const LINK_HEAD_CONCURRENCY = 4;
export const LINK_HEAD_PACING_MS = 250;
export const LINK_HEAD_TIMEOUT = 10000;
export const LINK_STATUS_PATH = join(DIR.data, 'link-status.json');

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

// ─── Meta-tag check (src/scoring/checks-structure.js) ──────────────────────
// `canonical` is deliberately absent: production emits none at all while AEM
// always does, so the pair carried no comparable signal — only a guaranteed
// mismatch. ogImage is compared by asset PATH, not URL: the two sites serve
// the same asset from different hosts and CMS roots.
export const META_KEYS = ['title', 'description', 'ogTitle', 'ogImage'];
// Reported (present / absent per side) but never scored. `keywords` carries no
// migration-parity signal — it is an editorial field the two CMSes populate
// differently — so it informs without moving the number.
export const META_INFO_KEYS = ['keywords'];
// CMS asset roots stripped before comparing an ogImage path.
// prod (Sitecore): /-/media/<path>   ·   AEM: /content/dam/<path>
export const ASSET_ROOT_PREFIXES = [/^\/-\/media\//i, /^\/content\/dam\//i];

// missingText segmentation (src/scoring/checks-content.js `segmentsOf`).
// Prod sentences are matched as substrings of AEM's rendered main text, so
// markup shape (<p>/<li> vs <table><td>) no longer affects the result.
// Larger = more distinctive units but one edited word fails a longer span.
export const SEGMENT_MIN_CHARS = 60;
export const SEGMENT_TAIL_MIN_CHARS = 12;

// Parity score at/above which a page is flagged PASS in the dashboard.
export const PASS_THRESHOLD = 85;

// ─── Thai/Latin script ratio (language-regression signal) ──────────────────
// Flag when the Thai-character fraction differs by more than this between
// prod and AEM — catches "page rendered in wrong language" defects.
export const THAI_RATIO_DELTA = 0.10;

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
