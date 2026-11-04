import { defineApi } from '@dshfiles/dshx/api'
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'
import * as SchemaGetter from 'effect/SchemaGetter'
import { method } from './api-schema.js'
import { routeQuoteSchema } from './cost-estimate.js'
import { AiAccountsSchema } from './effect-schema.js'
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

export const accountKindSchema = Schema.Literals(['codex', 'claude', 'opencode-go', 'commandcode', 'github-copilot', 'cursor', 'mistral'])

export const createSetupAccountInputSchema = Schema.Struct({ kind: accountKindSchema, requestId: Schema.String.check(Schema.isUUID()) })
export type CreateSetupAccountInput = typeof createSetupAccountInputSchema.Type

/** Model-facing text for a structured result the tools below return. */
const compactJson = <Output>(output: Output): string => JSON.stringify(output)

export const accountOrderDirectionSchema = Schema.Literals(['earlier', 'later'])

export const accountReorderSchema = Schema.Struct({
  instanceId: AiAccountsSchema.id(64),
  targetInstanceId: AiAccountsSchema.id(64),
  placement: Schema.Literals(['before', 'after']),
  /** Optional same-provider snapshot: reject a stale drag rather than overwrite a concurrent priority change. */
  expectedOrder: Schema.optional(AiAccountsSchema.list(AiAccountsSchema.id(64), 64)),
})
export type AccountReorder = typeof accountReorderSchema.Type

export const accountModeSchema = Schema.Literals(['direct', 'authOverlay'])

export const accountStateSchema = Schema.Literals(['healthy', 'cooling', 'disabled', 'unconfigured'])

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

const isModelText = (maximum: number) => Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(maximum))

const modelSelectionSchema = Schema.Struct({
  provider: isModelText(200),
  model: isModelText(200),
  reasoningEffort: Schema.optional(Schema.String.check(Schema.isMaxLength(64))),
})
const modelCatalogSchema = Schema.Struct({
  default: modelSelectionSchema,
  routableProviders: AiAccountsSchema.list(isModelText(200), 200),
  groups: AiAccountsSchema.list(
    Schema.Struct({
      id: isModelText(200),
      name: isModelText(200),
      models: AiAccountsSchema.list(
        Schema.Struct({
          id: isModelText(200),
          name: isModelText(200),
          description: Schema.optional(Schema.String.check(Schema.isMaxLength(500))),
          reasoning: Schema.optional(
            Schema.Struct({
              efforts: AiAccountsSchema.list(Schema.Struct({ id: isModelText(64), name: isModelText(100) }), 24),
              defaultEffort: Schema.optional(Schema.String.check(Schema.isMaxLength(64))),
            }),
          ),
        }),
        500,
      ),
    }),
    200,
  ),
  failures: AiAccountsSchema.list(
    Schema.Struct({
      id: Schema.String.check(Schema.isMaxLength(200)),
      name: Schema.String.check(Schema.isMaxLength(200)),
      message: Schema.String.check(Schema.isMaxLength(500)),
    }),
    200,
  ),
})

export type QuotaRecoveryModelSelection = typeof modelSelectionSchema.Type
export type QuotaRecoveryModelCatalog = typeof modelCatalogSchema.Type

const homePathSchema = AiAccountsSchema.trimmedString.check(
  Schema.isMaxLength(1024),
  Schema.makeFilter((path: string) => path === '' || isPlainHomePath(path), {
    message: 'Use an absolute path or one under ~/, without ".." segments.',
  }),
)

const apiKeyEnvSchema = AiAccountsSchema.trimmedString.check(
  Schema.isMaxLength(128),
  Schema.makeFilter((name: string) => name === '' || AccountsRules.isKeyEnvName(name), {
    message: 'Name an environment variable ending in _API_KEY, e.g. COMMANDCODE_API_KEY.',
  }),
)

const apiBaseUrlSchema = AiAccountsSchema.trimmedString.check(
  Schema.isMaxLength(512),
  Schema.makeFilter((url: string) => url === '' || AccountsRules.isAllowedCommandCodeBase(url), {
    message: 'Use https on commandcode.ai, or a loopback address.',
  }),
)

