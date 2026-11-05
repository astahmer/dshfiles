/**
 * URL validation and content classification: the pure, network-free half of the provider.
 *
 * Ported from `@deepseek-ai/dsh-web-fetch-http@0.2.1-rc.2` (`lib/types/policy.js`, MIT). Changes here:
 * redirects are no longer restricted to one origin (the provider revalidates every hop instead), and
 * more text formats are accepted, including untyped or `application/octet-stream` bodies that sniff as
 * UTF-8 text.
 */
import { WebError } from '@deepseek-ai/dsh-web'

/** Maximum accepted request URL length, as the stock provider enforces. */
export const WEB_FETCH_MAX_URL_LENGTH = 2048

/** Bytes inspected when a response carries no usable content type. */
const SNIFF_BYTES = 8192

/** Text formats served under `application/*`, beyond the `+json`/`+xml` suffixes. */
const APPLICATION_TEXT_TYPES = new Set([
  'application/json',
  'application/xml',
  'application/javascript',
  'application/ecmascript',
  'application/x-javascript',
  'application/typescript',
  'application/x-typescript',
  'application/yaml',
  'application/x-yaml',
  'application/toml',
  'application/x-toml',
  'application/x-sh',
  'application/x-shellscript',
  'application/sql',
  'application/graphql',
  'application/x-ndjson',
  'application/jsonl',
  'application/x-subrip',
  'application/x-tex',
  'application/x-httpd-php',
  'application/csv',
  'application/markdown',
  'application/x-markdown',
])

/** Types whose bytes say nothing about the format, so the body is sniffed instead. */
const UNTYPED = new Set(['', 'application/octet-stream', 'binary/octet-stream', 'application/unknown'])

export type ContentClass = 'html' | 'text' | 'sniff' | undefined

export class FetchPolicy {
  /** HTTP(S) only, no embedded credentials, bounded length. Every hop runs through this. */
  static validateUrl(input: string): URL {
    if (input.length > WEB_FETCH_MAX_URL_LENGTH) throw new WebError(`URL exceeds the maximum length of ${String(WEB_FETCH_MAX_URL_LENGTH)}`, 'WEB_INVALID_URL')
    let url: URL
    try {
      url = new URL(input)
    } catch (cause) {
      throw new WebError(`invalid URL: ${input}`, 'WEB_INVALID_URL', { cause })
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:')
      throw new WebError(`unsupported URL scheme "${url.protocol}" (only http and https are allowed)`, 'WEB_INVALID_URL')
    if (url.username.length > 0 || url.password.length > 0) throw new WebError('credentials in URLs are not allowed', 'WEB_BLOCKED_URL')
    return url
  }

  static isSameOrigin(a: URL, b: URL): boolean {
    return a.protocol === b.protocol && a.hostname === b.hostname && a.port === b.port
  }

  /** `html`, `text`, `sniff` (decide from the bytes) or `undefined` for a known binary type. */
  static classify(contentType: string | null): ContentClass {
    const mime = (contentType ?? '').replace(/;.*$/su, '').trim().toLowerCase()
    if (mime === 'text/html' || mime === 'application/xhtml+xml') return 'html'
    if (mime.startsWith('text/')) return 'text'
    if (APPLICATION_TEXT_TYPES.has(mime) || mime.endsWith('+json') || mime.endsWith('+xml') || mime.endsWith('+yaml')) return 'text'
    if (UNTYPED.has(mime)) return 'sniff'
    return undefined
  }

  /**
   * Decide an untyped body from its first bytes: no NUL byte and valid UTF-8 means text, and a leading
   * `<!doctype html` or `<html` means HTML. Anything else is binary and refused.
   */
  static sniff(bytes: Uint8Array): 'html' | 'text' | undefined {
    const head = bytes.subarray(0, SNIFF_BYTES)
    if (head.includes(0)) return undefined
    let text: string
    try {
      // A multi-byte sequence cut at the sniff boundary is not a decoding failure.
      text = new TextDecoder('utf-8', { fatal: true }).decode(head, { stream: head.length < bytes.length })
    } catch {
      return undefined
    }
    return /^\s*(?:<!doctype\s+html|<html[\s>])/iu.test(text) ? 'html' : 'text'
  }

  static parseCharset(contentType: string | null): string | undefined {
    return /;\s*charset\s*=\s*"?([^";]+)"?/iu
      .exec(contentType ?? '')?.[1]
      ?.trim()
      .toLowerCase()
  }

  static decoderFor(charset: string | undefined): TextDecoder {
    if (charset === undefined) return new TextDecoder('utf-8')
    try {
      return new TextDecoder(charset)
    } catch (cause) {
      throw new WebError(`unsupported charset "${charset}"`, 'WEB_UNSUPPORTED_CONTENT_TYPE', { cause })
    }
  }

  static isRedirect(status: number): boolean {
    return status === 301 || status === 302 || status === 303 || status === 307 || status === 308
  }
}
