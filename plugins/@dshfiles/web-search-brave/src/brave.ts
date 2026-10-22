import { WebError, type WebSearchRequest, type WebSearchResult, type WebSearchSource } from '@deepseek-ai/dsh-web'
import { z } from 'zod'

const BRAVE_SEARCH_ENDPOINT = 'https://api.search.brave.com/res/v1/web/search'
const SEARCH_TIMEOUT_MS = 15_000
const MAX_SNIPPET_CHARS = 1_200

const braveResultSchema = z.object({
  title: z.string().optional(),
  url: z.string().min(1),
  description: z.string().optional(),
  age: z.string().optional(),
  page_age: z.string().optional(),
})

const braveResponseSchema = z.object({
  web: z.object({
    results: z.array(braveResultSchema).optional(),
  }),
})

type BraveResponse = z.infer<typeof braveResponseSchema>

interface MutableSource {
  url: string
  title?: string
  snippet?: string
  publishedAt?: string
}

export interface BraveSearchOptions {
  readonly apiKey: string
  readonly count: number
  readonly safesearch: 'off' | 'moderate' | 'strict'
  readonly fetch?: typeof fetch
}

/** Brave's Web Search adapter for `ctx.web`: request, response mapping and the error codes the seam expects. */
export class BraveSearchModel {
  static readonly endpoint = BRAVE_SEARCH_ENDPOINT

  /** Brave snippets carry `<strong>`-style markup from its own highlighter; the seam wants plain text. */
  static stripMarkup(text: string): string {
    return text
      .replace(/<[^>]*>/gu, '')
      .replace(/&quot;/gu, '"')
      .replace(/&#x27;|&#39;/gu, "'")
      .replace(/&#(\d+);/gu, (_match, code: string) => String.fromCodePoint(Number(code)))
      .replace(/&amp;/gu, '&')
      .replace(/&lt;/gu, '<')
      .replace(/&gt;/gu, '>')
      .replace(/\s+/gu, ' ')
      .trim()
      .slice(0, MAX_SNIPPET_CHARS)
  }

  /** The I/O boundary: decode the wire text once, naming its shape for every later step. */
  static parseResponse(text: string): BraveResponse {
    let payload: unknown
    try {
      payload = JSON.parse(text)
    } catch (cause) {
      throw new WebError('Brave search returned invalid JSON.', 'WEB_PROVIDER_ERROR', { cause })
    }
    const parsed = braveResponseSchema.safeParse(payload)
    if (!parsed.success) throw new WebError('Brave search returned an unexpected response shape.', 'WEB_PROVIDER_ERROR')
    return parsed.data
  }

  /** Map a parsed Brave payload onto citeable sources; an unexpected shape fails loudly instead of returning nothing. */
  static toSources(parsed: BraveResponse): readonly WebSearchSource[] {
    const seen = new Set<string>()
    const sources: WebSearchSource[] = []
    for (const result of parsed.web.results ?? []) {
      if (seen.has(result.url)) continue
      seen.add(result.url)
      const source: MutableSource = { url: result.url }
      if (result.title !== undefined) source.title = BraveSearchModel.stripMarkup(result.title)
      if (result.description !== undefined) source.snippet = BraveSearchModel.stripMarkup(result.description)
      const publishedAt = result.page_age ?? result.age
      if (publishedAt !== undefined) source.publishedAt = publishedAt
      sources.push(source)
    }
    return sources
  }

  /** One Brave Web Search call; the seam enforces `maxResults` on the way back, so this asks for the configured count. */
  static async search(request: WebSearchRequest, options: BraveSearchOptions, signal?: AbortSignal): Promise<WebSearchResult> {
    const url = new URL(BRAVE_SEARCH_ENDPOINT)
    url.searchParams.set('q', request.query)
    url.searchParams.set('count', String(options.count))
    url.searchParams.set('safesearch', options.safesearch)
    url.searchParams.set('extra_snippets', 'true')
    const timeout = AbortSignal.timeout(SEARCH_TIMEOUT_MS)
    let response: Response
    try {
      response = await (options.fetch ?? fetch)(url, {
        headers: {
          accept: 'application/json',
          'accept-encoding': 'gzip',
          'x-subscription-token': options.apiKey,
        },
        signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
      })
    } catch (cause) {
      if (signal?.aborted === true) throw new WebError('Brave search aborted.', 'WEB_ABORTED', { cause })
      throw new WebError(`Brave search request failed: ${cause instanceof Error ? cause.message : String(cause)}`, 'WEB_PROVIDER_ERROR', { cause })
    }
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      const detail = body.trim().slice(0, 200)
      const hint =
        response.status === 401 || response.status === 403
          ? ' The Brave API key was rejected; check the Secret Catalog alias.'
          : response.status === 429
            ? ' Brave rate limit reached.'
            : ''
      throw new WebError(`Brave search returned HTTP ${String(response.status)}${detail === '' ? '' : `: ${detail}`}${hint}`, 'WEB_PROVIDER_ERROR')
    }
    const sources = BraveSearchModel.toSources(BraveSearchModel.parseResponse(await response.text()))
    if (sources.length === 0) throw new WebError('Brave search returned no results.', 'WEB_PROVIDER_ERROR')
    return { sources, truncated: false }
  }
}