export const accountProfileSchema = Schema.Struct({
  /** Routing slug the model picker shows, e.g. `codex_personal`. */
  instanceId: AiAccountsSchema.id(64),
  kind: accountKindSchema,
  displayName: AiAccountsSchema.id(120),
  enabled: Schema.Boolean,
  /** Codex: home holding shared state. Claude: the CLAUDE_CONFIG_DIR its login lives in. */
  homePath: homePathSchema,
  /** Per-account home holding a private `auth.json`; empty means the shared home. */
  shadowHomePath: homePathSchema,
  /** Keyed accounts name an environment variable instead of carrying a value. */
  apiKeyEnv: apiKeyEnvSchema,
  /** Explicit credential ownership; absent preserves legacy environment/CLI discovery precedence. */
  authSource: Schema.optional(Schema.Literals(['cli', 'reference'])),
  /** Command Code accounts may point at a different API base. */
  apiBaseUrl: apiBaseUrlSchema,
  badge: Schema.String.check(Schema.isMaxLength(32)),
  accentColor: Schema.String.check(Schema.isMaxLength(32)),
  providerIcon: Schema.String.check(Schema.isMaxLength(32)),
  mode: accountModeSchema,
  signedIn: Schema.Boolean,
  identity: Schema.NullOr(Schema.String.check(Schema.isMaxLength(320))),
  plan: Schema.NullOr(Schema.String.check(Schema.isMaxLength(64))),
  state: accountStateSchema,
  /** The exact command that signs this account in. Never a credential. */
  loginHint: Schema.String.check(Schema.isMaxLength(2048)),
  detail: Schema.NullOr(Schema.String.check(Schema.isMaxLength(400))),
  additionalModelIds: AiAccountsSchema.list(Schema.String.check(Schema.isMaxLength(120)), 32).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
  /**
   * Default reasoning effort per model id. Absent means the provider's own
   * default, so an account only lists the models it wants to pin.
   */
  reasoningDefaults: Schema.Record(Schema.String.check(Schema.isMaxLength(160)), Schema.String.check(Schema.isMaxLength(32))).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed({})),
  ),
  /** Missing preserves legacy curation; true suspends local settings without deleting them. */
  inheritModelSettings: Schema.optional(Schema.Boolean),
  /** Used only on models supporting this effort, after a per-model override. Null/absent means provider default. */
  defaultReasoningEffort: Schema.optional(Schema.NullOr(AiAccountsSchema.id(32))),
  /** Model ids this account never shows, so the picker stays short. */
  hiddenModelIds: AiAccountsSchema.list(Schema.String.check(Schema.isMaxLength(160)), 500).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
  /** Model ids to surface first. */
  favoriteModelIds: AiAccountsSchema.list(Schema.String.check(Schema.isMaxLength(160)), 500).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
  /**
   * Explicit picker order. Ids absent from this list keep the provider's own
   * order after the listed ones, so adding a model never reshuffles the rest.
   */
  modelOrder: AiAccountsSchema.list(Schema.String.check(Schema.isMaxLength(160)), 500).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
})

/** What the page may write: identity and health are observed, never authored. */
export const removeCustomModelInputSchema = Schema.Struct({
  instanceId: AiAccountsSchema.id(64),
  modelId: AiAccountsSchema.id(120).check(Schema.isPattern(/^[^\s\p{C}]+$/u)),
  confirm: Schema.Literal(true),
})

export const removeCustomModelOutputSchema = Schema.Struct({
  removed: Schema.Boolean,
  instanceId: AiAccountsSchema.id(64),
  modelId: AiAccountsSchema.id(120),
})

export const accountDraftSchema = Schema.Struct({
  instanceId: accountProfileSchema.fields.instanceId,
  kind: accountProfileSchema.fields.kind,
  displayName: accountProfileSchema.fields.displayName,
  enabled: accountProfileSchema.fields.enabled,
  homePath: accountProfileSchema.fields.homePath,
  shadowHomePath: accountProfileSchema.fields.shadowHomePath,
  apiKeyEnv: accountProfileSchema.fields.apiKeyEnv,
  authSource: accountProfileSchema.fields.authSource,
  apiBaseUrl: accountProfileSchema.fields.apiBaseUrl,
  badge: accountProfileSchema.fields.badge,
  accentColor: accountProfileSchema.fields.accentColor,
  providerIcon: accountProfileSchema.fields.providerIcon,
  additionalModelIds: accountProfileSchema.fields.additionalModelIds,
  reasoningDefaults: accountProfileSchema.fields.reasoningDefaults,
  inheritModelSettings: accountProfileSchema.fields.inheritModelSettings,
  defaultReasoningEffort: accountProfileSchema.fields.defaultReasoningEffort,
  hiddenModelIds: accountProfileSchema.fields.hiddenModelIds,
  favoriteModelIds: accountProfileSchema.fields.favoriteModelIds,
  modelOrder: accountProfileSchema.fields.modelOrder,
})

