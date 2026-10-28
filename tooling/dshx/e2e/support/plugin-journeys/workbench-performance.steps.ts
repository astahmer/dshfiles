import { expect, test, type Page, type Request, type Response } from '@playwright/test'
import { After, Before, Then, When } from '../bdd.js'
import { recordAssertion } from '../steps.js'

const INTERACTION_BUDGET_MS = 250
const STABLE_OVERHEAD_MS = 100
const THREAD_TITLES = ['Workbench first conversation', 'Workbench second conversation'] as const

type MeasurementLabel = 'baseline' | 'repeat'
interface FixtureThread {
  id: string
  title: string
  ordinal: number
}
interface BrowserMeasurement {
  startedAtUnixMs: number
  finishedAtUnixMs: number
  latencyMs: number
  settledMs: number
  domNodes: number
  longTasksSupported: boolean
  longTasks: { offsetMs: number; durationMs: number; overlapMs: number }[]
}
interface RpcObservation {
  method: string
  path: string
  offsetMs: number
  durationMs: number | null
  status: number | null
  failed: boolean
  pending: boolean
}
interface SwitchSample extends BrowserMeasurement {
  thread: number
  rpc: RpcObservation[]
}
interface MeasurementRun {
  label: MeasurementLabel
  samples: SwitchSample[]
}
interface PerformanceRun {
  threadIds: string[]
  measurements: MeasurementRun[]
  attached: boolean
}
const runs = new WeakMap<Page, PerformanceRun>()

Before({ tags: '@workbench-performance' }, () => test.setTimeout(90_000))

/** Observe real input and the owned ConversationContent binding; never drive product state from page.evaluate. */
const measureSwitch = async (page: Page, thread: FixtureThread): Promise<BrowserMeasurement> => {
  const row = page.locator(`article[data-thread-id="${thread.id}"] button[data-thread-main-action]`)
  await row.scrollIntoViewIfNeeded()
  const probe = await page.evaluateHandle(
    ({ id, prompt }) => {
      let frame = 0
      let watchdog: number | undefined
      let observer: PerformanceObserver | undefined
      let readyAt: number | undefined
      let readyFrames = 0
      const tasks: PerformanceEntry[] = []
      const supported = PerformanceObserver.supportedEntryTypes.includes('longtask')
      const dispose = () => {
        document.removeEventListener('click', onClick, true)
        cancelAnimationFrame(frame)
        window.clearTimeout(watchdog)
        observer?.disconnect()
      }
      let onClick: (event: MouseEvent) => void
      const complete = new Promise<BrowserMeasurement>((resolve, reject) => {
        onClick = event => {
          const target = event.target
          if (!(target instanceof Element) || target.closest('article[data-thread-id]')?.getAttribute('data-thread-id') !== id) return
          document.removeEventListener('click', onClick, true)
          const startedAt = performance.now()
          if (supported) {
            observer = new PerformanceObserver(list => tasks.push(...list.getEntries()))
            observer.observe({ type: 'longtask' })
          }
          watchdog = window.setTimeout(() => {
            dispose()
            reject(new Error('Sidebar input did not bind visible target history and an editable composer within 5 seconds.'))
          }, 5_000)
          const check = () => {
            const root = [...document.querySelectorAll<HTMLElement>('[data-main-surface] [data-conversation-session]')].find(
              element => element.dataset.conversationSession === id && element.checkVisibility(),
            )
            const editor = root?.querySelector<HTMLElement>('[data-conversation-region="composer"] [role="textbox"]')
            const editable =
              editor !== undefined &&
              editor !== null &&
              editor.checkVisibility() &&
              editor.getAttribute('aria-disabled') !== 'true' &&
              (editor.isContentEditable || (editor instanceof HTMLTextAreaElement && !editor.disabled && !editor.readOnly))
            const history = root?.querySelector('[data-chat-flow]')?.textContent?.includes(prompt) === true
            if (editable && history) {
              readyAt ??= performance.now()
              readyFrames += 1
            } else {
              readyAt = undefined
              readyFrames = 0
            }
            if (readyFrames < 2 || readyAt === undefined) {
              frame = requestAnimationFrame(check)
              return
            }
            const finishedAt = performance.now()
            tasks.push(...(observer?.takeRecords() ?? []))
            const result: BrowserMeasurement = {
              startedAtUnixMs: performance.timeOrigin + startedAt,
              finishedAtUnixMs: performance.timeOrigin + finishedAt,
              latencyMs: readyAt - startedAt,
              settledMs: finishedAt - startedAt,
              domNodes: document.getElementsByTagName('*').length,
              longTasksSupported: supported,
              longTasks: tasks
                .filter(task => task.startTime < finishedAt && task.startTime + task.duration > startedAt)
                .map(task => ({
                  offsetMs: task.startTime - startedAt,
                  durationMs: task.duration,
                  overlapMs: Math.max(0, Math.min(finishedAt, task.startTime + task.duration) - Math.max(startedAt, task.startTime)),
                })),
            }
            dispose()
            resolve(result)
          }
          frame = requestAnimationFrame(check)
        }
        document.addEventListener('click', onClick, true)
      })
      return { complete, dispose }
    },
    { id: thread.id, prompt: thread.title },
  )
  try {
    await row.click({ position: { x: 24, y: 16 }, timeout: 5_000 })
    return await probe.evaluate(async observation => await observation.complete)
  } finally {
    await probe.evaluate(observation => observation.dispose())
    await probe.dispose()
  }
}

