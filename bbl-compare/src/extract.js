// Browser-side metric extraction. This function is serialized and run inside
// the page via page.evaluate(), so it must be self-contained (no imports, no
// closures over Node variables). Returns a plain object of metrics.

export const EXTRACT_FN = () => {
  const norm = (s) => (s || '').trim().replace(/\s+/g, ' ');
  const qsa = (sel) => Array.from(document.querySelectorAll(sel));

  // --- Headings (with level + visibility) ---
  const headingEls = qsa('h1, h2, h3, h4');
  const headings = headingEls.map(h => ({
    level: parseInt(h.tagName.slice(1), 10),     // 1–4
    text: norm(h.textContent),                    // textContent (CSS-safe, matches AEM)
    tag: h.tagName,
    isVisible: h.offsetWidth > 0 || h.offsetHeight > 0 || h.getClientRects().length > 0,
  })).filter(h => h.text);

  // --- Links ---
  const links = qsa('a[href]').map(a => ({
    text: norm(a.innerText).slice(0, 80),
    href: a.getAttribute('href') || '',
  }));

  // --- Images ---
  const images = qsa('img').map(img => ({
    alt: norm(img.alt),
    src: (img.currentSrc || img.src || '').slice(0, 120),
  }));

  // --- Meta tags ---
  const meta = (name) => {
    const el = document.querySelector(`meta[name="${name}"], meta[property="${name}"]`);
    return el ? norm(el.content) : '';
  };
  const metaTags = {
    title: norm(document.title),
    description: meta('description'),
    canonical: (document.querySelector('link[rel="canonical"]') || {}).href || '',
    ogTitle: meta('og:title'),
    ogImage: meta('og:image'),
    keywords: meta('keywords'),
  };

  // --- Accordion sections (try several selectors AEM + generic) ---
  const accEls = qsa('[class*="accordion" i], [data-accordion], details, [class*="cmp-accordion"]');
  const accordions = accEls.map(a => ({
    title: norm(a.querySelector('summary, button, h3, h4, [class*="title" i]')?.innerText || '').slice(0, 80),
    bodyChars: norm(a.innerText).length,
    isFilled: norm(a.innerText).length > 40,
  }));
  const emptyAccordions = accordions.filter(a => !a.isFilled).length;

  // --- Header / nav ---
  const header = document.querySelector('header, [class*="header" i], nav');
  const headerLinkCount = header ? header.querySelectorAll('a[href]').length : 0;

  // --- Footer ---
  const footer = document.querySelector('footer, [class*="footer" i]');
  const footerLinkCount = footer ? footer.querySelectorAll('a[href]').length : 0;

  // --- Social icons ---
  const social = {
    facebook: !!document.querySelector('a[href*="facebook"]'),
    line: !!document.querySelector('a[href*="line.me"], a[href*="linecorp"]'),
    twitter: !!document.querySelector('a[href*="twitter"], a[href*="x.com"]'),
    youtube: !!document.querySelector('a[href*="youtube"]'),
  };

  // --- Leaked AEM internal paths (bug indicator on the migrate site) ---
  const html = document.documentElement.innerHTML;
  const leakedPaths = [...new Set((html.match(/\/content\/bangkokbank\/[^\s"'<>)\\]+/g) || []))].slice(0, 12);

  // --- Feature presence ---
  // Build a clean text snapshot: clone body and strip non-content elements
  // (script/style/iframe/noscript/template) so textContent reflects actual
  // page copy, not embedded code. textContent (not innerText) is needed
  // because AEM hides content via CSS during load, making innerText return 0.
  const cleanClone = document.body.cloneNode(true);
  cleanClone.querySelectorAll('script, style, iframe, noscript, template, svg').forEach(el => el.remove());
  const bodyText = norm(cleanClone.textContent);
  const features = {
    login: /login|เข้าสู่ระบบ|ล็อกอิน/i.test(bodyText.slice(0, 3000)),
    languageSwitch: !!document.querySelector('[class*="language" i], [class*="lang-" i]'),
    cookieBanner: /cookie|คุกกี้/i.test(bodyText.slice(0, 4000)),
    searchBox: !!document.querySelector('input[type="search"], [role="search"], [class*="search" i] input'),
  };

  return {
    headingCount: headings.length,
    headings,
    linkCount: links.length,
    links,
    imageCount: images.length,
    images: images.slice(0, 30),  // cap for payload size
    meta: metaTags,
    accordionCount: accordions.length,
    emptyAccordions,
    accordions: accordions.slice(0, 20),
    headerLinkCount,
    footerLinkCount,
    social,
    leakedContentPaths: leakedPaths,
    features,
    textLength: bodyText.length,
    pageHeight: document.documentElement.scrollHeight,
    bodyTextSample: bodyText.slice(0, 800),
    // Top words by frequency (for content keyword diff) — Thai + Latin, length >= 2.
    topWords: (() => {
      const words = bodyText.toLowerCase().match(/[\u0E00-\u0E7F]{2,}|[a-z]{3,}/g) || [];
      const freq = {};
      words.forEach(w => { freq[w] = (freq[w] || 0) + 1; });
      return Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 40).map(([w, c]) => ({ w, c }));
    })(),
  };
};
