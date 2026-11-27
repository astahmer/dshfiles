import { LlmError, type LlmDiscoveredModel } from '@deepseek-ai/dsh-llm'
import type { Credential, OAuthCredential } from '@earendil-works/pi-ai'
import * as Schema from 'effect/Schema'
import { AiAccountsSchema } from './effect-schema.js'
import { providerFetch } from './provider-request.js'

/** A decoded JSON body, before the catalog schema reads it. */
export type CodexModelsPayload = string | number | boolean | null | readonly CodexModelsPayload[] | { readonly [key: string]: CodexModelsPayload }

/**
 * Live model discovery for Codex (ChatGPT subscription) accounts.
 *
 * pi-ai's static Codex catalog lags the plan: a model the backend already serves stays out of the picker until the
 * next pi-ai release, and the backend's own context window is the authority over the catalog's. The backend lists the
 * plan's models at `GET /backend-api/codex/models`, the endpoint Codex CLI itself reads, with the same login and the
 * headers Codex CLI sends. Only `visibility: "list"` models are offered; hidden ones (`gpt-reserve`, review helpers)
 * are routing internals, not picker entries.
 */

export const CODEX_MODELS_URL = 'https://chatgpt.com/backend-api/codex/models'
/** The Codex CLI version this plugin introduces itself as; the backend filters models by `minimal_client_version`. */
export const CODEX_CLIENT_VERSION = '0.200.0'
/** Matches pi-ai's static Codex catalog: every Codex model there allows 128k output tokens. */
export const CODEX_MAX_OUTPUT_TOKENS = 128_000
/** Refresh a token this close to expiry before using it, as pi-ai does before a request. */
const REFRESH_MARGIN_MS = 60_000

const tokenCount = Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThan(0))

const codexModelSchema = Schema.Struct({
  slug: AiAccountsSchema.trimmedName(160),
  display_name: Schema.optional(Schema.NullOr(Schema.String.check(Schema.isMaxLength(200)))),
  visibility: Schema.optional(Schema.NullOr(Schema.String.check(Schema.isMaxLength(32)))),
  context_window: Schema.optional(Schema.NullOr(tokenCount)),
  max_context_window: Schema.optional(Schema.NullOr(tokenCount)),
  input_modalities: Schema.optional(Schema.NullOr(Schema.Array(Schema.String.check(Schema.isMaxLength(32))))),
  service_tiers: Schema.optional(Schema.NullOr(Schema.Array(Schema.Struct({ id: Schema.String.check(Schema.isMaxLength(64)) })))),
})

const codexModelsResponseSchema = Schema.Struct({ models: AiAccountsSchema.list(Schema.Unknown, 500) })

/** One model the plan lists, with the limits the backend disclosed. */
export interface CodexCatalogEntry {
  readonly id: string
  readonly name?: string
  /** The window the backend uses by default for this model. */
  readonly contextWindow?: number
  /** The largest window the backend accepts for this model; a user override is clamped to it. */
  readonly maxContextWindow?: number
  readonly inputModalities?: readonly ('text' | 'image')[]
  /** The backend offers the `priority` service tier (Codex "Fast") for this model. */
  readonly priorityTier: boolean
}

export class CodexModelCatalog {
  /**
   * The listed models of one `/codex/models` answer. An entry that does not decode is skipped instead of failing the
   * whole list, so one new backend field shape cannot empty the picker.
   */
  static readonly parse = (payload: CodexModelsPayload): readonly CodexCatalogEntry[] => {
    const response = AiAccountsSchema.decode(codexModelsResponseSchema, payload)
    const seen = new Set<string>()
    const entries: CodexCatalogEntry[] = []
    for (const raw of response.models) {
      const decoded = AiAccountsSchema.decodeResult(codexModelSchema, raw)
      if (decoded._tag !== 'Success') continue
      const model = decoded.success
      if (model.visibility !== 'list' || seen.has(model.slug)) continue
      seen.add(model.slug)
      const modalities = model.input_modalities?.filter((value): value is 'text' | 'image' => value === 'text' || value === 'image')
      const context = model.context_window ?? undefined
      const max = model.max_context_window ?? undefined
      entries.push({
        id: model.slug,
        ...(model.display_name != null && model.display_name.trim() !== '' && { name: model.display_name.trim() }),
        ...(context !== undefined && { contextWindow: context }),
        // A maximum below the default window is not a maximum the user could raise to.
        ...(max !== undefined && { maxContextWindow: Math.max(max, context ?? max) }),
        ...(modalities !== undefined && modalities.includes('text') && { inputModalities: modalities }),
        priorityTier: (model.service_tiers ?? []).some(tier => tier.id === 'priority'),
      })
    }
    return entries
  }

