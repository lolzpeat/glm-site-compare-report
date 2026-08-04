// Minimal-but-valid metric objects matching what extract.js produces
// (the shape stored at page.prod.metrics / page.aem.metrics in results.json).
export function metrics(over = {}) {
  return {
    headingCount: 0, headings: [],
    linkCount: 0, links: [],
    imageCount: 0, images: [],
    meta: {},
    accordionCount: 0, emptyAccordions: 0, accordions: [],
    headerLinkCount: 0, footerLinkCount: 0,
    componentCounts: { accordion: 0, table: 0, tableRows: 0, form: 0, formInputs: 0, video: 0, carousel: 0, tabs: 0 },
    headerMenus: [], footerMenus: [], otherComponents: [],
    social: {}, features: {}, leakedContentPaths: [],
    textLength: 1000, bodyTextSample: 'sample', thaiRatio: 0.5,
    textBlocks: [], topWords: [],
    ...over,
  };
}
