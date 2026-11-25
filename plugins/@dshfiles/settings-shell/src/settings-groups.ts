import type { PluginSettingsPage } from './plugin-settings.js'
import type { SettingField } from './schema-form/schema-model.js'

/**
 * The task groups of the one Settings page (plan `docs/ade-ux` §4.6). Settings are grouped by what the user is doing,
 * never by the plugin that stores them: every native `settings.section`, every plugin settings namespace and the stage
 * pages other plugins own (AI accounts, MCP servers, Secrets, Hosts, Plugins) are placed in one group here. A section
 * or namespace nobody placed lands in "Other", so nothing becomes unreachable when a plugin adds one; every one this
 * repository ships is placed (`settings-groups.test.ts` fails otherwise and says where to add it).
 */
export type SettingsGroupId =
  | 'general'
  | 'models'
  | 'agents'
  | 'tools'
  | 'projects'
  | 'hosts'
  | 'security'
  | 'notifications'
  | 'plugins'
  | 'about'
  | 'other'
  | 'pages'

export interface SettingsGroup {
  readonly id: SettingsGroupId
  readonly label: string
  readonly description: string
}

export const SETTINGS_GROUPS: readonly SettingsGroup[] = [
  { id: 'general', label: 'General', description: 'Appearance, language, layout and shortcuts.' },
  { id: 'models', label: 'Models & accounts', description: 'AI accounts, models, routing and pricing.' },
  { id: 'agents', label: 'Agents', description: 'Agent definitions, presets, delegation and memory.' },
  { id: 'tools', label: 'Tools & MCP', description: 'MCP servers, the MCP endpoint, web search and Jev.' },
  { id: 'projects', label: 'Projects & workspaces', description: 'Projects, workspaces, landing and checks.' },
  { id: 'hosts', label: 'Hosts & network', description: 'Machines threads run on and how DSH is reachable.' },
  { id: 'security', label: 'Security', description: 'Secrets, policies, privacy and the sandbox.' },
  { id: 'notifications', label: 'Notifications', description: 'Which events reach you, and how.' },
  { id: 'plugins', label: 'Plugins', description: 'Installed plugins and the marketplace.' },
  { id: 'about', label: 'About', description: 'Version, release notes and diagnostics.' },
  { id: 'other', label: 'Other', description: 'Settings no group claims yet.' },
  { id: 'pages', label: 'Pages', description: 'Other Settings pages, opened in the stage.' },
]

/**
 * The Settings destination's pages this list does not otherwise reach (round five B1). With the Settings page on the
 * stage the sidebar folds to its rail, so the page lists them itself, as rows that open the page: nothing that
 * destination holds becomes unreachable. A page an entry already links (Secrets, Installed plugins) or names is left
 * out, so no page is listed twice.
 */
export const DESTINATION_PAGES: ReadonlyArray<{ readonly panelId: string; readonly label: string }> = [
  { panelId: 'secret-catalog', label: 'Secrets' },
  { panelId: 'plugins', label: 'Plugins' },
  { panelId: 'dshfiles-plugin-market', label: 'Plugin market' },
  { panelId: 'dshfiles-capabilities-hub', label: 'Capabilities hub' },
  { panelId: 'component-gallery', label: 'Component gallery' },
  { panelId: 'dshfiles-plugin-guide', label: 'Plugin guide' },
]

/** Where one section, namespace or page sits. `entry` merges it into another entry (one nav row for one task). */
interface Placement {
  readonly group: SettingsGroupId
  /** Nav label; the section's or page's own label otherwise. Under a merged entry it is the block's subheading. */
  readonly label?: string
  /** Position in its group, or among the blocks of the entry it joins. */
  readonly order?: number
  /** The entry this one joins: a section id, `plugin:<namespace>`, or a merged entry of `MERGED_ENTRIES`. */
  readonly entry?: string
}

/** A merged entry's place and name. */
interface MergedEntry {
  readonly group: SettingsGroupId
  readonly label: string
  readonly order: number
}