const percentile = (values: readonly number[], quantile: number): number => {
  if (values.length === 0) throw new Error('A switch comparison requires nonempty measurements.')
  const sorted = [...values].sort((a, b) => a - b)
  const value = sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)]
  if (value === undefined) throw new Error('No measured value exists at the requested percentile.')
  return value
}
const summary = (samples: readonly SwitchSample[]) => ({
  count: samples.length,
  p50Ms: percentile(
    samples.map(sample => sample.latencyMs),
    0.5,
  ),
  p95Ms: percentile(
    samples.map(sample => sample.latencyMs),
    0.95,
  ),
  maxMs: Math.max(...samples.map(sample => sample.latencyMs)),
  medianDomNodes: percentile(
    samples.map(sample => sample.domNodes),
    0.5,
  ),
})

When('six real sidebar switches are measured for the {string} run', async ({ page }: { page: Page }, label: string) => {
  if (label !== 'baseline' && label !== 'repeat') throw new Error('Unknown Workbench performance label.')
  await expect(page.locator('[data-main-surface="workbench"]')).toBeVisible()
  const threads: FixtureThread[] = []
  for (const [ordinal, title] of THREAD_TITLES.entries()) {
    const row = page.locator('article[data-thread-id]').filter({ has: page.getByText(title, { exact: true }) })
    await expect(row).toHaveCount(1)
    const id = await row.getAttribute('data-thread-id')
    if (id === null) throw new Error('The real fixture row has no Session identity.')
    threads.push({ id, title, ordinal })
  }
  const run: PerformanceRun = runs.get(page) ?? { threadIds: threads.map(thread => thread.id), measurements: [], attached: false }
  runs.set(page, run)
  expect(
    threads.map(thread => thread.id),
    'Both measurements must use the exact same two real Sessions.',
  ).toEqual(run.threadIds)
  expect(
    run.measurements.some(previous => previous.label === label),
    'Each label is sampled once.',
  ).toBe(false)
  const measured: MeasurementRun = { label, samples: [] }
  run.measurements.push(measured)
  const requests: Request[] = []
  const statuses = new Map<Request, number>()
  const request = (entry: Request) => {
    if (new URL(entry.url()).pathname.startsWith('/api/')) requests.push(entry)
  }
  const response = (entry: Response) => statuses.set(entry.request(), entry.status())
  page.on('request', request)
  page.on('response', response)
  try {
    // Equal real-input warmup in both runs of the same unified Workbench; no fixed sleeps or forced product reads.
    for (const thread of threads) await measureSwitch(page, thread)
    for (let cycle = 0; cycle < 3; cycle += 1) {
      for (const thread of threads) {
        const sample = await measureSwitch(page, thread)
        const rpc = requests.flatMap(entry => {
          const timing = entry.timing()
          if (timing.startTime < sample.startedAtUnixMs || timing.startTime > sample.finishedAtUnixMs) return []
          return [
            {
              method: entry.method(),
              path: new URL(entry.url()).pathname,
              offsetMs: timing.startTime - sample.startedAtUnixMs,
              durationMs: timing.responseEnd >= 0 ? timing.responseEnd : null,
              status: statuses.get(entry) ?? null,
              failed: entry.failure() !== null,
              pending: timing.responseEnd < 0,
            },
          ]
        })
        measured.samples.push({ ...sample, thread: thread.ordinal, rpc })
      }
    }
  } finally {
    page.off('request', request)
    page.off('response', response)
  }
})

