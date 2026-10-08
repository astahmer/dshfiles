import type { AccountProfile, AccountsFile } from './api.js'

export const KIND_LABEL = {
  codex: 'Codex',
  claude: 'Claude',
  'opencode-go': 'OpenCode Go',
  commandcode: 'Command Code',
  cursor: 'Cursor',
} satisfies Record<AccountProfile['kind'], string>

export const KIND_ACCENT = {
  codex: '#10A37F',
  claude: '#D97757',
  'opencode-go': '#3B82F6',
  commandcode: '#0E7490',
  cursor: '#6B7280',
} satisfies Record<AccountProfile['kind'], string>

/** Rail group headings, in the order the groups are listed. */
export const KIND_GROUPS: readonly AccountProfile['kind'][] = ['codex', 'claude', 'opencode-go', 'commandcode', 'cursor']

/** The subscription each kind bills against, for the detail header's kicker. */
export const KIND_SUBSCRIPTION = {
  codex: 'CHATGPT SUBSCRIPTION',
  claude: 'ANTHROPIC SUBSCRIPTION',
  'opencode-go': 'OPENCODE SUBSCRIPTION',
  commandcode: 'COMMAND CODE SUBSCRIPTION',
  cursor: 'CURSOR SUBSCRIPTION',
} satisfies Record<AccountProfile['kind'], string>

/** Kinds that publish a model route; the rest only track identity and quota. */
export const routedKind = (kind: AccountProfile['kind']): boolean => kind !== 'cursor'

export const STATE_LABEL = {
  healthy: 'Authenticated',
  cooling: 'Rate limited',
  disabled: 'Off',
  unconfigured: 'Not signed in',
} satisfies Record<AccountProfile['state'], string>

export const DISTRIBUTIONS: readonly AccountsFile['distribution'][] = ['sticky', 'priority', 'round-robin', 'balanced']

export const DISTRIBUTION_HINT = {
  sticky: 'One account per conversation, so the upstream prompt cache stays warm. A rate-limited account is skipped and the retry lands on the next one.',
  priority: 'Drain one account until it is rate-limited, then the next in order.',
  'round-robin': 'Rotate on every request so spend spreads evenly.',
  balanced: 'Weighted random, biased toward the least recently used account.',
} satisfies Record<AccountsFile['distribution'], string>

/** What connects a new account, for the notice the rail shows after creating one. */
export const connectHintFor = (kind: AccountProfile['kind']): string => {
  if (kind === 'codex') return 'Sign in with the copied command (Session section) and the identity fills itself in.'
  if (kind === 'claude') return 'Sign in with the copied command (Session section); quota and identity fill themselves in.'
  if (kind === 'cursor') return 'Run cursor-agent login; this account tracks quota while sessions use the Cursor Agent runtime.'
  if (kind === 'commandcode') return 'Run `cmd login` or set COMMANDCODE_API_KEY and the picker publishes the route.'
  return 'Set OPENCODE_API_KEY (or a shared key on the ai-accounts entry) and the route serves.'
}
