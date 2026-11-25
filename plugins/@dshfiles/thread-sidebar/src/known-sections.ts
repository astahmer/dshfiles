/**
 * The page-to-destination table the rail and the Host both read (destinations.ts re-exports it). Plain data, so a Host
 * module can import it without the client registry.
 */
import type { DestinationId } from './destination-ids.js'

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
  /**
   * `developer`: a page for people who write plugins (a component reference, the extension catalog), not for someone
   * supervising agents. It is listed in the Developer group at the end of Settings, which a sidebar setting hides.
   */
  readonly group?: 'developer'
  /**
   * Not listed under its destination: the page repeats what another page of the destination already shows, so the list
   * would offer the same thing twice. The command palette and the New tab page still open it, and a person can file it
   * in any folder.
   */
  readonly unlisted?: boolean
}

/**
 * Today's left-nav pages and where they live now (plan §4.2 and the migration map). Labels lose their plugin prefix
 * ("pulls.review: Reviews" → "Review"). Pages whose final home is the Phase 3b thread panel stay listed here until that
 * panel exists, so they remain one click away.
 */
export const KNOWN_SECTIONS: readonly DestinationSection[] = [
  {
    panelId: 'dshfiles-thread-board',
    destination: 'threads',
    label: 'Board',
    description: 'The same threads as columns.',
    // "Thread board" was its own palette row beside this page's; the page row answers to both names.
    formerLabels: ['Thread Sidebar: Board', 'Thread board', 'Kanban'],
  },
  {
    panelId: 'attention-inbox',
    destination: 'inbox',
    // The destination and its page share one name; "Needs you" is the view inside the page.
    label: 'Inbox',
    description: 'Questions, approvals and failures waiting on you.',
    formerLabels: ['Inbox', 'Needs you'],
  },
  {
    panelId: 'jj-integration',
    destination: 'land',
    label: 'Workspaces',
    description: 'Thread workspaces ready, blocked or behind.',
    order: 1,
    formerLabels: ['JJ Integration: Thread integration', 'Land'],
  },
  {
    panelId: 'diffs-review',
    destination: 'land',
    label: 'Review',
    description: 'Review a workspace before landing it.',
    order: 2,
    formerLabels: ['pulls.review: Reviews', 'Review'],
  },
  {
    panelId: 'dshfiles-jujutsu',
    destination: 'land',
    label: 'History',
    description: 'The revision graph of a project.',
    order: 3,
    formerLabels: ['Jujutsu: Revision graph', 'Revision graph'],
  },
  {
    panelId: 'dshfiles-jujutsu-source-control',
    destination: 'land',
    label: 'Source control',
    description: 'Working-copy changes and commits.',
    order: 4,
    formerLabels: ['Jujutsu: Source Control', 'Source control'],
  },
  {
    panelId: 'dshfiles-backlog-panel',
    destination: 'work',
    label: 'Backlog',
    description: 'Tasks, bugs, ideas and notes.',
    order: 1,
    formerLabels: ['Backlog: Items', 'Backlog'],
  },
  {
    panelId: 'schedules',
    destination: 'work',
    label: 'Schedules',
    // Item 30's wording: Schedules prompts a thread that exists; Automations starts a new one.
    description: 'Prompts sent to a thread at a set time.',
    order: 2,
    formerLabels: ['Schedules', 'Automation tasks'],
  },
  {
    panelId: 'dshfiles-agents',
    destination: 'agents',
    label: 'Directory',
    description: 'Configured agents and their threads.',
    order: 1,
    formerLabels: ['Agents: Directory', 'Agents'],
  },
  {
    panelId: 'agent-communication',
    destination: 'agents',
    label: 'Messages',
    description: 'What agents sent each other.',
    order: 2,
    formerLabels: ['Agent Communication: Messages', 'Messages'],
  },
  {
    panelId: 'dshfiles-agent-toolkit',
    destination: 'agents',
    label: 'Capabilities',
    description: 'Tools, skills and MCP servers an agent can use.',
    order: 3,
    formerLabels: ['Agent Toolkit: Capabilities'],
  },
  // Upstream (2026-11): retained thread events, including notifications missed while away.
  {
    panelId: 'dshfiles-notification-history',
    destination: 'observe',
    label: 'Notifications',
    description: 'Retained thread events, including missed alerts.',
    order: 0,
  },
  // Phase 5: one Usage page (Cost · Quota · Requests · Tools); quota history and forecast are views of its Quota tab.
  {
    panelId: 'dshfiles-usage',
    destination: 'observe',
    label: 'Usage',
    description: 'Cost, quota, requests and tools.',
    order: 1,
    formerLabels: ['Usage', 'AI Accounts: Usage history', 'AI Accounts: Quota forecast'],
  },
  // Listed only in compositions without @dshfiles/usage, where ai-accounts keeps these pages of its own.
  { panelId: 'ai-accounts-usage', destination: 'observe', label: 'Quota history', description: 'Account quota over time.', order: 2 },
  { panelId: 'ai-accounts-forecast', destination: 'observe', label: 'Quota forecast', description: 'When each account runs out.', order: 3 },
  {
    panelId: 'activity-timeline',
    destination: 'observe',
    label: 'Activity',
    description: 'What happened, thread by thread.',
    order: 4,
    formerLabels: ['Activity Timeline: Activity'],
  },
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
  {
    panelId: 'dshfiles-multi-host-hosts',
    destination: 'observe',
    label: 'Hosts',
    description: 'Machines threads run on.',
    order: 8,
    formerLabels: ['Multi-host: Hosts', 'Hosts'],
  },
  {
    panelId: 'dshfiles-memory-panel',
    destination: 'knowledge',
    label: 'Memory',
    description: 'Notes and thread digests.',
    order: 1,
    formerLabels: ['Memory: Browser', 'Memory'],
  },
  {
    panelId: 'dshfiles-resources',
    destination: 'knowledge',
    label: 'Resources',
    description: 'Resource packs and their properties.',
    order: 2,
    formerLabels: ['Resource Packs: Resources'],
  },
  {
    panelId: 'dshfiles-whiteboard',
    destination: 'knowledge',
    label: 'Whiteboard',
    description: 'Per-project boards you and agents draw on.',
    order: 4,
    formerLabels: ['Whiteboard: Boards', 'Whiteboard'],
  },
  {
    panelId: 'dshfiles-agentsview',
    destination: 'knowledge',
    label: 'Agent CLI threads',
    description: 'Read-only threads Claude Code and Codex recorded here.',
    order: 5,
    formerLabels: ['Agent CLI threads'],
  },
  {
    panelId: 'ai-accounts',
    destination: 'settings',
    label: 'AI accounts',
    description: 'Accounts, models and routing.',
    order: 1,
    formerLabels: ['AI Accounts: Accounts'],
  },
  {
    panelId: 'mcp-servers',
    destination: 'settings',
    label: 'MCP servers',
    description: 'Tool servers agents connect to.',
    order: 2,
    formerLabels: ['MCP Servers: Servers'],
  },
  {
    panelId: 'secret-catalog',
    destination: 'settings',
    label: 'Secrets',
    description: 'Credential aliases, never values.',
    order: 3,
    formerLabels: ['Secret Catalog: Secrets', 'Secrets'],
  },
  { panelId: 'plugins', destination: 'settings', label: 'Plugins', description: 'Installed plugins and the marketplace.', order: 4, formerLabels: ['Plugins'] },
  // capabilities-hub's two pages: beside the managers they open, after them (the plugin declares the same seats).
  {
    panelId: 'dshfiles-plugin-market',
    destination: 'settings',
    label: 'Plugin market',
    description: 'Community plugins from dshmarket.com.',
    order: 5,
  },
  {
    panelId: 'dshfiles-capabilities-hub',
    destination: 'settings',
    label: 'Capabilities hub',
    description: 'Where skills, MCP servers and plugins are managed.',
    order: 6,
  },
  // Developer pages: for plugin authors, so they sit apart at the end of Settings instead of among the user's pages.
  {
    panelId: 'component-gallery',
    destination: 'settings',
    label: 'Component gallery',
    description: 'Every shared plugin component, live.',
    order: 1,
    group: 'developer',
    formerLabels: ['Component Gallery: Components', 'Component gallery'],
  },
  {
    panelId: 'dshfiles-plugin-guide',
    destination: 'settings',
    label: 'Plugin guide',
    description: 'Where a plugin can extend DSH.',
    order: 2,
    group: 'developer',
  },
]
