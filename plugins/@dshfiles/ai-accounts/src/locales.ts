import { defineLocale } from '@dshfiles/dshx/client'

/**
 * The accounts panel is its own main panel, so it carries its own namespace
 * rather than borrowing the Language row's fixed settings keys.
 */
const dictionaries = {
  en: { aiAccountsPanel: 'AI Accounts', aiAccountsUsageHistory: 'Usage history' },
  zh: { aiAccountsPanel: 'AI 账号', aiAccountsUsageHistory: '用量历史' },
}

export const AI_ACCOUNTS_LOCALE_NAMESPACE = 'settings.aiAccounts'

export const aiAccountsLocale = defineLocale(AI_ACCOUNTS_LOCALE_NAMESPACE, dictionaries)
