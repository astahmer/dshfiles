import { ChangesFacet } from './changes-facet.js'
import { DiffsReviewPanel } from './panel.js'

// The Review page and the Changes facet share their diff renderer and review modules, so they load as one lazy chunk:
// two chunks may not bundle the same plugin module.
export const LazyViews = { ChangesFacet, DiffsReviewPanel }
