import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { defineClient, defineLocale, defineSlot } from '@becomeopc/dshx/client'
import { AccountsSection } from './accounts-section.js'
import { aiAccountsLocale, AI_ACCOUNTS_LOCALE_NAMESPACE } from './locales.js'

let sectionLabel = (): string => 'AI Accounts'

const accountsSection = defineSlot('settings.section', {
  id: 'ai-accounts',
  order: 30,
  label: () => sectionLabel(),
  locale: aiAccountsLocale,
  component: AccountsSection,
})

export default defineClient({
  name: '@dshfiles/ai-accounts',
  locales: [aiAccountsLocale],
  slots: [accountsSection],
  setup(ctx) {
    const t = ctx.locale.bind(AI_ACCOUNTS_LOCALE_NAMESPACE)
    sectionLabel = () => t('section')
  },
})
