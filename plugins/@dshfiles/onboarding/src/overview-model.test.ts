import { describe, expect, it } from 'vitest'
import type { FeatureCatalog } from './catalog-model.js'
import { FEATURE_CATALOG } from './generated/feature-catalog.js'
import { OnboardingOverview, type ChecklistFacts } from './overview-model.js'

const facts = (overrides: Partial<ChecklistFacts> = {}): ChecklistFacts => ({
  account: { source: 'ai-accounts', saved: 1, connected: 1 },
  projects: [{ path: '/work/app', vcs: 'jj' }],
  github: 'signed-in',
  ...overrides,
})

const states = (item: ReturnType<typeof OnboardingOverview.checklist>) => item.map(entry => [entry.id, entry.state])

describe('setup checklist', () => {
  it('ticks each item from the observed facts', () => {
    expect(states(OnboardingOverview.checklist(facts()))).toEqual([
      ['account', 'done'],
      ['project', 'done'],
      ['repository', 'done'],
      ['github', 'done'],
    ])
  })

  it('leaves each item to do with a fix action, and unknown when the Host cannot tell', () => {
    const todo = OnboardingOverview.checklist(
      facts({ account: { source: 'ai-accounts', saved: 0, connected: 0 }, projects: [{ path: '/work/notes', vcs: null }], github: 'signed-out' }),
    )
    expect(states(todo)).toEqual([
      ['account', 'todo'],
      ['project', 'done'],
      ['repository', 'todo'],
      ['github', 'todo'],
    ])
    expect(todo.find(item => item.id === 'account')?.fix.route).toEqual({ panel: 'ai-accounts' })
    expect(todo.find(item => item.id === 'github')?.fix.shellCommand).toBe('gh auth login')
    expect(todo.find(item => item.id === 'repository')?.detail).toBe('No added project has a .jj or .git folder.')

    const unknown = OnboardingOverview.checklist(facts({ account: null, projects: null, github: 'failed' }))
    expect(states(unknown).map(([, state]) => state)).toEqual(['unknown', 'unknown', 'unknown', 'unknown'])
    expect(OnboardingOverview.checklist(facts({ github: 'missing' })).find(item => item.id === 'github')?.fix.shellCommand).toBe('https://cli.github.com')
    expect(OnboardingOverview.checklist(facts({ github: 'off' })).find(item => item.id === 'github')?.state).toBe('off')
  })

  const account = (value: ChecklistFacts['account']) => OnboardingOverview.checklist(facts({ account: value })).find(item => item.id === 'account')

  it('counts connected AI accounts when AI accounts answers, and says so', () => {
    const file = OnboardingOverview.accountFacts([
      { enabled: true, signedIn: true, state: 'healthy' },
      { enabled: true, signedIn: true, state: 'exhausted' },
      { enabled: false, signedIn: true, state: 'disabled' },
      { enabled: true, signedIn: false, state: 'unconfigured' },
    ])
    expect(file).toEqual({ source: 'ai-accounts', saved: 4, connected: 2 })
    expect(account(file)).toMatchObject({ state: 'done', detail: '2 connected accounts in AI accounts.' })
    expect(account(OnboardingOverview.accountFacts([{ enabled: true, signedIn: false, state: 'unconfigured' }]))).toMatchObject({
      state: 'todo',
      detail: '1 saved account, none connected. Sign one in from AI accounts.',
    })
    expect(account({ source: 'unreadable' })).toMatchObject({ state: 'unknown' })
  })

  it('falls back to provider routes without AI accounts, never calling a route a signed-in account', () => {
    const routes = account({ source: 'providers', routes: 2 })
    expect(routes).toMatchObject({
      state: 'done',
      detail: '2 model providers configured (no account manager installed); whether each holds a working credential is not checked.',
    })
    expect(routes?.detail).not.toMatch(/signed in|connected/u)
    expect(account({ source: 'providers', routes: 0 })).toMatchObject({ state: 'todo' })
  })

  it('reports an empty account file as nothing saved yet', () => {
    expect(OnboardingOverview.accountFacts([])).toEqual({ source: 'ai-accounts', saved: 0, connected: 0 })
    expect(account(OnboardingOverview.accountFacts([]))).toMatchObject({ state: 'todo', detail: 'No AI account is saved yet.' })
  })
})