const attach = async (run: PerformanceRun, complete: boolean): Promise<void> => {
  run.attached = true
  await test.info().attach('workbench-switch-performance.json', {
    contentType: 'application/json',
    body: Buffer.from(
      JSON.stringify(
        {
          scope: 'scratch-only; not a live-Host performance claim',
          renderer: 'workbench',
          comparison: 'baseline and repeat runs of the same renderer, not a native/Workbench comparison',
          complete,
          budgetMs: INTERACTION_BUDGET_MS,
          methodology:
            'Same unified Workbench and two real Sessions; baseline and repeat labels are measurement runs, not renderer modes; equal two-switch warmup; three measured roundtrips per run; browser capture-click to first bound, editable history frame, confirmed across two frames. Nearest-rank percentiles; six samples are descriptive, not a production SLO.',
          limitations:
            'HTTP /api requests only, no bodies, query strings, origins or credentials. Pending requests are explicit; WebSocket RPC frames and Host event-loop/CPU attribution require the separate live audit.',
          measurements: run.measurements.map(label => ({
            label: label.label,
            summary: label.samples.length > 0 ? summary(label.samples) : null,
            samples: label.samples.map(sample => ({
              ...sample,
              budgetExceeded: sample.latencyMs > INTERACTION_BUDGET_MS,
              slowRpc: sample.rpc.filter(rpc => rpc.durationMs !== null && rpc.durationMs > INTERACTION_BUDGET_MS),
              attribution: {
                observedSignals: [
                  ...(sample.longTasks.length > 0 ? ['browser-main-thread-longtasks'] : []),
                  ...(sample.rpc.some(rpc => rpc.durationMs !== null && rpc.durationMs > INTERACTION_BUDGET_MS) ? ['slow-http-rpc'] : []),
                  ...(sample.rpc.some(rpc => rpc.pending) ? ['http-rpc-pending-at-ready'] : []),
                ],
                unexplainedByLongTasksMs: Math.max(0, sample.latencyMs - sample.longTasks.reduce((sum, task) => sum + task.overlapMs, 0)),
                causalAttribution: 'Signals are observations, not causal proof; unexplained over-budget time needs the live Host/network/CPU audit.',
              },
            })),
          })),
        },
        null,
        2,
      ),
    ),
  })
}

Then('the scratch Workbench switch comparison is attached and has no stable regression', async ({ page }: { page: Page }) => {
  const run = runs.get(page)
  if (run === undefined) throw new Error('No real sidebar switch measurements were collected.')
  await attach(run, true)
  await recordAssertion(page, 'workbench-switch-performance-relative-and-absolute-budget', async () => {
    const baseline = run.measurements.find(label => label.label === 'baseline')
    const repeat = run.measurements.find(label => label.label === 'repeat')
    if (baseline === undefined || repeat === undefined) throw new Error('Both label measurements are required.')
    expect(baseline.samples).toHaveLength(6)
    expect(repeat.samples).toHaveLength(6)
    expect([...baseline.samples, ...repeat.samples].every(sample => sample.longTasksSupported)).toBe(true)
    const perThreadOverhead = THREAD_TITLES.map((_, ordinal) => {
      const before = baseline.samples.filter(sample => sample.thread === ordinal)
      const after = repeat.samples.filter(sample => sample.thread === ordinal)
      expect(
        percentile(
          after.map(sample => sample.domNodes),
          0.5,
        ),
        'The repeat run must not double whole-document DOM for the same Workbench two-thread fixture.',
      ).toBeLessThan(
        percentile(
          before.map(sample => sample.domNodes),
          0.5,
        ) * 2,
      )
      return (
        percentile(
          after.map(sample => sample.latencyMs),
          0.5,
        ) -
        percentile(
          before.map(sample => sample.latencyMs),
          0.5,
        )
      )
    })
    expect(
      perThreadOverhead.every(delta => delta > STABLE_OVERHEAD_MS),
      'Both threads show a stable median increase above 100ms in the repeated Workbench run.',
    ).toBe(false)
    if (summary(baseline.samples).p95Ms <= INTERACTION_BUDGET_MS) {
      expect(
        summary(repeat.samples).p50Ms,
        'With a healthy baseline run, typical repeated Workbench input must stay within the 250ms budget.',
      ).toBeLessThanOrEqual(INTERACTION_BUDGET_MS)
    }
  })
})

After({ tags: '@workbench-performance' }, async ({ page }: { page: Page }) => {
  const run = runs.get(page)
  if (run !== undefined && !run.attached) await attach(run, false)
  runs.delete(page)
})
