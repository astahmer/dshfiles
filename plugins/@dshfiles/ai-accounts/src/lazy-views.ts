import { AccountsPanel } from './accounts-panel.js'
import { ModelsPageAccounts } from './models-page-accounts.js'
import { QuotaAccountsView } from './quota-accounts-view.js'
import { QuotaForecastPanel } from './quota-forecast-panel.js'
import { AiAccountsSettingsSection } from './settings-section.js'
import { UsageHistoryPanel } from './usage-history-panel.js'

// The account pages share their account rows, charts and forms, so they load as one lazy chunk when the first opens:
// two chunks may not bundle the same plugin module.
export const LazyViews = { AccountsPanel, ModelsPageAccounts, QuotaAccountsView, QuotaForecastPanel, AiAccountsSettingsSection, UsageHistoryPanel }
