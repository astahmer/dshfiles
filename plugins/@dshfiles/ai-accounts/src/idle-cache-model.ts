import { CostEstimateModel, type ModelPrice, type RouteQuote } from './cost-estimate.js'
import { cacheRetentionFor, type CacheRetention } from './cache-retention.js'

/**
 * Whether the next request of an idle thread re-sends its whole prompt uncached, and what that costs.
 *
 * A provider keeps a prompt prefix cached for a lifetime counted from the last request that used it. Past it, the
 * next request pays the full input (or cache-write) rate for every prompt token instead of the cache-read rate.
 */

type Vendor = 'anthropic' | 'openai'

/**
 * Published default lifetimes, in minutes. Anthropic: 5 min (1 h when the provider profile sets
 * `cacheRetention: long`). OpenAI and Codex: prefixes stay 5–10 min after the last use, so the upper bound keeps the
 * warning from firing on a still-warm cache. Other vendors publish no lifetime: no warning without an override.
 */
const KNOWN_LIFETIME_MINUTES = { anthropic: 5, openai: 10 } as const satisfies Record<Vendor, number>

const vendorOf = (route: { readonly provider: string; readonly model: string; readonly modelsDevId: string | null }): Vendor | null => {
  const listed = route.modelsDevId?.split('/')[0]
  if (listed === 'anthropic' || listed === 'openai') return listed
  const model = route.model.toLowerCase()
  if (model.includes('claude')) return 'anthropic'
  if (/^(gpt|o\d|codex)/.test(model) || route.provider.toLowerCase().includes('codex')) return 'openai'
  return null
}

export interface CacheLifetime {
  readonly minutes: number
  readonly source: 'override' | 'known' | 'retention'
}

export interface IdleCacheFacts {
  readonly promptTokens: number
  readonly idleMinutes: number
  readonly lifetime: CacheLifetime
  /** USD for the prompt re-sent uncached, or null without a price. */
  readonly uncachedUsd: number | null
  /** USD the same prompt costs from a warm cache; null when the price lists no cache-read rate. */
  readonly cachedUsd: number | null
}

const MINUTE_MS = 60_000

export class IdleCacheModel {
  /** `provider/model`, then `provider/*`, from the settings; then the vendor's published default; else unknown. */
  static readonly lifetime = (input: {
    readonly provider: string
    readonly model: string
    readonly modelsDevId: string | null
    readonly overrides: Readonly<Record<string, number>>
    readonly retention?: Readonly<Record<string, CacheRetention>> | undefined
    /** The host-declared extended lifetime for this route, when its transport supports one. */
    readonly longCacheMinutes?: number | null | undefined
  }): CacheLifetime | null => {
    const override = input.overrides[`${input.provider}/${input.model}`] ?? input.overrides[`${input.provider}/*`]
    if (override !== undefined && override > 0) return { minutes: override, source: 'override' }
    const vendor = vendorOf(input)
    if (vendor !== null && cacheRetentionFor({ ...input, settings: input.retention ?? {} }) === 'long') {
      const declared = input.longCacheMinutes
      if (typeof declared === 'number') return { minutes: declared, source: 'retention' }
      if (vendor === 'anthropic') return { minutes: 60, source: 'retention' }
    }
    return vendor === null ? null : { minutes: KNOWN_LIFETIME_MINUTES[vendor], source: 'known' }
  }

  /** When the cache of a thread last used at `lastUsedAt` expires; null when its lifetime is unknown. */
  static readonly expiresAt = (input: { readonly lastUsedAt: number; readonly lifetime: CacheLifetime | null }): number | null =>
    input.lifetime === null ? null : input.lastUsedAt + input.lifetime.minutes * MINUTE_MS