export const accountConnectionMethodSchema = Schema.Literals(['device', 'subscription', 'key', 'cli', 'reference'])
export type AccountConnectionMethod = typeof accountConnectionMethodSchema.Type
export const prepareAccountConnectionInputSchema = Schema.Struct({
  ...createSetupAccountInputSchema.fields,
  mode: Schema.optional(accountConnectionMethodSchema),
  existingInstanceId: Schema.optional(AiAccountsSchema.id(64)),
})
export type PrepareAccountConnectionInput = typeof prepareAccountConnectionInputSchema.Type
export const accountConnectionSnapshotSchema = Schema.Struct({
  operationId: Schema.String.check(Schema.isUUID()),
  instanceId: AiAccountsSchema.id(64),
  status: Schema.Literals(['pending', 'verifying', 'complete', 'discarded']),
  method: accountConnectionMethodSchema,
  expiresAt: Schema.Number.check(Schema.isFinite()),
  account: Schema.NullOr(accountProfileSchema),
})
export type AccountConnectionSnapshot = typeof accountConnectionSnapshotSchema.Type
const lowercasedUuidSchema = Schema.String.check(Schema.isUUID()).pipe(
  Schema.decodeTo(Schema.String, {
    decode: SchemaGetter.transform((value: string) => value.toLowerCase()),
    encode: SchemaGetter.transform((value: string) => value),
  }),
)
const connectionIdentitySchema = Schema.Struct({ operationId: lowercasedUuidSchema })
export const configureAccountConnectionInputSchema = Schema.Struct({
  ...connectionIdentitySchema.fields,
  displayName: Schema.optional(AiAccountsSchema.trimmedName(120)),
  mode: Schema.optional(accountConnectionMethodSchema),
  homePath: Schema.optional(homePathSchema),
  shadowHomePath: Schema.optional(homePathSchema),
  apiKeyEnv: Schema.optional(apiKeyEnvSchema),
  apiBaseUrl: Schema.optional(apiBaseUrlSchema),
})
export type ConfigureAccountConnectionInput = typeof configureAccountConnectionInputSchema.Type

export const accountsFileSchema = Schema.Struct({
  distribution: Schema.Literals(['sticky', 'priority', 'round-robin', 'balanced']),
  cooldownMs: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(86_400_000)),
  shadowRoot: homePathSchema,
  accounts: AiAccountsSchema.list(accountProfileSchema, 64),
})

export const usageCardSchema = Schema.Struct({
  status: Schema.Literals(['ok', 'unauthenticated', 'unsupported', 'rate-limited', 'error']),
  message: Schema.NullOr(Schema.String.check(Schema.isMaxLength(300))),
  identity: Schema.NullOr(Schema.String.check(Schema.isMaxLength(320))),
  plan: Schema.NullOr(Schema.String.check(Schema.isMaxLength(64))),
  windows: AiAccountsSchema.list(
    Schema.Struct({
      label: Schema.String.check(Schema.isMaxLength(32)),
      percentRemaining: Schema.Number.check(Schema.isFinite()),
      resetsAt: Schema.NullOr(Schema.Number.check(Schema.isFinite())),
      /** Luna Reserve: drawn on only after an ordinary window is spent. */
      reserve: Schema.optional(Schema.Boolean),
    }),
    6,
  ),
  bankedResets: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(20)),
  /** When each banked reset expires, when the provider reports it. */
  bankedResetExpiries: AiAccountsSchema.list(Schema.NullOr(Schema.Number.check(Schema.isFinite())), 20),
})

export const accountsUsageSchema = Schema.Struct({
  /** When the sweep that produced these cards finished. */
  readAt: Schema.Number.check(Schema.isFinite()),
  /** The machine the Host reads quota from, shown on every card. */
  hostName: Schema.String.check(Schema.isMaxLength(255)),
  cards: Schema.Array(
    Schema.Struct({
      instanceId: AiAccountsSchema.id(64),
      displayName: Schema.String.check(Schema.isMaxLength(120)),
      kind: accountKindSchema,
      enabled: Schema.Boolean,
      usage: usageCardSchema,
    }),
  ),
})

