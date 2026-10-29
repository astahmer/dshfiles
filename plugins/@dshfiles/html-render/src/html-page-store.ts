import type { HtmlPage } from './html-page.js'

export const HtmlPageStoreLimits = { maxPagesPerThread: 16, maxTotalBytes: 32 * 1024 * 1024 } as const

interface StoredPage {
  readonly sessionId: string
  readonly callId: string
  readonly page: HtmlPage
  readonly bytes: number
}

/**
 * The pages html_render and html_preview published during this Host run, per thread, so html_render_screenshot can find
 * one by call id without reading the Session log. Bounded per thread and in total; oldest first out.
 */
export class HtmlPageStore {
  readonly #pages: StoredPage[] = []
  #totalBytes = 0

  remember(input: StoredPage): void {
    this.#remove(stored => stored.sessionId === input.sessionId && stored.callId === input.callId)
    this.#pages.push(input)
    this.#totalBytes += input.bytes
    const thread = this.#pages.filter(stored => stored.sessionId === input.sessionId)
    for (const stale of thread.slice(0, Math.max(0, thread.length - HtmlPageStoreLimits.maxPagesPerThread))) this.#remove(stored => stored === stale)
    while (this.#totalBytes > HtmlPageStoreLimits.maxTotalBytes && this.#pages.length > 1) this.#remove(stored => stored === this.#pages[0])
  }

  /** The thread's page for this call id, or its latest page without one. */
  find(input: { readonly sessionId: string; readonly callId?: string | undefined }): { readonly callId: string; readonly page: HtmlPage } | undefined {
    const thread = this.#pages.filter(stored => stored.sessionId === input.sessionId)
    const found = input.callId === undefined ? thread.at(-1) : thread.find(stored => stored.callId === input.callId)
    return found === undefined ? undefined : { callId: found.callId, page: found.page }
  }

  forgetThread(sessionId: string): void {
    this.#remove(stored => stored.sessionId === sessionId)
  }

  #remove(matches: (stored: StoredPage) => boolean): void {
    for (let index = this.#pages.length - 1; index >= 0; index -= 1) {
      const stored = this.#pages[index]
      if (stored === undefined || !matches(stored)) continue
      this.#pages.splice(index, 1)
      this.#totalBytes -= stored.bytes
    }
  }
}
