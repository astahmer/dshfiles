/**
 * The `readable` fetch provider for `ctx.web`.
 *
 * Ported from `@deepseek-ai/dsh-web-fetch-http@0.2.1-rc.2` (`lib/types/provider.js`, MIT) and changed
 * where the self-improve mining pass (plans/self-improve, T6) found `web_fetch` failing:
 *
 * - **Cross-origin redirects are followed.** The stock provider refuses them with
 *   `WEB_REDIRECT_BLOCKED`, so `http→https`, `www.` and docs-host moves all failed. Every hop here goes
 *   through the same URL policy, public-address resolution and connection pinning as the first request,
 *   so a redirect can never reach a loopback or private address the first URL could not.
 * - **More text types decode**: JavaScript, YAML, TOML, shell, SQL, NDJSON, and untyped or
 *   `application/octet-stream` bodies that sniff as UTF-8 text.
 * - **HTML is reduced to its readable article** before the tool converts it to markdown.
 */
import { deadline, timeoutOf } from '@deepseek-ai/dsh-timeout'
import { WebError, type WebFetchProvider, type WebFetchRequest, type WebFetchResult } from '@deepseek-ai/dsh-web'
import { pluginAttributes, withSpan } from '@dshfiles/dshx/tracing'
import type { Response } from 'undici'
import { ArticleExtractor } from './extract.js'
import { PublicNetwork, type FetchNetwork, type HopResponse } from './network.js'
import { FetchPolicy } from './policy.js'

export const READABLE_FETCH_PROVIDER_ID = 'readable'

/** An explicit product agent, never a browser disguise. */
export const DEFAULT_USER_AGENT = 'deepseek-harness-dshfiles/0.1 (web-fetch-readable; +https://github.com/deepseek-ai)'

export interface FetchOptions {
  readonly maxResponseBytes: number
  readonly maxBodyChars: number
  readonly timeoutMs: number
  readonly maxRedirects: number
  readonly readable: boolean
  readonly userAgent: string
}

export const DEFAULT_FETCH_OPTIONS: FetchOptions = {
  maxResponseBytes: 5_000_000,
  maxBodyChars: 100_000,
  timeoutMs: 30_000,
  maxRedirects: 8,
  readable: true,
  userAgent: DEFAULT_USER_AGENT,
}

/** What one fetch did, for its span; never the URL or the body. */
interface FetchTrace {
  redirects: number
  crossOriginRedirects: number
  extraction: 'article' | 'full' | 'not-html' | 'disabled' | 'too-large' | 'no-article' | 'failed'
}

export class ReadableFetchProvider implements WebFetchProvider {
  readonly id = READABLE_FETCH_PROVIDER_ID

  /**
   * @param options - read per fetch, so a settings change reaches the next call without a restart.
   * @param network - the transport; tests replace it.
   */
  constructor(
    private readonly options: () => Promise<FetchOptions> | FetchOptions,
    private readonly network: FetchNetwork = PublicNetwork.live,
  ) {}

  /** No credentials to check: an anonymous public fetcher is always usable. */
  available(): boolean {
    return true
  }

