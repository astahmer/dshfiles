import { defineApi, method } from '@dshfiles/dshx/api'
import { z } from 'zod'
import { routeQuoteSchema } from './cost-estimate.js'
import { quotaContinuationSummarySchema } from './quota-continuation-model.js'
import { fastModeUsageHistorySchema } from './fast-mode-usage-model.js'
import { MAX_USAGE_HISTORY_POINTS, usageHistoryPointSchema, usageMetaSchema } from './usage-history-model.js'

/**
 * Wire contract for the accounts page.
 *
 * The page edits account profiles, so every operation lives here rather than in
 * the view. The page and the agent's `ai_accounts` tool read the same file
 * through the same Host method, so they can never disagree.
 *
 * No credential token or `auth.json` content ever crosses: an account reports
 * whether it holds a login, the identity it presents, and the command that creates one.
 */

export const accountKindSchema = z.enum(['codex', 'claude', 'opencode-go', 'commandcode', 'github-copilot', 'cursor'])

export const createSetupAccountInputSchema = z.object({ kind: accountKindSchema, requestId: z.uuid() })
export type CreateSetupAccountInput = z.infer<typeof createSetupAccountInputSchema>

/** Model-facing text for a structured result the tools below return. */
const compactJson = <Output>(output: Output): string => JSON.stringify(output)

export const accountOrderDirectionSchema = z.enum(['earlier', 'later'])

export const accountReorderSchema = z.object({
  instanceId: z.string().min(1).max(64),
  targetInstanceId: z.string().min(1).max(64),
  placement: z.enum(['before', 'after']),
  /** Optional same-provider snapshot: reject a stale drag rather than overwrite a concurrent priority change. */
  expectedOrder: z.array(z.string().min(1).max(64)).max(64).optional(),
})
export type AccountReorder = z.infer<typeof accountReorderSchema>

export const accountModeSchema = z.enum(['direct', 'authOverlay'])

export const accountStateSchema = z.enum(['healthy', 'cooling', 'disabled', 'unconfigured'])

/**
 * A keyed account names the variable holding its key, and the Host sends that
 * value to the account's base URL. Both are constrained so an API caller can
 * never point an arbitrary environment variable at an arbitrary host.
 */
const keyEnvNamePattern = /^[A-Z][A-Z0-9_]*_API_KEY$/
const ACCOUNT_MODEL_SEPARATOR = '/'
const isLoopbackHost = (hostname: string): boolean => hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'

export class AccountsRules {
  static isKeyEnvName = (name: string): boolean => keyEnvNamePattern.test(name)

  // Route slugs stay unique when two accounts share a display name.
  static accountModelName = (instanceId: string, modelName: string): string => `${instanceId}${ACCOUNT_MODEL_SEPARATOR}${modelName}`

  static baseModelName = (instanceId: string, label: string): string =>
    label.startsWith(`${instanceId}${ACCOUNT_MODEL_SEPARATOR}`) ? label.slice(instanceId.length + ACCOUNT_MODEL_SEPARATOR.length) : label

  static isAllowedCommandCodeBase = (value: string): boolean => {
    const url = URL.parse(value)
    if (url === null || url.username !== '' || url.password !== '') return false
    if (isLoopbackHost(url.hostname)) return url.protocol === 'https:' || url.protocol === 'http:'
    return url.protocol === 'https:' && (url.hostname === 'commandcode.ai' || url.hostname.endsWith('.commandcode.ai'))
  }
}

const isPlainHomePath = (path: string): boolean => (path.startsWith('/') || path.startsWith('~/')) && !path.includes('\0') && !path.split('/').includes('..')

const modelSelectionSchema = z.object({
  provider: z.string().min(1).max(200),
  model: z.string().min(1).max(200),
  reasoningEffort: z.string().max(64).optional(),
})
const modelCatalogSchema = z.object({
  default: modelSelectionSchema,
  routableProviders: z.array(z.string().min(1).max(200)).max(200),
  groups: z
    .array(
      z.object({
        id: z.string().min(1).max(200),
        name: z.string().min(1).max(200),
        models: z
          .array(
            z.object({
              id: z.string().min(1).max(200),
              name: z.string().min(1).max(200),
              description: z.string().max(500).optional(),
              reasoning: z
                .object({
                  efforts: z.array(z.object({ id: z.string().min(1).max(64), name: z.string().min(1).max(100) })).max(24),
                  defaultEffort: z.string().max(64).optional(),
                })
                .optional(),
            }),
          )
          .max(500),
      }),
    )
    .max(200),
  failures: z.array(z.object({ id: z.string().max(200), name: z.string().max(200), message: z.string().max(500) })).max(200),
})

