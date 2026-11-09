import Schema from '@deepseek-ai/schemastery'
import { defineSettings, type SettingsValue } from '@dshfiles/dshx/settings'
import * as EffectSchema from 'effect/Schema'
import { AiAccountsSchema } from './effect-schema.js'
import { DEFAULT_RECOVERY_POLICY, recoveryPolicySchema, type KindPolicy } from './failure-policy.js'

const kindPolicySetting = (fallback: KindPolicy, description: string) =>
  Schema.object({
    retries: Schema.natural().max(10).default(fallback.retries).description('Retries on the same account.'),
    backoffMs: Schema.natural().min(100).max(60_000).default(fallback.backoffMs).description('First retry delay in ms; each further retry doubles it.'),
    lunaReserve: Schema.boolean().default(fallback.lunaReserve).description('Codex: continue on Luna Reserve while it lasts.'),
    failover: Schema.boolean().default(fallback.failover).description('Fail over to the next account of the same provider that offers the model.'),
    waitSeconds: Schema.natural()
      .max(3_600)
      .default(fallback.waitSeconds)
      .description('Wait up to this long for a provider-declared reset, then retry once (0 = never wait).'),
    shrink: Schema.boolean().default(fallback.shrink).description('Last try: resend earlier images as file placeholders.'),
    then: Schema.union([Schema.const('fail').description('Fail the turn'), Schema.const('dsh').description('Hand to DSH (built-in retry, compaction)')])
      .default(fallback.then)
      .description('When every option above is spent.'),
  }).description(description)

/**
 * Preferences for the accounts page and its quota surfaces. Account profiles
 * stay in the accounts file and the history schedule in the usage domain; this
 * namespace only holds how the Client behaves.
 */
export const aiAccountsSettings = defineSettings({
  namespace: 'ai-accounts',
  schema: Schema.object({
    /** `auto` writes each edit after a short pause; `manual` keeps Save and Revert. */
    saveMode: Schema.union(['auto', 'manual']).default('auto'),
    /** Pause after the last keystroke before an automatic save. */
    autoSaveDelayMs: Schema.natural().min(200).max(10_000).default(800),
    /** How often open quota surfaces ask the Host for fresh usage. */
    usageRefreshSeconds: Schema.natural().min(15).max(3_600).default(60),
    /** The usage strip above the sidebar foot (a compact button on the collapsed rail). */
    footerButton: Schema.boolean().default(true),
    /** What each sidebar usage meter shows: percent left, time to its reset, or both stacked. */
    meterLabel: Schema.union(['both', 'percent', 'reset']).default('both'),
    /** Show the governing quota window only, or all account windows side by side/stacked in the wide sidebar strip. */
    usageWindowLayout: Schema.union(['binding', 'horizontal', 'vertical']).default('binding'),
    /** Legacy cosmetic order, retained for old clients only. New clients use the account store; never migrate this into routing priority. */
    usageOrder: Schema.array(Schema.string()).default([]),
    /** Account ids the usage strip and popover leave out. */
    hiddenUsageAccounts: Schema.array(Schema.string()).default([]),
    /** Show each account's short name beside its meter in the sidebar usage strip. */
    usageShortNames: Schema.boolean().default(true),
    /** Account id → short name for the usage strip; an account without one uses its picker tag, then its initials. */
    usageShortNameOverrides: Schema.dict(Schema.string()).default({}),
    /** Usage popover size from its resize grip, in px; 0 fits the content. */
    usagePopoverWidth: Schema.natural().max(4_000).default(0),
    usagePopoverHeight: Schema.natural().max(4_000).default(0),
    /** The draggable usage tab pinned to a window edge; off by default because it covers content in narrow panes. */
    edgeWidget: Schema.boolean().default(false),
    /** Show the accounts block on Settings › Models. */
    modelsPageAccounts: Schema.boolean().default(true),
    /** Enable Codex Fast mode for supported model routes unless a Session changes that route. */
    fastModeDefault: Schema.boolean().default(false),
    /** Send a Codex account's requests to Luna Reserve while its weekly limit is spent and the reserve lasts. */
    codexLunaReserve: Schema.boolean().default(true),
    /** Default for resuming a quota-blocked turn one minute after its known reset, or on a growing backoff when the provider names none. */
    autoRetryQuotaDefault: Schema.boolean().default(true),
    /** Show a per-turn automatic-retry checkbox beside exhausted-limit errors. */
    showQuotaRetryChoice: Schema.boolean().default(true),
    /** What each kind of failed model request on an account route does next. */
    failureRecovery: Schema.object({
      transport: kindPolicySetting(DEFAULT_RECOVERY_POLICY.transport, 'Connection resets, timeouts, 5xx and replay-buffer overflows.'),
      rateLimit: kindPolicySetting(DEFAULT_RECOVERY_POLICY.rateLimit, 'Rate limited (429).'),
      exhausted: kindPolicySetting(DEFAULT_RECOVERY_POLICY.exhausted, 'Usage exhausted: no quota left, weekly limit spent.'),
      auth: kindPolicySetting(DEFAULT_RECOVERY_POLICY.auth, 'Signed out, rejected or missing credentials.'),
      oversized: kindPolicySetting(DEFAULT_RECOVERY_POLICY.oversized, 'Request or context too large.'),
    }).description('Failure recovery'),
    /** Show the estimated session cost in the token stats or in its own dock entry. */
    costPlacement: Schema.union(['inside', 'separate']).default('inside'),
    /** Estimated session cost beside the composer stats, priced from models.dev. */
    costEstimates: Schema.boolean().default(true),
    /** How often the Host refetches models.dev prices. */
    pricingRefreshHours: Schema.natural().min(1).max(720).default(24),
    /** `provider/model` or `provider/*` → a models.dev id, `free`, or `input=… output=… cacheRead=… cacheWrite=…` (USD per 1M tokens). */
    pricingOverrides: Schema.dict(Schema.string()).default({}),
    /** When nobody being able to run an agent matters: Quota forecast counts the gaps that fall in these hours. */
    workHours: Schema.object({
      /** `Date.getDay()` values, 0 = Sunday. */
      days: Schema.array(Schema.natural().max(6)).default([1, 2, 3, 4, 5]),
      startHour: Schema.natural().max(23).default(9),
      endHour: Schema.natural().min(1).max(24).default(18),
    }),
    /** Display currency; models.dev publishes USD only. */
    currency: Schema.union(['USD']).default('USD'),
  }),
  applies: 'live',
})

