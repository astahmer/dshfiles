import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import * as Schema from 'effect/Schema'
import { pluginAttributes, withSpan } from '@dshfiles/dshx/tracing'
import type { UsageCard } from './api.js'
import { CredentialModel, type CredentialValueResolver } from './credentials.js'
import { AiAccountsSchema } from './effect-schema.js'
import { providerFetch } from './provider-request.js'
import { ProviderUsageModel } from './usage.js'

/**
 * Mistral subscriptions (Le Chat Pro/Team/Enterprise, Vibe plans) are ordinary Mistral API keys: the organization's
 * plan decides whether a request draws the included monthly allowance or pay-as-you-go credits
 * (docs.mistral.ai/admin/billing-usage/subscriptions). Mistral Vibe's browser sign-in (`vibe --setup` → Launch browser)
 * mints such a key and keeps it in `$VIBE_HOME/.env` or the OS keyring. The `cli` connection method reuses that login
 * read-only, as the community `opencode-mistral-vibe` plugin does; the plugin never writes Vibe's files or keyring.
 */
export const MISTRAL_KIND = 'mistral'
export const DEFAULT_MISTRAL_KEY_ENV = 'MISTRAL_API_KEY'
export const MISTRAL_API_BASE = 'https://api.mistral.ai'
export const MISTRAL_LOGIN_HINT = 'vibe --setup   # choose Launch browser and sign in with your Mistral plan'

/** Mistral Vibe's keyring services, newest first (`vibe/cli-rust/src/credentials/keyring.rs`). */
const VIBE_KEYCHAIN_SERVICES = ['ai.mistral.vibe', 'vibe'] as const
const CATALOG_TIMEOUT_MS = 10_000
const KEYCHAIN_TIMEOUT_MS = 5_000