export type QuotaRecoveryModelSelection = z.infer<typeof modelSelectionSchema>
export type QuotaRecoveryModelCatalog = z.infer<typeof modelCatalogSchema>

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
  .refine(name => name === '' || AccountsRules.isKeyEnvName(name), {
    message: 'Name an environment variable ending in _API_KEY, e.g. COMMANDCODE_API_KEY.',
  })

const apiBaseUrlSchema = z
  .string()
  .trim()
  .max(512)
  .refine(url => url === '' || AccountsRules.isAllowedCommandCodeBase(url), {
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
  /** Explicit credential ownership; absent preserves legacy environment/CLI discovery precedence. */
  authSource: z.enum(['cli', 'reference']).optional(),
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
  /** Missing preserves legacy curation; true suspends local settings without deleting them. */
  inheritModelSettings: z.boolean().optional(),
  /** Used only on models supporting this effort, after a per-model override. Null/absent means provider default. */
  defaultReasoningEffort: z.string().min(1).max(32).nullable().optional(),
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
  authSource: true,
  apiBaseUrl: true,
  badge: true,
  accentColor: true,
  providerIcon: true,
  additionalModelIds: true,
  reasoningDefaults: true,
  inheritModelSettings: true,
  defaultReasoningEffort: true,
  hiddenModelIds: true,
  favoriteModelIds: true,
  modelOrder: true,
})

export const accountConnectionMethodSchema = z.enum(['device', 'subscription', 'key', 'cli', 'reference'])
export type AccountConnectionMethod = z.infer<typeof accountConnectionMethodSchema>
export const prepareAccountConnectionInputSchema = createSetupAccountInputSchema.extend({
  mode: accountConnectionMethodSchema.optional(),
  existingInstanceId: z.string().min(1).max(64).optional(),
})
export type PrepareAccountConnectionInput = z.infer<typeof prepareAccountConnectionInputSchema>
export const accountConnectionSnapshotSchema = z.object({
  operationId: z.uuid(),
  instanceId: z.string().min(1).max(64),
  status: z.enum(['pending', 'verifying', 'complete', 'discarded']),
  method: accountConnectionMethodSchema,
  expiresAt: z.number(),
  account: accountProfileSchema.nullable(),
})
export type AccountConnectionSnapshot = z.infer<typeof accountConnectionSnapshotSchema>
const connectionIdentitySchema = z.object({ operationId: z.uuid().transform(value => value.toLowerCase()) })
export const configureAccountConnectionInputSchema = connectionIdentitySchema.extend({
  displayName: z.string().trim().pipe(accountDraftSchema.shape.displayName).optional(),
  mode: accountConnectionMethodSchema.optional(),
  homePath: homePathSchema.optional(),
  shadowHomePath: homePathSchema.optional(),
  apiKeyEnv: apiKeyEnvSchema.optional(),
  apiBaseUrl: apiBaseUrlSchema.optional(),
})
export type ConfigureAccountConnectionInput = z.infer<typeof configureAccountConnectionInputSchema>

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
        /** Luna Reserve: drawn on only after an ordinary window is spent. */
        reserve: z.boolean().optional(),
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
      /** True only for an account-added ID absent from native and discovered provider catalogs. */
      accountAdditional: z.boolean().optional(),
    }),
  ),
  warning: z.string().max(200).optional(),
})

export const nativeProvidersSchema = z.object({
  /** False when this Host has no profile patch to write (no profile context or Loader). */
  available: z.boolean(),
  /** Whether a patch edit applies live (HMR watches the patch) or only after a restart. */
  liveReload: z.boolean(),
  reason: z.string().max(300).nullable(),
  providers: z
    .array(
      z.object({
        /** The Loader row id, e.g. `llm-deepseek`. */
        entryId: z.string().min(1).max(128),
        label: z.string().max(200),
        /** Model routes the row serves while it runs. */
        routes: z.array(z.string().max(128)).max(64),
        /** What the profile patch asks for. */
        enabled: z.boolean(),
        /** What the running Host currently has; differs from `enabled` until reload or restart. */
        running: z.boolean(),
        /** Set when the row is disabled by a patch this plugin did not write, so the switch cannot undo it. */
        lockedReason: z.string().max(300).nullable(),
      }),
    )
    .max(64),
})

