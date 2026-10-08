import { defineApi, method } from '@dshfiles/dshx/api'
import { z } from 'zod'
import { quotaContinuationSummarySchema } from './quota-continuation-model.js'
import { MAX_USAGE_HISTORY_POINTS, usageHistoryPointSchema, usageMetaSchema } from './usage-history-model.js'

/**
 * Wire contract for the accounts page.
 *
 * The page edits account profiles, so every operation lives here rather than in
 * the view. The page and the agent's `ai_accounts` tool read the same file
 * through the same Host method, so they can never disagree.
 *
 * No token and no `auth.json` content ever crosses: an account reports whether
 * it holds a login, the identity it presents, and the command that creates one.
 */

export const accountKindSchema = z.enum(['codex', 'claude', 'opencode-go', 'commandcode', 'cursor'])

export const accountModeSchema = z.enum(['direct', 'authOverlay'])

export const accountStateSchema = z.enum(['healthy', 'cooling', 'disabled', 'unconfigured'])

/**
 * A keyed account names the variable holding its key, and the Host sends that
 * value to the account's base URL. Both are constrained so an API caller can
 * never point an arbitrary environment variable at an arbitrary host.
 */
const keyEnvNamePattern = /^[A-Z][A-Z0-9_]*_API_KEY$/

export const isKeyEnvName = (name: string): boolean => keyEnvNamePattern.test(name)

const ACCOUNT_MODEL_SEPARATOR = '/'

// Route slugs stay unique when two accounts share a display name.
export const accountModelName = (instanceId: string, modelName: string): string => `${instanceId}${ACCOUNT_MODEL_SEPARATOR}${modelName}`

export const baseModelName = (instanceId: string, label: string): string =>
  label.startsWith(`${instanceId}${ACCOUNT_MODEL_SEPARATOR}`) ? label.slice(instanceId.length + ACCOUNT_MODEL_SEPARATOR.length) : label

const isLoopbackHost = (hostname: string): boolean => hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'

export const isAllowedCommandCodeBase = (value: string): boolean => {
  const url = URL.parse(value)
  if (url === null || url.username !== '' || url.password !== '') return false
  if (isLoopbackHost(url.hostname)) return url.protocol === 'https:' || url.protocol === 'http:'
  return url.protocol === 'https:' && (url.hostname === 'commandcode.ai' || url.hostname.endsWith('.commandcode.ai'))
}

const isPlainHomePath = (path: string): boolean => (path.startsWith('/') || path.startsWith('~/')) && !path.includes('\0') && !path.split('/').includes('..')

const homePathSchema = z
  .string()
  .trim()
  .max(1024)
  .refine(path => path === '' || isPlainHomePath(path), {
    message: 'Use an absolute path or one under ~/, without ".." segments.',
  })

const apiKeyEnvSchema = z
  .string()
  .trim()
  .max(128)
  .refine(name => name === '' || isKeyEnvName(name), {
    message: 'Name an environment variable ending in _API_KEY, e.g. COMMANDCODE_API_KEY.',
  })

const apiBaseUrlSchema = z
  .string()
  .trim()
  .max(512)
  .refine(url => url === '' || isAllowedCommandCodeBase(url), {
    message: 'Use https on commandcode.ai, or a loopback address.',
  })