/**
 * One task several plugins hold settings for: its members join one nav row instead of one row per plugin (audit
 * 2026-11-16: General listed 15 rows, of which Composer, Message queue and Prompt stash were one task). A merged entry
 * shows once a member is loaded, always under the task's name, so the row reads the same in every composition.
 */
const MERGED_ENTRIES: ReadonlyMap<string, MergedEntry> = new Map(
  Object.entries({
    layout: { group: 'general', label: 'Layout', order: 25 },
    composer: { group: 'general', label: 'Composer', order: 30 },
    transcript: { group: 'general', label: 'Transcript', order: 35 },
    'web-access': { group: 'tools', label: 'Web search and fetch', order: 30 },
    checks: { group: 'projects', label: 'Checks and tests', order: 30 },
    diagnostics: { group: 'about', label: 'Diagnostics', order: 20 },
  } satisfies Record<string, MergedEntry>),
)

/** Native and plugin `settings.section` ids. */
const SECTION_PLACEMENT: Readonly<Record<string, Placement>> = {
  general: { group: 'general', order: 0 },
  'thread-sidebar': { group: 'general', label: 'Thread list', order: 20 },
  'dshfiles-status-bar': { group: 'general', label: 'Status bar', order: 3, entry: 'layout' },
  'archived-sessions': { group: 'general', label: 'Archived threads', order: 40 },
  'thread-notifications': { group: 'notifications', label: 'Thread notifications', order: 0 },
  account: { group: 'models', order: 0 },
  models: { group: 'models', order: 10 },
  'ai-accounts': { group: 'models', label: 'AI accounts', order: 5 },
  'agent-presets': { group: 'agents', order: 10 },
  'dshfiles-mcp-endpoint': { group: 'tools', order: 20 },
  // The projects a thread can run in: the first thing a new user sets up, so it leads its group.
  'dshfiles-workspace-folder-picker-projects': { group: 'projects', label: 'Projects', order: 0 },
  'dshfiles-new-thread': { group: 'projects', order: 1 },
  'dshfiles-network-access': { group: 'hosts', order: 20 },
  'dshfiles-thread-share': { group: 'hosts', order: 30 },
  'dshfiles-conversation-cleanup': { group: 'security', order: 45 },
  plugins: { group: 'plugins', order: 0 },
  // thread-sidebar's Update DSH (fetch, What's new, sync and rebuild, then Restart when idle).
  'dshfiles-update-dsh': { group: 'about', label: 'Update DSH', order: 5 },
  // dshmarket's own settings section: the community catalog, a full page of its own. Unplaced, it landed under "Other".
  market: { group: 'plugins', label: 'Plugin Market', order: 10 },
}