  fetch(request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult> {
    return withSpan('web fetch', { kind: 'client', attributes: pluginAttributes({ plugin: 'web-fetch-readable', attributes: {} }) }, async span => {
      const trace: FetchTrace = { redirects: 0, crossOriginRedirects: 0, extraction: 'not-html' }
      try {
        const result = await this.fetchUntraced(request, trace, signal)
        span.setAttribute('dshx.web-fetch-readable.status', result.statusCode)
        span.setAttribute('dshx.web-fetch-readable.kind', result.body.kind)
        span.setAttribute('dshx.web-fetch-readable.truncated', result.truncated)
        return result
      } finally {
        span.setAttribute('dshx.web-fetch-readable.redirects', trace.redirects)
        span.setAttribute('dshx.web-fetch-readable.cross_origin_redirects', trace.crossOriginRedirects)
        span.setAttribute('dshx.web-fetch-readable.extraction', trace.extraction)
      }
    })
  }

  private async fetchUntraced(request: WebFetchRequest, trace: FetchTrace, signal?: AbortSignal): Promise<WebFetchResult> {
    if (signal?.aborted === true) throw new WebError('web fetch aborted', 'WEB_ABORTED')
    const options = await this.options()
    // try/finally rather than `using`: the Host bundle targets Node without the disposal helper runtime.
    const limit = deadline(signal, options.timeoutMs, 'WEB_FETCH_TIMEOUT')
    try {
      return await this.followAndRead(request.url, options, trace, limit.signal)
    } finally {
      limit[Symbol.dispose]()
    }
  }

  /** Follow redirects up to the hop cap, revalidating every target, then read the final response. */
  private async followAndRead(initialUrl: string, options: FetchOptions, trace: FetchTrace, signal: AbortSignal): Promise<WebFetchResult> {
    let currentUrl = FetchPolicy.validateUrl(initialUrl)
    for (;;) {
      const hop = await this.requestOnce(currentUrl, options, signal)
      try {
        const { response } = hop
        if (!FetchPolicy.isRedirect(response.status)) return await this.readBody(response, currentUrl, options, trace, signal)
        await response.body?.cancel()
        if (trace.redirects >= options.maxRedirects)
          throw new WebError(
            `exceeded the maximum of ${String(options.maxRedirects)} redirects; raise maxRedirects in Settings → Web fetch (readable), or fetch the last URL directly`,
            'WEB_REDIRECT_BLOCKED',
          )
        const location = response.headers.get('location')
        if (location === null) throw new WebError(`redirect response (HTTP ${String(response.status)}) without a Location header`, 'WEB_PROVIDER_ERROR')
        let target: URL
        try {
          target = new URL(location, currentUrl)
        } catch (cause) {
          throw new WebError(`invalid redirect Location "${location}"`, 'WEB_PROVIDER_ERROR', { cause })
        }
        // The same policy as the first URL; the next requestOnce resolves and pins the new host afresh.
        const validated = FetchPolicy.validateUrl(target.toString())
        if (!FetchPolicy.isSameOrigin(validated, currentUrl)) trace.crossOriginRedirects++
        trace.redirects++
        currentUrl = validated
      } finally {
        await hop.close()
      }
    }
  }

  private async requestOnce(url: URL, options: FetchOptions, signal: AbortSignal): Promise<HopResponse> {
    const headers = {
      'user-agent': options.userAgent,
      accept: 'text/html,application/xhtml+xml,text/*;q=0.9,application/json;q=0.8,*/*;q=0.5',
    }
    try {
      const proxy = this.network.proxyFor(url)
      if (proxy !== undefined && !PublicNetwork.isNonPublicIpLiteral(url.hostname)) return await this.network.requestVia(proxy, url, headers, signal)
      const addresses = await this.network.resolve(url.hostname, signal)
      return await this.network.request(url, addresses, headers, signal)
    } catch (error) {
      if (error instanceof WebError) throw error
      throw ReadableFetchProvider.translateAbortOrNetwork(error, signal)
    }
  }

  private async readBody(response: Response, finalUrl: URL, options: FetchOptions, trace: FetchTrace, signal: AbortSignal): Promise<WebFetchResult> {
    const contentType = response.headers.get('content-type')
    const declared = FetchPolicy.classify(contentType)
    if (declared === undefined) {
      await response.body?.cancel()
      throw new WebError(
        `unsupported content type "${contentType ?? 'unknown'}": web_fetch returns text and HTML only; download binary files with bash (curl -o) instead`,
        'WEB_UNSUPPORTED_CONTENT_TYPE',
      )
    }
    let decoder: TextDecoder
    try {
      decoder = FetchPolicy.decoderFor(FetchPolicy.parseCharset(contentType))
    } catch (error) {
      await response.body?.cancel()
      throw error
    }
    const { bytes, truncatedByBytes } = await this.readCapped(response, options, signal)
    const kind = declared === 'sniff' ? FetchPolicy.sniff(bytes) : declared
    if (kind === undefined)
      throw new WebError(
        `unsupported content type "${contentType ?? 'unknown'}": the body is not text; download binary files with bash (curl -o) instead`,
        'WEB_UNSUPPORTED_CONTENT_TYPE',
      )
    const decoded = decoder.decode(bytes)
    let content = decoded
    if (kind === 'html') {
      if (!options.readable) trace.extraction = 'disabled'
      else {
        const extraction = ArticleExtractor.extract(decoded, finalUrl.toString())
        trace.extraction = extraction.kind === 'article' ? 'article' : extraction.reason
        if (extraction.kind === 'article') content = extraction.html
      }
    }
    const truncatedByChars = content.length > options.maxBodyChars
    if (truncatedByChars) content = content.slice(0, options.maxBodyChars)
    return {
      url: finalUrl.toString(),
      statusCode: response.status,
      body: kind === 'html' ? { kind: 'html', content } : { kind: 'text', content },
      truncated: truncatedByBytes || truncatedByChars,
    }
  }

  /** A declared length over the cap is refused; a stream that grows past it is cut short. */
  private async readCapped(response: Response, options: FetchOptions, signal: AbortSignal): Promise<{ bytes: Uint8Array; truncatedByBytes: boolean }> {
    const declared = response.headers.get('content-length')
    if (declared !== null) {
      const length = Number(declared)
      if (Number.isFinite(length) && length > options.maxResponseBytes) {
        await response.body?.cancel()
        throw new WebError(
          `response exceeds the maximum of ${String(options.maxResponseBytes)} bytes; raise maxResponseBytes in Settings → Web fetch (readable)`,
          'WEB_FETCH_TOO_LARGE',
        )
      }
    }
    if (response.body === null) return { bytes: new Uint8Array(0), truncatedByBytes: false }
    const chunks: Uint8Array[] = []
    let total = 0
    let truncatedByBytes = false
    const reader = response.body.getReader()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        const remaining = options.maxResponseBytes - total
        if (value.byteLength > remaining) {
          chunks.push(value.subarray(0, remaining))
          total += remaining
          truncatedByBytes = true
          break
        }
        chunks.push(value)
        total += value.byteLength
      }
    } catch (error) {
      throw ReadableFetchProvider.translateAbortOrNetwork(error, signal)
    } finally {
      await reader.cancel().catch(() => undefined)
    }
    const bytes = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return { bytes, truncatedByBytes }
  }

  /** Our deadline is a timeout; any other abort is a cancel; an unaborted throw is a network failure. */
  private static translateAbortOrNetwork(error: unknown, signal: AbortSignal): WebError {
    const timeout = timeoutOf(signal, 'WEB_FETCH_TIMEOUT')
    if (timeout !== undefined) return new WebError('web fetch timed out', 'WEB_FETCH_TIMEOUT', { cause: timeout })
    if (signal.aborted) return new WebError('web fetch aborted', 'WEB_ABORTED', { cause: error })
    return new WebError(`web fetch failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
  }
}
