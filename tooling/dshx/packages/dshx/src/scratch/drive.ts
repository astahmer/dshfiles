import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import type { Browser, Page } from 'playwright'
import { DshxFeatureCatalogSchema, parseReachStep } from '../project/features.js'
import { DSHFILES_ROOT } from '../project/local-bundles.js'
import { StartupDialogs } from '../project/startup-dialogs.js'
import { ScratchSeedRuntime } from './seed.js'
import { ScratchError, ScratchStateRuntime, type ScratchState } from './state.js'

export interface CatalogFeature {
  readonly packageId: string
  readonly catalogFile: string
  readonly id: string
  readonly title: string
  readonly reach?: readonly string[]
}

const catalogFeatures = async (): Promise<CatalogFeature[]> => {
  const pluginsRoot = join(DSHFILES_ROOT, 'plugins/@dshfiles')
  const features: CatalogFeature[] = []
  for (const entry of await readdir(pluginsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const catalogFile = join(pluginsRoot, entry.name, 'dshx.features.json')
    const source = await readFile(catalogFile, 'utf8').catch(() => undefined)
    if (source === undefined) continue
    const catalog = DshxFeatureCatalogSchema.safeParse(JSON.parse(source))
    if (!catalog.success) continue
    for (const feature of catalog.data.features) {
      features.push({
        packageId: `@dshfiles/${entry.name}`,
        catalogFile,
        id: feature.id,
        title: feature.title,
        ...(feature.reach === undefined ? {} : { reach: feature.reach }),
      })
    }
  }
  return features
}

/** `<feature-id>`, `<plugin>/<feature-id>` or `@dshfiles/<plugin>#<feature-id>`. */
const findCatalogFeature = async (reference: string): Promise<CatalogFeature> => {
  const features = await catalogFeatures()
  const match = /^(?:@dshfiles\/)?(?:([a-z0-9-]+)[/#])?([a-z0-9][a-z0-9-]*)$/.exec(reference)
  const plugin = match?.[1]
  const featureId = match?.[2]
  const candidates = features.filter(feature => feature.id === featureId && (plugin === undefined || feature.packageId === `@dshfiles/${plugin}`))
  if (candidates.length === 1 && candidates[0] !== undefined) return candidates[0]
  if (candidates.length > 1) {
    throw new ScratchError(
      'ambiguous-feature',
      `"${reference}" names ${candidates.length} features.`,
      `Qualify it: ${candidates.map(feature => `${feature.packageId.slice('@dshfiles/'.length)}/${feature.id}`).join(', ')}.`,
    )
  }
  const reachable = features.filter(feature => feature.reach !== undefined).map(feature => `${feature.packageId.slice('@dshfiles/'.length)}/${feature.id}`)
  throw new ScratchError('unknown-feature', `No catalog feature matches "${reference}".`, `Features with reach steps: ${reachable.join(', ')}.`)
}

const connect = async (state: ScratchState): Promise<{ readonly browser: Browser; readonly page: Page }> => {
  if (ScratchStateRuntime.ownedProcessStatus(state.browser) !== 'running') {
    throw new ScratchError('browser-down', 'The scratch Chromium is not running.', 'Run "dshx dev down" then "dshx dev up".')
  }
  const { chromium } = await import('playwright')
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${state.browser.cdpPort}`)
  const context = browser.contexts()[0]
  if (context === undefined)
    throw new ScratchError('browser-context', 'The scratch Chromium has no browser context.', 'Run "dshx dev down" then "dshx dev up".')
  const page = context.pages()[0] ?? (await context.newPage())
  return { browser, page }
}

/** A reach `attach` names a file under the repository root; anything that resolves outside it is refused. */
const repositoryFile = (file: string): string => {
  const path = resolve(DSHFILES_ROOT, file)
  const inside = relative(DSHFILES_ROOT, path)
  if (inside.startsWith('..') || inside === '') throw new Error(`attach "${file}" is outside the repository`)
  return path
}

/** Names match exactly; a trailing `*` matches a case-insensitive substring (for names that carry a path or count). */
const locate = (page: Page, by: string, rawName: string) => {
  const exact = !rawName.endsWith('*')
  const name = exact ? rawName : rawName.slice(0, -1)
  if (by === 'text') return page.getByText(name, { exact }).first()
  if (by === 'label') return page.getByLabel(name, { exact }).first()
  if (by === 'title') return page.getByTitle(name, { exact }).first()
  // SAFETY: the catalog grammar admits any lowercase word; Playwright rejects an unknown ARIA role at run time.
  return page.getByRole(by as Parameters<Page['getByRole']>[0], { name, exact }).first()
}

export interface OpenStepResult {
  readonly step: string
  readonly ok: boolean
  readonly ms: number
  readonly error?: string
}

export interface OpenResult {
  readonly feature: string
  readonly packageId: string
  readonly catalogFile: string
  readonly steps: readonly OpenStepResult[]
  readonly ok: boolean
  readonly path: string
  readonly failureShot?: string
}

export const scratchOpen = async (state: ScratchState, reference: string, timeoutMs: number): Promise<OpenResult> => {
  const feature = await ScratchFeatureCatalog.find(reference)
  if (feature.reach === undefined) {
    throw new ScratchError(
      'no-reach',
      `${feature.packageId}#${feature.id} has no reach steps.`,
      `Add "reach" to ${feature.catalogFile} (skill maintain-verify-dsh).`,
    )
  }
  if (!state.bundles.includes(feature.packageId)) {
    throw new ScratchError(
      'plugin-not-loaded',
      `${feature.packageId} is not in this scratch DSH.`,
      `Run "dshx dev down" then "dshx dev up --plugin ${feature.packageId}".`,
    )
  }
  const { browser, page } = await connect(state)
  const steps: OpenStepResult[] = []
  const openAppRoot = async (): Promise<void> => {
    await page.goto(state.launchUrl, { waitUntil: 'domcontentloaded' })
    await page.locator('[data-slot="root"]').first().waitFor({ state: 'attached', timeout: timeoutMs })
    await StartupDialogs.dismissPreviewNotice(page, 3_000)
    await StartupDialogs.dismissProviderSetupDuringStartup(page, 3_000)
  }
  try {
    await openAppRoot()
    let seeded = state.seeds ?? []
    let fakeProvider = state.fakeProvider
    // A key press right after fill goes to that field as a locator action, so a dialog that opened in between is dismissed first.
    let filled: ReturnType<typeof locate> | undefined
    for (const [index, step] of feature.reach.entries()) {
      const parsed = parseReachStep(step)
      const startedAt = Date.now()
      try {
        if (parsed === undefined) throw new Error('step does not match the reach grammar')
        await StartupDialogs.dismissProviderSetupIfShown(page)
        if (parsed.action === 'seed') {
          if (!seeded.some(applied => applied.seed === parsed.seed)) {
            const applied: NonNullable<ScratchState['seeds']>[number] = { seed: parsed.seed }
            const outcome = await ScratchSeedRuntime.applySeed({ state, seed: parsed.seed, page, timeoutMs })
            if (outcome.changedFile !== undefined) applied.changedFile = outcome.changedFile
            if (outcome.fakeProvider !== undefined) fakeProvider = outcome.fakeProvider
            seeded = [...seeded, applied]
            const next: ScratchState = { ...state, seeds: seeded }
            if (fakeProvider !== undefined) next.fakeProvider = fakeProvider
            await ScratchStateRuntime.write(next)
          }
          if (feature.reach[index + 1]?.startsWith('seed ') !== true) await openAppRoot()
        } else if (parsed.action === 'attach')
          await page.locator('input[type="file"]').first().setInputFiles(repositoryFile(parsed.file), { timeout: timeoutMs })
        else if (parsed.action === 'press') await (filled === undefined ? page.keyboard.press(parsed.key) : filled.press(parsed.key, { timeout: timeoutMs }))
        else if (parsed.action === 'click') {
          filled = undefined
          await locate(page, parsed.by, parsed.name).click({ timeout: timeoutMs })
        } else if (parsed.action === 'hover') {
          filled = undefined
          await locate(page, parsed.by, parsed.name).hover({ timeout: timeoutMs })
        } else if (parsed.action === 'rightclick') {
          filled = undefined
          // A row that re-renders under the pointer (a new thread, a status change) closes its context menu at once.
          const target = locate(page, parsed.by, parsed.name)
          const deadline = Date.now() + timeoutMs
          for (;;) {
            await target.click({ button: 'right', timeout: timeoutMs })
            const opened = await page
              .getByRole('menu')
              .first()
              .waitFor({ state: 'visible', timeout: 1_500 })
              .then(
                () => true,
                () => false,
              )
            if (opened) break
            if (Date.now() > deadline) throw new Error(`no context menu opened on ${parsed.by} "${parsed.name}"`)
          }
        } else if (parsed.action === 'fill') {
          filled = locate(page, parsed.by, parsed.name)
          const value = parsed.value ?? ''
          // A screen still initialising (the New thread composer) can reset a draft typed into it a moment earlier.
          for (let attempt = 0; attempt < 4; attempt += 1) {
            await filled.fill(value, { timeout: timeoutMs })
            await page.waitForTimeout(400)
            const current = await filled.evaluate(element =>
              element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element.value : (element.textContent ?? ''),
            )
            if (current.includes(value)) break
          }
        } else await locate(page, parsed.by, parsed.name).waitFor({ state: 'visible', timeout: timeoutMs })
        steps.push({ step, ok: true, ms: Date.now() - startedAt })
      } catch (error) {
        steps.push({
          step,
          ok: false,
          ms: Date.now() - startedAt,
          error: ScratchStateRuntime.redactUrls(error instanceof Error ? (error.message.split('\n')[0] ?? error.message) : String(error)),
        })
        break
      }
    }
    const ok = steps.length === feature.reach.length && steps.every(step => step.ok)
    let failureShot: string | undefined
    if (!ok) {
      await mkdir(state.evidenceDir, { recursive: true })
      failureShot = join(state.evidenceDir, `${new Date().toISOString().replaceAll(':', '-')}-open-failed-${feature.id}.png`)
      await page.screenshot({ path: failureShot })
    }
    return {
      feature: feature.id,
      packageId: feature.packageId,
      catalogFile: feature.catalogFile,
      steps,
      ok,
      path: new URL(page.url()).pathname,
      ...(failureShot === undefined ? {} : { failureShot }),
    }
  } finally {
    await browser.close()
  }
}

interface BrowserEvent {
  readonly at: string
  readonly kind: string
  readonly detail: string
}

export interface ShotResult {
  readonly screenshot: string
  readonly summary: string
  readonly path: string
  readonly title: string
  readonly errors: { readonly console: number; readonly page: number; readonly requests: number; readonly http: number }
  readonly warnings: number
  /** Distinct error events, most frequent first, at most 10. */
  readonly topErrors: readonly { readonly kind: string; readonly detail: string; readonly count: number }[]
}

export const scratchShot = async (state: ScratchState, label: string, outDir: string | undefined): Promise<ShotResult> => {
  const directory = outDir ?? state.evidenceDir
  await mkdir(directory, { recursive: true })
  const stamp = new Date().toISOString().replaceAll(':', '-')
  const screenshot = join(directory, `${stamp}-${label}.png`)
  const summaryFile = join(directory, `${stamp}-${label}.json`)
  const { browser, page } = await connect(state)
  let path: string
  let title: string
  try {
    await page.screenshot({ path: screenshot })
    path = new URL(page.url()).pathname
    title = await page.title()
  } finally {
    await browser.close()
  }
  const events = (await readFile(state.browserEvents, 'utf8').catch(() => ''))
    .split('\n')
    .filter(line => line.trim() !== '')
    .map((line): BrowserEvent => JSON.parse(line))
  const count = (kind: string): number => events.filter(event => event.kind === kind).length
  const errorEvents = events.filter(event => event.kind !== 'console.warning')
  const result: ShotResult = {
    screenshot,
    summary: summaryFile,
    path,
    title,
    errors: { console: count('console.error'), page: count('pageerror'), requests: count('requestfailed'), http: count('http') },
    warnings: count('console.warning'),
    topErrors: [
      ...errorEvents
        .reduce((groups, event) => {
          const key = `${event.kind}\u0000${event.detail.slice(0, 300)}`
          groups.set(key, { kind: event.kind, detail: event.detail.slice(0, 300), count: (groups.get(key)?.count ?? 0) + 1 })
          return groups
        }, new Map<string, { kind: string; detail: string; count: number }>())
        .values(),
    ]
      .sort((left, right) => right.count - left.count)
      .slice(0, 10),
  }
  await writeFile(summaryFile, `${JSON.stringify({ ...result, events: errorEvents }, null, 2)}\n`)
  return result
}

export class ScratchFeatureCatalog {
  static readonly list = catalogFeatures
  static readonly find = findCatalogFeature
}