  static readonly price = (input: { readonly promptTokens: number; readonly price: ModelPrice }) => {
    const band = CostEstimateModel.contextBand(input.promptTokens)
    const none = { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
    const resent =
      input.price.cacheWrite === undefined ? { ...none, uncachedInputTokens: input.promptTokens } : { ...none, cacheWriteTokens: input.promptTokens }
    const uncached = CostEstimateModel.costOfTokens({ tokens: resent, price: input.price, band }).total
    const hasCacheRead = input.price.cacheRead !== undefined || (input.price.tiers ?? []).some(tier => tier.cacheRead !== undefined)
    const cached = hasCacheRead
      ? CostEstimateModel.costOfTokens({ tokens: { ...none, cacheReadTokens: input.promptTokens }, price: input.price, band }).total
      : null
    return { uncached, cached }
  }

  /**
   * The warning, or null to stay quiet: while a turn runs, before the lifetime passed, for a short prompt, or for a
   * route without a known lifetime.
   */
  static readonly of = (input: {
    readonly now: number
    readonly lastUsedAt: number | null
    readonly running: boolean
    readonly promptTokens: number | undefined
    readonly minTokens: number
    readonly route: { readonly provider: string; readonly model: string }
    readonly quote: RouteQuote | undefined
    readonly overrides: Readonly<Record<string, number>>
    readonly retention?: Readonly<Record<string, CacheRetention>> | undefined
  }): IdleCacheFacts | null => {
    if (input.running || input.lastUsedAt === null || input.promptTokens === undefined || input.promptTokens < input.minTokens) return null
    const lifetime = IdleCacheModel.lifetime({
      ...input.route,
      modelsDevId: input.quote?.modelsDevId ?? null,
      overrides: input.overrides,
      retention: input.retention,
      longCacheMinutes: input.quote?.longCacheMinutes ?? null,
    })
    const expiresAt = IdleCacheModel.expiresAt({ lastUsedAt: input.lastUsedAt, lifetime })
    if (lifetime === null || expiresAt === null || input.now < expiresAt) return null
    const price =
      input.quote?.price === null || input.quote?.price === undefined || input.quote.free
        ? null
        : IdleCacheModel.price({ promptTokens: input.promptTokens, price: input.quote.price })
    return {
      promptTokens: input.promptTokens,
      idleMinutes: Math.floor((input.now - input.lastUsedAt) / MINUTE_MS),
      lifetime,
      uncachedUsd: price?.uncached ?? null,
      cachedUsd: price?.cached ?? null,
    }
  }

  static readonly formatIdle = (minutes: number): string => {
    if (minutes < 60) return `${minutes} min`
    if (minutes < 48 * 60) return `${Math.floor(minutes / 60)} h`
    return `${Math.floor(minutes / (24 * 60))} d`
  }

  static readonly formatTokens = (tokens: number): string =>
    tokens >= 1_000_000 ? `${(tokens / 1_000_000).toFixed(1)}M` : tokens >= 1_000 ? `${Math.round(tokens / 1_000)}K` : String(tokens)

  /** `≈$0.45`, or `<$0.0001` as is: it already says it is a bound. */
  static readonly formatAmount = (usd: number): string => {
    const formatted = CostEstimateModel.formatUsd(usd)
    return formatted.startsWith('<') ? formatted : `≈${formatted}`
  }

  static readonly label = (facts: IdleCacheFacts): string =>
    facts.uncachedUsd === null
      ? `cache expired · ${IdleCacheModel.formatTokens(facts.promptTokens)} uncached`
      : `cache expired · next send ${IdleCacheModel.formatAmount(facts.uncachedUsd)}`

  static readonly detail = (facts: IdleCacheFacts): string => {
    const lifetime = `${facts.lifetime.minutes} min${facts.lifetime.source !== 'known' ? ', from settings' : ''}`
    const head = `Idle ${IdleCacheModel.formatIdle(facts.idleMinutes)}, past the prompt cache's ${lifetime}. The next message re-sends ~${IdleCacheModel.formatTokens(facts.promptTokens)} prompt tokens uncached`
    if (facts.uncachedUsd === null) return `${head}.`
    const cached = facts.cachedUsd === null ? '' : ` instead of ${IdleCacheModel.formatAmount(facts.cachedUsd)} cached`
    return `${head}: ${IdleCacheModel.formatAmount(facts.uncachedUsd)}${cached}.`
  }

  /** The first message of a thread that continues this one without replaying it. */
  static readonly referencePrompt = (input: { readonly sessionId: string; readonly title: string | undefined; readonly draft: string }): string => {
    const named = input.title === undefined || input.title.trim() === '' ? input.sessionId : `“${input.title.trim()}” (${input.sessionId})`
    const head = `Continue from the earlier thread ${named}. Look up only what you need from it with find_threads or memory_read instead of replaying it.`
    return input.draft.trim() === '' ? head : `${head}\n\n${input.draft.trim()}`
  }
}