export const accountsCatalogSchema = Schema.Struct({
  instanceId: AiAccountsSchema.id(64),
  models: Schema.Array(
    Schema.Struct({
      id: AiAccountsSchema.id(200),
      name: Schema.String.check(Schema.isMaxLength(200)),
      efforts: AiAccountsSchema.list(Schema.Struct({ id: Schema.String.check(Schema.isMaxLength(64)), name: Schema.String.check(Schema.isMaxLength(80)) }), 12),
      defaultEffort: Schema.NullOr(Schema.String.check(Schema.isMaxLength(32))),
      /** True only for an account-added ID absent from native and discovered provider catalogs. */
      accountAdditional: Schema.optional(Schema.Boolean),
    }),
  ),
  warning: Schema.optional(Schema.String.check(Schema.isMaxLength(200))),
})

export const nativeProvidersSchema = Schema.Struct({
  /** False when this Host has no profile patch to write (no profile context or Loader). */
  available: Schema.Boolean,
  /** Whether a patch edit applies live (HMR watches the patch) or only after a restart. */
  liveReload: Schema.Boolean,
  reason: Schema.NullOr(Schema.String.check(Schema.isMaxLength(300))),
  providers: AiAccountsSchema.list(
    Schema.Struct({
      /** The Loader row id, e.g. `llm-deepseek`. */
      entryId: AiAccountsSchema.id(128),
      label: Schema.String.check(Schema.isMaxLength(200)),
      /** Model routes the row serves while it runs. */
      routes: AiAccountsSchema.list(Schema.String.check(Schema.isMaxLength(128)), 64),
      /** What the profile patch asks for. */
      enabled: Schema.Boolean,
      /** What the running Host currently has; differs from `enabled` until reload or restart. */
      running: Schema.Boolean,
      /** Set when the row is disabled by a patch this plugin did not write, so the switch cannot undo it. */
      lockedReason: Schema.NullOr(Schema.String.check(Schema.isMaxLength(300))),
    }),
    64,
  ),
})

export type NativeProviders = typeof nativeProvidersSchema.Type

export const pricingStatusSchema = Schema.Struct({
  fetchedAt: Schema.NullOr(Schema.Number.check(Schema.isFinite())),
  source: Schema.String.check(Schema.isMaxLength(512)),
  modelCount: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  refreshing: Schema.Boolean,
  lastError: Schema.NullOr(Schema.String.check(Schema.isMaxLength(500))),
})

export type PricingStatus = typeof pricingStatusSchema.Type

const pricedRouteSchema = Schema.Struct({ provider: Schema.String.check(Schema.isMaxLength(128)), model: Schema.String.check(Schema.isMaxLength(200)) })

export type AccountsCatalog = typeof accountsCatalogSchema.Type
export type UsageCard = typeof usageCardSchema.Type
export type AccountsUsage = typeof accountsUsageSchema.Type

export const copilotLoginStateSchema = Schema.Struct({
  instanceId: AiAccountsSchema.id(64),
  status: Schema.Literals(['idle', 'starting', 'waiting', 'complete', 'error']),
  userCode: Schema.NullOr(Schema.String.check(Schema.isMaxLength(32))),
  verificationUri: Schema.NullOr(
    Schema.String.check(
      Schema.isMaxLength(512),
      Schema.makeFilter((value: string) => URL.parse(value) !== null, { message: 'Must be an absolute URL.' }),
    ),
  ),
  message: Schema.NullOr(Schema.String.check(Schema.isMaxLength(300))),
})

export type CopilotLoginState = typeof copilotLoginStateSchema.Type

export const identityResultSchema = Schema.Struct({
  instanceId: AiAccountsSchema.id(64),
  email: Schema.NullOr(Schema.String.check(Schema.isMaxLength(320))),
  plan: Schema.NullOr(Schema.String.check(Schema.isMaxLength(64))),
  signedIn: Schema.Boolean,
})

export type AccountProfile = typeof accountProfileSchema.Type
export type AccountDraft = typeof accountDraftSchema.Type
export type AccountsFile = typeof accountsFileSchema.Type
export type AccountKind = typeof accountKindSchema.Type
export type AccountOrderDirection = typeof accountOrderDirectionSchema.Type
export type UsageHistoryPoint = typeof usageHistoryPointSchema.Type
export type UsageHistoryMeta = typeof usageMetaSchema.Type

