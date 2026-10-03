import { declareLocaleNamespace } from '@dshfiles/dshx/client'

/**
 * The accounts panel is its own main panel, so it carries its own namespace
 * rather than borrowing the Language row's fixed settings keys.
 */
const dictionaries = {
  en: { aiAccountsPanel: 'AI Accounts' },
  zh: { aiAccountsPanel: 'AI 账号' },
}

export const AI_ACCOUNTS_LOCALE_NAMESPACE = 'settings.aiAccounts'

export const aiAccountsLocale = declareLocaleNamespace(
  AI_ACCOUNTS_LOCALE_NAMESPACE,
  dictionaries,
)
