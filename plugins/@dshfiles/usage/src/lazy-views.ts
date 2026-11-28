import { AccountUsageDashboard } from './account-usage-dashboard.js'
import { UsagePanel } from './panel.js'
import { ThreadCostFacet } from './thread-cost-facet.js'

// The Usage page, the account dashboard and the Cost facet share charts, formatting and the API contract, so they load
// as one lazy chunk when the first opens: two chunks may not bundle the same plugin module.
export const LazyViews = { AccountUsageDashboard, UsagePanel, ThreadCostFacet }