/** `$VIBE_HOME` when it is an absolute path, else `~/.vibe`: the directory Mistral Vibe reads its `.env` from. */
const vibeHome = (env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string => {
  const configured = env['VIBE_HOME']?.trim() ?? ''
  return configured !== '' && isAbsolute(configured) ? configured : join(home, '.vibe')
}

/** The last `MISTRAL_API_KEY` assignment of a dotenv file, with quotes, `export` and comments as python-dotenv reads them. */
const parseVibeEnvKey = (text: string, name: string = DEFAULT_MISTRAL_KEY_ENV): string => {
  let found = ''
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim().replace(/^export\s+/u, '')
    if (line === '' || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator <= 0 || line.slice(0, separator).trim() !== name) continue
    let value = line.slice(separator + 1).trim()
    const quote = value[0]
    if ((quote === '"' || quote === "'") && value.lastIndexOf(quote) > 0) value = value.slice(1, value.lastIndexOf(quote))
    else value = value.replace(/\s+#.*$/u, '')
    found = value.trim()
  }
  return found
}

/**
 * macOS Keychain lookup through the system `security` tool, in an `ai-accounts keychain read` span that records only
 * the service and whether a value was found; any failure is simply no login.
 */
const readKeychainPassword = (service: string, account: string): Promise<string> =>
  withSpan(
    'ai-accounts keychain read',
    { attributes: pluginAttributes({ plugin: 'ai-accounts', attributes: { provider: MISTRAL_KIND, service } }) },
    async span => {
      const value = await new Promise<string>(resolve => {
        execFile('/usr/bin/security', ['find-generic-password', '-s', service, '-a', account, '-w'], { timeout: KEYCHAIN_TIMEOUT_MS }, (error, stdout) =>
          resolve(error === null ? stdout.trim() : ''),
        )
      })
      span.setAttribute('ai_accounts.found', value !== '')
      return value
    },
  )

export interface VibeLoginSources {
  readonly directory?: string
  readonly platform?: NodeJS.Platform
  readonly readText?: (path: string) => Promise<string>
  readonly readKeychain?: (service: string, account: string) => Promise<string>
}

/**
 * Mistral Vibe's stored key, in Vibe's own order after the environment: `$VIBE_HOME/.env`, then the macOS Keychain.
 * Linux and Windows keyrings are not read; those Hosts use `.env` or a key reference.
 */
const readVibeKey = async (sources: VibeLoginSources = {}): Promise<string> => {
  const readText = sources.readText ?? ((path: string) => readFile(path, 'utf8'))
  try {
    const fromFile = parseVibeEnvKey(await readText(join(sources.directory ?? vibeHome(), '.env')))
    if (fromFile !== '') return fromFile
  } catch {
    // No .env: Vibe may have used the keyring.
  }
  if ((sources.platform ?? process.platform) !== 'darwin') return ''
  const readKeychain = sources.readKeychain ?? readKeychainPassword
  for (const service of VIBE_KEYCHAIN_SERVICES) {
    const key = (await readKeychain(service, DEFAULT_MISTRAL_KEY_ENV)).trim()
    if (key !== '') return key
  }
  return ''
}

/**
 * The key an account serves with. A named reference wins; `cli` reads only Mistral Vibe's login; `reference` never
 * falls back to it, so a missing named key cannot silently borrow another identity.
 */
const readMistralKey = async (
  keyEnv: string,
  resolveCredential?: CredentialValueResolver,
  authSource?: 'cli' | 'reference',
  readCliKey: () => Promise<string> = () => readVibeKey(),
): Promise<string> => {
  const name = keyEnv.trim() === '' ? DEFAULT_MISTRAL_KEY_ENV : keyEnv.trim()
  const named = authSource === 'cli' ? '' : resolveCredential === undefined ? CredentialModel.readKeyFromEnv(name) : await resolveCredential(name)
  if (named.trim().length > 0) return named.trim()
  if (authSource === 'reference') return ''
  return (await readCliKey()).trim()
}

const capabilitiesSchema = Schema.Struct({
  completion_chat: Schema.optional(Schema.Boolean),
  function_calling: Schema.optional(Schema.Boolean),
  vision: Schema.optional(Schema.Boolean),
})

const catalogModelSchema = Schema.Struct({
  id: AiAccountsSchema.trimmedName(160),
  capabilities: Schema.optional(capabilitiesSchema),
  max_context_length: Schema.optional(Schema.NullOr(Schema.Number.check(Schema.isFinite()))),
  deprecation: Schema.optional(Schema.NullOr(Schema.String)),
})

/** `GET /v1/model-catalog?surface=vibe-code`: the models a Vibe plan offers (`vibe/core/model_catalog/models.py`). */
const vibeCatalogSchema = Schema.Struct({ models: AiAccountsSchema.list(catalogModelSchema, 500) })
/** `GET /v1/models`: the documented model list. */
const modelListSchema = Schema.Struct({ data: AiAccountsSchema.list(catalogModelSchema, 500) })

export interface MistralCatalogEntry {
  readonly id: string
  readonly contextWindow?: number
  readonly vision: boolean
}

const catalogEntries = (models: readonly (typeof catalogModelSchema.Type)[]): readonly MistralCatalogEntry[] => {
  const seen = new Set<string>()
  const entries: MistralCatalogEntry[] = []
  for (const model of models) {
    // DSH drives tools, so a model that cannot call them is not offered; embeddings, OCR and moderation drop out here.
    if (seen.has(model.id) || model.capabilities?.completion_chat !== true || model.capabilities.function_calling !== true) continue
    if (model.deprecation !== undefined && model.deprecation !== null) continue
    seen.add(model.id)
    const context = model.max_context_length
    entries.push({
      id: model.id,
      ...(context !== undefined && context !== null && context > 0 && { contextWindow: context }),
      vision: model.capabilities.vision === true,
    })
  }
  return entries
}

const parseMistralCatalog = (payload: unknown): readonly MistralCatalogEntry[] => {
  const vibe = AiAccountsSchema.decodeResult(vibeCatalogSchema, payload)
  if (vibe._tag === 'Success') return catalogEntries(vibe.success.models)
  return catalogEntries(AiAccountsSchema.decode(modelListSchema, payload).data)
}

const withTimeout = (signal: AbortSignal | undefined, ms: number): AbortSignal =>
  signal === undefined ? AbortSignal.timeout(ms) : AbortSignal.any([signal, AbortSignal.timeout(ms)])

const getJson = (input: {
  readonly apiKey: string
  readonly path: string
  readonly operation: 'catalog' | 'usage' | 'credits'
  readonly signal: AbortSignal
}): Promise<Response> =>
  providerFetch({
    provider: MISTRAL_KIND,
    operation: input.operation,
    url: `${MISTRAL_API_BASE}${input.path}`,
    init: { headers: { accept: 'application/json', authorization: `Bearer ${input.apiKey}` }, redirect: 'error', signal: input.signal },
  })

/** The models this key may call: the Vibe plan catalog when Mistral serves it, else the documented `/v1/models`. */
const fetchMistralCatalog = async (apiKey: string, signal?: AbortSignal): Promise<readonly MistralCatalogEntry[]> => {
  const key = apiKey.trim()
  if (key === '') throw new Error(`No Mistral key. Run \`vibe --setup\` or store ${DEFAULT_MISTRAL_KEY_ENV} for this account.`)
  const requestSignal = withTimeout(signal, CATALOG_TIMEOUT_MS)
  try {
    const vibe = await getJson({ apiKey: key, path: '/v1/model-catalog?surface=vibe-code', operation: 'catalog', signal: requestSignal })
    if (vibe.ok) {
      const entries = parseMistralCatalog(await vibe.json())
      if (entries.length > 0) return entries
    }
  } catch (cause) {
    if (requestSignal.aborted) throw cause
    // Undocumented catalog unavailable or unparsable: fall back to the documented list.
  }
  const response = await getJson({ apiKey: key, path: '/v1/models', operation: 'catalog', signal: requestSignal })
  if (!response.ok) throw new Error(`Mistral model catalog request failed (${String(response.status)}).`)
  return parseMistralCatalog(await response.json())
}

const subscriptionSchema = Schema.Struct({ plan_name: Schema.String, vibe_payg_enabled: Schema.optional(Schema.NullOr(Schema.Boolean)) })
export type MistralSubscription = typeof subscriptionSchema.Type
const budgetSchema = Schema.Struct({
  vibe_budget: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        usage_percentage: Schema.Number.check(Schema.isFinite()),
        reset_at: Schema.optional(Schema.NullOr(Schema.String)),
        payg_enabled: Schema.optional(Schema.NullOr(Schema.Boolean)),
      }),
    ),
  ),
})
export type MistralBudget = typeof budgetSchema.Type

