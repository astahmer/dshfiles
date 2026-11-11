import type { CatalogFeature, Route } from './catalog-model.js'

/**
 * The curated "major features" (plan Appendix A): one row per bundle, with the route its page opens. A feature's own
 * `onboarding.open` wins; a bundle without a page keeps no route and shows no Open button. Until every UI plugin ships an
 * `onboarding` block (plan P5), this is where a curated bundle's route lives.
 */
export interface CuratedBundle {
  readonly plugin: string
  readonly open?: Route
}

const panel = (id: string): Route => ({ panel: id })
const settingsSection = (section: string): Route => ({ settings: { section } })

export const CURATED_BUNDLES: readonly CuratedBundle[] = [
  // Threads
  { plugin: 'main-tabs' },
  { plugin: 'thread-sidebar', open: panel('dshfiles-thread-board') },
  { plugin: 'jj-integration', open: panel('jj-integration') },
  { plugin: 'btw' },
  { plugin: 'queue-reorder' },
  { plugin: 'rich-composer' },
  { plugin: 'session-search' },
  // Inbox
  { plugin: 'activity-timeline', open: panel('attention-inbox') },
  { plugin: 'agent-questions', open: panel('attention-inbox') },
  { plugin: 'backlog', open: panel('dshfiles-backlog-panel') },
  { plugin: 'pull-requests' },
  { plugin: 'ai-accounts', open: panel('ai-accounts') },
  // Land
  { plugin: 'jujutsu', open: panel('dshfiles-jujutsu') },
  { plugin: 'pulls-review', open: panel('pulls-review') },
  { plugin: 'git-worktrees' },
  // Work
  { plugin: 'project-automations' },
  { plugin: 'goal-tool' },
  { plugin: 'schedule', open: panel('schedules') },
  // Agents
  { plugin: 'agents', open: panel('dshfiles-agents') },
  { plugin: 'agent-communication', open: panel('agent-communication') },
  { plugin: 'agent-preset' },
  { plugin: 'agent-toolkit', open: panel('dshfiles-agent-toolkit') },
  { plugin: 'multi-host', open: panel('dshfiles-multi-host-hosts') },
  // Observe
  { plugin: 'usage', open: panel('dshfiles-usage') },
  { plugin: 'traces', open: panel('traces') },
  { plugin: 'background-jobs', open: panel('dshfiles-background-jobs') },
  { plugin: 'preview' },
  // Knowledge
  { plugin: 'memory', open: panel('dshfiles-memory-panel') },
  { plugin: 'references' },
  { plugin: 'fff-search' },
  { plugin: 'agentsview', open: panel('dshfiles-agentsview') },
  // Settings
  { plugin: 'settings-shell' },
  { plugin: 'capabilities-hub', open: panel('dshfiles-capabilities-hub') },
  { plugin: 'plugin-guide', open: panel('dshfiles-plugin-guide') },
  { plugin: 'secret-catalog', open: panel('secret-catalog') },
  { plugin: 'mcp-servers', open: panel('mcp-servers') },
  { plugin: 'policies' },
  { plugin: 'workspace-folder-picker', open: settingsSection('dshfiles-workspace-folder-picker-projects') },
  // Composer and transcript
  { plugin: 'mentions' },
  { plugin: 'model-effort-picker' },
  { plugin: 'annotations' },
  { plugin: 'html-render' },
  { plugin: 'mermaid-diagrams' },
  { plugin: 'attachment-gallery' },
  { plugin: 'diff-viewed' },
  // Agent tools
  { plugin: 'apply-patch' },
  { plugin: 'tool-search' },
]

const curatedBundles = new Map(CURATED_BUNDLES.map(bundle => [bundle.plugin, bundle]))

/** Whether a feature is curated, and the route its Open button takes (`null`: no button). */
interface Curation {
  readonly curated: boolean
  readonly route: Route | null
}

/**
 * The one "curated" rule, shared by the Getting started gallery (overview-model.ts) and `scripts/pack-docs.ts`: a feature
 * with an `onboarding` block, or a curated bundle's feature that lives somewhere (`destination` is not `none`). Only
 * type imports, so plain `node --experimental-strip-types` loads it.
 */
export const curationOf = (feature: Pick<CatalogFeature, 'plugin' | 'destination' | 'onboarding'>): Curation => {
  const bundle = feature.destination === 'none' ? undefined : curatedBundles.get(feature.plugin)
  return { curated: feature.onboarding !== null || bundle !== undefined, route: feature.onboarding?.open ?? bundle?.open ?? null }
}
