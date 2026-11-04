import { bench, url } from '@hona/strobe'

const startUrl = process.env.STROBE_BENCH_URL
const largeThreadMarker = 'strobe large history marker'

if (startUrl === undefined) throw new Error('Set STROBE_BENCH_URL to the scratch DSH launch URL.')

type FixtureIds = { a: string; b: string; large: string }
type BrowserLocator = {
  click: (options?: { timeout?: number }) => Promise<void>
  fill: (value: string) => Promise<void>
  first: () => BrowserLocator
  getByRole: (role: string, options: { name: string | RegExp; exact?: boolean }) => BrowserLocator
  isVisible: () => Promise<boolean>
  last: () => BrowserLocator
  locator: (selector: string) => BrowserLocator
  press: (key: string) => Promise<void>
  waitFor: (options?: { state?: 'visible' | 'hidden' }) => Promise<void>
}
type BrowserPage = {
  getByRole: BrowserLocator['getByRole']
  goto: (url: string) => Promise<unknown>
  locator: BrowserLocator['locator']
  url: () => string
  waitForFunction: (fn: (before: string | null) => boolean, before: string | null) => Promise<unknown>
}
let fixtureIds: FixtureIds | undefined

const thread = (id: string) => `[data-thread-main-action][data-thread-id=${JSON.stringify(id)}]`
const selectedThread = (id: string) => `${thread(id)}[data-selected="true"]`
const createThread = async (page: BrowserPage, prompt: string) => {
  const previousId = new URL(page.url()).searchParams.get('thread')
  await page.getByRole('button', { name: 'New thread', exact: true }).click()
  await page.waitForFunction((before: string | null) => {
    const current = new URL(window.location.href).searchParams.get('thread')
    return current !== null && current !== before
  }, previousId)
  const id = new URL(page.url()).searchParams.get('thread')
  if (id === null) throw new Error('Scratch thread creation did not produce a Session id.')
  const composer = page.locator('[contenteditable="true"]').last()
  await composer.waitFor({ state: 'visible' })
  await composer.fill(prompt)
  await composer.press('Enter')
  await page.locator(thread(id)).waitFor({ state: 'visible' })
  await page.locator(`[data-conversation-session=${JSON.stringify(id)}] [data-chat-flow]`).waitFor({ state: 'visible' })
  return id
}
const prepareThreads = async ({ playwright }: { playwright: { page: BrowserPage } }) => {
  if (fixtureIds !== undefined) return fixtureIds
  const page = playwright.page
  await page.goto(startUrl)
  const notice = page.getByRole('dialog', { name: 'Preview Notice', exact: true })
  if (await notice.isVisible().catch(() => false)) await notice.getByRole('button', { name: 'Continue', exact: true }).click()
  const setup = page.getByRole('dialog', { name: /^(Add an API key to get started|Get started)$/ })
  if (await setup.isVisible().catch(() => false)) {
    const later = setup.getByRole('button', { name: 'Configure later', exact: true })
    if (await later.isVisible().catch(() => false)) await later.click()
    else await setup.getByRole('button', { name: 'Close', exact: true }).click()
  }
  const selectSampleWorkspace = async () => {
    const chooseWorkspace = page.getByRole('button', { name: 'Choose workspace', exact: true })
    if (!(await chooseWorkspace.isVisible().catch(() => false))) return
    await chooseWorkspace.click()
    const picker = page.getByRole('dialog', { name: 'Choose a project', exact: true })
    await picker
      .getByRole('option', { name: /^sample(?:\s|$)/i })
      .first()
      .click()
    await picker.waitFor({ state: 'hidden' })
  }
  await selectSampleWorkspace()
  const a = await createThread(page, 'Strobe benchmark A')
  const b = await createThread(page, 'Strobe benchmark B')
  const largePrompt = `Strobe benchmark large history\n\n${largeThreadMarker}\n\n${'synthetic scratch-only history content '.repeat(13_000)}`
  const large = await createThread(page, largePrompt)
  fixtureIds = { a, b, large }
  return fixtureIds
}
const sessionComposer = '[aria-label="Message or run a task, / commands, @ files or sessions"]'
const fixtures = (): FixtureIds => {
  if (fixtureIds === undefined) throw new Error('Strobe fixture sessions were not prepared.')
  return fixtureIds
}
const newThreadComposer = '[aria-label="Describe what you want to build, / commands, @ files or sessions"]'

export default bench({
  targets: { dsh: url(startUrl, { viewport: { width: 1440, height: 900 }, prepare: prepareThreads }) },
  cases: {
    'page-load-interactive': {
      primary: 'phase.interactive',
      async run({ page, phase }) {
        await phase('interactive', async () => {
          await page.goto(startUrl)
          await page.waitFor(selectedThread(fixtures().a))
          await page.waitFor(sessionComposer)
        })
      },
    },
    'thread-switch': {
      primary: 'phase.switch',
      metrics: ['net.requests{/api/*}'],
      async run({ page, phase }) {
        const sessionId = fixtures().a
        await phase('switch', async () => {
          await page.click(thread(sessionId), { until: selectedThread(sessionId) })
          await page.waitFor(sessionComposer)
          await page.waitFor('[data-chat-flow] > *')
        })
      },
      reset: async ({ page }) => {
        await page.click(thread(fixtures().b), { until: selectedThread(fixtures().b) })
        await page.waitFor(sessionComposer)
      },
    },
    'new-thread-composer': {
      primary: 'phase.composer',
      async run({ page, phase }) {
        await phase('composer', async () => {
          await page.click({ selector: 'button', text: 'New thread' }, { until: newThreadComposer })
          await page.waitFor(newThreadComposer)
        })
      },
      reset: async ({ page }) => {
        await page.click(thread(fixtures().a), { until: selectedThread(fixtures().a) })
        await page.waitFor(sessionComposer)
      },
    },
    'large-thread-open': {
      primary: 'phase.history',
      async run({ page, phase }) {
        await phase('history', async () => {
          await page.click(thread(fixtures().large), { until: selectedThread(fixtures().large) })
          await page.waitFor({ selector: '[data-chat-flow]', text: largeThreadMarker })
          await page.waitFor(sessionComposer)
        })
      },
      reset: async ({ page }) => {
        await page.click(thread(fixtures().a), { until: selectedThread(fixtures().a) })
        await page.waitFor(sessionComposer)
      },
    },
  },
})
