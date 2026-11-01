import { useSettings } from '@dshfiles/dshx/client'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import { AiAccountsSchema } from './effect-schema.js'
import { recoveryPolicySchema } from './failure-policy.js'
import { QuotaCoverageModel } from './quota-coverage-model.js'
import { DEFAULT_CLIENT_SETTINGS, aiAccountsSettings, type SaveMode } from './settings.js'

const meterLabelSchema = Schema.Literals(['both', 'percent', 'reset']).pipe(Schema.catchDecoding(() => Effect.succeed(Option.some('both'))))
export type MeterLabel = typeof meterLabelSchema.Type
const usageWindowLayoutSchema = Schema.Literals(['binding', 'horizontal', 'vertical']).pipe(Schema.catchDecoding(() => Effect.succeed(Option.some('binding'))))
export type UsageWindowLayout = typeof usageWindowLayoutSchema.Type
const nonNegativeIntBetween = (minimum: number, maximum: number) =>
  Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(minimum), Schema.isLessThanOrEqualTo(maximum))
const workHoursSchema = Schema.Struct({
  days: Schema.Array(nonNegativeIntBetween(0, 6)),
  startHour: nonNegativeIntBetween(0, 23),
  endHour: nonNegativeIntBetween(1, 24),
}).pipe(
  Schema.catchDecoding(() => Effect.succeed(Option.some({ ...QuotaCoverageModel.defaultWorkHours, days: [...QuotaCoverageModel.defaultWorkHours.days] }))),
)

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
    meterLabel: AiAccountsSchema.decode(meterLabelSchema, value?.meterLabel),
    usageWindowLayout: AiAccountsSchema.decode(usageWindowLayoutSchema, value?.usageWindowLayout),
    hiddenUsageAccounts: Array.isArray(value?.hiddenUsageAccounts) ? value.hiddenUsageAccounts.filter(id => typeof id === 'string') : [],
    usageShortNames: value?.usageShortNames ?? true,
    usageShortNameOverrides: value?.usageShortNameOverrides ?? {},
    usagePopoverSize: { width: value?.usagePopoverWidth ?? 0, height: value?.usagePopoverHeight ?? 0 },
    edgeWidget: value?.edgeWidget ?? DEFAULT_CLIENT_SETTINGS.edgeWidget,
    fastModeDefault: value?.fastModeDefault ?? false,
    codexLunaReserve: value?.codexLunaReserve ?? true,
    autoRetryQuotaDefault: value?.autoRetryQuotaDefault ?? true,
    showQuotaRetryChoice: value?.showQuotaRetryChoice ?? true,
    failureRecovery: AiAccountsSchema.decode(recoveryPolicySchema, value?.failureRecovery),
    modelsPageAccounts: value?.modelsPageAccounts ?? DEFAULT_CLIENT_SETTINGS.modelsPageAccounts,
    costEstimates: value?.costEstimates ?? DEFAULT_CLIENT_SETTINGS.costEstimates,
    costPlacement: value?.costPlacement === 'separate' ? 'separate' : 'inside',
    pricingRefreshHours: value?.pricingRefreshHours ?? DEFAULT_CLIENT_SETTINGS.pricingRefreshHours,
    pricingOverrides: value?.pricingOverrides ?? {},
    workHours: AiAccountsSchema.decode(workHoursSchema, value?.workHours),
  }
}