export type NativeProviders = z.infer<typeof nativeProvidersSchema>

export const pricingStatusSchema = z.object({
  fetchedAt: z.number().nullable(),
  source: z.string().max(512),
  modelCount: z.number().int().min(0),
  refreshing: z.boolean(),
  lastError: z.string().max(500).nullable(),
})

export type PricingStatus = z.infer<typeof pricingStatusSchema>

const pricedRouteSchema = z.object({ provider: z.string().max(128), model: z.string().max(200) })

export type AccountsCatalog = z.infer<typeof accountsCatalogSchema>
export type UsageCard = z.infer<typeof usageCardSchema>
export type AccountsUsage = z.infer<typeof accountsUsageSchema>

export const copilotLoginStateSchema = z.object({
  instanceId: z.string().min(1).max(64),
  status: z.enum(['idle', 'starting', 'waiting', 'complete', 'error']),
  userCode: z.string().max(32).nullable(),
  verificationUri: z.string().url().max(512).nullable(),
  message: z.string().max(300).nullable(),
})

export type CopilotLoginState = z.infer<typeof copilotLoginStateSchema>

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
export type AccountOrderDirection = z.infer<typeof accountOrderDirectionSchema>
export type UsageHistoryPoint = z.infer<typeof usageHistoryPointSchema>
export type UsageHistoryMeta = z.infer<typeof usageMetaSchema>

/** Icon names the page offers, matching the reference account page. */
export const PROVIDER_ICONS = ['Bot', 'Rocket', 'Sparkles', 'Terminal', 'Layers', 'Brain', 'Globe', 'Code', 'Gem'] as const

export const secretCatalogKeyOptionSchema = z.object({
  alias: z.string().min(1).max(256),
  environment: z.string().min(1).max(256),
  scope: z.enum(['global', 'project', 'local']),
  cwd: z.string().max(4096).nullable(),
  variableName: z.string().max(256),
  service: z.string().max(512),
  description: z.string().max(1024),
})

export const secretCatalogKeysSchema = z.object({
  available: z.boolean(),
  items: z.array(secretCatalogKeyOptionSchema).max(2_000),
})

export type SecretCatalogKeyOption = z.infer<typeof secretCatalogKeyOptionSchema>
export type SecretCatalogKeys = z.infer<typeof secretCatalogKeysSchema>