/** Settings namespaces (Loader row ids), including DSH core rows that only have a package name for a title. */
const NAMESPACE_PLACEMENT: Readonly<Record<string, Placement>> = {
  // General
  // The theme owner (`@dshfiles/ui-styles`) serves the fields; Settings only places them (no dependency on the owner).
  'dshfiles-ui-styles': { group: 'general', label: 'Appearance', order: 1 },
  'dshfiles-shortcuts': { group: 'general', label: 'Keyboard shortcuts', order: 10 },
  // Keyboard navigation with one setting: it sits with the shortcuts instead of holding a row.
  'dshfiles-command-palette': { group: 'general', label: 'Command palette', order: 1, entry: 'plugin:dshfiles-shortcuts' },
  // Under the Thread list section, so titled for what the fields do, not with the plugin's name ("Thread Sidebar").
  'thread-sidebar': { group: 'general', label: 'Display and automation', entry: 'thread-sidebar' },
  // Layout: the frame around a thread.
  'dshfiles-main-tabs': { group: 'general', label: 'Main tabs', order: 0, entry: 'layout' },
  'dshfiles-workbench': { group: 'general', label: 'Docked panes', order: 1, entry: 'layout' },
  'dshfiles-sidebar-right': { group: 'general', label: 'Thread panel', order: 2, entry: 'layout' },
  'dshfiles-frame-layout': { group: 'general', label: 'Status bar', order: 3, entry: 'layout' },
  // Composer: writing and queueing a message.
  'dshfiles-rich-composer': { group: 'general', label: 'Composer', order: 0, entry: 'composer' },
  'queue-reorder': { group: 'general', label: 'Message queue', order: 1, entry: 'composer' },
  'dshfiles-prompt-stash': { group: 'general', label: 'Saved prompts', order: 2, entry: 'composer' },
  // Transcript: how a turn reads back.
  'dshfiles-turn-summary': { group: 'general', label: 'Turn summary', order: 0, entry: 'transcript' },
  'dshfiles-tool-meta': { group: 'general', label: 'Tool details', order: 1, entry: 'transcript' },
  'dshfiles-agent-plan': { group: 'general', label: 'Agent plan', order: 2, entry: 'transcript' },
  'dshfiles-editor': { group: 'general', label: 'Editor', order: 40 },
  // Models & accounts
  'ai-accounts': { group: 'models', entry: 'ai-accounts' },
  'dshfiles-model-effort-picker': { group: 'models', label: 'Model picker', order: 20 },
  // Drawn by the native Account section when it is loaded (see DRAWN_BY_SECTION); otherwise their own entries here.
  'llm-deepseek-account': { group: 'models', label: 'DeepSeek account', order: 40 },
  'ui-settings-account': { group: 'models', label: 'Account display', order: 1, entry: 'plugin:llm-deepseek-account' },
  'llm-deepseek': { group: 'models', label: 'DeepSeek API', order: 42 },
  'llm-pi-ai': { group: 'models', label: 'Other model providers', order: 43 },
  'agent-default-model': { group: 'models', label: 'Default model', order: 44 },
  'agent-preset-registry': { group: 'agents', label: 'Preset registry', order: 41 },
  locale: { group: 'general', label: 'Language', order: 50 },
  'ui-theme': { group: 'general', label: 'Theme', order: 51 },
  'ui-settings': { group: 'general', label: 'Interface', order: 52 },
  permission: { group: 'security', label: 'Permission presets', order: 50 },
  'dshfiles-chat': { group: 'general', label: 'Chat', order: 53 },
  // Agents
  'agent-loop': { group: 'agents', label: 'Agent loop', order: 0 },
  'dshfiles-memory': { group: 'agents', label: 'Memory', order: 30 },
  'dshfiles-agents': { group: 'agents', label: 'Agents', order: 5 },
  subagent: { group: 'agents', label: 'Subagents', order: 20 },
  'subagent-model-selection-settings': { group: 'agents', label: 'Subagent models', order: 1, entry: 'plugin:subagent' },
  'dshfiles-background-jobs': { group: 'agents', label: 'Background jobs', order: 25 },
  // Tools & MCP
  // The server list the MCP servers page edits: one entry with the link to that page.
  'mcp-manager': { group: 'tools', label: 'MCP servers', order: 0 },
  // Web access: which provider searches and fetches, then each provider's own settings.
  web: { group: 'tools', label: 'Providers', order: 0, entry: 'web-access' },
  'dshfiles-web-search-brave': { group: 'tools', label: 'Brave search', order: 1, entry: 'web-access' },
  'web-search-deepseek': { group: 'tools', label: 'DeepSeek search', order: 2, entry: 'web-access' },
  'web-deepseek-api': { group: 'tools', label: 'DeepSeek web API', order: 3, entry: 'web-access' },
  'dshfiles-web-fetch-readable': { group: 'tools', label: 'Page fetch', order: 4, entry: 'web-access' },
  // Projects & workspaces
  // Upstream #287: each project's chip name and colour, edited on the Projects entry it belongs to.
  'dshfiles-workspace-folder-picker': { group: 'projects', label: 'Names and colours', order: 1, entry: 'dshfiles-workspace-folder-picker-projects' },
  'jj-integration': { group: 'projects', label: 'Thread workspaces', order: 10 },
  'dshfiles-git-worktrees': { group: 'projects', label: 'Git worktrees', order: 1, entry: 'plugin:jj-integration' },
  'dshfiles-session-undo': { group: 'projects', label: 'Undo a turn', order: 2, entry: 'plugin:jj-integration' },
  'dshfiles-jujutsu': { group: 'projects', label: 'Repository history', order: 12 },
  'dshfiles-project-checks': { group: 'projects', label: 'Project checks', order: 0, entry: 'checks' },
  'dshfiles-test-runs': { group: 'projects', label: 'Test runs', order: 1, entry: 'checks' },
  'dshfiles-preview': { group: 'projects', label: 'Preview and dev servers', order: 31 },
  // The browser a preview is picked from: with the preview settings, not a row in General.
  'dshfiles-annotations': { group: 'projects', label: 'Annotations', order: 1, entry: 'plugin:dshfiles-preview' },
  'dshfiles-backlog': { group: 'projects', label: 'Backlog', order: 40 },
  'dshfiles-backlog-image-editor': { group: 'projects', label: 'Image editor', order: 1, entry: 'plugin:dshfiles-backlog' },
  'dshfiles-pull-requests': { group: 'projects', label: 'Pull requests', order: 41 },
  'dshfiles-project-automations': { group: 'projects', label: 'Automations', order: 42 },
  // Hosts & network
  'dshfiles-multi-host': { group: 'hosts', label: 'Hosts', order: 10 },
  // Security
  'secret-catalog': { group: 'security', label: 'Secrets', order: 0 },
  'dshfiles-policies': { group: 'security', label: 'Policies', order: 10 },
  'bash-sandbox': { group: 'security', label: 'Shell sandbox', order: 20 },
  'session-log-deepseek': { group: 'security', label: 'Thread log sharing', order: 40 },
  // Plugins
  'dshfiles-hmr-gate': { group: 'plugins', label: 'Plugin updates', order: 20 },
  'dshfiles-opencode-compat': { group: 'plugins', label: 'OpenCode plugins', order: 30 },
  // About: updates, first-run surfaces and diagnostics
  // Settings' own fields are the release check and, under Advanced, the preview notice: they sit with Update DSH.
  'dshfiles-settings-shell': { group: 'about', label: 'Release checks and notices', order: 6, entry: 'dshfiles-update-dsh' },
  'dshfiles-onboarding': { group: 'about', label: 'Getting started', order: 10 },
  'dshfiles-agent-telemetry': { group: 'about', label: 'Agent telemetry', order: 0, entry: 'diagnostics' },
  'dshfiles-traces': { group: 'about', label: 'Traces', order: 1, entry: 'diagnostics' },
  'dshfiles-worktree-memory': { group: 'about', label: 'Process RAM alerts', order: 2, entry: 'diagnostics' },
}