export type SaveMode = 'auto' | 'manual'

export const DEFAULT_CLIENT_SETTINGS = {
  saveMode: 'auto',
  autoSaveDelayMs: 800,
  usageRefreshSeconds: 60,
  footerButton: true,
  edgeWidget: false,
  modelsPageAccounts: true,
  costEstimates: true,
  pricingRefreshHours: 24,
} as const satisfies {
  readonly saveMode: SaveMode
  readonly autoSaveDelayMs: number
  readonly usageRefreshSeconds: number
  readonly footerButton: boolean
  readonly edgeWidget: boolean
  readonly modelsPageAccounts: boolean
  readonly costEstimates: boolean
  readonly pricingRefreshHours: number
}

export type PricingSettings = {
  readonly costEstimates: boolean
  readonly pricingRefreshHours: number
  readonly pricingOverrides: Readonly<Record<string, string>>
}

/** The namespace keys read below; each stays `unknown` until its own rule decides whether it is usable. */
const liveSettingsSchema = EffectSchema.Struct({
  costEstimates: EffectSchema.optional(EffectSchema.Unknown),
  pricingRefreshHours: EffectSchema.optional(EffectSchema.Unknown),
  pricingOverrides: EffectSchema.optional(EffectSchema.Unknown),
  fastModeDefault: EffectSchema.optional(EffectSchema.Unknown),
  codexLunaReserve: EffectSchema.optional(EffectSchema.Unknown),
  failureRecovery: EffectSchema.optional(EffectSchema.Unknown),
  hiddenUsageAccounts: EffectSchema.optional(EffectSchema.Unknown),
  autoRetryQuotaDefault: EffectSchema.optional(EffectSchema.Unknown),
  showQuotaRetryChoice: EffectSchema.optional(EffectSchema.Unknown),
})

type LiveSettings = typeof liveSettingsSchema.Type

/** One setting, or its fallback when the value is absent, malformed, or from an older Host. */
const decodeSetting = <S extends EffectSchema.ConstraintDecoder<unknown>>(schema: S, value: unknown, fallback: S['Type']): S['Type'] => {
  const result = AiAccountsSchema.decodeResult(schema, value)
  return result._tag === 'Success' ? result.success : fallback
}

/** The committed namespace value; an older Host may still hold a malformed field, so each one is decoded again. */
export type AiAccountsSettingsValue = SettingsValue<typeof aiAccountsSettings.schema>

const liveFields = (live: AiAccountsSettingsValue): LiveSettings => {
  const result = AiAccountsSchema.decodeResult(liveSettingsSchema, live)
  return result._tag === 'Success' ? result.success : {}
}

export interface AccountSettingsSnapshot {
  readonly pricing: PricingSettings
  /** Enable Codex Fast mode for supported routes unless a Session changes that route. */
  readonly fastModeDefault: boolean
  readonly lunaReserveRouting: boolean
  readonly recovery: {
    readonly policy: typeof recoveryPolicySchema.Type
    readonly usageOrder: readonly string[]
    readonly hiddenUsageAccounts: readonly string[]
  }
  readonly quotaRetry: { readonly autoRetryDefault: boolean; readonly showChoice: boolean }
}

/** The Host-side preferences of the namespace, each falling back on its own when absent or malformed. */
const fromLive = (live: AiAccountsSettingsValue): AccountSettingsSnapshot => {
  const fields = liveFields(live)
  return {
    pricing: {
      costEstimates: decodeSetting(EffectSchema.Boolean, fields.costEstimates, true),
      pricingRefreshHours: decodeSetting(EffectSchema.Finite.check(EffectSchema.isGreaterThanOrEqualTo(1)), fields.pricingRefreshHours, 24),
      pricingOverrides: decodeSetting(EffectSchema.Record(EffectSchema.String, EffectSchema.String), fields.pricingOverrides, {}),
    },
    fastModeDefault: decodeSetting(EffectSchema.Boolean, fields.fastModeDefault, false),
    lunaReserveRouting: decodeSetting(EffectSchema.Boolean, fields.codexLunaReserve, true),
    // Preserve the Host call shape without letting an old cosmetic list override canonical route priority.
    recovery: {
      policy: decodeSetting(recoveryPolicySchema, fields.failureRecovery, DEFAULT_RECOVERY_POLICY),
      usageOrder: [],
      hiddenUsageAccounts: decodeSetting(EffectSchema.Array(EffectSchema.String), fields.hiddenUsageAccounts, []),
    },
    quotaRetry: {
      autoRetryDefault: decodeSetting(EffectSchema.Boolean, fields.autoRetryQuotaDefault, true),
      showChoice: decodeSetting(EffectSchema.Boolean, fields.showQuotaRetryChoice, true),
    },
  }
}

export class AccountSettingsModel {
  static readonly fromLive = fromLive
}
