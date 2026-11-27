/**
 * dshfiles: a chat link the Browser tab cannot show, decided before the dead grey page appears.
 *
 * The pane is an iframe, and an iframe never learns why a cross-origin document stayed out: `load` fires, `error` does
 * not, and Chrome draws its own blank page. `@dshfiles/preview`'s Host half reads the target's framing headers, so Chat
 * asks it by registered identity (the same way it reaches session-search) and falls back:
 *
 * - a link already known to refuse embedding opens in a browser tab, in the click's own gesture;
 * - a link opened in the pane is checked right after, and a refusal says so in a toast whose action opens the tab.
 *
 * Without `@dshfiles/preview` (or its Host half), nothing changes: the pane takes the link as before.
 */
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'

const embedCheckSchema = Schema.Struct({
  url: Schema.String,
  reachable: Schema.Boolean,
  status: Schema.NullOr(Schema.Number),
  framing: Schema.Literals(['allowed', 'denied']),
  verdict: Schema.Literals(['open', 'refused', 'unreachable']),
  detail: Schema.NullOr(Schema.String),
})

/** What preview's `probeEmbed` answers. */
export type LinkEmbedCheck = typeof embedCheckSchema.Type

/** preview's registered identity; a caller never imports the contract it calls. */
export const PREVIEW_PROBE_API = { owner: '@dshfiles/preview', id: 'preview', version: 1, methods: ['probeEmbed'] } as const

/** One answer stays usable this long: a dev server restarted or stopped in between must be asked again. */
export const LINK_EMBED_TTL_MS = 60_000

const LINK_EMBED_LIMIT = 100

const decodeCheck = (raw: unknown): LinkEmbedCheck | undefined => Option.getOrUndefined(Schema.decodeUnknownOption(embedCheckSchema)(raw))

/** The Host call Chat supplies, decoded at Chat's boundary. */
export type LinkEmbedProbe = (url: string) => Promise<LinkEmbedCheck | undefined>

/** What Chat reads and acts on. */
export interface LinkEmbedPortHandle {
  /** True when the last answer says the pane can never show this address. */
  readonly refused: (url: string) => boolean
  /** Ask about a URL without waiting; the answer is cached for the next click. */
  readonly warm: (url: string) => void
  /**
   * Check a URL whose page is about to open in the pane or in a tab.
   * @returns the answer, or undefined when the Host cannot be asked.
   */
  readonly check: (url: string) => Promise<LinkEmbedCheck | undefined>
  /** After the pane took the URL, report a refusal so the user learns why the page stayed blank. */
  readonly sayIfRefused: (url: string) => void
}

/** What a toast says about one refused or dead link. */
export interface LinkEmbedMessage {
  readonly title: string
  readonly description: string
}

export const linkEmbedMessage = (check: LinkEmbedCheck): LinkEmbedMessage => {
  const host = URL.canParse(check.url) ? new URL(check.url).host : check.url
  if (check.verdict === 'refused')
    return {
      title: `${host} refuses to be embedded`,
      description: `${check.detail ?? 'The site forbids framing.'} The Browser tab can only show a blank page for it; open it in a browser tab instead.`,
    }
  return {
    title: `Nothing answers at ${host}`,
    description: 'The dev server has probably stopped. Start it again, then open the link.',
  }
}

class LinkEmbedMemory {
  readonly #byUrl = new Map<string, { readonly check: LinkEmbedCheck; readonly at: number }>()
  readonly #inflight = new Map<string, Promise<LinkEmbedCheck | undefined>>()

  get(url: string): LinkEmbedCheck | undefined {
    const cached = this.#byUrl.get(url)
    if (cached === undefined) return undefined
    if (Date.now() - cached.at > LINK_EMBED_TTL_MS) {
      this.#byUrl.delete(url)
      return undefined
    }
    return cached.check
  }

  remember(url: string, check: LinkEmbedCheck): void {
    this.#byUrl.delete(url)
    this.#byUrl.set(url, { check, at: Date.now() })
    while (this.#byUrl.size > LINK_EMBED_LIMIT) {
      const oldest = this.#byUrl.keys().next()
      if (oldest.done === true) return
      this.#byUrl.delete(oldest.value)
    }
  }

  /** Share one Host request between callers; every later click reads the cache. */
  ask(url: string, probe: LinkEmbedProbe): Promise<LinkEmbedCheck | undefined> {
    const known = this.get(url)
    if (known !== undefined) return Promise.resolve(known)
    const running = this.#inflight.get(url)
    if (running !== undefined) return running
    const request = probe(url)
      .then(check => {
        if (check !== undefined) this.remember(url, check)
        return check
      })
      .catch(() => undefined)
      .finally(() => {
        this.#inflight.delete(url)
      })
    this.#inflight.set(url, request)
    return request
  }

  clear(): void {
    this.#byUrl.clear()
    this.#inflight.clear()
  }
}

/**
 * Build the port Chat's link handling reads.
 * @param input - the Host probe, the toast surface Chat already has, and the tab opener.
 */
export const createLinkEmbedPort = (input: {
  readonly probe: LinkEmbedProbe
  readonly toast: (toast: {
    readonly title: string
    readonly description: string
    readonly tone: 'warning'
    readonly action: { readonly label: string; readonly run: () => void }
  }) => void
  readonly openInNewTab: (url: string) => void
}): LinkEmbedPortHandle => {
  const memory = new LinkEmbedMemory()
  const say = (url: string, check: LinkEmbedCheck): void => {
    const message = linkEmbedMessage(check)
    input.toast({
      ...message,
      tone: 'warning',
      action: { label: 'Open in browser tab', run: () => input.openInNewTab(url) },
    })
  }
  return {
    refused: url => memory.get(url)?.verdict === 'refused',
    warm: url => {
      void memory.ask(url, input.probe)
    },
    check: url => memory.ask(url, input.probe),
    sayIfRefused: url => {
      const report = async (): Promise<void> => {
        const check = await memory.ask(url, input.probe)
        if (check === undefined || check.verdict === 'open') return
        say(url, check)
      }
      void report()
    },
  }
}

declare global {
  // Set by client-entry, read by Chat's native link handling; the two may load separate copies of this module.
  var __dshfilesChatLinkEmbed: LinkEmbedPortHandle | null | undefined
}

/** The one port Chat's link handling uses; a missing port keeps today's behavior. */
export class LinkEmbedPort {
  static readonly create = createLinkEmbedPort
  static readonly check = decodeCheck

  static readonly set = (port: LinkEmbedPortHandle | null): void => {
    globalThis.__dshfilesChatLinkEmbed = port
  }

  static readonly refused = (url: string): boolean => globalThis.__dshfilesChatLinkEmbed?.refused(url) === true

  static readonly warm = (url: string): void => {
    globalThis.__dshfilesChatLinkEmbed?.warm(url)
  }

  /** Report a pane that stayed blank for a known reason; no-op without the port. */
  static readonly sayIfRefused = (url: string): void => {
    globalThis.__dshfilesChatLinkEmbed?.sayIfRefused(url)
  }
}
