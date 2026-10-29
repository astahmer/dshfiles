import { existsSync } from 'node:fs'
import { homedir, userInfo } from 'node:os'
import { chromium, type Browser, type BrowserContext, type Locator, type Page, type Route } from 'playwright-core'
import { z } from 'zod'
import { withSpan } from '@dshfiles/dshx/tracing'
import type { PreviewSettings } from './settings.js'
import { checkPreviewUrl } from './url-policy.js'

const NAVIGATION_TIMEOUT_MS = 30_000
const ACTION_TIMEOUT_MS = 8_000
const SNAPSHOT_TIMEOUT_MS = 10_000
const VIEWPORT = { width: 1280, height: 800 } as const
const MAX_EVALUATE_CHARS = 8_000

export interface PreviewPageSummary {
  readonly pageId: string
  readonly url: string
  readonly title: string
  readonly openedAt: number
  readonly revealRequestedAt: number | null
}

export interface ActionTarget {
  readonly ref?: string | undefined
  readonly selector?: string | undefined
}

interface PreviewPage {
  readonly id: string
  readonly page: Page
  readonly openedAt: number
  revealRequestedAt: number | null
}

interface ThreadBrowser {
  readonly context: BrowserContext
  readonly pages: Map<string, PreviewPage>
  nextPage: number
  idleTimer: NodeJS.Timeout | undefined
}

export class PreviewError extends Error {
  override readonly name = 'PreviewError'
}

const aiSnapshotSchema = z.union([z.string(), z.object({ full: z.string() }).transform(value => value.full)])
const aiSnapshotOwnerSchema = z.object({
  _snapshotForAI: z.custom<(options: { readonly timeout: number }) => Promise<z.input<typeof aiSnapshotSchema>>>(value => typeof value === 'function'),
})

/**
 * playwright-core keeps the ref-producing snapshot that playwright-mcp uses off its public types; its `[ref=e5]` marks
 * resolve through the `aria-ref=` selector. The public aria snapshot is the fallback when a release drops it.
 */
const snapshotWithRefs = async (page: Page): Promise<{ readonly text: string; readonly refs: boolean }> => {
  const owner = aiSnapshotOwnerSchema.safeParse(page)
  if (owner.success) {
    const parsed = aiSnapshotSchema.safeParse(await owner.data._snapshotForAI.call(page, { timeout: SNAPSHOT_TIMEOUT_MS }))
    if (parsed.success) return { text: parsed.data, refs: true }
  }
  return { text: await page.locator('body').ariaSnapshot({ timeout: SNAPSHOT_TIMEOUT_MS }), refs: false }
}

const bounded = (text: string, maxChars: number): { readonly text: string; readonly truncated: boolean } =>
  text.length <= maxChars
    ? { text, truncated: false }
    : { text: `${text.slice(0, maxChars)}\n[snapshot truncated at ${String(maxChars)} characters]`, truncated: true }

const MISSING_EXECUTABLE = /Executable doesn't exist at (\S+)/

/**
 * Playwright looks for its browsers under `$HOME`. A launcher or scratch harness that rewrites HOME hides the cache the
 * account installed, so the same path under the account's own home is tried once.
 */
const accountHomeExecutable = (error: unknown): string | undefined => {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH !== undefined || !(error instanceof Error)) return undefined
  const missing = MISSING_EXECUTABLE.exec(error.message)?.[1]
  const accountHome = userInfo().homedir
  if (missing === undefined || accountHome === homedir() || !missing.startsWith(`${homedir()}/`)) return undefined
  const relocated = `${accountHome}${missing.slice(homedir().length)}`
  return existsSync(relocated) ? relocated : undefined
}

const launchChromium = async (configuredPath: string): Promise<Browser> => {
  if (configuredPath !== '') return chromium.launch({ headless: true, executablePath: configuredPath })
  try {
    return await chromium.launch({ headless: true })
  } catch (error) {
    const relocated = accountHomeExecutable(error)
    if (relocated === undefined) throw error
    return chromium.launch({ headless: true, executablePath: relocated })
  }
}

const pageSpan = <Result>(name: string, pageId: string | undefined, run: () => Promise<Result>): Promise<Result> =>
  withSpan(name, { kind: 'client', attributes: pageId === undefined ? {} : { 'dshx.preview.page': pageId } }, run)

/** One headless Chromium for the Host, one isolated browser context per thread, closed when the thread goes idle or away. */
export class PreviewBrowsers {
  readonly #settings: () => PreviewSettings
  readonly #threads = new Map<string, ThreadBrowser>()
  #browser: Promise<Browser> | undefined

  constructor(input: { readonly settings: () => PreviewSettings }) {
    this.#settings = input.settings
  }

