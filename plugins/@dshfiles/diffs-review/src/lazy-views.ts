// The Review page and the Changes facet share their diff renderer and review modules, so they load as one lazy chunk:
// two chunks may not bundle the same plugin module.
export { ChangesFacet } from './changes-facet.js'
export { DiffsReviewPanel } from './panel.js'