/**
 * Namespaces a native section already draws (theme and language in General, providers in Models): their fields stay
 * searchable, and a match opens the section that draws them, but they get no navigation row of their own.
 */
const DRAWN_BY_SECTION: Readonly<Record<string, string>> = {
  locale: 'general',
  'ui-theme': 'general',
  'ui-settings': 'general',
  permission: 'general',
  'dshfiles-chat': 'general',
  'llm-deepseek': 'models',
  'llm-pi-ai': 'models',
  'agent-default-model': 'models',
  'llm-deepseek-account': 'account',
  'ui-settings-account': 'account',
  'agent-preset-registry': 'agent-presets',
}

/** Namespace prefixes DSH core uses for one row per tool or model (`tool-subagent/model-…`). */
const NAMESPACE_PREFIX_PLACEMENT: ReadonlyArray<readonly [string, Placement]> = [
  ['tool-subagent', { group: 'agents', label: 'Subagents', order: 20 }],
  ['tool-', { group: 'tools', order: 50 }],
  ['agent-', { group: 'agents', order: 40 }],
]

/**
 * Pages other plugins own in the stage, reachable from a group. Settings links them rather than copying their UI; the
 * link joins the entry that already holds the same task's settings, when there is one.
 */
export interface PageLink {
  readonly panelId: string
  readonly group: SettingsGroupId
  readonly label: string
  readonly description: string
  readonly order: number
  /** The entries it joins, first one loaded wins: a section id or `plugin:<namespace>`. */
  readonly entry?: readonly string[]
}