export const FORECAST_HISTORY_DAYS = 36
export const FORECAST_HISTORY_BUCKET_MINUTES = 30
// Keep batches small: dshx rejects JSON API payloads over 1 MiB.
export const MAX_FORECAST_HISTORY_BATCH_SIZE = 2
export const forecastHistoryBatchInputSchema = Schema.Struct({
  instanceIds: AiAccountsSchema.list(AiAccountsSchema.id(64), MAX_FORECAST_HISTORY_BATCH_SIZE).check(Schema.isMinLength(1)),
}).check(
  Schema.makeFilter(({ instanceIds }: { readonly instanceIds: readonly string[] }) => new Set(instanceIds).size === instanceIds.length, {
    message: 'Account ids must be unique.',
  }),
)

/** Icon names the page offers, matching the reference account page. */
export const PROVIDER_ICONS = ['Bot', 'Rocket', 'Sparkles', 'Terminal', 'Layers', 'Brain', 'Globe', 'Code', 'Gem'] as const

export const secretCatalogKeyOptionSchema = Schema.Struct({
  alias: AiAccountsSchema.id(256),
  environment: AiAccountsSchema.id(256),
  scope: Schema.Literals(['global', 'project', 'local']),
  cwd: Schema.NullOr(Schema.String.check(Schema.isMaxLength(4096))),
  variableName: Schema.String.check(Schema.isMaxLength(256)),
  service: Schema.String.check(Schema.isMaxLength(512)),
  description: Schema.String.check(Schema.isMaxLength(1024)),
})

export const secretCatalogKeysSchema = Schema.Struct({
  available: Schema.Boolean,
  items: AiAccountsSchema.list(secretCatalogKeyOptionSchema, 2_000),
})

export type SecretCatalogKeyOption = typeof secretCatalogKeyOptionSchema.Type
export type SecretCatalogKeys = typeof secretCatalogKeysSchema.Type