  /** What DSH's model discovery records: the id, its default window, Codex's output cap and its inputs. */
  static readonly toDiscovered = (entry: CodexCatalogEntry): LlmDiscoveredModel => ({
    id: entry.id,
    ...(entry.name !== undefined && { name: entry.name }),
    ...(entry.contextWindow !== undefined && { contextWindow: entry.contextWindow }),
    maxTokens: CODEX_MAX_OUTPUT_TOKENS,
    ...(entry.inputModalities !== undefined && { inputModalities: entry.inputModalities }),
  })

  /** The access token and ChatGPT account id one request needs, refreshed through the account's own credential store. */
  static readonly credential = async (input: {
    readonly store: {
      readonly read: () => Promise<OAuthCredential | undefined>
      readonly modify: (mutate: (current: Credential | undefined) => Promise<Credential | undefined>) => Promise<Credential | undefined>
    }
    readonly refresh: (credential: OAuthCredential, signal: AbortSignal) => Promise<OAuthCredential>
    readonly signal: AbortSignal
    readonly now?: () => number
  }): Promise<{ readonly access: string; readonly accountId: string }> => {
    const now = input.now ?? Date.now
    const stale = (credential: Credential | undefined): credential is OAuthCredential =>
      credential?.type === 'oauth' && credential.expires - now() < REFRESH_MARGIN_MS
    let credential: Credential | undefined = await input.store.read()
    if (stale(credential)) {
      // The same serialized read-refresh-persist a request runs, so discovery and a request never double-refresh.
      credential = await input.store.modify(async current => (stale(current) ? input.refresh(current, input.signal) : current))
    }
    if (credential?.type !== 'oauth') throw new LlmError('This Codex account has no ChatGPT login. Sign in again from AI Accounts.', 'MISSING_CREDENTIAL')
    const accountId = typeof credential.accountId === 'string' && credential.accountId.length > 0 ? credential.accountId : undefined
    if (accountId === undefined) {
      throw new LlmError('The Codex login has no ChatGPT account id. Sign in again from AI Accounts.', 'INVALID_CREDENTIAL')
    }
    return { access: credential.access, accountId }
  }

  /** One `/codex/models` request in an `ai-accounts provider request` span (provider codex, operation catalog). */
  static readonly fetch = async (input: {
    readonly access: string
    readonly accountId: string
    readonly signal: AbortSignal
    readonly fetch?: typeof fetch
  }): Promise<readonly CodexCatalogEntry[]> => {
    const response = await providerFetch({
      provider: 'codex',
      operation: 'catalog',
      url: `${CODEX_MODELS_URL}?client_version=${CODEX_CLIENT_VERSION}`,
      init: {
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${input.access}`,
          'chatgpt-account-id': input.accountId,
          originator: 'codex_cli_rs',
          'user-agent': `codex_cli_rs/${CODEX_CLIENT_VERSION}`,
        },
        redirect: 'error',
        signal: input.signal,
      },
      fetch: input.fetch,
    })
    if (response.status === 401 || response.status === 403) {
      throw new LlmError(`Codex rejected this login for the model list (${String(response.status)}). Sign in again from AI Accounts.`, 'INVALID_CREDENTIAL')
    }
    if (!response.ok) throw new Error(`Codex model list request failed (${String(response.status)}).`)
    const payload: CodexModelsPayload = await response.json()
    return CodexModelCatalog.parse(payload)
  }
}
