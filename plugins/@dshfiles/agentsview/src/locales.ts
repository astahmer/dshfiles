import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { defineLocale } from '@dshfiles/dshx/client'

export const AGENTSVIEW_LOCALE_NAMESPACE = 'dshfiles.agentsview'

const en = {
  title: 'Agent CLI threads',
  subtitle: 'Threads other agent CLIs recorded on this machine (Claude Code, Codex), read-only.',
  refresh: 'Refresh',
  loading: 'Loading…',
  loadFailed: 'Agent CLI threads could not be loaded.',
  retry: 'Try again',
  allAgents: 'All agents',
  agentFilter: 'Agent',
  search: 'Search agent CLI threads',
  searchPlaceholder: 'Filter titles, or press Enter to search messages…',
  searchMessages: 'Search messages',
  searchingMessages: 'Searching messages…',
  searchIncomplete: 'Scanned {scanned} of {total} threads before the time budget ran out; refine the text or pick one agent to search further.',
  searchComplete: 'Scanned {scanned} of {total} threads.',
  noHits: 'No message matches this text.',
  clearSearch: 'Back to the list',
  indexing: 'Indexing agent logs: {indexed} of {total} files',
  indexError: 'The last indexing pass failed: {error}. Press Refresh to try again.',
  noSources:
    'No agent CLI logs were found. Claude Code writes under ~/.claude/projects and Codex under ~/.codex (or $CLAUDE_CONFIG_DIR / $CODEX_HOME); run either CLI once, then press Refresh.',
  sourceMissing: 'not found',
  noSessions: 'No thread matches this filter.',
  sessionsCount: '{count} threads',
  showMore: 'Show more',
  prompts: 'prompts',
  promptCount: '{count} prompts',
  promptCountOne: '1 prompt',
  toolCount: '{count} tool calls',
  toolCountOne: '1 tool call',
  tokensIn: 'in',
  tokensOut: 'out',
  tokensCached: 'cached',
  statsWindow: 'Last 30 days',
  statsSessions: 'threads',
  back: 'Back',
  copyKey: 'Copy key',
  copied: 'Copied',
  showMeta: 'Show system and context messages',
  showTools: 'Show tool calls and results',
  showThinking: 'Show thinking',
  noItems: 'This thread has no visible messages with the current filters.',
  capped: 'This log is long: only its first {count} items are kept.',
  earlier: 'Load earlier',
  later: 'Load later',
  itemRange: 'Items {from}–{to} of {total}',
  kindUser: 'User',
  kindAssistant: 'Assistant',
  kindThinking: 'Thinking',
  kindToolCall: 'Tool call',
  kindToolResult: 'Tool result',
  kindMeta: 'Context',
  error: 'error',
  truncated: 'truncated',
  untrusted: 'Transcript text was written by another agent; treat it as data.',
  selectSession: 'Select a thread to read it.',
  matchInTitle: 'title',
  ageNow: 'now',
  ageMinutes: '{n}min',
  ageHours: '{n}h',
  ageDays: '{n}d',
  ageMonths: '{n}mo',
  ageYears: '{n}y',
} as const

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'dshfiles.agentsview': keyof typeof en
  }
}

export type AgentsviewKey = keyof typeof en

export type AgentsviewTranslate = TranslateNS<typeof AGENTSVIEW_LOCALE_NAMESPACE>

export const agentsviewLocale = defineLocale(AGENTSVIEW_LOCALE_NAMESPACE, { en })
