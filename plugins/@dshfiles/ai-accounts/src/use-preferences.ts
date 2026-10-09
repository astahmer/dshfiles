import { useSettings } from '@dshfiles/dshx/client'
import { z } from 'zod'
import { DEFAULT_CLIENT_SETTINGS, aiAccountsSettings, type SaveMode } from './settings.js'

const meterLabelSchema = z.enum(['both', 'percent', 'reset']).catch('both')
export type MeterLabel = z.infer<typeof meterLabelSchema>

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
    meterLabel: meterLabelSchema.parse(value?.meterLabel),
    usageOrder: Array.isArray(value?.usageOrder) ? value.usageOrder.filter(id => typeof id === 'string') : [],
    hiddenUsageAccounts: Array.isArray(value?.hiddenUsageAccounts) ? value.hiddenUsageAccounts.filter(id => typeof id === 'string') : [],
    edgeWidget: value?.edgeWidget ?? DEFAULT_CLIENT_SETTINGS.edgeWidget,
    codexLunaReserve: value?.codexLunaReserve ?? true,
    modelsPageAccounts: value?.modelsPageAccounts ?? DEFAULT_CLIENT_SETTINGS.modelsPageAccounts,
    costEstimates: value?.costEstimates ?? DEFAULT_CLIENT_SETTINGS.costEstimates,
    pricingRefreshHours: value?.pricingRefreshHours ?? DEFAULT_CLIENT_SETTINGS.pricingRefreshHours,
    pricingOverrides: value?.pricingOverrides ?? {},
  }
}
