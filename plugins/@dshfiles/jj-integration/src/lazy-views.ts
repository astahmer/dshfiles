import { ThreadWorkspacesPanel } from './panel.js'
import { ProjectMainBranchPanel } from './project-main-branch-panel.js'

// The Workspaces page and the project main-branch panel share their workspace rows and land actions, so they load as
// one lazy chunk when the first opens: two chunks may not bundle the same plugin module.
export const LazyViews = { ThreadWorkspacesPanel, ProjectMainBranchPanel }
