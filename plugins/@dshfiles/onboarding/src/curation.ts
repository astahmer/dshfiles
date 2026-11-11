import type { CatalogFeature, Route } from './catalog-model.js'

/**
 * The curated "major features" (plan Appendix A): one row per bundle. Curation is this list alone; an `onboarding` block
 * carries copy and a route, never curation. A curated bundle's features open where their own `onboarding.open` points,
 * else at the bundle's route: `routeFrom` names the bundle's feature whose block route they share, `open` is a route no
 * block carries (the plugin has no block for it). A bundle with neither shows no Open button on block-less rows.
 */
export type CuratedBundle = { readonly plugin: string; readonly open?: Route } | { readonly plugin: string; readonly routeFrom: string }

export const CURATED_BUNDLES: readonly CuratedBundle[] = [
  // Threads
  { plugin: 'main-tabs' },
  { plugin: 'thread-sidebar', routeFrom: 'thread-classification' },
  { plugin: 'jj-integration', routeFrom: 'thread-workspaces-panel' },
  { plugin: 'btw' },
  { plugin: 'queue-reorder' },
  { plugin: 'rich-composer' },
  { plugin: 'session-search' },
  // Inbox
  { plugin: 'activity-timeline', routeFrom: 'inbox-panel' },
  { plugin: 'agent-questions', open: { panel: 'attention-inbox' } },
  { plugin: 'backlog', routeFrom: 'capture-and-triage' },
  { plugin: 'pull-requests' },
  { plugin: 'ai-accounts', routeFrom: 'account-lifecycle' },
  // Land
  { plugin: 'jujutsu', routeFrom: 'revision-graph' },
  { plugin: 'diffs-review', routeFrom: 'thread-review-scopes' },
  { plugin: 'git-worktrees' },
  // Work
  { plugin: 'project-automations' },
  { plugin: 'goal-tool' },
  { plugin: 'schedule', open: { panel: 'schedules' } },
  // Agents
  { plugin: 'agents', routeFrom: 'agent-registry' },
  { plugin: 'agent-communication', routeFrom: 'passive-messaging' },
  { plugin: 'agent-preset' },
  { plugin: 'agent-toolkit', routeFrom: 'agent-toolkit-page' },
  { plugin: 'multi-host', routeFrom: 'host-management' },
  // Observe
  { plugin: 'usage', routeFrom: 'usage-request-log' },
  { plugin: 'traces', routeFrom: 'trace-explorer' },
  { plugin: 'background-jobs', routeFrom: 'jobs-board' },
  { plugin: 'preview' },
  // Knowledge
  { plugin: 'memory', routeFrom: 'memory-panel' },
  { plugin: 'references' },
  { plugin: 'fff-search' },
  { plugin: 'agentsview', routeFrom: 'agent-sessions-panel' },
  // Settings
  { plugin: 'settings-shell' },
  { plugin: 'capabilities-hub', routeFrom: 'capabilities-hub' },
  { plugin: 'plugin-guide', routeFrom: 'plugin-guide' },
  { plugin: 'secret-catalog', routeFrom: 'scoped-alias-catalog' },
  { plugin: 'mcp-servers', routeFrom: 'server-configuration' },
  { plugin: 'policies' },
  { plugin: 'workspace-folder-picker', routeFrom: 'project-settings-section' },
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
  // Getting started itself
  { plugin: 'onboarding' },
]

const curatedBundles = new Map(CURATED_BUNDLES.map(bundle => [bundle.plugin, bundle]))

/** Whether a feature is curated, and the route its Open button takes (`null`: no button). */
interface Curation {
  readonly curated: boolean
  readonly route: Route | null
}

type CuratedFeature = Pick<CatalogFeature, 'plugin' | 'id' | 'destination' | 'onboarding'>

const bundleRoute = (input: { readonly bundle: CuratedBundle; readonly features: readonly CuratedFeature[] }): Route | null => {
  const bundle = input.bundle
  if (!('routeFrom' in bundle)) return bundle.open ?? null
  return input.features.find(candidate => candidate.plugin === bundle.plugin && candidate.id === bundle.routeFrom)?.onboarding?.open ?? null
}

/**
 * The one "curated" rule, shared by the Getting started gallery (overview-model.ts) and `scripts/pack-docs.ts`: a curated
 * bundle's feature that lives somewhere (`destination` is not `none`). `features` is the catalog `routeFrom` resolves in.
 * Only type imports, so plain `node --experimental-strip-types` loads it.
 */
export const curationOf = (input: { readonly feature: CuratedFeature; readonly features: readonly CuratedFeature[] }): Curation => {
  const feature = input.feature
  const bundle = feature.destination === 'none' ? undefined : curatedBundles.get(feature.plugin)
  return {
    curated: bundle !== undefined,
    route: feature.onboarding?.open ?? (bundle === undefined ? null : bundleRoute({ bundle, features: input.features })),
  }
}