const MISTRAL_NO_BUDGET_MESSAGE =
  'Mistral reported no Vibe allowance for this key (an API-only key, or a member without usage permission). Check usage in console.mistral.ai.'

/** Turn Vibe's billing reads into a card; `null` reads are the 403/404 Vibe also treats as "no data". */
const mistralUsageCard = (subscription: MistralSubscription | null, budget: MistralBudget | null): UsageCard => {
  const planName = subscription === null ? null : subscription.plan_name.trim().slice(0, 64) || null
  const detail = budget?.vibe_budget
  if (detail === undefined || detail === null) return { ...ProviderUsageModel.emptyUsage('unsupported', MISTRAL_NO_BUDGET_MESSAGE), plan: planName }
  const resetsAt = detail.reset_at === undefined || detail.reset_at === null ? Number.NaN : Date.parse(detail.reset_at)
  return {
    status: detail.usage_percentage >= 100 && detail.payg_enabled !== true ? 'rate-limited' : 'ok',
    message: detail.payg_enabled === true ? 'Pay-as-you-go continues after the monthly allowance.' : null,
    identity: null,
    plan: planName,
    windows: [
      {
        label: 'Monthly allowance',
        percentRemaining: ProviderUsageModel.remainingFromUsed(detail.usage_percentage),
        resetsAt: Number.isFinite(resetsAt) ? resetsAt : null,
      },
    ],
    bankedResets: 0,
    bankedResetExpiries: [],
  }
}

