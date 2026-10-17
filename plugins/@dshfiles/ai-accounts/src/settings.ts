import Schema from '@deepseek-ai/schemastery'
import { defineSettings } from '@dshfiles/dshx/settings'
import { z } from 'zod'
import { DEFAULT_RECOVERY_POLICY, recoveryPolicySchema, type KindPolicy, type RecoveryPolicy } from './failure-policy.js'

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
    /** Account ids in the order the usage strip and popover list them; unlisted accounts follow. */
    usageOrder: Schema.array(Schema.string()).default([]),
    /** Account ids the usage strip and popover leave out. */
    hiddenUsageAccounts: Schema.array(Schema.string()).default([]),
    /** Show each account's short name beside its meter in the sidebar usage strip. */
    usageShortNames: Schema.boolean().default(true),
    /** Account id → short name for the usage strip; an account without one uses its picker tag, then its initials. */
    usageShortNameOverrides: Schema.dict(Schema.string()).default({}),
    /** The draggable usage tab pinned to a window edge; off by default because it covers content in narrow panes. */
    edgeWidget: Schema.boolean().default(false),
    /** Show the accounts block on Settings › Models. */
    modelsPageAccounts: Schema.boolean().default(true),
    /** Send a Codex account's requests to Luna Reserve while its weekly limit is spent and the reserve lasts. */
    codexLunaReserve: Schema.boolean().default(true),
    /** Default for resuming a quota-blocked turn one minute after its known reset. */
    autoRetryQuotaDefault: Schema.boolean().default(false),
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

const pricingSettingsSchema = z.object({
  costEstimates: z.boolean().catch(true),
  pricingRefreshHours: z.number().min(1).catch(24),
  pricingOverrides: z.record(z.string(), z.string()).catch({}),
})

export type PricingSettings = z.infer<typeof pricingSettingsSchema>

let readHostSettings: (() => unknown) | undefined

/** The Host half of the namespace: it only remembers its scope so the pricing service reads live values. */
export const aiAccountsHostSettings = aiAccountsSettings.host({
  setup: scope => {
    const read = (): unknown => scope.get()
    readHostSettings = read
    return () => {
      if (readHostSettings === read) readHostSettings = undefined
    }
  },
})

const readLiveSettings = (): object => {
  let value: unknown
  try {
    value = readHostSettings?.()
  } catch {
    value = undefined
  }
  return typeof value === 'object' && value !== null ? value : {}
}

/** Live pricing preferences; defaults when the namespace is not registered on this Host. */
export const readPricingSettings = (): PricingSettings => pricingSettingsSchema.parse(readLiveSettings())

/** Live Luna Reserve routing; on when the namespace is not registered on this Host. */
export const readLunaReserveRouting = (): boolean =>
  z
    .object({ codexLunaReserve: z.boolean().catch(true) })
    .catch({ codexLunaReserve: true })
    .parse(readLiveSettings()).codexLunaReserve

const recoverySettingsSchema = z.object({
  failureRecovery: recoveryPolicySchema,
  usageOrder: z.array(z.string()).catch([]),
  hiddenUsageAccounts: z.array(z.string()).catch([]),
})

/** Live failure policy plus the account order and hidden list a fail-over respects; defaults when unregistered. */
export const readRecoverySettings = (): {
  readonly policy: RecoveryPolicy
  readonly usageOrder: readonly string[]
  readonly hiddenUsageAccounts: readonly string[]
} => {
  const parsed = recoverySettingsSchema.parse(readLiveSettings())
  return { policy: parsed.failureRecovery, usageOrder: parsed.usageOrder, hiddenUsageAccounts: parsed.hiddenUsageAccounts }
}

const quotaRetrySettingsSchema = z.object({
  autoRetryQuotaDefault: z.boolean().catch(false),
  showQuotaRetryChoice: z.boolean().catch(true),
})

/** Quota retry defaults; old or unregistered Hosts remain opted out and show the turn-level option. */
export const readQuotaRetrySettings = (): {
  readonly autoRetryDefault: boolean
  readonly showChoice: boolean
} => {
  const parsed = quotaRetrySettingsSchema.parse(readLiveSettings())
  return { autoRetryDefault: parsed.autoRetryQuotaDefault, showChoice: parsed.showQuotaRetryChoice }
}

export class AccountSettingsModel {
  static readonly readPricingSettings = readPricingSettings
  static readonly readLunaReserveRouting = readLunaReserveRouting
  static readonly readRecoverySettings = readRecoverySettings
  static readonly readQuotaRetrySettings = readQuotaRetrySettings
}
