import type { AccountConnectionMethod, AccountDraft, AccountKind } from './api.js'

const methods = {
  codex: ['device', 'cli'],
  'github-copilot': ['device'],
  claude: ['subscription', 'key', 'reference'],
  'opencode-go': ['key', 'reference'],
  commandcode: ['key', 'cli', 'reference'],
  cursor: ['key', 'cli', 'reference'],
} as const satisfies Record<AccountKind, readonly AccountConnectionMethod[]>
const labels = {
  device: 'Sign in in the browser',
  subscription: 'Claude Code subscription',
  key: 'Store a new key or setup token',
  cli: 'Use an existing CLI login',
  reference: 'Use an existing key reference',
}

/** Browser/Host share the provider's actual existing connection methods, not credential-presence guesses. */
export class AccountConnectionMethodModel {
  static allowedMethods = (kind: AccountKind): readonly AccountConnectionMethod[] => methods[kind]
  static label = (method: AccountConnectionMethod): string => labels[method]
  static assertAllowed = (kind: AccountKind, method: AccountConnectionMethod): void => {
    if (!AccountConnectionMethodModel.allowedMethods(kind).includes(method)) throw new Error('This provider does not support that connection method.')
  }
  static defaultMethod = (kind: AccountKind, existing?: Pick<AccountDraft, 'apiKeyEnv'>): AccountConnectionMethod => {
    if (kind === 'codex' || kind === 'github-copilot') return 'device'
    if (existing !== undefined && existing.apiKeyEnv.trim() !== '') return 'reference'
    if (kind === 'claude') return 'subscription'
    if (existing !== undefined && (kind === 'commandcode' || kind === 'cursor')) return 'cli'
    return 'key'
  }
}
