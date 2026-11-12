const escapeAttribute = (value: string): string => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

/**
 * What Safari on iOS reads for a home-screen app: without `apple-mobile-web-app-capable`
 * a launch leaves the URL bar in place, and without `apple-touch-icon` the icon is a
 * screenshot of the page. `black` keeps white status-bar text over the dark app while
 * leaving the content below the bar, so no safe-area inset is needed.
 */
export const headTags = ({ shortName }: { readonly shortName: string }): string =>
  [
    '<link rel="apple-touch-icon" sizes="180x180" href="/pwa/apple-touch-icon-180.png">',
    '<meta name="mobile-web-app-capable" content="yes">',
    '<meta name="apple-mobile-web-app-capable" content="yes">',
    `<meta name="apple-mobile-web-app-title" content="${escapeAttribute(shortName)}">`,
    '<meta name="apple-mobile-web-app-status-bar-style" content="black">',
  ].join('\n    ')

/** Add the tags to a served index document, at most once. */
export const injectHead = (html: string, tags: string): string => (html.includes(tags) ? html : html.replace('</head>', `    ${tags}\n  </head>`))
