/** Absolute pathname prefix the Host serves `dist/renderer/` under: pele's ES module build and KaTeX's. */
export const RENDERER_ROUTE = '/dshfiles-mermaid-diagrams/renderer'
/** The module the Client imports; pele's `lazy` entry, which fetches each diagram type's parser on first use. */
export const RENDERER_ENTRY_FILE = 'lazy.js'
/** KaTeX's ES module, imported only for a diagram whose labels hold `$$…$$` math. */
export const KATEX_ENTRY_FILE = 'katex.mjs'
