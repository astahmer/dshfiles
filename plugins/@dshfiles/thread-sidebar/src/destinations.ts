/**
 * The shell's destinations (plan `plans/ade-ux` §4.2): the fixed rail entries and the sections each one lists. The
 * thread sidebar owns the left column (it declares `shell.left` and the `sidebar.panellist` seat), so it owns this
 * registry. Published as the `@dshfiles/thread-sidebar/destinations` dshx module; importing it loads none of the sidebar.
 *
 * Plugins do not add rail entries. Their existing `sidebar.panellist` pages are re-homed here as sections: the table
 * below maps every page id the mounted profile registers today, and a plugin that ships a new page adds one
 * `DestinationSections` entry (`api.add(DestinationSections, { panelId, destination, label })`). A page nobody mapped
 * still shows, under Settings › Other pages, so nothing becomes unreachable.
 */
import { defineRegistry } from '@dshfiles/dshx/client'
import { DESTINATION_IDS, type DestinationId } from './destination-ids.js'

export { DESTINATION_IDS, type DestinationId }

/** A lucide icon the rail draws; the module carries only its name so it imports no React. */
export type DestinationIcon = 'messages-square' | 'inbox' | 'git-merge' | 'list-todo' | 'bot' | 'activity' | 'library' | 'settings'

export interface DestinationDefinition {
  readonly id: DestinationId
  readonly label: string
  /** One line under the destination's list heading. */
  readonly description: string
  readonly icon: DestinationIcon
  /**
   * Where the rail badge comes from: the glyph of this `sidebar.panellist` page, which draws its own count (the Inbox
   * glyph of `@dshfiles/activity-timeline` projects the attention store's Needs you count). Absent page, no badge.
   */
  readonly badgeFromPanel?: string
  /** Pinned to the bottom of the rail. */
  readonly bottom?: boolean
}

export const DESTINATIONS: readonly DestinationDefinition[] = [
  { id: 'threads', label: 'Threads', description: 'Every thread, grouped by status.', icon: 'messages-square' },
  { id: 'inbox', label: 'Inbox', description: 'What needs you, answered in place.', icon: 'inbox', badgeFromPanel: 'attention-inbox' },
  { id: 'land', label: 'Land', description: 'Workspaces ready to land, and repository history.', icon: 'git-merge' },
  { id: 'work', label: 'Work', description: 'Backlog items and schedules that start threads.', icon: 'list-todo' },
  { id: 'agents', label: 'Agents', description: 'Configured agents and their messages.', icon: 'bot' },
  { id: 'observe', label: 'Observe', description: 'Usage, activity, traces, jobs and hosts.', icon: 'activity' },
  { id: 'knowledge', label: 'Knowledge', description: 'Memory and reference material agents use.', icon: 'library' },
  { id: 'settings', label: 'Settings', description: 'Accounts, tools, secrets and plugins.', icon: 'settings', bottom: true },
]

/** One page listed under a destination: opening it selects that main panel in the stage. */
export interface DestinationSection {
  readonly panelId: string
  readonly destination: DestinationId
  /** Sentence case, no plugin name. */
  readonly label: string
  readonly description?: string
  /** Lower first; ties keep registration order. */
  readonly order?: number
  /**
   * What the left-nav entry was called before the rail, first the name users knew longest, so "Where did a page go?"
   * and the palette still find it by either.
   */
  readonly formerLabels?: readonly string[]
}

/**
 * Today's left-nav pages and where they live now (plan §4.2 and the migration map). Labels lose their plugin prefix
 * ("pulls.review: Reviews" → "Review"). Pages whose final home is the Phase 3b thread panel stay listed here until that
 * panel exists, so they remain one click away.
 */