export const PAGE_LINKS: readonly PageLink[] = [
  // The AI accounts section links its own page ("Open AI Accounts"); this link stands in only when that section is absent.
  {
    panelId: 'ai-accounts',
    group: 'models',
    label: 'AI accounts',
    description: 'Sign in, order and manage accounts and their models.',
    order: 5,
    entry: ['ai-accounts', 'plugin:ai-accounts'],
  },
  {
    panelId: 'mcp-servers',
    group: 'tools',
    label: 'MCP servers',
    description: 'Add, connect and authorize the tool servers agents use.',
    order: 0,
    entry: ['plugin:mcp-manager'],
  },
  {
    panelId: 'secret-catalog',
    group: 'security',
    label: 'Secrets',
    description: 'Credential aliases, never values.',
    order: 0,
    entry: ['plugin:secret-catalog'],
  },
  {
    panelId: 'dshfiles-multi-host-hosts',
    group: 'hosts',
    label: 'Hosts',
    description: 'Add a host, test it and see which threads run there.',
    order: 0,
    entry: ['plugin:dshfiles-multi-host'],
  },
  { panelId: 'plugins', group: 'plugins', label: 'Installed plugins', description: 'Every loaded plugin, its version and its own page.', order: 1 },
  { panelId: 'dshfiles-agents', group: 'agents', label: 'Agent definitions', description: 'Configured agents, their instructions and routes.', order: 0 },
]

/** Sections that already draw a button to their plugin's stage page. */
const SECTIONS_LINKING_THEIR_PAGE: ReadonlySet<string> = new Set(['ai-accounts'])

/** The entry that holds every Jev setting (key, enable, thresholds), wherever the plugin that uses it stores them. */
export const JEV_ENTRY_ID = 'jev'

/** One row in the Settings navigation: what opens when it is picked. */
export interface SettingsEntry {
  /** Nav id: a section id, a `plugin:<namespace>` page id, `link:<panelId>`, `jev` or a merged entry (`layout`). */
  readonly id: string
  readonly group: SettingsGroupId
  readonly label: string
  readonly order: number
  /** The native or plugin `settings.section` it renders. */
  readonly sectionId?: string
  /** The section's own name, when it is one block of an entry named after a task: drawn as that block's subheading. */
  readonly sectionLabel?: string
  /** Plugin settings pages it renders below the section, already stripped of fields shown elsewhere. */
  readonly pages: readonly PluginSettingsPage[]
  /** Pages the section draws natively: searchable, and opening this entry, but not drawn twice. */
  readonly hiddenPages: readonly PluginSettingsPage[]
  /** Another plugin's stage page it opens. */
  readonly link?: PageLink
  /** A row of the Pages group: picking it opens this stage page instead of a Settings entry. */
  readonly opens?: string
  /** Words that find it in search without showing: namespaces, former names. */
  readonly keywords: string
}

export interface GroupedEntries {
  readonly group: SettingsGroup
  readonly entries: readonly SettingsEntry[]
}

const placementOfNamespace = (ns: string): Placement => {
  const exact = NAMESPACE_PLACEMENT[ns]
  if (exact !== undefined) return exact
  const prefixed = NAMESPACE_PREFIX_PLACEMENT.find(([prefix]) => ns.startsWith(prefix))
  return prefixed?.[1] ?? { group: 'other' }
}

const placementOfSection = (id: string): Placement => SECTION_PLACEMENT[id] ?? { group: 'other' }