  #launch(): Promise<Browser> {
    if (this.#browser !== undefined) return this.#browser
    const executablePath = this.#settings().chromiumPath.trim()
    const launching = withSpan(
      'preview launch',
      { kind: 'client', attributes: { 'process.executable.name': executablePath === '' ? 'chromium-headless-shell' : 'chromium' } },
      () => launchChromium(executablePath),
    )
    const browser = launching.then(
      launched => {
        launched.on('disconnected', () => {
          if (this.#browser === browser) this.#browser = undefined
          this.#threads.clear()
        })
        return launched
      },
      (error: unknown) => {
        this.#browser = undefined
        const detail = error instanceof Error ? error.message.split('\n')[0] : String(error)
        throw new PreviewError(
          `The preview browser could not start (${detail ?? 'unknown error'}). Install it with \`pnpm --dir plugins/@dshfiles/preview exec playwright-core install chromium-headless-shell\` from the dshfiles checkout, or set Settings › dshfiles-preview › chromiumPath to an installed Chrome or Chromium.`,
        )
      },
    )
    this.#browser = browser
    return browser
  }

  #guard(route: Route): Promise<void> {
    const request = route.request()
    if (!request.isNavigationRequest() || request.frame().parentFrame() !== null) return route.continue()
    const settings = this.#settings()
    const verdict = checkPreviewUrl({ url: request.url(), allowedHosts: settings.allowedHosts, allowAnyHost: settings.allowAnyHost })
    return verdict.ok ? route.continue() : route.abort('blockedbyclient')
  }