export const KNOWN_SECTIONS: readonly DestinationSection[] = [
  { panelId: 'dshfiles-thread-board', destination: 'threads', label: 'Board', description: 'The same threads as columns.', formerLabels: ['Thread Sidebar: Board'] },
  { panelId: 'attention-inbox', destination: 'inbox', label: 'Needs you', description: 'Questions, approvals and failures waiting on you.', formerLabels: ['Inbox'] },
  { panelId: 'jj-integration', destination: 'land', label: 'Workspaces', description: 'Thread workspaces ready, blocked or behind.', order: 1, formerLabels: ['JJ Integration: Thread integration', 'Land'] },
  { panelId: 'pulls-review', destination: 'land', label: 'Review', description: 'Review a workspace before landing it.', order: 2, formerLabels: ['pulls.review: Reviews', 'Review'] },
  { panelId: 'dshfiles-jujutsu', destination: 'land', label: 'History', description: 'The revision graph of a project.', order: 3, formerLabels: ['Jujutsu: Revision graph', 'Revision graph'] },
  { panelId: 'dshfiles-jujutsu-source-control', destination: 'land', label: 'Source control', description: 'Working-copy changes and commits.', order: 4, formerLabels: ['Jujutsu: Source Control', 'Source control'] },
  { panelId: 'dshfiles-backlog-panel', destination: 'work', label: 'Backlog', description: 'Tasks, bugs, ideas and notes.', order: 1, formerLabels: ['Backlog: Items', 'Backlog'] },
  { panelId: 'schedules', destination: 'work', label: 'Schedules', description: 'Reminders and recurring prompts.', order: 2, formerLabels: ['Schedules'] },
  { panelId: 'dshfiles-agents', destination: 'agents', label: 'Directory', description: 'Configured agents and their threads.', order: 1, formerLabels: ['Agents: Directory', 'Agents'] },
  { panelId: 'agent-communication', destination: 'agents', label: 'Messages', description: 'What agents sent each other.', order: 2, formerLabels: ['Agent Communication: Messages', 'Messages'] },
  { panelId: 'dshfiles-agent-toolkit', destination: 'agents', label: 'Capabilities', description: 'Tools, skills and MCP servers an agent can use.', order: 3, formerLabels: ['Agent Toolkit: Capabilities'] },
  // Phase 5: one Usage page (Cost · Quota · Requests · Tools); quota history and forecast are views of its Quota tab.
  {
    panelId: 'dshfiles-usage',
    destination: 'observe',
    label: 'Usage',
    description: 'Cost, quota, requests and tools.',
    order: 1,
    formerLabels: ['Usage: Analytics', 'AI Accounts: Usage history', 'AI Accounts: Quota forecast', 'Quota history', 'Quota forecast'],
  },
  // Listed only in compositions without @dshfiles/usage, where ai-accounts keeps these pages of its own.
  { panelId: 'ai-accounts-usage', destination: 'observe', label: 'Quota history', description: 'Account quota over time.', order: 2 },
  { panelId: 'ai-accounts-forecast', destination: 'observe', label: 'Quota forecast', description: 'When each account runs out.', order: 3 },
  { panelId: 'activity-timeline', destination: 'observe', label: 'Activity', description: 'What happened, thread by thread.', order: 4, formerLabels: ['Activity Timeline: Activity'] },
  { panelId: 'traces', destination: 'observe', label: 'Traces', description: 'Spans, logs, metrics and alerts.', order: 5, formerLabels: ['Traces: Explorer'] },
  // Phase 5: one Processes page (Jobs · Dev servers · RAM); RAM is a tab of it.
  {
    panelId: 'dshfiles-background-jobs',
    destination: 'observe',
    label: 'Processes',
    description: 'Background jobs, dev servers and RAM per workspace.',
    order: 6,
    formerLabels: ['Background Jobs: Jobs', 'Worktree Memory: RAM', 'Jobs', 'RAM'],
  },
  // Listed only without @dshfiles/background-jobs, where worktree-memory keeps its own RAM page.
  { panelId: 'dshfiles-worktree-memory', destination: 'observe', label: 'RAM', description: 'Process memory per workspace.', order: 7 },
  { panelId: 'dshfiles-multi-host-hosts', destination: 'observe', label: 'Hosts', description: 'Machines threads run on.', order: 8, formerLabels: ['Multi-host: Hosts', 'Hosts'] },
  { panelId: 'dshfiles-memory-panel', destination: 'knowledge', label: 'Memory', description: 'Notes and thread digests.', order: 1, formerLabels: ['Memory: Browser', 'Memory'] },
  { panelId: 'dshfiles-resources', destination: 'knowledge', label: 'Resources', description: 'Resource packs and their properties.', order: 2, formerLabels: ['Resource Packs: Resources'] },
  { panelId: 'component-gallery', destination: 'knowledge', label: 'Component gallery', description: 'Every shared plugin component, live.', order: 3, formerLabels: ['Component Gallery: Components', 'Component gallery'] },
  { panelId: 'ai-accounts', destination: 'settings', label: 'AI accounts', description: 'Accounts, models and routing.', order: 1, formerLabels: ['AI Accounts: Accounts'] },
  { panelId: 'mcp-servers', destination: 'settings', label: 'MCP servers', description: 'Tool servers agents connect to.', order: 2, formerLabels: ['MCP Servers: Servers'] },
  { panelId: 'secret-catalog', destination: 'settings', label: 'Secrets', description: 'Credential aliases, never values.', order: 3, formerLabels: ['Secret Catalog: Secrets', 'Secrets'] },
  { panelId: 'plugins', destination: 'settings', label: 'Plugins', description: 'Installed plugins and the marketplace.', order: 4, formerLabels: ['Plugins'] },
]

