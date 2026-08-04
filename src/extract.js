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

  // --- Main-content text (header/footer/nav chrome excluded) ---
  // bodyText counts the whole page, so the global header+footer (nearly
  // identical on both sites) dilutes the prod-vs-AEM length ratio toward 1 and
  // flatters AEM. contentLength prefers these when both sides have them.
  // Selectors are deliberately NARROW: broad `[class*="header" i]` would also
  // delete legitimate content wrappers like `card-header`/`table-header`.
  const CHROME_SEL = [
    'header', 'footer', 'nav',
    '[role="banner"]', '[role="contentinfo"]', '[role="navigation"]',
    '[class*="site-header" i]', '[class*="site-footer" i]',
    '[class*="page-header" i]', '[class*="page-footer" i]',
    '[class*="global-header" i]', '[class*="global-footer" i]',
    '[class*="navbar" i]', '[class*="main-nav" i]', '[class*="mega-menu" i]',
    '[class*="breadcrumb" i]', '[class*="cookie" i]', '[class*="skip-to" i]',
  ].join(', ');
  const NON_CONTENT_TAGS = { SCRIPT: 1, STYLE: 1, IFRAME: 1, NOSCRIPT: 1, TEMPLATE: 1, SVG: 1 };
  // Prod (Sitecore) ships hidden modals inline — the "leaving our website"
  // confirm and a full Privacy Notice (~15k chars on some pages) sit in the
  // DOM with display:block/visibility:visible but a 0×0 box and NO client
  // rects. Counting them inflated prod's length ~4x and made AEM look like it
  // had dropped 90% of content that is in fact present. Computed style cannot
  // see this; getClientRects() can — the same test extract.js already uses for
  // heading visibility. So walk the live tree and skip unrendered subtrees
  // rather than cloning (a clone is detached, so it has no geometry at all).
  const isRendered = (el) =>
    el.getClientRects().length > 0 || el.offsetWidth > 0 || el.offsetHeight > 0;
  const walkVisible = (root, onElement) => {
    let text = '';
    const visit = (node) => {
      if (node.nodeType === 3) { text += node.nodeValue + ' '; return; }
      if (node.nodeType !== 1) return;
      if (NON_CONTENT_TAGS[node.tagName]) return;
      if (node !== root && node.matches(CHROME_SEL)) return;
      if (!isRendered(node)) return;
      if (onElement) onElement(node);
      for (let i = 0; i < node.childNodes.length; i++) visit(node.childNodes[i]);
    };
    visit(root);
    return text;
  };
  const mainInfo = (() => {
    const explicit = document.querySelector('main, [role="main"], #main-content, #mainContent, .main-content');
    const root = explicit || document.body;
    const blocks = [];
    // Every element the walk accepts — inside root, rendered, not chrome. The
    // walk already applies exactly the scoping rule the image and component
    // counts need, so they reuse its verdict instead of re-deriving it.
    const inScope = new Set();
    const text = norm(walkVisible(root, (el) => {
      inScope.add(el);
      if (/^(H1|H2|H3|H4|P|LI)$/.test(el.tagName)) {
        const t = norm(el.textContent);
        if (t.length > 3) blocks.push(t);
      }
    }));
    // Content-scoped images and components, on the same visible-and-not-chrome
    // basis as the text above. Whole-page counts are dominated by chrome: prod
    // carries 34 of 44 images in the header/footer and 6 hidden cookie-banner
    // "accordions", so alt-text parity was comparing mega-menu icons and the
    // accordion count compared a cookie banner against nothing.
    const mainImages = Array.from(document.querySelectorAll('img'))
      .filter(el => inScope.has(el))
      .map((img) => {
        const r = img.getBoundingClientRect();
        return {
          alt: norm(img.alt),
          src: (img.currentSrc || img.src || '').slice(0, 120),
          naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight,
          renderedWidth: Math.round(r.width), renderedHeight: Math.round(r.height),
        };
      });
    const countIn = (sel) => Array.from(document.querySelectorAll(sel)).filter(el => inScope.has(el)).length;
    const mainComponentCounts = {
      accordion: countIn('[class*="accordion" i], [data-accordion], details, [class*="cmp-accordion"]'),
      table: countIn('table'),
      tableRows: countIn('table tr'),
      form: countIn('form'),
      formInputs: countIn('input, select, textarea'),
      video: countIn('video, iframe[src*="youtube"], iframe[src*="youtu.be"], iframe[allow*="autoplay"]'),
      carousel: countIn('[class*="carousel" i], [class*="slider" i], [data-carousel]'),
      tabs: countIn('[role="tablist"], [class*="tabs" i], [class*="cmp-tabs"]'),
    };

    // Unfiltered length of the same root, for diagnosis only: if a capture
    // lands before layout settles, every subtree reports zero rects and `text`
    // collapses to 0 while `raw` stays large. Scoring compares the two so a
    // not-yet-laid-out page is never read as "content deleted".
    const rawClone = root.cloneNode(true);
    rawClone.querySelectorAll('script, style, iframe, noscript, template, svg').forEach(el => el.remove());
    return {
      source: explicit ? 'main' : 'body-minus-chrome',
      text,
      rawLength: norm(rawClone.textContent).length,
      blocks: blocks.slice(0, 200),
      images: mainImages.slice(0, 30),
      componentCounts: mainComponentCounts,
    };
  })();

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
    mainTextLength: mainInfo.text.length,
    mainTextRawLength: mainInfo.rawLength,
    mainTextSource: mainInfo.source,
    // Full rendered main text (capped). missingText segments this at SCORE
    // time rather than storing pre-cut segments, so the segmentation rule can
    // be retuned without another capture run.
    mainTextFull: mainInfo.text.slice(0, 40000),
    mainImages: mainInfo.images,
    mainComponentCounts: mainInfo.componentCounts,
    mainTextSample: mainInfo.text.slice(0, 800),
    mainTextBlocks: mainInfo.blocks,
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