  async #thread(sessionId: string): Promise<ThreadBrowser> {
    const existing = this.#threads.get(sessionId)
    if (existing !== undefined) return existing
    const browser = await this.#launch()
    const raced = this.#threads.get(sessionId)
    if (raced !== undefined) return raced
    const context = await browser.newContext({ viewport: VIEWPORT, acceptDownloads: false, serviceWorkers: 'block' })
    context.setDefaultTimeout(ACTION_TIMEOUT_MS)
    context.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS)
    await context.route('**/*', route => this.#guard(route))
    const thread: ThreadBrowser = { context, pages: new Map(), nextPage: 1, idleTimer: undefined }
    context.on('close', () => {
      if (this.#threads.get(sessionId) === thread) this.#threads.delete(sessionId)
    })
    this.#threads.set(sessionId, thread)
    return thread
  }

  #touch(sessionId: string, thread: ThreadBrowser): void {
    clearTimeout(thread.idleTimer)
    thread.idleTimer = setTimeout(() => void this.closeThread(sessionId), this.#settings().idleMinutes * 60_000)
    thread.idleTimer.unref()
  }

  #page(sessionId: string, pageId: string) {
    const thread = this.#threads.get(sessionId)
    const entry = thread?.pages.get(pageId)
    if (thread === undefined || entry === undefined || entry.page.isClosed())
      throw new PreviewError(`No open preview page ${pageId} in this thread. Call preview_list to see open pages, or preview_open to open one.`)
    this.#touch(sessionId, thread)
    return { thread, entry }
  }

  #checkUrl(url: string): string {
    const settings = this.#settings()
    const verdict = checkPreviewUrl({ url, allowedHosts: settings.allowedHosts, allowAnyHost: settings.allowAnyHost })
    if (!verdict.ok) throw new PreviewError(verdict.reason)
    return verdict.url
  }

  async #summary(entry: PreviewPage): Promise<PreviewPageSummary> {
    const title = await entry.page.title().catch(() => '')
    return { pageId: entry.id, url: entry.page.url(), title: title.slice(0, 300), openedAt: entry.openedAt, revealRequestedAt: entry.revealRequestedAt }
  }

  #locator(page: Page, target: ActionTarget): Locator {
    if (target.ref !== undefined) return page.locator(`aria-ref=${target.ref}`)
    if (target.selector !== undefined) return page.locator(target.selector)
    throw new PreviewError('Pass either ref (from preview_snapshot) or selector.')
  }

  async #navigationResult(entry: PreviewPage, response: { status(): number } | null): Promise<PreviewPageSummary & { readonly status: number | null }> {
    return { ...(await this.#summary(entry)), status: response?.status() ?? null }
  }

  open(input: { readonly sessionId: string; readonly url: string; readonly reveal: boolean }) {
    const url = this.#checkUrl(input.url)
    return pageSpan('preview open', undefined, async () => {
      const thread = await this.#thread(input.sessionId)
      const live = [...thread.pages.values()].filter(entry => !entry.page.isClosed())
      const limit = this.#settings().maxPagesPerThread
      if (live.length >= limit)
        throw new PreviewError(`This thread already has ${String(limit)} preview pages open. Close one with preview_close, or reuse it with preview_navigate.`)
      const page = await thread.context.newPage()
      const entry: PreviewPage = { id: `p${String(thread.nextPage++)}`, page, openedAt: Date.now(), revealRequestedAt: input.reveal ? Date.now() : null }
      thread.pages.set(entry.id, entry)
      page.on('close', () => thread.pages.delete(entry.id))
      this.#touch(input.sessionId, thread)
      const response = await page.goto(url, { waitUntil: 'domcontentloaded' }).catch((error: unknown) => {
        throw new PreviewError(
          `Opened page ${entry.id}, but loading ${url} failed: ${error instanceof Error ? (error.message.split('\n')[0] ?? '') : String(error)}`,
        )
      })
      return this.#navigationResult(entry, response)
    })
  }

  navigate(input: {
    readonly sessionId: string
    readonly pageId: string
    readonly url?: string | undefined
    readonly action?: 'back' | 'forward' | 'reload' | undefined
  }) {
    const { entry } = this.#page(input.sessionId, input.pageId)
    const url = input.url === undefined ? undefined : this.#checkUrl(input.url)
    return pageSpan('preview navigate', entry.id, async () => {
      const options = { waitUntil: 'domcontentloaded' } as const
      const response =
        url !== undefined
          ? await entry.page.goto(url, options)
          : input.action === 'back'
            ? await entry.page.goBack(options)
            : input.action === 'forward'
              ? await entry.page.goForward(options)
              : await entry.page.reload(options)
      return this.#navigationResult(entry, response)
    })
  }

  revealRequest(input: { readonly sessionId: string; readonly pageId: string }): PreviewPageSummary['revealRequestedAt'] {
    const { entry } = this.#page(input.sessionId, input.pageId)
    entry.revealRequestedAt = Date.now()
    return entry.revealRequestedAt
  }

  snapshot(input: { readonly sessionId: string; readonly pageId: string; readonly maxChars: number }) {
    const { entry } = this.#page(input.sessionId, input.pageId)
    return pageSpan('preview snapshot', entry.id, async () => {
      const snapshot = await snapshotWithRefs(entry.page)
      const text = bounded(snapshot.text, input.maxChars)
      return { ...(await this.#summary(entry)), snapshot: text.text, truncated: text.truncated, refs: snapshot.refs }
    })
  }

  screenshot(input: { readonly sessionId: string; readonly pageId: string; readonly fullPage: boolean }) {
    const { entry } = this.#page(input.sessionId, input.pageId)
    return pageSpan('preview screenshot', entry.id, async () => ({
      summary: await this.#summary(entry),
      image: await entry.page.screenshot({ type: 'jpeg', quality: 75, fullPage: input.fullPage, timeout: SNAPSHOT_TIMEOUT_MS }),
    }))
  }

  click(input: { readonly sessionId: string; readonly pageId: string; readonly target: ActionTarget; readonly doubleClick: boolean }) {
    const { entry } = this.#page(input.sessionId, input.pageId)
    return pageSpan('preview click', entry.id, async () => {
      const locator = this.#locator(entry.page, input.target)
      await (input.doubleClick ? locator.dblclick() : locator.click())
      return this.#summary(entry)
    })
  }

  type(input: { readonly sessionId: string; readonly pageId: string; readonly target: ActionTarget; readonly text: string; readonly submit: boolean }) {
    const { entry } = this.#page(input.sessionId, input.pageId)
    return pageSpan('preview type', entry.id, async () => {
      const locator = this.#locator(entry.page, input.target)
      await locator.fill(input.text)
      if (input.submit) await locator.press('Enter')
      return this.#summary(entry)
    })
  }

  evaluate(input: { readonly sessionId: string; readonly pageId: string; readonly expression: string }) {
    if (!this.#settings().allowEvaluate)
      throw new PreviewError('preview_evaluate is off. The user can turn on Settings › dshfiles-preview › allowEvaluate; until then use preview_snapshot.')
    const { entry } = this.#page(input.sessionId, input.pageId)
    return pageSpan('preview evaluate', entry.id, async () => {
      const value: unknown = await entry.page.evaluate(input.expression)
      const serialized = value === undefined ? 'undefined' : (JSON.stringify(value) ?? String(value))
      const result = bounded(serialized, MAX_EVALUATE_CHARS)
      return { ...(await this.#summary(entry)), result: result.text, truncated: result.truncated }
    })
  }

  async close(input: { readonly sessionId: string; readonly pageId?: string | undefined }): Promise<{ readonly closed: number }> {
    if (input.pageId === undefined) return { closed: await this.closeThread(input.sessionId) }
    const { entry } = this.#page(input.sessionId, input.pageId)
    await pageSpan('preview close', entry.id, () => entry.page.close())
    return { closed: 1 }
  }

  async list(sessionId: string): Promise<PreviewPageSummary[]> {
    const thread = this.#threads.get(sessionId)
    if (thread === undefined) return []
    return Promise.all([...thread.pages.values()].filter(entry => !entry.page.isClosed()).map(entry => this.#summary(entry)))
  }

  async closeThread(sessionId: string): Promise<number> {
    const thread = this.#threads.get(sessionId)
    if (thread === undefined) return 0
    this.#threads.delete(sessionId)
    clearTimeout(thread.idleTimer)
    const count = [...thread.pages.values()].filter(entry => !entry.page.isClosed()).length
    await pageSpan('preview close-thread', undefined, () => thread.context.close()).catch(() => undefined)
    return count
  }

  async dispose(): Promise<void> {
    for (const thread of this.#threads.values()) clearTimeout(thread.idleTimer)
    this.#threads.clear()
    const browser = this.#browser
    this.#browser = undefined
    if (browser !== undefined) await browser.then(launched => launched.close()).catch(() => undefined)
  }
}