/**
 * Plan quota from the billing reads Mistral Vibe's footer uses (`vibe/app_server/_billing.py`). They are not in
 * Mistral's public API reference, so this is best effort: authentication is proven by the documented `/v1/models`,
 * and a missing allowance reads `unsupported` rather than a guessed percentage.
 */
const readMistralUsage = async (input: {
  readonly keyEnv: string
  readonly authSource?: 'cli' | 'reference' | undefined
  readonly resolveCredential?: CredentialValueResolver | undefined
  readonly onAuthenticated?: (() => void) | undefined
  readonly signal?: AbortSignal | undefined
  readonly readCliKey?: (() => Promise<string>) | undefined
}): Promise<UsageCard> => {
  if (input.signal?.aborted) return ProviderUsageModel.emptyUsage('error', 'Usage collection was cancelled.')
  const key = await readMistralKey(input.keyEnv, input.resolveCredential, input.authSource, input.readCliKey)
  if (key === '') return ProviderUsageModel.emptyUsage('unauthenticated', `Run \`vibe --setup\` or store ${DEFAULT_MISTRAL_KEY_ENV} for this account.`)
  const signal = ProviderUsageModel.usageSignal(input.signal)
  // A 403 (no usage permission), 404 (no billing on this platform) or malformed body is "no data", as in Vibe.
  const readSubscription = async (): Promise<MistralSubscription | null> => {
    try {
      const response = await getJson({ apiKey: key, path: '/v1/billing/subscription', operation: 'credits', signal })
      if (!response.ok) return null
      const parsed = AiAccountsSchema.decodeResult(subscriptionSchema, await response.json())
      return parsed._tag === 'Success' ? parsed.success : null
    } catch {
      return null
    }
  }
  const readBudget = async (): Promise<MistralBudget | null> => {
    try {
      const response = await getJson({ apiKey: key, path: '/v1/billing/budget', operation: 'credits', signal })
      if (!response.ok) return null
      const parsed = AiAccountsSchema.decodeResult(budgetSchema, await response.json())
      return parsed._tag === 'Success' ? parsed.success : null
    } catch {
      return null
    }
  }
  try {
    const [models, subscription, budget] = await Promise.all([
      getJson({ apiKey: key, path: '/v1/models', operation: 'usage', signal }),
      readSubscription(),
      readBudget(),
    ])
    if (models.status === 401 || models.status === 403)
      return ProviderUsageModel.emptyUsage('unauthenticated', 'Mistral rejected this key; run `vibe --setup` again or replace the key.')
    if (models.status === 429) return ProviderUsageModel.emptyUsage('rate-limited', 'Mistral is rate limiting this key; wait a minute and refresh.')
    if (!models.ok) return ProviderUsageModel.emptyUsage('error', `Mistral returned ${String(models.status)} for the model list; refresh later.`)
    if (AiAccountsSchema.decodeResult(modelListSchema, await models.json())._tag === 'Success' && input.signal?.aborted !== true) input.onAuthenticated?.()
    return mistralUsageCard(subscription, budget)
  } catch (cause) {
    return ProviderUsageModel.emptyUsage('error', cause instanceof Error ? cause.message : 'Mistral could not be reached; refresh later.')
  }
}

/** Mistral subscription accounts: Mistral Vibe login reuse, the plan's model catalog and its monthly allowance. */
export class MistralAccountModel {
  static readonly noBudgetMessage = MISTRAL_NO_BUDGET_MESSAGE
  static readonly vibeHome = vibeHome
  static readonly parseVibeEnvKey = parseVibeEnvKey
  static readonly readVibeKey = readVibeKey
  static readonly readKey = readMistralKey
  static readonly parseCatalog = parseMistralCatalog
  static readonly fetchCatalog = fetchMistralCatalog
  static readonly usageCard = mistralUsageCard
  static readonly readUsage = readMistralUsage
}
