/**
 * Whether a page can be shown in the Browser tab at all.
 *
 * The Browser tab is the native package's iframe, and an iframe never learns why a cross-origin document stayed out:
 * Chrome draws its own dead grey page, `load` fires, and `error` does not. A page that sends `X-Frame-Options: deny`
 * or a `frame-ancestors` policy is therefore indistinguishable from a stopped dev server. The DSH Host reads those
 * headers before a URL reaches the pane, and this module turns them into one verdict that the dev-server Open and a
 * chat link both act on: open the pane, or fall back to a browser tab with the reason.
 */

/** What the target's framing headers allow. */
export type EmbedFraming = 'allowed' | 'denied'

/** What to do with the URL. */
export type EmbedVerdict =
  /** Load it in the pane. */
  | 'open'
  /** The site refuses to be framed; only a browser tab can show it. */
  | 'refused'
  /** Nothing answered on that origin: the dev server stopped or never bound there. */
  | 'unreachable'
  /** Not checked yet. */
  | 'unknown'

/** The Host's answer for one URL. */
export interface EmbedCheck {
  /** Final address, after redirects when the Host followed them. */
  readonly url: string
  readonly reachable: boolean
  /** HTTP status, or null when the request failed. */
  readonly status: number | null
  readonly framing: EmbedFraming
  /** The header that refused framing, e.g. `X-Frame-Options: deny`, else null. */
  readonly detail: string | null
}

/** What the target's framing headers allow, and the header that refused it. */
export interface FramingVerdict {
  readonly framing: EmbedFraming
  readonly detail: string | null
}

const WEB_PROTOCOLS = new Set(['http:', 'https:'])

/** What the Host decides for one address; `unknown` only exists client-side, before the answer. */
type EmbedDecision = Exclude<EmbedVerdict, 'unknown'>

/** The decisions this module answers: a probe's verdict, the address to probe, and the framing headers' verdict. */
export class EmbedPolicy {
  /** The decision a probe supports; an unreachable target outranks a permissive header, a refusal outranks both. */
  static readonly verdict = (check: EmbedCheck): EmbedDecision => {
    if (check.framing === 'denied') return 'refused'
    if (!check.reachable) return 'unreachable'
    return 'open'
  }

  /** A bare `host:port` reads as http, as the Browser tab's own address bar does. */
  static readonly normalizeProbeUrl = (input: string): string | undefined => {
    const raw = input.trim()
    if (raw === '') return undefined
    const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`
    if (!URL.canParse(candidate)) return undefined
    const parsed = new URL(candidate)
    if (!WEB_PROTOCOLS.has(parsed.protocol)) return undefined
    if (parsed.username !== '' || parsed.password !== '') return undefined
    return parsed.href
  }

  /**
   * Read the two headers that decide whether a page may be framed.
   * @param headers - the target's `X-Frame-Options` and `Content-Security-Policy` values, when present.
   * @returns whether framing is allowed, and the header that refused it.
   */
  static readonly classifyFraming = (headers: {
    readonly xFrameOptions?: string | null | undefined
    readonly contentSecurityPolicy?: string | null | undefined
  }): FramingVerdict => {
    const xFrameOptions = headers.xFrameOptions?.trim().toLowerCase() ?? ''
    // `sameorigin` names the page's own origin, and the pane is always another one; `allow-from` is obsolete.
    if (xFrameOptions !== '' && !xFrameOptions.startsWith('allowall')) return { framing: 'denied', detail: `X-Frame-Options: ${xFrameOptions}` }
    const csp = headers.contentSecurityPolicy ?? ''
    const refused = refusalFromCsp(csp)
    if (refused !== undefined) return { framing: 'denied', detail: refused }
    return { framing: 'allowed', detail: null }
  }
}

/** One `frame-ancestors` directive's source list, lowercased tokens. */
const frameAncestorsSources = (policy: string): readonly string[] | undefined => {
  const directive = /(?:^|;)\s*frame-ancestors([^;]*)/i.exec(policy)
  if (directive === null) return undefined
  return (directive[1] ?? '')
    .trim()
    .split(/\s+/u)
    .filter(token => token !== '')
    .map(token => token.toLowerCase())
}

/** Every policy header applies: one refusing list is a refusal, whatever the others allow. */
const refusalFromCsp = (header: string): string | undefined => {
  for (const policy of header.split(',')) {
    const sources = frameAncestorsSources(policy)
    if (sources === undefined) continue
    if (sources.length === 0 || sources.includes('*')) continue
    return `Content-Security-Policy: frame-ancestors ${sources.join(' ')}`
  }
  return undefined
}