describe('packs view', () => {
  it('reports each plugin as enabled, disabled or not installed and ticks prerequisites', () => {
    const checklist = OnboardingOverview.checklist(facts({ github: 'signed-out' }))
    const packs = OnboardingOverview.packs({
      catalog: FEATURE_CATALOG,
      states: new Map([
        ['pull-requests', 'enabled'],
        ['pulls-review', 'disabled'],
      ]),
      checklist,
    })
    const github = packs.find(pack => pack.id === 'github')
    expect(github?.plugins.map(plugin => [plugin.name, plugin.state])).toEqual([
      ['pull-requests', 'enabled'],
      ['pulls-review', 'disabled'],
      ['project-automations', 'not-installed'],
    ])
    expect(github?.prerequisites).toEqual([
      { id: 'repository', state: 'done' },
      { id: 'github', state: 'todo' },
    ])
    expect(github?.plugins[0]?.description.length).toBeGreaterThan(0)
    const unknown = OnboardingOverview.packs({ catalog: FEATURE_CATALOG, states: null, checklist: null })
    expect(new Set(unknown.flatMap(pack => pack.plugins.map(plugin => plugin.state)))).toEqual(new Set(['unknown']))
  })
})

const tinyCatalog: FeatureCatalog = {
  schemaVersion: 1,
  generatedFrom: [],
  plugins: [],
  features: [
    {
      key: 'backlog#items',
      plugin: 'backlog',
      id: 'items',
      title: 'Track backlog items',
      summary: 'Tasks and ideas.',
      destination: 'work',
      currentSurface: 'rail: Work › Backlog',
      reach: [
        { text: 'click tab "Work"', action: 'click', by: 'tab', name: 'Work', value: null },
        { text: 'expect heading "Backlog"', action: 'expect', by: 'heading', name: 'Backlog', value: null },
      ],
      onboarding: null,
    },
    {
      key: 'backlog#tool',
      plugin: 'backlog',
      id: 'tool',
      title: 'Backlog agent tools',
      summary: 'Read and write items.',
      destination: 'none',
      currentSurface: null,
      reach: [],
      onboarding: null,
    },
    {
      key: 'btw#side',
      plugin: 'unlisted',
      id: 'side',
      title: 'Side chat',
      summary: 'Ask aside.',
      destination: 'threads',
      currentSurface: null,
      reach: [
        { text: 'seed tool-call-thread', action: 'seed', by: null, name: null, value: 'tool-call-thread' },
        { text: 'expect text "Side"', action: 'expect', by: 'text', name: 'Side', value: null },
      ],
      onboarding: { prerequisites: ['account'], firstAction: 'Type /btw.', doneWhen: 'A side answer shows.', open: { command: '@dshfiles/btw.open' } },
    },
  ],
}

describe('feature search', () => {
  it('lists curated rows first until the user searches, with the bundle route or the block route', () => {
    const curated = OnboardingOverview.features(tinyCatalog, { curatedDefault: true })
    expect(curated.curatedOnly).toBe(true)
    expect(curated.rows.map(row => [row.key, row.route])).toEqual([
      ['btw#side', { command: '@dshfiles/btw.open' }],
      ['backlog#items', { panel: 'dshfiles-backlog-panel' }],
    ])
    expect(curated.rows[0]).toMatchObject({ firstAction: 'Type /btw.', prerequisites: ['account'], walkable: false })
    expect(curated.rows[1]).toMatchObject({ reachSteps: 2, walkable: true })

    const searched = OnboardingOverview.features(tinyCatalog, { query: 'backlog', curatedDefault: true })
    expect(searched.curatedOnly).toBe(false)
    expect(searched.rows.map(row => [row.key, row.route])).toEqual([
      ['backlog#items', { panel: 'dshfiles-backlog-panel' }],
      ['backlog#tool', null],
    ])
  })

  it('narrows by destination, counts by destination and bounds the rows', () => {
    const all = OnboardingOverview.features(tinyCatalog, { curatedOnly: false, curatedDefault: true })
    expect(all.destinations).toEqual([
      { id: 'threads', count: 1 },
      { id: 'work', count: 1 },
      { id: 'none', count: 1 },
    ])
    expect(OnboardingOverview.features(tinyCatalog, { destination: 'work', curatedOnly: false, curatedDefault: true }).rows.map(row => row.key)).toEqual([
      'backlog#items',
    ])
    expect(OnboardingOverview.features(FEATURE_CATALOG, { curatedOnly: false, limit: 5, curatedDefault: true })).toMatchObject({ rows: { length: 5 } })
    expect(OnboardingOverview.features(tinyCatalog, { query: 'side ask', curatedDefault: true }).rows.map(row => row.key)).toEqual(['btw#side'])
    expect(OnboardingOverview.features(tinyCatalog, { query: 'side nothing', curatedDefault: true }).rows).toEqual([])
  })

  it('renders a bounded agent summary with the checklist, packs and rows', () => {
    const value = OnboardingOverview.overview({ catalog: FEATURE_CATALOG, facts: facts(), states: null, request: {}, curatedDefault: true, preview: null })
    const text = OnboardingOverview.render(value)
    expect(text.length).toBeLessThanOrEqual(6_000)
    expect(text).toContain('- [x] An AI account is connected')
    expect(text).toContain('Versioning workflow')
  })
})
