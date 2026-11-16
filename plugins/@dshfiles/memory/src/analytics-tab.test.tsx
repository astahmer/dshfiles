import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AnalyticsTab } from './analytics-tab.tsx'
import type { MemoryUsage } from './api.ts'

const usage = (overrides: Partial<MemoryUsage> = {}): MemoryUsage => ({
  state: 'ready',
  failure: null,
  retrieval: { requested: 'bm25', active: 'bm25', model: null, reason: null },
  threads: 0,
  notes: 0,
  indexedMessages: 0,
  blocksServed: 0,
  citations: 0,
  digests: { trail: 0, model: 0, duplicate: 0, trivial: 0, modelFailures: 0 },
  jev: { calls: 0, inputTokens: 0, failures: 0 },
  tools: [],
  costs: { days: [], total: { digest: { calls: 0, input: 0, cacheRead: 0, output: 0, usd: 0 }, jev: { calls: 0, input: 0, usd: 0 } } },
  effectiveness: {
    block: { threads: 0, meanBytes: 0, maxBytes: 0, requests: 0 },
    citations: { total: 0, agentCorrected: 0, userCorrected: 0, up: 0, down: 0 },
  },
  noteCounts: { active: 0, superseded: 0, forgotten: 0, archived: 0 },
  daily: [],
  events: [],
  topNotes: [],
  ...overrides,
})
const noop = (): void => undefined
const render = (value: MemoryUsage): string =>
  renderToStaticMarkup(<AnalyticsTab days={30} onDaysChange={noop} openNote={noop} openThread={noop} project={undefined} usage={value} />)

describe('memory analytics with little to report', () => {
  it('says one sentence and draws no stat tile, icon tile or empty chart', () => {
    const markup = render(usage())
    expect(markup).toContain('Nothing recorded yet.')
    expect(markup).not.toContain('Memory is active')
    for (const label of ['Digest calls', 'Jev calls', 'User corrections', 'Start blocks', 'Model requests']) expect(markup).not.toContain(label)
    for (const empty of ['Digest activity', 'Retrieval outcomes', 'Cost over time', 'Recall', 'Correctness', 'Recent events', 'Top memories'])
      expect(markup).not.toContain(empty)
    expect(markup).not.toMatch(/dshx:bg-(info|warning|violet|success|teal|primary)\/10/u)
    expect(markup).not.toMatch(/memory_(search|read)/u)
  })
  it('lists only the counters that are not zero, in a plain table', () => {
    const markup = render(usage({ digests: { trail: 2, model: 0, duplicate: 0, trivial: 0, modelFailures: 0 } }))
    expect(markup).toContain('2 digests; nothing recalled yet.')
    expect(markup).toMatch(/<th[^>]*>Digest calls<\/th><td[^>]*>2<\/td>/u)
    for (const label of ['Jev calls', 'Searches', 'Reads', 'Citations', 'Start blocks']) expect(markup).not.toContain(`>${label}</th>`)
    expect(markup).not.toMatch(/dshx:bg-(info|warning|violet|success|teal|primary)\/10/u)
  })
  it('names a state that needs the user instead of a healthy one', () => {
    expect(render(usage({ state: 'off' }))).toContain('Memory is off.')
  })
})