export const accountProfileSchema = z.object({
  /** Routing slug the model picker shows, e.g. `codex_personal`. */
  instanceId: z.string().min(1).max(64),
  kind: accountKindSchema,
  displayName: z.string().min(1).max(120),
  enabled: z.boolean(),
  /** Codex: home holding shared state. Claude: the CLAUDE_CONFIG_DIR its login lives in. */
  homePath: homePathSchema,
  /** Per-account home holding a private `auth.json`; empty means the shared home. */
  shadowHomePath: homePathSchema,
  /** Keyed accounts name an environment variable instead of carrying a value. */
  apiKeyEnv: apiKeyEnvSchema,
  /** Command Code accounts may point at a different API base. */
  apiBaseUrl: apiBaseUrlSchema,
  badge: z.string().max(32),
  accentColor: z.string().max(32),
  providerIcon: z.string().max(32),
  mode: accountModeSchema,
  signedIn: z.boolean(),
  identity: z.string().max(320).nullable(),
  plan: z.string().max(64).nullable(),
  state: accountStateSchema,
  /** The exact command that signs this account in. Never a credential. */
  loginHint: z.string().max(2048),
  detail: z.string().max(400).nullable(),
  additionalModelIds: z.array(z.string().max(120)).max(32).default([]),
  /**
   * Default reasoning effort per model id. Absent means the provider's own
   * default, so an account only lists the models it wants to pin.
   */
  reasoningDefaults: z.record(z.string().max(160), z.string().max(32)).default({}),
  /** Model ids this account never shows, so the picker stays short. */
  hiddenModelIds: z.array(z.string().max(160)).max(500).default([]),
  /** Model ids to surface first. */
  favoriteModelIds: z.array(z.string().max(160)).max(500).default([]),
  /**
   * Explicit picker order. Ids absent from this list keep the provider's own
   * order after the listed ones, so adding a model never reshuffles the rest.
   */
  modelOrder: z.array(z.string().max(160)).max(500).default([]),
})

/** What the page may write: identity and health are observed, never authored. */
export const accountDraftSchema = accountProfileSchema.pick({
  instanceId: true,
  kind: true,
  displayName: true,
  enabled: true,
  homePath: true,
  shadowHomePath: true,
  apiKeyEnv: true,
  apiBaseUrl: true,
  badge: true,
  accentColor: true,
  providerIcon: true,
  additionalModelIds: true,
  reasoningDefaults: true,
  hiddenModelIds: true,
  favoriteModelIds: true,
  modelOrder: true,
})

export const accountsFileSchema = z.object({
  distribution: z.enum(['sticky', 'priority', 'round-robin', 'balanced']),
  cooldownMs: z.number().int().min(0).max(86_400_000),
  shadowRoot: homePathSchema,
  accounts: z.array(accountProfileSchema).max(64),
})

export const usageCardSchema = z.object({
  status: z.enum(['ok', 'unauthenticated', 'unsupported', 'rate-limited', 'error']),
  message: z.string().max(300).nullable(),
  identity: z.string().max(320).nullable(),
  plan: z.string().max(64).nullable(),
  windows: z
    .array(
      z.object({
        label: z.string().max(32),
        percentRemaining: z.number(),
        resetsAt: z.number().nullable(),
      }),
    )
    .max(6),
  bankedResets: z.number().int().min(0).max(20),
  /** When each banked reset expires, when the provider reports it. */
  bankedResetExpiries: z.array(z.number().nullable()).max(20),
})

export const accountsUsageSchema = z.object({
  /** When the sweep that produced these cards finished. */
  readAt: z.number(),
  /** The machine the Host reads quota from, shown on every card. */
  hostName: z.string().max(255),
  cards: z.array(
    z.object({
      instanceId: z.string().min(1).max(64),
      displayName: z.string().max(120),
      kind: accountKindSchema,
      enabled: z.boolean(),
      usage: usageCardSchema,
    }),
  ),
})

export const accountsCatalogSchema = z.object({
  instanceId: z.string().min(1).max(64),
  models: z.array(
    z.object({
      id: z.string().min(1).max(200),
      name: z.string().max(200),
      efforts: z.array(z.object({ id: z.string().max(64), name: z.string().max(80) })).max(12),
      defaultEffort: z.string().max(32).nullable(),
    }),
  ),
})

export type AccountsCatalog = z.infer<typeof accountsCatalogSchema>
export type UsageCard = z.infer<typeof usageCardSchema>
export type AccountsUsage = z.infer<typeof accountsUsageSchema>

export const identityResultSchema = z.object({
  instanceId: z.string().min(1).max(64),
  email: z.string().max(320).nullable(),
  plan: z.string().max(64).nullable(),
  signedIn: z.boolean(),
})

export type AccountProfile = z.infer<typeof accountProfileSchema>
export type AccountDraft = z.infer<typeof accountDraftSchema>
export type AccountsFile = z.infer<typeof accountsFileSchema>
export type AccountKind = z.infer<typeof accountKindSchema>
export type UsageHistoryPoint = z.infer<typeof usageHistoryPointSchema>
export type UsageHistoryMeta = z.infer<typeof usageMetaSchema>

