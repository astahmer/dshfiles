import { defineLocale } from '@dshfiles/dshx/client'

export const AI_ACCOUNTS_LOCALE_NAMESPACE = 'settings.aiAccounts'

const en = {
  section: 'AI Accounts',
}

const zh = {
  section: 'AI 账号',
}

export const aiAccountsLocale = defineLocale(AI_ACCOUNTS_LOCALE_NAMESPACE, { en, zh })