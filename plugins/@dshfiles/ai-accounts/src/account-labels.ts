import type { AccountProfile, AccountsFile } from './api.js'

export const KIND_LABEL = {
  codex: 'Codex',
  'opencode-go': 'OpenCode Go',
  commandcode: 'Command Code',
} satisfies Record<AccountProfile['kind'], string>

export const KIND_ACCENT = {
  codex: '#2563EB',
  'opencode-go': '#7C3AED',
  commandcode: '#0E7490',
} satisfies Record<AccountProfile['kind'], string>

/** Rail group headings, in the order the groups are listed. */
export const KIND_GROUPS: readonly AccountProfile['kind'][] = ['codex', 'opencode-go', 'commandcode']

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
  if (kind === 'commandcode') return 'Set COMMANDCODE_API_KEY in the environment and the picker publishes the route.'
  return 'Set OPENCODE_API_KEY (or a shared key on the ai-accounts entry) and the route serves.'
}