export const aiAccountsApi = defineApi({
  id: 'ai-accounts',
  version: 1,
  owner: '@dshfiles/ai-accounts',
  methods: {
    /** Read the whole file: distribution plus every account. */
    read: method({ input: z.void(), output: accountsFileSchema }),
    /** Absolute Host path of the active runtime account file; never a credential file. */
    filePath: method({ input: z.void(), output: z.string().max(4096) }),
    /** Value-free Secret Catalog metadata for global entries or one explicitly selected folder. */
    secretCatalogKeys: method({ input: z.object({ cwd: z.string().max(4096).nullable() }), output: secretCatalogKeysSchema }),
    /** Import one selected scoped alias into the saved account's DSH credential reference. */
    importSecretCatalogKey: method({
      input: z.object({
        instanceId: z.string().min(1).max(64),
        alias: z.string().min(1).max(256),
        environment: z.string().min(1).max(256),
        scope: z.enum(['global', 'project', 'local']),
        cwd: z.string().max(4096).nullable(),
        replaceExisting: z.boolean().optional(),
      }),
      output: z.object({ imported: z.literal(true), apiKeyEnv: z.string().max(128) }),
    }),
    prepareAccountConnection: method({
      input: prepareAccountConnectionInputSchema,
      output: accountConnectionSnapshotSchema,
      description:
        'Prepare a private provisional account connection without saving it or registering routes. Call only when the user asked to connect an account.',
      tool: { name: 'ai_accounts_prepare_connection', render: compactJson },
    }),
    getAccountConnection: method({
      input: connectionIdentitySchema,
      output: accountConnectionSnapshotSchema,
      description: 'Read a provisional account connection; contains metadata only, never credentials. Read-only.',
      tool: { name: 'ai_accounts_connection', readOnly: true, render: compactJson },
    }),
    configureAccountConnection: method({
      input: configureAccountConnectionInputSchema,
      output: accountConnectionSnapshotSchema,
      description:
        'Configure a pending connection, including an optional display name for a new account, references and base URL, without saving or publishing routes. Name-only edits do not restart sign-in; rename saved accounts in settings. Call only when the user asked to configure that connection.',
      tool: { name: 'ai_accounts_configure_connection', render: compactJson },
    }),
    // Raw secret entry is browser-only. Agents use the value-free catalog import capability below.
    stageAccountConnectionKey: method({
      input: connectionIdentitySchema.extend({ value: z.string().min(1).max(65_536) }),
      output: accountConnectionSnapshotSchema,
    }),
    importAccountConnectionKey: method({
      input: connectionIdentitySchema.extend({
        alias: z.string().min(1).max(128),
        environment: z.string().min(1).max(256),
        scope: z.enum(['global', 'project', 'local']),
        cwd: z.string().max(4096).nullable(),
      }),
      output: accountConnectionSnapshotSchema,
      description:
        'Stage a selected Secret Catalog alias on a pending connection, without publishing an account or revealing the key. Call only when the user asked to import that credential.',
      tool: { name: 'ai_accounts_import_connection_key', render: compactJson },
    }),
    completeAccountConnection: method({
      input: connectionIdentitySchema,
      output: accountConnectionSnapshotSchema,
      description:
        'Verify account authentication and atomically save a successful connection. Call only when the user asked to finish connecting that account.',
      tool: { name: 'ai_accounts_complete_connection', render: compactJson },
    }),
    discardAccountConnection: method({
      input: connectionIdentitySchema.extend({ confirm: z.literal(true) }),
      output: z.object({ discarded: z.literal(true) }),
      description:
        'Discard a provisional connection and its owned temporary credentials; existing accounts are preserved. Explicit confirm:true is required. Call only when the user asked to cancel that connection.',
      tool: { name: 'ai_accounts_discard_connection', render: () => 'Account connection discarded.' },
    }),
    /** Legacy clients must fail closed instead of eagerly persisting an unconnected account. */
    createSetupAccount: method({
      input: createSetupAccountInputSchema,
      output: z.object({ instanceId: z.string().min(1).max(64), file: accountsFileSchema }),
      description:
        'Retired eager setup endpoint; it refuses without saving an account. Use ai_accounts_prepare_connection followed by verified completion instead. Call only when the user asked to add that account.',
      tool: { name: 'ai_accounts_create_setup_account', render: output => `Account ${output.instanceId} is ready for setup.` },
    }),
    /** Create or update one account by its instance id. */
    save: method({
      input: z.object({
        draft: accountDraftSchema,
        /** Set when the draft renames an existing account, so the old slug is replaced rather than duplicated. */
        previousInstanceId: z.string().min(1).max(64).optional(),
      }),
      output: accountsFileSchema,
      description:
        'Save an account profile or change its enabled/model settings. Stores references and metadata only, never credential values. Call only when the user asked to edit that account.',
      tool: { name: 'ai_accounts_save_account', render: output => `Saved account settings (${String(output.accounts.length)} account(s)).` },
    }),
    /** Remove one account. */
    remove: method({
      input: z.object({ instanceId: z.string().min(1).max(64) }),
      output: accountsFileSchema,
    }),
    /** Reorder one account within its provider group. */
    moveAccount: method({
      input: z.object({ instanceId: z.string().min(1).max(64), direction: accountOrderDirectionSchema }),
      output: accountsFileSchema,
      description: 'Move one account earlier or later within its provider group. Call only when the user asked for that order.',
      tool: {
        name: 'ai_accounts_move_account',
        render: output => `Account order updated (${String(output.accounts.length)} account(s)).`,
      },
    }),
    /** Atomically place an account before or after another account of the same provider. */
    reorderAccount: method({
      input: accountReorderSchema,
      output: accountsFileSchema,
      description:
        'Atomically change true account priority by placing an account before or after a same-provider target. Other provider groups are unchanged. Call only when the user asked for that order.',
      tool: {
        name: 'ai_accounts_reorder_account',
        render: output => `Account priority updated (${String(output.accounts.length)} account(s)).`,
      },
    }),
    /** Change how requests are spread across compatible account routes. */
    setDistribution: method({
      input: z.object({ distribution: accountsFileSchema.shape.distribution }),
      output: accountsFileSchema,
      description:
        'Change how requests spread across compatible account routes (for example sticky-first or round-robin). Call only when the user asked for that routing policy.',
      tool: {
        name: 'ai_accounts_set_distribution',
        render: output => `Request distribution is now ${output.distribution}.`,
      },
    }),
    /**
     * Read the identity an account currently presents, creating its shadow home
     * on first use so a fresh `codex login` writes to the right place.
     */
    identity: method({
      input: z.object({ instanceId: z.string().min(1).max(64) }),
      output: identityResultSchema,
      description:
        'The identity one account currently presents (its signed-in user, and the command that creates a login), creating its shadow home on first use. Read-only apart from that first-use home.',
      tool: { name: 'ai_accounts_identity', readOnly: true, render: compactJson },
    }),
    /** Start the GitHub device-code flow for one saved Copilot account. */
    beginCopilotLogin: method({
      input: z.object({
        instanceId: z.string().min(1).max(64),
        operationId: z
          .uuid()
          .transform(value => value.toLowerCase())
          .optional(),
      }),
      output: copilotLoginStateSchema,
      description:
        'Start GitHub Copilot device sign-in for a saved account. The user approves in the Web GUI; agent responses omit device codes and URLs. Call only when the user asked to sign in with GitHub.',
      tool: { name: 'ai_accounts_begin_copilot_login', render: output => compactJson({ ...output, userCode: null, verificationUri: null }) },
    }),
    /** Read the current non-secret state of a Copilot sign-in flow. */
    copilotLoginStatus: method({
      input: z.object({ instanceId: z.string().min(1).max(64) }),
      output: copilotLoginStateSchema,
      description: 'Read GitHub Copilot sign-in status without device codes or URLs for agent callers. Read-only.',
      tool: { name: 'ai_accounts_copilot_login_status', readOnly: true, render: output => compactJson({ ...output, userCode: null, verificationUri: null }) },
    }),
    /** Cancel a device-code flow that has not completed. */
    cancelCopilotLogin: method({
      input: z.object({
        instanceId: z.string().min(1).max(64),
        confirm: z.literal(true),
        operationId: z
          .uuid()
          .transform(value => value.toLowerCase())
          .optional(),
      }),
      output: z.object({ cancelled: z.literal(true) }),
      description: 'Cancel a pending GitHub Copilot sign-in. Explicit confirm: true is required. Call only when the user asked to cancel sign-in.',
      tool: { name: 'ai_accounts_cancel_copilot_login', render: () => 'GitHub Copilot sign-in cancelled.' },
    }),
    /** Remove one Copilot account's stored OAuth grant. */
    signOutCopilot: method({
      input: z.object({ instanceId: z.string().min(1).max(64) }),
      output: z.object({ signedOut: z.literal(true) }),
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
      description: 'One account’s model catalog with the reasoning levels each model supports. Read-only.',
      tool: {
        name: 'ai_accounts_catalog',
        readOnly: true,
        render: output =>
          output.models
            .map(model => `${model.id} · ${model.name}${model.efforts.length === 0 ? '' : ` · effort ${model.efforts.map(effort => effort.id).join('/')}`}`)
            .join('\n') || `${output.instanceId} exposes no models.`,
      },
    }),
    /**
     * Stored quota readings for one account over a window, oldest first, so a
     * chart reads left to right without re-sorting on the client.
     */
    history: method({
      input: z.object({
        instanceId: z.string().min(1).max(64),
        days: z.number().int().min(1).max(365).default(7),
        /** Keep one reading per bucket, plus every reset or spent-limit change, so a long range stays small. */
        bucketMinutes: z.number().int().min(5).max(360).optional(),
      }),
      output: z.object({
        instanceId: z.string().min(1).max(64),
        points: z.array(usageHistoryPointSchema).max(MAX_USAGE_HISTORY_POINTS),
      }),
      description: 'Stored quota readings for one account over a window, oldest first. Read-only.',
      tool: {
        name: 'ai_accounts_history',
        readOnly: true,
        render: output =>
          output.points.length === 0
            ? `No stored quota readings for ${output.instanceId} in that window.`
            : `${String(output.points.length)} reading(s) for ${output.instanceId}: ${compactJson(output.points)}`,
      },
    }),
    fastModeHistory: method({
      input: z.object({ instanceId: z.string().min(1).max(64), days: z.number().int().min(1).max(365).default(30) }),
      output: fastModeUsageHistorySchema.extend({ instanceId: z.string().min(1).max(64) }),
      description: 'Provider-reported service tiers and token counts for completed Fast-mode requests; excludes prompts and response text. Read-only.',
      tool: {
        name: 'ai_accounts_fast_mode_history',
        readOnly: true,
        render: output => {
          const totals = output.points.reduce(
            (result, point) => ({
              confirmedFast: result.confirmedFast + point.confirmedFast,
              returnedDefault: result.returnedDefault + point.returnedDefault,
              otherTier: result.otherTier + point.otherTier,
              unreportedTier: result.unreportedTier + point.unreportedTier,
              inputTokens: result.inputTokens + point.inputTokens,
              outputTokens: result.outputTokens + point.outputTokens,
            }),
            { confirmedFast: 0, returnedDefault: 0, otherTier: 0, unreportedTier: 0, inputTokens: 0, outputTokens: 0 },
          )
          return `Fast mode for ${output.instanceId}: ${String(totals.confirmedFast)} provider-confirmed Fast, ${String(totals.returnedDefault)} default, ${String(totals.otherTier)} other-tier, ${String(totals.unreportedTier)} unreported responses; ${String(totals.inputTokens)} input and ${String(totals.outputTokens)} output tokens across ${String(output.points.length)} time buckets.`
        },
      },
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
    usage: method({
      input: z.void(),
      output: accountsUsageSchema,
      description:
        'Live subscription quota of every configured AI account (Codex, Copilot, OpenCode Go…): used and remaining windows and when each resets. Read-only; cached for a short while.',
      tool: { name: 'ai_accounts_quota', readOnly: true },
    }),
    /** Native DSH provider rows (DeepSeek, Command Code, …) and whether each is switched on. */
    nativeProviders: method({
      input: z.void(),
      output: nativeProvidersSchema,
      description: 'Native DSH provider rows (DeepSeek, Command Code, …) and whether each is switched on. Read-only.',
      tool: { name: 'ai_accounts_native_providers', readOnly: true, render: compactJson },
    }),
    /**
     * Switch one native provider row off or back on in the profile patch. Only
     * the row's `disabled` flag changes; its config and credentials stay.
     */
    setNativeProviderEnabled: method({
      input: z.object({ entryId: z.string().min(1).max(128), enabled: z.boolean() }),
      output: nativeProvidersSchema,
      description:
        'Switch one native DSH provider row off or back on in the profile patch; its config and credentials stay. Call only when the user asked to enable or disable that provider.',
      tool: {
        name: 'ai_accounts_set_native_provider',
        render: output => compactJson(output),
      },
    }),
    /** Bypass the shared short-lived sweep cache, for an explicit refresh. */
    refreshUsage: method({
      input: z.void(),
      output: accountsUsageSchema,
      description: 'Read live subscription quota now, bypassing the shared short-lived cache. Call only when the user asked for a fresh reading.',
      tool: { name: 'ai_accounts_refresh_quota', render: compactJson },
    }),

    /** Read now and record, so a fresh chart does not wait for the next poll. */
    collectUsage: method({
      input: z.void(),
      output: z.object({ recorded: z.number() }),
      description:
        'Read every account’s quota now and record one history point per account, so a chart does not wait for the next poll. Call only when the user asked to record a reading.',
      tool: {
        name: 'ai_accounts_collect_usage',
        render: output => `Recorded ${String(output.recorded)} quota reading(s).`,
      },
    }),
    /** Durable quota-blocked Sessions that can be resumed or snoozed by the user. */
    quotaContinuations: method({
      input: z.void(),
      output: z.object({
        scheduleAvailable: z.boolean(),
        continuations: z.array(quotaContinuationSummarySchema).max(500),
      }),
      description:
        'Durable quota-blocked Sessions that can be resumed or snoozed: each continuation, its Session, its reset evidence and whether automatic retry is on. Read-only.',
      tool: { name: 'ai_accounts_continuations', readOnly: true, render: compactJson },
    }),
    /** Models currently available for an inline quota-recovery route switch. */
    quotaRecoveryModelCatalog: method({ input: z.void(), output: modelCatalogSchema }),
    /** Queue the exact stored continuation, optionally with a Session-local model selection. */
    resumeQuotaContinuation: method({
      input: z.object({ continuationId: z.string().uuid(), selection: modelSelectionSchema.optional() }),
      output: z.object({ accepted: z.boolean() }),
      description:
        'Queue the exact stored continuation now, optionally with a Session-local model selection. Call only when the user asked to resume that blocked thread.',
      tool: {
        name: 'ai_accounts_resume_continuation',
        render: output => (output.accepted ? 'Queued the stored continuation.' : 'The Host did not accept the continuation.'),
      },
    }),
    /** Change whether a waiting quota-blocked turn resumes automatically at its known reset. */
    setQuotaContinuationAutoRetry: method({
      input: z.object({ continuationId: z.string().uuid(), sessionId: z.string().trim().min(1).max(256), enabled: z.boolean() }),
      output: z.object({ updated: z.boolean() }),
      description: 'Change whether one quota-blocked turn resumes automatically at its known reset. Call only when the user asked for that.',
      tool: {
        name: 'ai_accounts_set_auto_retry',
        render: output => (output.updated ? 'Updated automatic retry for that continuation.' : 'That continuation was not found.'),
      },
    }),
    /** The cached models.dev price catalog: when it was fetched and how many models it prices. */
    pricingStatus: method({
      input: z.void(),
      output: pricingStatusSchema,
      description: 'The cached models.dev price catalog: when it was fetched and how many models it prices. Read-only.',
      tool: { name: 'ai_accounts_pricing_status', readOnly: true, render: compactJson },
    }),
    /** Refetch models.dev now; a failure keeps the last catalog and reports why. */
    refreshPricing: method({
      input: z.void(),
      output: pricingStatusSchema,
      description:
        'Refetch the models.dev price catalog now; a failure keeps the last catalog and reports why. Call only when the user asked to refresh prices.',
      tool: { name: 'ai_accounts_refresh_pricing', render: compactJson },
    }),
    /** Price the routes a session used, after overrides and models.dev id mapping. */
    quoteRoutes: method({
      input: z.object({ routes: z.array(pricedRouteSchema).max(64) }),
      output: z.object({ fetchedAt: z.number().nullable(), quotes: z.array(routeQuoteSchema).max(64) }),
    }),
    /** Snooze only the continuation's recovery timing; it does not change quota reset evidence. */
    snoozeQuotaContinuation: method({
      input: z.object({
        continuationId: z.string().uuid(),
        duration: z.enum(['one-hour', 'four-hours', 'one-day', 'unsnooze']),
      }),
      output: z.object({ updated: z.boolean() }),
      description:
        'Snooze one continuation’s recovery timing, or unsnooze it. It does not change quota reset evidence. Call only when the user asked to snooze or unsnooze it.',
      tool: {
        name: 'ai_accounts_snooze_continuation',
        render: output => (output.updated ? 'Updated the continuation snooze.' : 'That continuation was not found.'),
      },
    }),
    /** Drop a waiting recovery the user does not want; the thread itself is untouched and can still be prompted by hand. */
    dismissQuotaContinuation: method({
      input: z.object({ continuationId: z.string().uuid() }),
      output: z.object({ dismissed: z.boolean() }),
      description:
        'Dismiss one quota-blocked thread from the usage-limit list without resuming it: its stored continuation and any automatic retry are cancelled; the thread stays as it is. Call only when the user asked to dismiss that blocked thread.',
      tool: {
        name: 'ai_accounts_dismiss_continuation',
        render: output => (output.dismissed ? 'Dismissed the stored continuation.' : 'That continuation was not waiting.'),
      },
    }),
  },
})
export const baseModelName = AccountsRules.baseModelName
export const isKeyEnvName = AccountsRules.isKeyEnvName
