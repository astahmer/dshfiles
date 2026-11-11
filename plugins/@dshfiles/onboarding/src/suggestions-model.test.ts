import { describe, expect, it } from 'vitest'
import { FEATURE_CATALOG } from './generated/feature-catalog.js'
import { SUGGESTION_RULES, SuggestionsModel, type UsageSignals } from './suggestions-model.js'

const signals = (input: Partial<UsageSignals>): UsageSignals => ({
  tools: new Map(),
  commands: new Map(),
  toolErrors: 0,
  turns: 0,
  longestThreadRequests: 0,
  compactionRequests: 0,
  ...input,
})

const rulesOf = (value: UsageSignals): readonly string[] => SuggestionsModel.suggest({ catalog: FEATURE_CATALOG, signals: value }).map(entry => entry.rule)

describe('the suggestion rules table', () => {
  it('names only catalogued features, each once per rule id, with a threshold and one sentence why', () => {
    const keys = new Set(FEATURE_CATALOG.features.map(feature => feature.key))
    expect(SUGGESTION_RULES.filter(rule => !keys.has(rule.feature)).map(rule => rule.feature)).toEqual([])
    expect(new Set(SUGGESTION_RULES.map(rule => rule.id)).size).toBe(SUGGESTION_RULES.length)
    for (const rule of SUGGESTION_RULES) {
      expect(rule.threshold).toBeGreaterThan(0)
      expect(rule.why).toMatch(/^[A-Z][^]*\.$/u)
      expect(rule.why.split(/\.\s/u)).toHaveLength(1)
    }
  })

  it('suggests nothing without usage', () => {
    expect(rulesOf(signals({}))).toEqual([])
  })

  it('suggests thread workspaces from many jj commands, and stops once a thread-workspace tool ran', () => {
    expect(rulesOf(signals({ commands: new Map([['jj', 19]]) }))).toEqual([])
    expect(rulesOf(signals({ commands: new Map([['jj', 20]]) }))).toEqual(['jj-without-thread-workspaces'])
    expect(rulesOf(signals({ commands: new Map([['jj', 50]]) }))).toEqual(['jj-without-thread-workspaces', 'jj-without-revision-graph'])
    expect(rulesOf(signals({ commands: new Map([['jj', 50]]), tools: new Map([['jj_thread_isolate', 1]]) }))).toEqual(['jj-without-revision-graph'])
    expect(
      rulesOf(
        signals({
          commands: new Map([['jj', 50]]),
          tools: new Map([
            ['jj_thread_isolate', 1],
            ['jj_load', 3],
          ]),
        }),
      ),
    ).toEqual([])
  })

  it('suggests the compaction meter for long threads only while nothing compacted', () => {
    expect(rulesOf(signals({ longestThreadRequests: 150 }))).toEqual(['long-threads-without-compaction'])
    expect(rulesOf(signals({ longestThreadRequests: 150, compactionRequests: 1 }))).toEqual([])
  })

  it('covers gh, plans, failing tools and long histories', () => {
    expect(rulesOf(signals({ commands: new Map([['gh', 10]]) }))).toEqual(['gh-without-pull-requests'])
    expect(rulesOf(signals({ commands: new Map([['gh', 10]]), tools: new Map([['pull_request_create', 1]]) }))).toEqual([])
    expect(rulesOf(signals({ tools: new Map([['todo_write', 30]]) }))).toEqual(['plans-without-backlog'])
    expect(
      rulesOf(
        signals({
          tools: new Map([
            ['todo_write', 30],
            ['backlog_capture', 2],
          ]),
        }),
      ),
    ).toEqual([])
    expect(rulesOf(signals({ toolErrors: 25 }))).toEqual(['failing-tools-without-traces'])
    expect(rulesOf(signals({ toolErrors: 25, tools: new Map([['traces_search', 1]]) }))).toEqual([])
    expect(rulesOf(signals({ turns: 200 }))).toEqual(['many-turns-without-memory'])
    expect(rulesOf(signals({ turns: 200, tools: new Map([['memory_search', 1]]) }))).toEqual([])
  })

  it('carries the feature row, so a suggestion links to its gallery row and Show me where', () => {
    const [first] = SuggestionsModel.suggest({ catalog: FEATURE_CATALOG, signals: signals({ commands: new Map([['jj', 84]]) }) })
    expect(first).toMatchObject({
      rule: 'jj-without-thread-workspaces',
      evidence: '84 jj commands, no thread workspace yet',
      feature: { key: 'jj-integration#thread-destination', plugin: 'jj-integration' },
    })
  })
})

describe('usage signals', () => {
  it('keep tool names without provider prefixes and only the executable of each command', () => {
    const value = SuggestionsModel.signalsOf({
      activity: {
        tools: [
          { name: 'mcp__dsh__bash', calls: 4, errors: 1 },
          { name: 'bash', calls: 6, errors: 2 },
          { name: 'functions.jj_thread_isolate', calls: 1, errors: 0 },
        ],
        commandDistribution: [
          { command: 'jj log', calls: 12 },
          { command: 'jj st', calls: 9 },
          { command: 'gh', calls: 2 },
        ],
        totals: undefined,
      },
      charts: {
        summary: { turns: 40 },
        breakdown: { purpose: [{ key: 'compaction', requests: 3 }] },
        topThreads: [{ requests: 12 }, { requests: 180 }],
      },
    })
    expect([...value.tools]).toEqual([
      ['bash', 10],
      ['jj_thread_isolate', 1],
    ])
    expect([...value.commands]).toEqual([
      ['jj', 21],
      ['gh', 2],
    ])
    expect(value).toMatchObject({ toolErrors: 3, turns: 40, longestThreadRequests: 180, compactionRequests: 3 })
  })
})

describe('render', () => {
  it('says why there is nothing, and lists each suggestion with its counts', () => {
    expect(SuggestionsModel.render({ state: 'ready', days: 30, suggestions: [] })).toContain('No suggestion')
    expect(SuggestionsModel.render({ state: 'no-usage', reason: 'Usage is off.' })).toBe('Usage suggestions: Usage is off.')
    const suggestions = SuggestionsModel.suggest({ catalog: FEATURE_CATALOG, signals: signals({ commands: new Map([['gh', 12]]) }) })
    expect(SuggestionsModel.render({ state: 'ready', days: 30, suggestions })).toContain('(pull-requests#github-pull-request-create) — 12 gh commands')
  })
})
