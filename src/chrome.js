// Chrome binary resolution, shared by compare.js and waf-probe.js.
// Lives in its own module because waf-probe must not import compare.js —
// compare.js starts a capture run on import.
import { existsSync } from 'node:fs';
import { glob } from 'node:fs/promises';
import { CHROME_EXECUTABLE_PATH } from '../config.js';

export async function resolveChrome() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH && existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  // Glob the puppeteer cache for the Chrome for Testing binary.
  const pattern = CHROME_EXECUTABLE_PATH;
  for await (const p of glob(pattern)) {
    if (existsSync(p)) return p;
  }
  // Fallback: try agent-browser's Chrome.
  const ab = '/Users/prapon.t/.agent-browser/browsers/chrome-148.0.7778.97/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
  if (existsSync(ab)) return ab;
  throw new Error('No Chrome binary found. Set PUPPETEER_EXECUTABLE_PATH or install Chrome.');
}
