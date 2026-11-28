import { bench, url } from '@hona/strobe'
import type { Context, Page } from '@hona/strobe'
import { fixtureIds, largeThreadMarker, scratchFixture, shortThreadA, viewport } from './fixtures.ts'

const { launchUrl, stateDir } = scratchFixture()
const { a, b, large } = fixtureIds(stateDir)
const thread = (id: string) => `[data-thread-main-action][data-thread-id=${JSON.stringify(id)}]`
const selectedThread = (id: string) => `${thread(id)}[aria-current="page"]`
// The hover action strip covers the row's center, but not the status glyph on the left.
const threadClickTarget = (id: string) => `${thread(id)} [data-thread-lead]`
const history = (id: string) => `[data-conversation-session=${JSON.stringify(id)}] [data-chat-flow]`
const sessionComposer = '[aria-label="Message or run a task, / commands, @ files or threads"]'
const newThreadComposer = '[aria-label="Describe what you want to build, / commands, @ files or threads"]'
const newThreadButton = 'button[aria-label="New thread"]'
const loadUrl = new URL('/', launchUrl)
loadUrl.searchParams.set('thread', a)

type BenchPage = Pick<Page, 'click' | 'goto' | 'waitFor'>
type Driver = { page: BenchPage; phase: Context<unknown>['phase'] }

async function openThread(page: BenchPage, id: string) {
  await page.click(threadClickTarget(id), { until: selectedThread(id) })
  await page.waitFor(sessionComposer)
}

export async function setup({ page, case: name }: { page: BenchPage; case: string }) {
  // Every Strobe block starts with a new browser profile, but uses the same saved scratch Sessions.
  if (name === 'thread-switch') await openThread(page, b)
  else if (name !== 'page-load-interactive') await openThread(page, a)
}

export const cases = {
  'page-load-interactive': {
    primary: 'phase.interactive',
    async run({ page, phase }: Driver) {
      await phase('interactive', async () => {
        await page.goto(loadUrl.href)
        await page.waitFor(selectedThread(a))
        await page.waitFor(sessionComposer)
      })
    },
  },
  'thread-switch': {
    primary: 'phase.switch',
    metrics: ['net.requests{/api/*}'],
    async run({ page, phase }: Driver) {
      await phase('switch', async () => {
        await openThread(page, a)
        await page.waitFor(history(a), { text: shortThreadA })
      })
    },
    reset: async ({ page }: { page: BenchPage }) => openThread(page, b),
  },
  'new-thread-composer': {
    primary: 'phase.composer',
    async run({ page, phase }: Driver) {
      await phase('composer', async () => {
        await page.click(newThreadButton, { until: newThreadComposer })
        await page.waitFor(newThreadComposer)
      })
    },
    reset: async ({ page }: { page: BenchPage }) => openThread(page, a),
  },
  'large-thread-open': {
    primary: 'phase.history',
    async run({ page, phase }: Driver) {
      await phase('history', async () => {
        await page.click(threadClickTarget(large), { until: selectedThread(large) })
        await page.waitFor(history(large), { text: largeThreadMarker })
        await page.waitFor(sessionComposer)
      })
    },
    reset: async ({ page }: { page: BenchPage }) => openThread(page, a),
  },
}

// Do not use a target prepare hook: Strobe 0.6 connects another CDP client before calling it.
// The standalone seeder owns that work; Strobe only needs its own Chromium driver to run the cases.
export default bench({ targets: { dsh: url(launchUrl, { viewport }) }, setup, cases })
