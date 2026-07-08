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

  // --- Links (absolute href for broken-link checking) ---
  const links = qsa('a[href]').map(a => ({
    text: norm(a.textContent).slice(0, 80),
    href: a.href,  // absolute URL (a.href resolves relative to base)
  }));

  // --- Images (with rendered + natural dims for distortion detection) ---
  const images = qsa('img').map(img => {
    const r = img.getBoundingClientRect();
    return {
      alt: norm(img.alt),
      src: (img.currentSrc || img.src || '').slice(0, 120),
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
      renderedWidth: Math.round(r.width),
      renderedHeight: Math.round(r.height),
    };
  }).filter(img => img.renderedWidth > 0);  // skip hidden images

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
    publishDate: meta('article:published_time') || meta('publish_date') || meta('date'),
    section: meta('article:section'),
  };

  // --- Accordion sections (try several selectors AEM + generic) ---
  const accEls = qsa('[class*="accordion" i], [data-accordion], details, [class*="cmp-accordion"]');
  const accordions = accEls.map(a => ({
    title: norm(a.querySelector('summary, button, h3, h4, [class*="title" i]')?.innerText || '').slice(0, 80),
    bodyChars: norm(a.innerText).length,
    isFilled: norm(a.innerText).length > 40,
  }));
  const emptyAccordions = accordions.filter(a => !a.isFilled).length;

  // --- Component counts (for the new `components` parity check) ---
  const componentCounts = {
    accordion: accordions.length,
    table:     document.querySelectorAll('table').length,
    tableRows: document.querySelectorAll('table tr').length,
    form:      document.querySelectorAll('form').length,
    formInputs:document.querySelectorAll('input, select, textarea').length,
    video:     document.querySelectorAll(
                 'video, iframe[src*="youtube"], iframe[src*="youtu.be"], iframe[allow*="autoplay"]'
               ).length,
    carousel:  document.querySelectorAll('[class*="carousel" i], [class*="slider" i], [data-carousel]').length,
    tabs:      document.querySelectorAll('[role="tablist"], [class*="tabs" i], [class*="cmp-tabs"]').length,
  };

  // --- Header / nav (labels for the new headerMenu check) ---
  const header = document.querySelector('header, [class*="header" i], nav');
  const headerMenus = header
    ? Array.from(new Set(Array.from(header.querySelectorAll('a[href]'))
        .map(a => norm(a.textContent).slice(0, 80))
        .filter(Boolean)))
        .map(label => ({ label }))
        .slice(0, 80)
    : [];
  const headerLinkCount = header ? header.querySelectorAll('a[href]').length : 0;

  // --- Footer (labels for the new footerMenu check) ---
  const footer = document.querySelector('footer, [class*="footer" i]');
  const footerMenus = footer
    ? Array.from(new Set(Array.from(footer.querySelectorAll('a[href]'))
        .map(a => norm(a.textContent).slice(0, 80))
        .filter(Boolean)))
        .map(label => ({ label }))
        .slice(0, 80)
    : [];
  const footerLinkCount = footer ? footer.querySelectorAll('a[href]').length : 0;

  // --- Social icons ---
  const social = {
    facebook: !!document.querySelector('a[href*="facebook"]'),
    line: !!document.querySelector('a[href*="line.me"], a[href*="linecorp"]'),
    twitter: !!document.querySelector('a[href*="twitter"], a[href*="x.com"]'),
    youtube: !!document.querySelector('a[href*="youtube"]'),
  };

  // --- News-specific: breadcrumb + share buttons ---
  // Breadcrumb: look for common breadcrumb patterns (nav, ol, schema).
  const breadcrumbEl = document.querySelector(
    '[class*="breadcrumb" i], [aria-label="breadcrumb" i], nav ol li a, [itemtype*="Breadcrumb"]'
  );
  const breadcrumbItems = Array.from(document.querySelectorAll(
    '[class*="breadcrumb" i] a, [class*="breadcrumb" i] li, [aria-label="breadcrumb" i] a, [itemtype*="Breadcrumb"] [itemprop="name"]'
  )).map(el => norm(el.textContent)).filter(Boolean).slice(0, 10);

  // Share buttons: look for elements with share-related classes or social share links.
  const shareBtns = {
    count: document.querySelectorAll(
      '[class*="share" i] a, [class*="share" i] button, [class*="social-share" i] a, a[href*="sharer"], a[onclick*="share"]'
    ).length,
    hasFacebook: !!document.querySelector('[class*="share" i] a[href*="facebook"], a[href*="sharer"][href*="facebook"], [class*="share" i] [class*="facebook" i]'),
    hasLine: !!document.querySelector('[class*="share" i] a[href*="line"], a[href*="sharer"][href*="line"], [class*="share" i] [class*="line" i]'),
    hasTwitter: !!document.querySelector('[class*="share" i] a[href*="twitter"], a[href*="sharer"][href*="twitter"], a[href*="share" i] [class*="twitter" i]'),
    hasEmail: !!document.querySelector('[class*="share" i] a[href*="mailto"], [class*="share" i] [class*="email" i]'),
    hasPrint: !!document.querySelector('[class*="share" i] [class*="print" i], [class*="share" i] button[onclick*="print"]'),
  };

  // --- Leaked AEM internal paths (bug indicator on the migrate site) ---
  const html = document.documentElement.innerHTML;
  const leakedPaths = [...new Set((html.match(/\/content\/bangkokbank\/[^\s"'<>)\\]+/g) || []))].slice(0, 12);

  // --- Heuristic "other components" (advisory only — not scored) ---
  const otherComponents = [];
  if (document.querySelector('[role="dialog"], [class*="modal" i]')) otherComponents.push('dialog/modal');
  if (document.querySelector('canvas')) otherComponents.push('canvas');
  if (document.querySelector('[role="alert"], [class*="notification" i], [class*="toast" i]')) otherComponents.push('notification');
  if (document.querySelector('[class*="map" i], iframe[src*="google.com/maps"], iframe[src*="map"]')) otherComponents.push('map');
  if (document.querySelector('audio')) otherComponents.push('audio');

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
    componentCounts,
    headerMenus,
    footerMenus,
    otherComponents,
    social,
    breadcrumb: { hasBreadcrumb: !!breadcrumbEl, items: breadcrumbItems },
    shareBtns,
    leakedContentPaths: leakedPaths,
    features,
    textLength: bodyText.length,
    pageHeight: document.documentElement.scrollHeight,
    bodyTextSample: bodyText.slice(0, 800),
    // News-specific: extract article body from known containers.
    // prod uses .modal-body.pad-bot, AEM uses .news-media-details-container.
    newsContent: (() => {
      const el = document.querySelector('.modal-body.pad-bot, .modal-body') ||
                 document.querySelector('.news-media-details-container, .news-media-details');
      if (!el) return { found: false, text: '', textLength: 0, sample: '' };
      const t = norm(el.textContent);
      return { found: true, text: t, textLength: t.length, sample: t.slice(0, 800) };
    })(),
    // News-specific: images inside the article content container only.
    // (excludes nav icons, logos, share buttons, etc.)
    newsImages: (() => {
      const container = document.querySelector('.modal-body.pad-bot, .modal-body') ||
                        document.querySelector('.news-media-details-container, .news-media-details');
      if (!container) return { found: false, count: 0, images: [] };
      const imgs = Array.from(container.querySelectorAll('img')).map(img => {
        const r = img.getBoundingClientRect();
        return {
          alt: norm(img.alt),
          src: (img.currentSrc || img.src || '').slice(0, 120),
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
          renderedWidth: Math.round(r.width),
          renderedHeight: Math.round(r.height),
        };
      }).filter(img => img.renderedWidth > 10); // skip tiny icons
      return { found: true, count: imgs.length, images: imgs };
    })(),
    // News-specific: extract headline from known title containers.
    // prod: .text-large.text-light.pad-bot (inside .center-content.editor)
    // AEM: first long <p> inside .news-media-details (no specific class)
    newsTitle: (() => {
      // prod pattern
      const prodEl = document.querySelector('.text-large.text-light.pad-bot');
      if (prodEl) return { found: true, text: norm(prodEl.textContent), source: '.text-large.text-light.pad-bot' };
      // AEM pattern: first <p> with >20 chars inside news-media-details
      // (skip GUIDs and short metadata like dates/paths)
      const aemContainer = document.querySelector('.news-media-details, .news-media-details-container, .news-media-details-wrapper');
      if (aemContainer) {
        const ps = aemContainer.querySelectorAll('p, h1, h2, h3, h4');
        for (const p of ps) {
          const t = norm(p.textContent);
          // Skip GUIDs, dates, paths, short metadata, "Read More" etc.
          if (t.length > 20 &&
              !/^[0-9a-f]{8}-[0-9a-f]{4}/i.test(t) &&  // GUID
              !/^\d{1,2}\s+[ก-๛]/.test(t) &&             // Thai date
              !/^\/th\//.test(t) &&                        // URL path
              !/^read|bangkokbank:assets/i.test(t)) {      // metadata
            return { found: true, text: t, source: 'news-media-details > p' };
          }
        }
      }
      return { found: false, text: '', source: '' };
    })(),
    // News-specific: extract publish date from article containers only.
    // prod: <p class="text-default pad-bot"> inside .modal-body.pad-bot
    // AEM: date element inside .news-media-details (if present)
    publishDateFromContent: (() => {
      // prod: look for date in .text-default.pad-bot inside modal-body
      const prodContainer = document.querySelector('.modal-body.pad-bot, .modal-body');
      if (prodContainer) {
        const dateEl = prodContainer.querySelector('.text-default.pad-bot, .text-default');
        if (dateEl) {
          const t = norm(dateEl.textContent);
          const m = t.match(/(\d{1,2}\s+[ก-๛]{2,10}\s*\d{4})/);
          if (m) return m[1];
        }
      }
      // AEM: look for date element inside news-media-details
      const aemContainer = document.querySelector('.news-media-details, .news-media-details-container, .news-media-details-wrapper');
      if (aemContainer) {
        const els = aemContainer.querySelectorAll('p, span, div, time');
        for (const el of els) {
          if (el.children.length === 0) {
            const t = norm(el.textContent);
            const m = t.match(/(\d{1,2}\s+[ก-๛]{2,10}\s*\d{4})/);
            if (m && t.length < 30) return m[1];
          }
        }
      }
      // Last resort: meta tag (but skip if it's a timestamp like ISO format — that's capture time, not article date)
      if (metaTags.publishDate && !/^\d{4}-\d{2}-\d{2}T/.test(metaTags.publishDate)) return metaTags.publishDate;
      return '';
    })(),
    // Thai/Latin script ratio — catches language-regression (wrong-language render).
    thaiRatio: (() => {
      const thai = (bodyText.match(/[\u0E00-\u0E7F]/g) || []).length;
      const latin = (bodyText.match(/[A-Za-z]/g) || []).length;
      return thai + latin > 0 ? thai / (thai + latin) : 0;
    })(),
    // Text blocks for content diff (filter dynamic blocks later in compare).
    textBlocks: qsa('h1,h2,h3,h4,p,li').map(el => norm(el.textContent)).filter(t => t.length > 3).slice(0, 200),
    // Top words by frequency (for content keyword diff) — Thai + Latin, length >= 2.
    topWords: (() => {
      const words = bodyText.toLowerCase().match(/[\u0E00-\u0E7F]{2,}|[a-z]{3,}/g) || [];
      const freq = {};
      words.forEach(w => { freq[w] = (freq[w] || 0) + 1; });
      return Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 40).map(([w, c]) => ({ w, c }));
    })(),
  };
};
