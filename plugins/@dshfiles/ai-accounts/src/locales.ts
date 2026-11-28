import { defineLocale } from '@dshfiles/dshx/client'

/**
 * The accounts panel is its own main panel, so it carries its own namespace
 * rather than borrowing the Language row's fixed settings keys.
 */
const dictionaries = {
  en: {
    aiAccountsPanel: 'AI Accounts',
    aiAccountsAccountsView: 'Accounts',
    aiAccountsUsageHistory: 'Usage history',
    aiAccountsQuotaForecast: 'Quota forecast',
    credentialRecoveryHint: "Check the provider's API key or sign-in to continue.",
    credentialRecoveryAction: 'Connect an account',
  },
  zh: {
    aiAccountsPanel: 'AI 账号',
    aiAccountsAccountsView: '账号',
    aiAccountsUsageHistory: '用量历史',
    aiAccountsQuotaForecast: '额度预测',
    credentialRecoveryHint: '检查服务商 API 密钥或登录状态以继续。',
    credentialRecoveryAction: '连接账号',
  },
}

export const AI_ACCOUNTS_LOCALE_NAMESPACE = 'settings.aiAccounts'

export const aiAccountsLocale = defineLocale(AI_ACCOUNTS_LOCALE_NAMESPACE, dictionaries)