/** Plugins that add a page after this table was written declare where it goes. */
export const DestinationSections = defineRegistry<DestinationSection>('@dshfiles/thread-sidebar.destination-section')

/** One page the sidebar knows about: a `sidebar.panellist` entry. */
export interface DestinationPanel {
  readonly id: string
  readonly label: string
  readonly order: number
}

export interface ResolvedSection extends DestinationSection {
  /** A page nobody mapped: listed under Settings › Other pages with its own label. */
  readonly unmapped: boolean
}

export interface ResolvedDestination extends DestinationDefinition {
  readonly sections: readonly ResolvedSection[]
}

/** "Usage: Analytics" → "Analytics"; a label without a prefix is kept. */
const withoutPluginPrefix = (label: string): string => {
  const index = label.indexOf(': ')
  return index > 0 && index < label.length - 2 ? label.slice(index + 2) : label
}

/**
 * Place every registered page under one destination. Contributed sections win over the built-in table (a plugin knows
 * its page best); pages nobody mapped land in Settings as unmapped, labelled without their plugin prefix.
 */
const resolve = (panels: readonly DestinationPanel[], contributed: readonly DestinationSection[] = []): readonly ResolvedDestination[] => {
  const mapped = new Map<string, DestinationSection>()
  for (const section of KNOWN_SECTIONS) mapped.set(section.panelId, section)
  for (const section of contributed) mapped.set(section.panelId, section)
  const byDestination = new Map<DestinationId, ResolvedSection[]>(DESTINATION_IDS.map(id => [id, []]))
  for (const panel of panels) {
    const section = mapped.get(panel.id)
    const resolved: ResolvedSection =
      section === undefined
        ? { panelId: panel.id, destination: 'settings', label: withoutPluginPrefix(panel.label), order: 1000 + panel.order, formerLabels: [panel.label], unmapped: true }
        : { ...section, unmapped: false }
    byDestination.get(resolved.destination)?.push(resolved)
  }
  return DESTINATIONS.map(destination => ({
    ...destination,
    sections: [...(byDestination.get(destination.id) ?? [])].sort((left, right) => (left.order ?? 0) - (right.order ?? 0)),
  }))
}

/** The destination that lists this page, if any. */
const owning = (destinations: readonly ResolvedDestination[], panelId: string | null | undefined): ResolvedDestination | undefined =>
  panelId === null || panelId === undefined ? undefined : destinations.find(destination => destination.sections.some(section => section.panelId === panelId))

export class Destinations {
  static readonly resolve = resolve
  static readonly owning = owning
  static readonly withoutPluginPrefix = withoutPluginPrefix
}
