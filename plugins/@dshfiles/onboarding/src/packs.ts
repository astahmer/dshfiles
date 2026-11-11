import type { Prerequisite } from './catalog-model.js'

/** A Settings field a pack's user most likely wants to change: its namespace (Loader row id) and path. */
export interface PackSetting {
  readonly label: string
  readonly entryId: string
  readonly fieldPath: readonly string[]
}

/** A named set of owned plugins adopted together; a plugin may sit in several packs. */
export interface Pack {
  readonly id: string
  readonly title: string
  readonly summary: string
  /** Always on: the shell every other pack builds on; never disabled by a pack action. */
  readonly core: boolean
  /** Directory names under `plugins/@dshfiles`. */
  readonly plugins: readonly string[]
  readonly prerequisites: readonly Prerequisite[]
  readonly keySettings: readonly PackSetting[]
}

/** The one definition of the packs; the packs test checks every plugin and setting against the repository. */
export const PACKS: readonly Pack[] = [
  {
    id: 'core',
    title: 'Core',
    summary: 'The thread list, tabs, chat, composer, session control and Settings every other pack builds on.',
    core: true,
    plugins: ['thread-sidebar', 'main-tabs', 'chat', 'rich-composer', 'session-controller', 'settings-shell'],
    prerequisites: ['account', 'project'],
    keySettings: [{ label: 'Restart by itself when idle to apply updates', entryId: 'thread-sidebar', fieldPath: ['autoRestartWhenIdle'] }],
  },
  {
    id: 'versioning',
    title: 'Versioning workflow',
    summary: 'A workspace per thread, landing finished work, the revision graph, changed-file review and undo per turn. Works with jj and git.',
    core: false,
    plugins: ['jj-integration', 'jujutsu', 'diff-viewed', 'session-undo'],
    prerequisites: ['project', 'repository'],
    keySettings: [
      { label: 'Isolate each new thread in its own workspace', entryId: 'jj-integration', fieldPath: ['isolateByDefault'] },
      { label: 'Keep a revision per turn for undo', entryId: 'dshfiles-session-undo', fieldPath: ['turnRevisions'] },
    ],
  },
  {
    id: 'github',
    title: 'GitHub & review',
    summary: 'Open and watch pull requests, review a workspace before landing, and run project automations from GitHub events.',
    core: false,
    plugins: ['pull-requests', 'pulls-review', 'project-automations'],
    prerequisites: ['repository', 'github'],
    keySettings: [{ label: 'Refresh pull requests when a thread changes', entryId: 'dshfiles-pull-requests', fieldPath: ['refreshOnThreadEvents'] }],
  },
  {
    id: 'planning',
    title: 'Backlog & planning',
    summary: 'A backlog that starts threads (with Jira and Notion), goals agents keep working on, schedules and a reorderable queue.',
    core: false,
    plugins: ['backlog', 'backlog-jira', 'backlog-notion', 'goal-tool', 'schedule', 'queue-reorder'],
    prerequisites: ['project'],
    keySettings: [{ label: 'Triage new backlog items automatically', entryId: 'dshfiles-backlog', fieldPath: ['autoTriage'] }],
  },
  {
    id: 'accounts',
    title: 'Accounts & cost',
    summary: 'Several AI accounts with failover, usage and quota, context compaction, and deferred tools to keep prompts small.',
    core: false,
    plugins: ['ai-accounts', 'usage', 'context-compaction', 'tool-search'],
    prerequisites: ['account'],
    keySettings: [{ label: 'Fail over to the next account when one runs out', entryId: 'ai-accounts', fieldPath: ['failover'] }],
  },
  {
    id: 'agents',
    title: 'Agents & orchestration',
    summary: 'Persistent agents that message each other, questions that wait for you, background jobs and threads on other hosts.',
    core: false,
    plugins: ['agents', 'agent-communication', 'agent-questions', 'background-jobs', 'multi-host'],
    prerequisites: ['account'],
    keySettings: [{ label: 'Stop background jobs that outlive their thread', entryId: 'dshfiles-background-jobs', fieldPath: ['stopOutlivedAfterMinutes'] }],
  },
  {
    id: 'observe',
    title: 'Observe & perf',
    summary: 'Traces of every turn and tool call, an activity log, a browser preview of dev servers, and hot reload that waits for idle.',
    core: false,
    plugins: ['traces', 'activity-timeline', 'preview', 'hmr-gate'],
    prerequisites: [],
    keySettings: [
      { label: 'Where traces are stored', entryId: 'dshfiles-traces', fieldPath: ['mode'] },
      { label: 'Hosts the preview browser may open', entryId: 'dshfiles-preview', fieldPath: ['allowedHosts'] },
    ],
  },
  {
    id: 'knowledge',
    title: 'Knowledge',
    summary: 'Memory across threads, reference repositories, search over past threads and prompts, and fast file search.',
    core: false,
    plugins: ['memory', 'references', 'session-search', 'prompt-stash', 'fff-search'],
    prerequisites: ['project'],
    keySettings: [
      { label: 'Keep memory across threads', entryId: 'dshfiles-memory', fieldPath: ['enabled'] },
      { label: 'Search every prompt you sent', entryId: 'dshfiles-prompt-stash', fieldPath: ['promptHistory'] },
    ],
  },
]
