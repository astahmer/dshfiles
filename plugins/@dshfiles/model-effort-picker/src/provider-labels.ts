import type { AccountKind } from '@dshfiles/ai-accounts/api'

/** The service a route is accessed through, named the way AI Accounts names its account groups. */
export const PROVIDER_LABEL = {
  codex: 'Codex',
  claude: 'Claude',
  'opencode-go': 'OpenCode Go',
  commandcode: 'Command Code',
  'github-copilot': 'GitHub Copilot',
  cursor: 'Cursor',
} satisfies Record<AccountKind, string>