export const aiAccountsApi = defineApi({
  id: 'ai-accounts',
  version: 1,
  owner: '@dshfiles/ai-accounts',
  methods: {
    /** Read the whole file: distribution plus every account. */
    read: method({ input: Schema.Void, output: accountsFileSchema }),
    /** Absolute Host path of the active runtime account file; never a credential file. */
    filePath: method({ input: Schema.Void, output: Schema.String.check(Schema.isMaxLength(4096)) }),
    /** Value-free Secret Catalog metadata for global entries or one explicitly selected folder. */
    secretCatalogKeys: method({
      input: Schema.Struct({ cwd: Schema.NullOr(Schema.String.check(Schema.isMaxLength(4096))) }),
      output: secretCatalogKeysSchema,
    }),
    /** Import one selected scoped alias into the saved account's DSH credential reference. */
    importSecretCatalogKey: method({
      input: Schema.Struct({
        instanceId: AiAccountsSchema.id(64),
        alias: AiAccountsSchema.id(256),
        environment: AiAccountsSchema.id(256),
        scope: Schema.Literals(['global', 'project', 'local']),
        cwd: Schema.NullOr(Schema.String.check(Schema.isMaxLength(4096))),
        replaceExisting: Schema.optional(Schema.Boolean),
      }),
      output: Schema.Struct({ imported: Schema.Literal(true), apiKeyEnv: Schema.String.check(Schema.isMaxLength(128)) }),
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
      input: Schema.Struct({ ...connectionIdentitySchema.fields, value: AiAccountsSchema.id(65_536) }),
      output: accountConnectionSnapshotSchema,
    }),
    importAccountConnectionKey: method({
      input: Schema.Struct({
        ...connectionIdentitySchema.fields,
        alias: AiAccountsSchema.id(128),
        environment: AiAccountsSchema.id(256),
        scope: Schema.Literals(['global', 'project', 'local']),
        cwd: Schema.NullOr(Schema.String.check(Schema.isMaxLength(4096))),
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
      input: Schema.Struct({ ...connectionIdentitySchema.fields, confirm: Schema.Literal(true) }),
      output: Schema.Struct({ discarded: Schema.Literal(true) }),
      description:
        'Discard a provisional connection and its owned temporary credentials; existing accounts are preserved. Explicit confirm:true is required. Call only when the user asked to cancel that connection.',
      tool: { name: 'ai_accounts_discard_connection', render: () => 'Account connection discarded.' },
    }),
    /** Legacy clients must fail closed instead of eagerly persisting an unconnected account. */
    createSetupAccount: method({
      input: createSetupAccountInputSchema,
      output: Schema.Struct({ instanceId: AiAccountsSchema.id(64), file: accountsFileSchema }),
      description:
        'Retired eager setup endpoint; it refuses without saving an account. Use ai_accounts_prepare_connection followed by verified completion instead. Call only when the user asked to add that account.',
      tool: { name: 'ai_accounts_create_setup_account', render: output => `Account ${output.instanceId} is ready for setup.` },
    }),
    /** Create or update one account by its instance id. */
    save: method({
      input: Schema.Struct({
        draft: accountDraftSchema,
        /** Set when the draft renames an existing account, so the old slug is replaced rather than duplicated. */
        previousInstanceId: Schema.optional(AiAccountsSchema.id(64)),
      }),
      output: accountsFileSchema,
      description:
        'Save an account profile or change its enabled/model settings. Stores references and metadata only, never credential values. Call only when the user asked to edit that account.',
      tool: { name: 'ai_accounts_save_account', render: output => `Saved account settings (${String(output.accounts.length)} account(s)).` },
    }),
    /** Remove one account. */
    remove: method({
      input: Schema.Struct({ instanceId: AiAccountsSchema.id(64) }),
      output: accountsFileSchema,
    }),
    /** Remove one manually added model from an account's saved picker curation. */
    removeCustomModel: method({
      input: removeCustomModelInputSchema,
      output: removeCustomModelOutputSchema,
      description:
        'Remove one manually added model from an AI Accounts profile and clear its picker curation. Provider catalog models are not removed. Call only when the user asked for it and confirm is true.',
      tool: {
        name: 'ai_accounts_remove_custom_model',
        render: output =>
          output.removed
            ? `Removed manually added model ${output.modelId} from ${output.instanceId}. Provider catalog models are unchanged.`
            : `No manually added model ${output.modelId} was found for ${output.instanceId}.`,
      },
    }),
    /** Reorder one account within its provider group. */
    moveAccount: method({
      input: Schema.Struct({ instanceId: AiAccountsSchema.id(64), direction: accountOrderDirectionSchema }),
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
      input: Schema.Struct({ distribution: accountsFileSchema.fields.distribution }),
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
      input: Schema.Struct({ instanceId: AiAccountsSchema.id(64) }),
      output: identityResultSchema,
      description:
        'The identity one account currently presents (its signed-in user, and the command that creates a login), creating its shadow home on first use. Read-only apart from that first-use home.',
      tool: { name: 'ai_accounts_identity', readOnly: true, render: compactJson },
    }),
    /** Start the GitHub device-code flow for one saved Copilot account. */
    beginCopilotLogin: method({
      input: Schema.Struct({
        instanceId: AiAccountsSchema.id(64),
        operationId: Schema.optional(lowercasedUuidSchema),
      }),
      output: copilotLoginStateSchema,
      description:
        'Start GitHub Copilot device sign-in for a saved account. The user approves in the Web GUI; agent responses omit device codes and URLs. Call only when the user asked to sign in with GitHub.',
      tool: { name: 'ai_accounts_begin_copilot_login', render: output => compactJson({ ...output, userCode: null, verificationUri: null }) },
    }),
    /** Read the current non-secret state of a Copilot sign-in flow. */
    copilotLoginStatus: method({
      input: Schema.Struct({ instanceId: AiAccountsSchema.id(64) }),
      output: copilotLoginStateSchema,
      description: 'Read GitHub Copilot sign-in status without device codes or URLs for agent callers. Read-only.',
      tool: { name: 'ai_accounts_copilot_login_status', readOnly: true, render: output => compactJson({ ...output, userCode: null, verificationUri: null }) },
    }),
    /** Cancel a device-code flow that has not completed. */
    cancelCopilotLogin: method({
      input: Schema.Struct({
        instanceId: AiAccountsSchema.id(64),
        confirm: Schema.Literal(true),
        operationId: Schema.optional(lowercasedUuidSchema),
      }),
      output: Schema.Struct({ cancelled: Schema.Literal(true) }),
      description: 'Cancel a pending GitHub Copilot sign-in. Explicit confirm: true is required. Call only when the user asked to cancel sign-in.',
      tool: { name: 'ai_accounts_cancel_copilot_login', render: () => 'GitHub Copilot sign-in cancelled.' },
    }),
    /** Remove one Copilot account's stored OAuth grant. */
    signOutCopilot: method({
      input: Schema.Struct({ instanceId: AiAccountsSchema.id(64) }),
      output: Schema.Struct({ signedOut: Schema.Literal(true) }),
    }),
    /**
     * One account's model catalog with the reasoning levels each model
     * supports, so the panel can offer a default effort per model instead of
     * guessing what a model accepts.
     */
    catalog: method({
      input: Schema.Struct({ instanceId: AiAccountsSchema.id(64) }),
      output: Schema.Struct({
        instanceId: AiAccountsSchema.id(64),
        models: Schema.Array(
          Schema.Struct({
            id: AiAccountsSchema.id(200),
            name: Schema.String.check(Schema.isMaxLength(200)),
            efforts: AiAccountsSchema.list(
              Schema.Struct({ id: Schema.String.check(Schema.isMaxLength(64)), name: Schema.String.check(Schema.isMaxLength(80)) }),
              12,
            ),
            defaultEffort: Schema.NullOr(Schema.String.check(Schema.isMaxLength(32))),
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
      input: Schema.Struct({
        instanceId: AiAccountsSchema.id(64),
        days: AiAccountsSchema.intBetween(1, 365).pipe(Schema.withDecodingDefaultKey(Effect.succeed(7))),
        /** Keep one reading per bucket, plus every reset or spent-limit change, so a long range stays small. */
        bucketMinutes: Schema.optional(AiAccountsSchema.intBetween(5, 360)),
      }),
      output: Schema.Struct({
        instanceId: AiAccountsSchema.id(64),
        points: AiAccountsSchema.list(usageHistoryPointSchema, MAX_USAGE_HISTORY_POINTS),
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
    forecastHistoryBatch: method({
      input: forecastHistoryBatchInputSchema,
      output: Schema.Struct({
        histories: AiAccountsSchema.list(
          Schema.Struct({
            instanceId: AiAccountsSchema.id(64),
            points: AiAccountsSchema.list(usageHistoryPointSchema, MAX_USAGE_HISTORY_POINTS),
          }),
          MAX_FORECAST_HISTORY_BATCH_SIZE,
        ),
      }),
      description: 'Stored 36-day quota history for up to two accounts in one bounded read. Read-only.',
    }),
    fastModeHistory: method({
      input: Schema.Struct({
        instanceId: AiAccountsSchema.id(64),
        days: AiAccountsSchema.intBetween(1, 365).pipe(Schema.withDecodingDefaultKey(Effect.succeed(30))),
      }),
      output: Schema.Struct({ ...fastModeUsageHistorySchema.fields, instanceId: AiAccountsSchema.id(64) }),
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
    historySettings: method({ input: Schema.Void, output: usageMetaSchema }),
    saveHistorySettings: method({
      input: Schema.Struct({
        intervalMinutes: AiAccountsSchema.intBetween(1, 60),
        retentionDays: AiAccountsSchema.intBetween(1, 365),
      }),
      output: usageMetaSchema,
    }),

    /**
     * Live subscription quota for every account. Each card is read with its own
     * credential and a short timeout, so one unreachable provider degrades one
     * card rather than the panel. Concurrent surfaces share one cached sweep.
     */
    usage: method({
      input: Schema.Void,
      output: accountsUsageSchema,
      description:
        'Live subscription quota of every configured AI account (Codex, Copilot, Mistral, OpenCode Go…): used and remaining windows and when each resets. Read-only; cached for a short while.',
      tool: { name: 'ai_accounts_quota', readOnly: true },
    }),
    /** Native DSH provider rows (DeepSeek, Command Code, …) and whether each is switched on. */
    nativeProviders: method({
      input: Schema.Void,
      output: nativeProvidersSchema,
      description: 'Native DSH provider rows (DeepSeek, Command Code, …) and whether each is switched on. Read-only.',
      tool: { name: 'ai_accounts_native_providers', readOnly: true, render: compactJson },
    }),
    /**
     * Switch one native provider row off or back on in the profile patch. Only
     * the row's `disabled` flag changes; its config and credentials stay.
     */
    setNativeProviderEnabled: method({
      input: Schema.Struct({ entryId: AiAccountsSchema.id(128), enabled: Schema.Boolean }),
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
      input: Schema.Void,
      output: accountsUsageSchema,
      description: 'Read live subscription quota now, bypassing the shared short-lived cache. Call only when the user asked for a fresh reading.',
      tool: { name: 'ai_accounts_refresh_quota', render: compactJson },
    }),

    /** Read now and record, so a fresh chart does not wait for the next poll. */
    collectUsage: method({
      input: Schema.Void,
      output: Schema.Struct({ recorded: Schema.Number.check(Schema.isFinite()) }),
      description:
        'Read every account’s quota now and record one history point per account, so a chart does not wait for the next poll. Call only when the user asked to record a reading.',
      tool: {
        name: 'ai_accounts_collect_usage',
        render: output => `Recorded ${String(output.recorded)} quota reading(s).`,
      },
    }),
    /** Durable quota-blocked Sessions that can be resumed or snoozed by the user. */
    quotaContinuations: method({
      input: Schema.Void,
      output: Schema.Struct({
        scheduleAvailable: Schema.Boolean,
        continuations: AiAccountsSchema.list(quotaContinuationSummarySchema, 500),
      }),
      description:
        'Durable quota-blocked Sessions that can be resumed or snoozed: each continuation, its Session, its reset evidence and whether automatic retry is on. Read-only.',
      tool: { name: 'ai_accounts_continuations', readOnly: true, render: compactJson },
    }),
    /** Models currently available for an inline quota-recovery route switch. */
    quotaRecoveryModelCatalog: method({ input: Schema.Void, output: modelCatalogSchema }),
    /** Queue the exact stored continuation, optionally with a Session-local model selection. */
    resumeQuotaContinuation: method({
      input: Schema.Struct({ continuationId: Schema.String.check(Schema.isUUID()), selection: Schema.optional(modelSelectionSchema) }),
      output: Schema.Struct({ accepted: Schema.Boolean }),
      description:
        'Queue the exact stored continuation now, optionally with a Session-local model selection. Call only when the user asked to resume that blocked thread.',
      tool: {
        name: 'ai_accounts_resume_continuation',
        render: output => (output.accepted ? 'Queued the stored continuation.' : 'The Host did not accept the continuation.'),
      },
    }),
    /** Change whether a waiting quota-blocked turn resumes automatically at its known reset. */
    setQuotaContinuationAutoRetry: method({
      input: Schema.Struct({
        continuationId: Schema.String.check(Schema.isUUID()),
        sessionId: AiAccountsSchema.trimmedName(256),
        enabled: Schema.Boolean,
      }),
      output: Schema.Struct({ updated: Schema.Boolean }),
      description: 'Change whether one quota-blocked turn resumes automatically at its known reset. Call only when the user asked for that.',
      tool: {
        name: 'ai_accounts_set_auto_retry',
        render: output => (output.updated ? 'Updated automatic retry for that continuation.' : 'That continuation was not found.'),
      },
    }),
    /** The cached models.dev price catalog: when it was fetched and how many models it prices. */
    pricingStatus: method({
      input: Schema.Void,
      output: pricingStatusSchema,
      description: 'The cached models.dev price catalog: when it was fetched and how many models it prices. Read-only.',
      tool: { name: 'ai_accounts_pricing_status', readOnly: true, render: compactJson },
    }),
    /** Refetch models.dev now; a failure keeps the last catalog and reports why. */
    refreshPricing: method({
      input: Schema.Void,
      output: pricingStatusSchema,
      description:
        'Refetch the models.dev price catalog now; a failure keeps the last catalog and reports why. Call only when the user asked to refresh prices.',
      tool: { name: 'ai_accounts_refresh_pricing', render: compactJson },
    }),
    /** Price the routes a session used, after overrides and models.dev id mapping. */
    quoteRoutes: method({
      input: Schema.Struct({ routes: AiAccountsSchema.list(pricedRouteSchema, 64) }),
      output: Schema.Struct({
        fetchedAt: Schema.NullOr(Schema.Number.check(Schema.isFinite())),
        quotes: AiAccountsSchema.list(routeQuoteSchema, 64),
      }),
    }),
    /** Snooze only the continuation's recovery timing; it does not change quota reset evidence. */
    snoozeQuotaContinuation: method({
      input: Schema.Struct({
        continuationId: Schema.String.check(Schema.isUUID()),
        duration: Schema.Literals(['one-hour', 'four-hours', 'one-day', 'unsnooze']),
      }),
      output: Schema.Struct({ updated: Schema.Boolean }),
      description:
        'Snooze one continuation’s recovery timing, or unsnooze it. It does not change quota reset evidence. Call only when the user asked to snooze or unsnooze it.',
      tool: {
        name: 'ai_accounts_snooze_continuation',
        render: output => (output.updated ? 'Updated the continuation snooze.' : 'That continuation was not found.'),
      },
    }),
    /** Drop a waiting recovery the user does not want; the thread itself is untouched and can still be prompted by hand. */
    dismissQuotaContinuation: method({
      input: Schema.Struct({ continuationId: Schema.String.check(Schema.isUUID()) }),
      output: Schema.Struct({ dismissed: Schema.Boolean }),
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
