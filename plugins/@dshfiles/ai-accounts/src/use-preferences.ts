import { useSettings } from '@dshfiles/dshx/client'
import { DEFAULT_CLIENT_SETTINGS, aiAccountsSettings, type SaveMode } from './settings.js'

/** The accounts preferences with defaults filled in while Settings loads or is unavailable. */
export const usePreferences = () => {
  const settings = useSettings(aiAccountsSettings)
  const value = settings.value
  const saveMode: SaveMode = value?.saveMode === 'manual' ? 'manual' : 'auto'
  return {
    settings,
    saveMode,
    autoSaveDelayMs: value?.autoSaveDelayMs ?? DEFAULT_CLIENT_SETTINGS.autoSaveDelayMs,
    usageRefreshMs: (value?.usageRefreshSeconds ?? DEFAULT_CLIENT_SETTINGS.usageRefreshSeconds) * 1000,
    footerButton: value?.footerButton ?? DEFAULT_CLIENT_SETTINGS.footerButton,
    footerAccounts: Array.isArray(value?.footerAccounts) ? value.footerAccounts.filter(id => typeof id === 'string') : [],
    footerMaxItems: typeof value?.footerMaxItems === 'number' ? value.footerMaxItems : DEFAULT_CLIENT_SETTINGS.footerMaxItems,
    edgeWidget: value?.edgeWidget ?? DEFAULT_CLIENT_SETTINGS.edgeWidget,
    modelsPageAccounts: value?.modelsPageAccounts ?? DEFAULT_CLIENT_SETTINGS.modelsPageAccounts,
    costEstimates: value?.costEstimates ?? DEFAULT_CLIENT_SETTINGS.costEstimates,
    pricingRefreshHours: value?.pricingRefreshHours ?? DEFAULT_CLIENT_SETTINGS.pricingRefreshHours,
    pricingOverrides: value?.pricingOverrides ?? {},
  }
}
