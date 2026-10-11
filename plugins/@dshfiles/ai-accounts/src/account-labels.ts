import type { AccountProfile, AccountsFile } from './api.js'

export const KIND_LABEL = {
  codex: 'Codex',
  claude: 'Claude',
  'opencode-go': 'OpenCode Go',
  commandcode: 'Command Code',
  'github-copilot': 'GitHub Copilot',
  cursor: 'Cursor',
} satisfies Record<AccountProfile['kind'], string>

export const KIND_ACCENT = {
  codex: '#10A37F',
  claude: '#D97757',
  'opencode-go': '#3B82F6',
  commandcode: '#0E7490',
  'github-copilot': '#24292F',
  cursor: '#6B7280',
} satisfies Record<AccountProfile['kind'], string>

/** Rail group headings, in the order the groups are listed. */
export const KIND_GROUPS: readonly AccountProfile['kind'][] = ['codex', 'claude', 'github-copilot', 'opencode-go', 'commandcode', 'cursor']

/** The subscription each kind bills against, for the detail header's kicker. */
export const KIND_SUBSCRIPTION = {
  codex: 'CHATGPT SUBSCRIPTION',
  claude: 'ANTHROPIC SUBSCRIPTION',
  'opencode-go': 'OPENCODE SUBSCRIPTION',
  commandcode: 'COMMAND CODE SUBSCRIPTION',
  'github-copilot': 'GITHUB COPILOT SUBSCRIPTION',
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

export const DISTRIBUTION_LABEL = {
  sticky: 'Sticky',
  priority: 'Priority',
  'round-robin': 'Round-robin',
  balanced: 'Balanced',
} satisfies Record<AccountsFile['distribution'], string>

export const DISTRIBUTION_HINT = {
  sticky: 'Keep each conversation on its selected account to reuse its prompt cache. Switch only if that account is unavailable.',
  priority: 'Use compatible accounts for the selected provider and model in account-list order. Stay on the first available until it is rate-limited.',
  'round-robin': 'Move to the next available account with the same provider and model on every request.',
  balanced: 'Choose among compatible accounts, favoring accounts used least recently.',
} satisfies Record<AccountsFile['distribution'], string>

/** What connects a new account, for the notice the rail shows after creating one. */
export const connectHintFor = (kind: AccountProfile['kind']): string => {
  if (kind === 'codex') return 'Sign in with the copied command (Session section) and the identity fills itself in.'
  if (kind === 'claude') return 'Sign in with the copied command (Session section); quota and identity fill themselves in.'
  if (kind === 'cursor') return 'Run cursor-agent login; this account tracks quota while sessions use the Cursor Agent runtime.'
  if (kind === 'commandcode') return 'Run `cmd login` or set COMMANDCODE_API_KEY and the picker publishes the route.'
  if (kind === 'github-copilot') return 'Sign in with GitHub to connect your Copilot subscription.'
  return 'Set OPENCODE_API_KEY (or a shared key on the ai-accounts entry) and the route serves.'
}