/** "tool-subagent/model-deepseek" → "Model deepseek"; "dshfiles-main-tabs" → "Main tabs". */
const humanizeId = (id: string): string => {
  const last = id.split('/').filter(Boolean).at(-1) ?? id
  const words = last
    .replace(/^@[^/]+\//u, '')
    .replace(/^(?:dshfiles|dshx)-/u, '')
    .replace(/[-_.]+/gu, ' ')
    .trim()
  return words === '' ? id : `${words.charAt(0).toUpperCase()}${words.slice(1)}`
}

/** A title that is a package or row id ("agent-loop", "web", "@scope/pkg") rather than words for a person. */
const looksLikeId = (title: string): boolean => /^[@a-z0-9][a-z0-9@/._-]*$/u.test(title) || /^dshx? /iu.test(title)

/** A human title for one plugin page: the placement's label, then its manifest title unless that is an id. */
const pageTitle = (page: PluginSettingsPage): string => {
  const placed = placementOfNamespace(page.ns).label
  if (placed !== undefined) return placed
  return page.title === '' || looksLikeId(page.title) ? humanizeId(page.title === '' ? page.ns : page.title) : page.title
}

/**
 * Single fields that belong to another task than the rest of their namespace (plan §4.6). Empty since the one sidebar
 * layout (b:952m) retired Layout (fixed rail or free docking), the only one; kept for the next such field.
 */
const PROMOTED_FIELDS: ReadonlyArray<{ readonly ns: string; readonly key: string; readonly entry: string; readonly title: string }> = []

/** The namespace holding the one Jev key (this plugin's own settings). */
export const SHARED_JEV_NAMESPACE = 'dshfiles-settings-shell'

/** Jev settings live together in Tools & MCP: every field whose key names Jev. */
const isJevField = (field: SettingField): boolean => /^jev/iu.test(field.key)

interface SectionInput {
  readonly id: string
  readonly label: string
  readonly order: number
}

/**
 * Every Settings entry, grouped and ordered. `panels` are the stage pages registered now: a link to a page that is not
 * loaded is left out. Pages whose fields all moved to the Jev entry are left out of their group.
 */
const groupEntries = (input: {
  readonly sections: readonly SectionInput[]
  readonly pages: readonly PluginSettingsPage[]
  readonly panels: ReadonlySet<string>
}): readonly GroupedEntries[] => {
  interface Draft {
    group: SettingsGroupId
    label: string
    order: number
    sectionId?: string
    sectionLabel?: string
    /** Each page with its place among the entry's blocks. */
    pages: Array<{ readonly page: PluginSettingsPage; readonly order: number }>
    hiddenPages: PluginSettingsPage[]
    link?: PageLink
    keywords: string[]
  }
  const entries = new Map<string, Draft>()
  /** The entry of one task several plugins share, created when its first member arrives. */
  const mergedEntry = (id: string): Draft | undefined => {
    const merged = MERGED_ENTRIES.get(id)
    if (merged === undefined) return undefined
    const existing = entries.get(id)
    if (existing !== undefined) return existing
    const draft: Draft = { group: merged.group, label: merged.label, order: merged.order, pages: [], hiddenPages: [], keywords: [id] }
    entries.set(id, draft)
    return draft
  }
  /** What a placement's `entry` names: an entry id, the entry drawing that section, or a merged entry. */
  const entryNamed = (id: string): Draft | undefined => entries.get(id) ?? [...entries.values()].find(entry => entry.sectionId === id) ?? mergedEntry(id)
  for (const section of input.sections) {
    const placement = placementOfSection(section.id)
    const merged = placement.entry === undefined ? undefined : mergedEntry(placement.entry)
    // A merged entry draws one section as a block under the task's name; a second one keeps its own row.
    if (merged !== undefined && merged.sectionId === undefined) {
      merged.sectionId = section.id
      merged.sectionLabel = placement.label ?? section.label
      merged.keywords.push(section.id, section.label)
      continue
    }
    entries.set(section.id, {
      group: placement.group,
      label: placement.label ?? section.label,
      order: placement.entry === undefined ? (placement.order ?? 100 + section.order) : 100 + section.order,
      sectionId: section.id,
      pages: [],
      hiddenPages: [],
      keywords: [section.id, section.label],
    })
  }
  const jevPages: PluginSettingsPage[] = []
  const pending: Array<{ readonly page: PluginSettingsPage; readonly placement: Placement }> = []
  for (const original of input.pages) {
    const promoted = PROMOTED_FIELDS.filter(promotion => promotion.ns === original.ns)
    const isPromoted = (field: SettingField): boolean => promoted.some(promotion => promotion.key === field.key && field.path.length === 1)
    for (const promotion of promoted) {
      const target = entries.get(promotion.entry)
      const fields = original.fields.filter(field => field.key === promotion.key && field.path.length === 1)
      if (target === undefined || fields.length === 0) continue
      target.pages.push({
        page: { ...original, pageId: `${promotion.entry}:${original.ns}:${promotion.key}`, title: promotion.title, description: '', fields },
        order: 0,
      })
    }
    const kept = original.fields.filter(
      field => !isPromoted(field) || !entries.has(PROMOTED_FIELDS.find(promotion => promotion.key === field.key)?.entry ?? ''),
    )
    const jev = kept.filter(isJevField)
    const rest = kept.filter(field => !isJevField(field))
    const title = pageTitle(original)
    // The one shared key (this plugin's own field) leads the Jev entry; the plugins that use it follow with their switches.
    if (jev.length > 0 && original.ns === SHARED_JEV_NAMESPACE)
      jevPages.unshift({
        ...original,
        pageId: `${JEV_ENTRY_ID}:${original.ns}`,
        title: 'Key',
        description: 'One TypeSafe key for every Jev reader: Backlog triage and Memory signals.',
        fields: jev,
      })
    else if (jev.length > 0) jevPages.push({ ...original, pageId: `${JEV_ENTRY_ID}:${original.ns}`, title, fields: jev })
    // A page whose every field moved elsewhere (to Jev, to General) has nothing left to show.
    if (rest.length === 0 && original.fields.length > 0) continue
    const drawnBy = DRAWN_BY_SECTION[original.ns]
    const drawing = drawnBy === undefined ? undefined : entries.get(drawnBy)
    if (drawing !== undefined) {
      drawing.hiddenPages.push({ ...original, title, fields: rest })
      continue
    }
    pending.push({ page: { ...original, title, fields: rest }, placement: placementOfNamespace(original.ns) })
  }
  const standAlone = (page: PluginSettingsPage, placement: Placement): void => {
    entries.set(page.pageId, {
      group: placement.group,
      label: page.title,
      // A page that meant to join an entry which is not loaded keeps its group but not the block position it had there.
      order: placement.entry === undefined ? (placement.order ?? 200) : 200,
      pages: [{ page, order: 0 }],
      hiddenPages: [],
      keywords: [page.ns, page.title],
    })
  }
  // Pages with a row of their own come first, so a page joins its entry whatever order the Host listed them in.
  for (const { page, placement } of pending) if (placement.entry === undefined) standAlone(page, placement)
  for (const { page, placement } of pending) {
    if (placement.entry === undefined) continue
    const target = entryNamed(placement.entry)
    if (target === undefined) {
      standAlone(page, placement)
      continue
    }
    target.pages.push({ page, order: placement.order ?? 0 })
    target.keywords.push(page.ns, page.title)
  }
  if (jevPages.length > 0) {
    entries.set(JEV_ENTRY_ID, {
      group: 'tools',
      label: 'Jev',
      order: 40,
      pages: jevPages.map(page => ({ page, order: 0 })),
      hiddenPages: [],
      keywords: ['jev', 'typesafe', 'classifier', ...jevPages.map(page => page.ns)],
    })
  }
  for (const link of PAGE_LINKS) {
    if (!input.panels.has(link.panelId)) continue
    const target = (link.entry ?? []).map(id => entries.get(id)).find(entry => entry !== undefined)
    // A section that already opens its own page needs no second button.
    if (target !== undefined && SECTIONS_LINKING_THEIR_PAGE.has(target.sectionId ?? '')) {
      target.keywords.push(link.panelId)
      continue
    }
    if (target !== undefined) {
      target.link = link
      target.label = link.label
      target.keywords.push(link.panelId)
      continue
    }
    entries.set(`link:${link.panelId}`, {
      group: link.group,
      label: link.label,
      order: link.order,
      pages: [],
      hiddenPages: [],
      link,
      keywords: [link.panelId, link.description],
    })
  }
  const linked = new Set([...entries.values()].flatMap(entry => (entry.link === undefined ? [] : [entry.link.panelId])))
  const named = new Set([...entries.values()].map(entry => entry.label.trim().toLowerCase()))
  const pageRows: SettingsEntry[] = DESTINATION_PAGES.flatMap((page, index) =>
    !input.panels.has(page.panelId) || linked.has(page.panelId) || named.has(page.label.toLowerCase())
      ? []
      : [{ id: `page:${page.panelId}`, group: 'pages', label: page.label, order: index, pages: [], hiddenPages: [], opens: page.panelId, keywords: page.panelId }],
  )
  const byGroup = new Map<SettingsGroupId, SettingsEntry[]>(pageRows.length === 0 ? [] : [['pages', pageRows]])
  for (const [id, entry] of entries) {
    const row: SettingsEntry = {
      id,
      group: entry.group,
      label: entry.label,
      order: entry.order,
      // Blocks in their placed order; equal orders keep the order the Host listed them in.
      pages: entry.pages.toSorted((left, right) => left.order - right.order).map(block => block.page),
      hiddenPages: entry.hiddenPages,
      keywords: entry.keywords.join(' '),
    }
    const withSection: SettingsEntry = entry.sectionId === undefined ? row : { ...row, sectionId: entry.sectionId }
    const withSectionLabel: SettingsEntry = entry.sectionLabel === undefined ? withSection : { ...withSection, sectionLabel: entry.sectionLabel }
    const finished: SettingsEntry = entry.link === undefined ? withSectionLabel : { ...withSectionLabel, link: entry.link }
    const list = byGroup.get(entry.group) ?? []
    list.push(finished)
    byGroup.set(entry.group, list)
  }
  return SETTINGS_GROUPS.flatMap(group => {
    const list = byGroup.get(group.id)
    if (list === undefined || list.length === 0) return []
    return [{ group, entries: list.toSorted((left, right) => left.order - right.order || left.label.localeCompare(right.label)) }]
  })
}

/** The entry a nav id, section id or plugin page id opens; plugin pages merged into a section open that section. */
const entryFor = (groups: readonly GroupedEntries[], id: string | undefined): SettingsEntry | undefined => {
  if (id === undefined) return undefined
  const all = groups.flatMap(group => group.entries)
  return (
    all.find(entry => entry.id === id) ??
    all.find(entry => entry.sectionId === id) ??
    all.find(entry => entry.pages.some(page => page.pageId === id) || entry.hiddenPages.some(page => page.pageId === id)) ??
    // `plugin:<namespace>` of a page whose fields all moved (to Jev, to General): open where they went.
    all.find(entry => [...entry.pages, ...entry.hiddenPages].some(page => `plugin:${page.ns}` === id))
  )
}

/** The entry that draws one field of a namespace: the Jev entry for a Jev field, the namespace's entry otherwise. */
const entryForField = (groups: readonly GroupedEntries[], ns: string, fieldPath: readonly string[]): SettingsEntry | undefined => {
  const all = groups.flatMap(group => group.entries)
  const key = fieldPath[0] ?? ''
  return all.find(entry => [...entry.pages, ...entry.hiddenPages].some(page => page.ns === ns && page.fields.some(field => field.path[0] === key)))
}

/** Every page as Settings shows it, the native-drawn ones included, for search. */
const searchablePages = (groups: readonly GroupedEntries[]): readonly PluginSettingsPage[] =>
  groups.flatMap(group => group.entries.flatMap(entry => [...entry.pages, ...entry.hiddenPages]))

/** The group a namespace is placed in; `other` when nobody placed it. */
const groupOfNamespace = (ns: string): SettingsGroupId =>
  DRAWN_BY_SECTION[ns] === undefined ? placementOfNamespace(ns).group : placementOfSection(DRAWN_BY_SECTION[ns]).group

/** The group a `settings.section` is placed in; `other` when nobody placed it. */
const groupOfSection = (id: string): SettingsGroupId => placementOfSection(id).group

export class SettingsGroups {
  static readonly group = groupEntries
  static readonly groupOfNamespace = groupOfNamespace
  static readonly groupOfSection = groupOfSection
  static readonly entryFor = entryFor
  static readonly entryForField = entryForField
  static readonly searchablePages = searchablePages
  static readonly pageTitle = pageTitle
  static readonly humanizeId = humanizeId
  static readonly isJevField = isJevField
}
