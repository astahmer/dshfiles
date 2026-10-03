import { defineLocale } from '@dshfiles/dshx/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'

/**
 * The accounts panel is its own main panel, so it carries its own namespace
 * rather than borrowing the Language row's fixed settings keys.
 */
export const AI_ACCOUNTS_LOCALE_NAMESPACE = 'settings.aiAccounts'

const en = { aiAccountsPanel: 'AI Accounts' }
const zh = { aiAccountsPanel: 'AI 账号' }

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'settings.aiAccounts': 'aiAccountsPanel'
  }
}

export const aiAccountsLocale = defineLocale(AI_ACCOUNTS_LOCALE_NAMESPACE, { en, zh })
