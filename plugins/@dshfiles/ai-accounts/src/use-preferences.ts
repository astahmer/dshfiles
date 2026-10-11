import { useSettings } from '@dshfiles/dshx/client'
import { z } from 'zod'
import { recoveryPolicySchema } from './failure-policy.js'
import { DEFAULT_CLIENT_SETTINGS, aiAccountsSettings, type SaveMode } from './settings.js'

const meterLabelSchema = z.enum(['both', 'percent', 'reset']).catch('both')
export type MeterLabel = z.infer<typeof meterLabelSchema>
const usageWindowLayoutSchema = z.enum(['binding', 'horizontal', 'vertical']).catch('binding')
export type UsageWindowLayout = z.infer<typeof usageWindowLayoutSchema>

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
    usageWindowLayout: usageWindowLayoutSchema.parse(value?.usageWindowLayout),
    usageOrder: Array.isArray(value?.usageOrder) ? value.usageOrder.filter(id => typeof id === 'string') : [],
    hiddenUsageAccounts: Array.isArray(value?.hiddenUsageAccounts) ? value.hiddenUsageAccounts.filter(id => typeof id === 'string') : [],
    edgeWidget: value?.edgeWidget ?? DEFAULT_CLIENT_SETTINGS.edgeWidget,
    codexLunaReserve: value?.codexLunaReserve ?? true,
    failureRecovery: recoveryPolicySchema.parse(value?.failureRecovery),
    modelsPageAccounts: value?.modelsPageAccounts ?? DEFAULT_CLIENT_SETTINGS.modelsPageAccounts,
    costEstimates: value?.costEstimates ?? DEFAULT_CLIENT_SETTINGS.costEstimates,
    costPlacement: value?.costPlacement === 'separate' ? 'separate' : 'inside',
    pricingRefreshHours: value?.pricingRefreshHours ?? DEFAULT_CLIENT_SETTINGS.pricingRefreshHours,
    pricingOverrides: value?.pricingOverrides ?? {},
  }
}
