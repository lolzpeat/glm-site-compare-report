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

// Text-length is considered "matching" if AEM is within this fraction of prod.
export const TEXT_MATCH_TOLERANCE = 0.30;

// Parity score at/above which a page is flagged PASS in the dashboard.
export const PASS_THRESHOLD = 85;

// Where to find a Chrome binary. puppeteer-core does not download one.
// Prefer the Chrome for Testing that agent-browser/puppeteer cache already have.
export const CHROME_EXECUTABLE_PATH =
  process.env.PUPPETEER_EXECUTABLE_PATH ||
  '/Users/prapon.t/.cache/puppeteer/chrome/mac_arm-*/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
