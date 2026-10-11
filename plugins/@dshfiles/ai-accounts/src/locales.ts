import { defineLocale } from '@dshfiles/dshx/client'

/**
 * The accounts panel is its own main panel, so it carries its own namespace
 * rather than borrowing the Language row's fixed settings keys.
 */
const dictionaries = {
  en: {
    aiAccountsPanel: 'AI Accounts',
    aiAccountsUsageHistory: 'Usage history',
    credentialRecoveryHint: "Check the provider's API key or sign-in to continue.",
    credentialRecoveryAction: 'Add or fix credentials',
  },
  zh: {
    aiAccountsPanel: 'AI 账号',
    aiAccountsUsageHistory: '用量历史',
    credentialRecoveryHint: '检查服务商 API 密钥或登录状态以继续。',
    credentialRecoveryAction: '添加或修复凭据',
  },
}

export const AI_ACCOUNTS_LOCALE_NAMESPACE = 'settings.aiAccounts'

export const aiAccountsLocale = defineLocale(AI_ACCOUNTS_LOCALE_NAMESPACE, dictionaries)