/** Icon names the page offers, matching the reference account page. */
export const PROVIDER_ICONS = ['Bot', 'Rocket', 'Sparkles', 'Terminal', 'Layers', 'Brain', 'Globe', 'Code', 'Gem'] as const

export const aiAccountsApi = defineApi({
  id: 'ai-accounts',
  version: 1,
  methods: {
    /** Read the whole file: distribution plus every account. */
    read: method({ input: z.void(), output: accountsFileSchema }),
    /** Create or update one account by its instance id. */
    save: method({
      input: z.object({
        draft: accountDraftSchema,
        /** Set when the draft renames an existing account, so the old slug is replaced rather than duplicated. */
        previousInstanceId: z.string().min(1).max(64).optional(),
      }),
      output: accountsFileSchema,
    }),
    /** Remove one account. */
    remove: method({
      input: z.object({ instanceId: z.string().min(1).max(64) }),
      output: accountsFileSchema,
    }),
    /** Change how requests are spread across accounts. */
    setDistribution: method({
      input: z.object({ distribution: accountsFileSchema.shape.distribution }),
      output: accountsFileSchema,
    }),
    /**
     * Read the identity an account currently presents, creating its shadow home
     * on first use so a fresh `codex login` writes to the right place.
     */
    identity: method({
      input: z.object({ instanceId: z.string().min(1).max(64) }),
      output: identityResultSchema,
    }),
    /**
     * One account's model catalog with the reasoning levels each model
     * supports, so the panel can offer a default effort per model instead of
     * guessing what a model accepts.
     */
    catalog: method({
      input: z.object({ instanceId: z.string().min(1).max(64) }),
      output: z.object({
        instanceId: z.string().min(1).max(64),
        models: z.array(
          z.object({
            id: z.string().min(1).max(200),
            name: z.string().max(200),
            efforts: z.array(z.object({ id: z.string().max(64), name: z.string().max(80) })).max(12),
            defaultEffort: z.string().max(32).nullable(),
          }),
        ),
      }),
    }),
    /**
     * Stored quota readings for one account over a window, oldest first, so a
     * chart reads left to right without re-sorting on the client.
     */
    history: method({
      input: z.object({
        instanceId: z.string().min(1).max(64),
        days: z.number().int().min(1).max(365).default(7),
      }),
      output: z.object({
        instanceId: z.string().min(1).max(64),
        points: z.array(usageHistoryPointSchema).max(MAX_USAGE_HISTORY_POINTS),
      }),
    }),
    /** Schedule and retention are persisted with the history domain. */
    historySettings: method({ input: z.void(), output: usageMetaSchema }),
    saveHistorySettings: method({
      input: z.object({
        intervalMinutes: z.number().int().min(1).max(60),
        retentionDays: z.number().int().min(1).max(365),
      }),
      output: usageMetaSchema,
    }),

    /**
     * Live subscription quota for every account. Each card is read with its own
     * credential and a short timeout, so one unreachable provider degrades one
     * card rather than the panel. Concurrent surfaces share one cached sweep.
     */
    usage: method({ input: z.void(), output: accountsUsageSchema }),
    /** Bypass the shared short-lived sweep cache, for an explicit refresh. */
    refreshUsage: method({ input: z.void(), output: accountsUsageSchema }),

    /** Read now and record, so a fresh chart does not wait for the next poll. */
    collectUsage: method({ input: z.void(), output: z.object({ recorded: z.number() }) }),
    /** Durable quota-blocked Sessions that can be resumed or snoozed by the user. */
    quotaContinuations: method({
      input: z.void(),
      output: z.object({
        scheduleAvailable: z.boolean(),
        continuations: z.array(quotaContinuationSummarySchema).max(500),
      }),
    }),
    /** Queue the exact stored continuation through the native Session Controller. */
    resumeQuotaContinuation: method({
      input: z.object({ continuationId: z.string().uuid() }),
      output: z.object({ accepted: z.boolean() }),
    }),
    /** Snooze only the continuation's recovery timing; it does not change quota reset evidence. */
    snoozeQuotaContinuation: method({
      input: z.object({
        continuationId: z.string().uuid(),
        duration: z.enum(['one-hour', 'four-hours', 'one-day', 'unsnooze']),
      }),
      output: z.object({ updated: z.boolean() }),
    }),
  },
})
